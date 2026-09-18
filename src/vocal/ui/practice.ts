/**
 * 练歌页：准备 → 跟唱 → 分析。
 *
 * 两个关键点：
 *
 * 1. **时间轴对齐**。录音和伴奏都挂在同一个 AudioContext 上，
 *    但两者的起点差几十毫秒。分析层要求「录音的第 0 个采样点 = 参考时间轴的 0 秒」，
 *    所以这里按两个起点的差值裁掉或补上开头，让两把尺子对齐。
 *    剩下的设备输入延迟交给节奏分析里的校准机制处理。
 *
 * 2. **实时只是辅助**。屏幕上的实时音高是给你唱的时候看的，
 *    最终结论一律以唱完之后的离线分析为准——离线能前后看、能修八度、
 *    能做中值滤波，准得多。产品需求里也是这么要求的。
 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import { LiveDetector } from '../dsp/pitch';
import { midiToName } from '../dsp/notes';
import { analyzePerformance } from '../analysis/performance';
import type { Reference } from '../analysis/types';
import { buildReference, SONG_BY_ID, songRange } from '../songs/library';
import { Accompaniment } from '../audio/synth';
import { audioCtx, resumeAudio } from '../audio/context';
import { MAX_RECORD_SEC, type Recorder } from '../audio/recorder';
import { buildProfile } from '../data/profile';
import { addSession, getSettings, saveCurve, saveReport, packCurve, saveAudio } from '../data/store';
import { summarize } from '../data/types';
import {
  btn,
  card,
  el,
  esc,
  loading,
  makeCanvas,
  rafLoop,
  segmented,
  sectionTitle,
  type View,
} from './components';
import { drawRoll, drawRange } from './charts';

export function renderPractice(
  box: HTMLElement,
  ctx: Ctx,
  songId: string,
  presetSection?: number,
): () => void {
  const free = songId === '__free__';
  const song = free ? null : SONG_BY_ID.get(songId);
  if (!free && !song) {
    box.appendChild(el('div', 'v-empty', '找不到这首歌。'));
    return () => {};
  }

  const settings = getSettings();
  let transpose = 0;
  let sectionOnly: number | undefined = presetSection;
  let guide = settings.guideLevel;
  let tempoScale = 1;

  let cleanup: (() => void) | null = null;
  const dispose = () => {
    cleanup?.();
    cleanup = null;
  };

  // 有音域记录就自动推荐一个合适的调
  if (song) {
    const profile = buildProfile();
    if (profile.range) {
      const sr = songRange(song);
      let t = Math.round((profile.range.comfortLo + profile.range.comfortHi) / 2 - (sr.lo + sr.hi) / 2);
      t -= Math.round(t / 12) * 12; // 八度交给评分折叠，这里只调 ±6 以内
      transpose = Math.max(-6, Math.min(6, t));
    }
  }

  function clear() {
    dispose();
    box.innerHTML = '';
  }

  // ------------------------------------------------------------ 准备页
  function setup() {
    clear();
    box.className = 'v-page';
    const wrap = el('div', 'v-wrap');
    box.appendChild(topbar(free ? '自由演唱' : `${song!.emoji} ${song!.name}`, () => ctx.back()));
    box.appendChild(wrap);
    wrap.style.padding = '16px';

    if (free) {
      const c = card();
      c.innerHTML =
        '<h3>录一段你自己的</h3>' +
        '<p>没有伴奏也没有目标旋律，所以不评音准和节奏——' +
        '没有参考就下这种结论是在编数字。会分析的是：你的音域、长音稳不稳、' +
        '声音的动态范围，以及这段录音本身的质量。</p>' +
        '<p>建议唱 20 秒以上，中间可以停顿。</p>';
      wrap.appendChild(c);
    } else {
      const sr = songRange(song!);
      const info = card();
      info.innerHTML =
        `<h3>${esc(song!.name)}</h3>` +
        `<p>${song!.bpm} BPM · 原调最高 ${midiToName(sr.hi)} · ${esc(song!.source)}</p>`;
      const rangeView = makeCanvas(info, 'v-canvas', 62);
      const profile = buildProfile();
      requestAnimationFrame(() =>
        drawRange(
          rangeView,
          profile.range
            ? {
                lo: profile.range.lo,
                hi: profile.range.hi,
                comfortLo: profile.range.comfortLo,
                comfortHi: profile.range.comfortHi,
              }
            : null,
          { lo: sr.lo + transpose, hi: sr.hi + transpose },
        ),
      );
      wrap.appendChild(info);

      // ---- 调 ----
      wrap.appendChild(sectionTitle('调'));
      const keyCard = card();
      const keyRow = el('div', 'v-btn-row');
      const keyLabel = el('span', 'v-key');
      const updateKey = () => {
        const hi = songRange(song!).hi + transpose;
        keyLabel.textContent = `${transpose > 0 ? '+' : ''}${transpose}`;
        keyNote.textContent = `移调后最高音 ${midiToName(hi)}${
          profile.range
            ? hi > profile.range.hi + 1
              ? '（超出你唱到过的最高音，会比较吃力）'
              : hi > profile.range.comfortHi
                ? '（在你的舒适区上沿）'
                : '（在舒适区内）'
            : ''
        }`;
        drawRange(
          rangeView,
          profile.range
            ? {
                lo: profile.range.lo,
                hi: profile.range.hi,
                comfortLo: profile.range.comfortLo,
                comfortHi: profile.range.comfortHi,
              }
            : null,
          { lo: songRange(song!).lo + transpose, hi },
        );
      };
      keyRow.appendChild(
        btn('♭ 降', 'v-btn', () => {
          if (transpose > -6) transpose--;
          updateKey();
        }),
      );
      keyRow.appendChild(keyLabel);
      keyRow.appendChild(
        btn('♯ 升', 'v-btn', () => {
          if (transpose < 6) transpose++;
          updateKey();
        }),
      );
      keyCard.appendChild(keyRow);
      const keyNote = el('p', '');
      keyNote.style.marginTop = '10px';
      keyCard.appendChild(keyNote);
      updateKey();
      wrap.appendChild(keyCard);

      // ---- 分段练习 ----
      wrap.appendChild(sectionTitle('练哪一段'));
      const secCard = card();
      const secOpts = [{ value: '-1', label: '整首' }].concat(
        song!.sections.map((s, i) => ({ value: String(i), label: s.name ?? s.kind })),
      );
      secCard.appendChild(
        segmented(secOpts, String(sectionOnly ?? -1), (v) => {
          const n = Number(v);
          sectionOnly = n < 0 ? undefined : n;
        }),
      );
      secCard.appendChild(
        el(
          'p',
          '',
          '副歌唱不好就单练副歌——比每次都从头唱效率高得多。' +
            '纯伴奏的前奏/尾奏不计入评分。',
        ),
      );
      wrap.appendChild(secCard);

      // ---- 速度 ----
      wrap.appendChild(sectionTitle('速度'));
      const tempoCard = card();
      tempoCard.appendChild(
        segmented(
          [
            { value: '0.7', label: '70%' },
            { value: '0.85', label: '85%' },
            { value: '1', label: '原速' },
          ],
          '1',
          (v) => {
            tempoScale = Number(v);
          },
        ),
      );
      tempoCard.appendChild(el('p', '', '节奏总跟不上时，先放慢练熟，再回原速。'));
      wrap.appendChild(tempoCard);

      // ---- 模式 ----
      wrap.appendChild(sectionTitle('提示强度'));
      const modeCard = card();
      modeCard.appendChild(
        segmented(
          [
            { value: 'novice', label: '新手' },
            { value: 'normal', label: '普通' },
            { value: 'exam', label: '考试' },
          ],
          guide,
          (v) => {
            guide = v as typeof guide;
            modeDesc.textContent = MODE_DESC[guide];
          },
        ),
      );
      const modeDesc = el('p', '');
      modeDesc.style.marginTop = '10px';
      modeDesc.textContent = MODE_DESC[guide];
      modeCard.appendChild(modeDesc);
      wrap.appendChild(modeCard);
    }

    // ---- 麦克风与开始 ----
    const hint = ctx.micHint();
    if (hint) {
      const n = el('div', 'v-note bad');
      n.innerHTML = `<b>${esc(hint.text)}</b><br>${esc(hint.fix)}`;
      wrap.appendChild(n);
    }
    wrap.appendChild(
      el(
        'div',
        'v-note',
        '点开始后会请求麦克风权限。录音只在这台设备上分析，' +
          `默认不保存，唱完离开页面就没了。最长录 ${Math.round(MAX_RECORD_SEC / 60)} 分钟。`,
      ),
    );

    const start = btn(free ? '● 开始录音' : '▶ 开始跟唱', 'v-btn primary big', async () => {
      start.disabled = true;
      start.innerHTML = '<span class="v-spinner"></span> 正在打开麦克风…';
      resumeAudio();
      const mic = await ctx.requestMic();
      if (!mic) {
        ctx.refresh();
        return;
      }
      sing(mic);
    });
    wrap.appendChild(start);

    return () => {};
  }

  const MODE_DESC: Record<string, string> = {
    novice: '音符条上标歌词，跑调时直接画箭头告诉你该往上还是往下。适合刚开始练的人。',
    normal: '只显示音符条和你的音高线，不给纠正提示。',
    exam: '唱的时候不显示任何提示，唱完再看分析。想测真实水平就用这个。',
  };

  // ------------------------------------------------------------ 跟唱页
  function sing(mic: Recorder) {
    clear();
    box.className = 'v-page';
    box.style.padding = '0';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';

    const ref: Reference | null = song
      ? buildReference(song, { transpose, sectionOnly, tempoScale, leadInBeats: 4 })
      : null;

    const stage = el('div', 'v-stage');
    box.appendChild(stage);

    // 顶部实时读数
    const live = el('div', 'v-live');
    live.innerHTML =
      '<span class="dot"></span><span class="t">准备…</span>' +
      '<span class="cents"></span><span class="lvl"><i style="width:0%"></i></span>';
    stage.appendChild(live);
    const liveText = live.querySelector('.t') as HTMLElement;
    const liveCents = live.querySelector('.cents') as HTMLElement;
    const liveLevel = live.querySelector('.lvl i') as HTMLElement;

    let lyricBar: HTMLElement | null = null;
    let view: View | null = null;

    if (ref) {
      lyricBar = el('div', 'v-lyric');
      stage.appendChild(lyricBar);
      view = makeCanvas(stage, 'v-canvas v-roll');
    } else {
      // 自由演唱：没有卷帘，给一个大计时器和电平表
      const freeBox = el('div', 'v-drill-stage');
      freeBox.style.cssText = 'flex:1;display:flex;flex-direction:column;justify-content:center;padding:24px';
      freeBox.innerHTML =
        '<div class="target" id="v-timer">0:00</div>' +
        '<div class="hint" id="v-freehint">随便唱，唱够 20 秒以上分析才有意义</div>';
      stage.appendChild(freeBox);
      view = makeCanvas(freeBox, 'v-canvas', 90);
    }

    // 控制条
    const ctrl = el('div', 'v-ctrl');
    const stopBtn = btn('■ 唱完了', 'v-btn rec', () => finish());
    const cancelBtn = btn('取消', 'v-btn ghost small', () => {
      abort();
      setup();
    });
    cancelBtn.style.flex = '0 0 76px';
    ctrl.appendChild(cancelBtn);
    ctrl.appendChild(stopBtn);
    box.appendChild(ctrl);

    // ---- 启动录音与伴奏 ----
    const detector = new LiveDetector(audioCtx().sampleRate);
    const acc = new Accompaniment();
    const trail: { t: number; midi: number }[] = [];
    let refStartCtx = 0;
    let recStartCtx = 0;
    let stopLoop: (() => void) | null = null;
    let ended = false;

    const abort = () => {
      ended = true;
      stopLoop?.();
      acc.stop();
      if (mic.isRecording) mic.stop();
    };
    cleanup = abort;

    void (async () => {
      await mic.start(() => finish());
      recStartCtx = audioCtx().currentTime;
      if (ref) {
        refStartCtx = acc.play(ref, settings.accompanimentVolume, settings.leadClicks, () => finish());
      } else {
        refStartCtx = recStartCtx;
      }

      stopLoop = rafLoop(() => {
        if (ended) return;
        const now = audioCtx().currentTime - refStartCtx;
        const frame = mic.readFrame();
        const p = detector.detect(frame);
        const level = mic.readLevel();
        liveLevel.style.width = `${Math.min(100, level * 420)}%`;
        liveLevel.style.background =
          level > 0.55 ? 'var(--v-red)' : level < 0.012 ? 'var(--v-dim)' : 'var(--v-green)';

        if (p) {
          trail.push({ t: now, midi: p.midi });
          // 只留最近 8 秒，内存和绘制都轻
          while (trail.length && trail[0].t < now - 8) trail.shift();
        }

        if (ref && view) {
          drawRoll(view, {
            ref,
            now,
            trail: guide === 'exam' ? [] : trail,
            current: guide === 'exam' ? null : (p?.midi ?? null),
            guide,
          });
          updateLive(ref, now, p?.midi ?? null);
          updateLyric(ref, now);
        } else if (view) {
          drawFreeMeter(view, trail, now);
          const t = mic.elapsed;
          const timer = document.getElementById('v-timer');
          if (timer) timer.textContent = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
          liveText.textContent = p ? midiToName(p.midi) : '没听到声音';
          liveCents.textContent = '';
        }
      });
    })();

    function updateLive(r: Reference, now: number, midi: number | null) {
      const target = r.notes.find((n) => now >= n.start && now <= n.start + n.dur);
      if (!target) {
        liveText.textContent = now < (r.notes[0]?.start ?? 0) ? '准备…' : '间奏';
        liveCents.textContent = '';
        return;
      }
      liveText.textContent = `目标 ${midiToName(target.midi)}`;
      if (midi === null || guide === 'exam') {
        liveCents.textContent = '';
        return;
      }
      const folded = midi - Math.round((midi - target.midi) / 12) * 12;
      const cents = Math.round((folded - target.midi) * 100);
      liveCents.textContent = Math.abs(cents) <= 50 ? '✓ 准' : `${cents > 0 ? '高' : '低'} ${Math.abs(cents)}`;
      liveCents.style.color =
        Math.abs(cents) <= 50 ? 'var(--v-green)' : Math.abs(cents) <= 100 ? 'var(--v-yellow)' : 'var(--v-red)';
    }

    function updateLyric(r: Reference, now: number) {
      if (!lyricBar) return;
      const ph = r.phrases.find((p) => now >= p.startSec - 1 && now <= p.endSec);
      if (!ph) {
        lyricBar.innerHTML = '<span class="dim">…</span>';
        return;
      }
      const notes = r.notes.slice(ph.from, ph.to);
      lyricBar.innerHTML = notes
        .map((n) => {
          if (!n.lyric) return '';
          const on = now >= n.start && now <= n.start + n.dur;
          const past = now > n.start + n.dur;
          return `<span class="${on ? 'cur' : past ? '' : 'dim'}">${esc(n.lyric)}</span>`;
        })
        .join('');
    }

    async function finish() {
      if (ended) return;
      ended = true;
      stopLoop?.();
      acc.stop();
      const rec = mic.stop();
      cleanup = null;

      clear();
      box.className = 'v-page';
      box.style.padding = '16px';
      const wrap = el('div', 'v-wrap');
      wrap.appendChild(loading('正在分析这段录音…'));
      box.appendChild(wrap);

      // 让浏览器先把「分析中」画出来，再干重活
      await new Promise((r) => setTimeout(r, 30));

      const aligned = alignToReference(rec.samples, rec.sampleRate, recStartCtx, refStartCtx);
      const result = analyzePerformance(aligned, rec.sampleRate, ref, {
        mode: ref ? 'song' : 'free',
        latency: settings.latencyMs / 1000,
        calibrated: settings.calibrated,
      });

      const id = `s${Date.now().toString(36)}`;
      const keep = settings.keepAudio !== 'never';
      if (keep) {
        try {
          await saveAudio(id, aligned, rec.sampleRate);
        } catch {
          // 存不下就算了，不影响分析
        }
      }
      saveReport(id, result.report);
      saveCurve(id, packCurve(result.track.frames));
      addSession(summarize(result.report, id, keep));
      ctx.setLast(id, { ...result, track: { ...result.track } }, { ...rec, samples: aligned });
      ctx.go({ p: 'analysis', sessionId: id });
    }

    return abort;
  }

  cleanup = setup();
  return () => dispose();
}

/**
 * 把录音裁成「第 0 个采样点 = 参考时间轴 0 秒」。
 *
 * 录音先开、伴奏后开是常态（开麦有几十毫秒开销），这时要从录音开头
 * 砍掉那一段；反过来则在前面补静音。不做这一步，所有音符的时间都会整体偏，
 * 音准和节奏全都算错。
 */
export function alignToReference(
  samples: Float32Array,
  sampleRate: number,
  recStartCtx: number,
  refStartCtx: number,
): Float32Array {
  const shift = Math.round((refStartCtx - recStartCtx) * sampleRate);
  if (shift === 0) return samples;
  if (shift > 0) {
    // 伴奏比录音晚开：砍掉录音开头多出来的部分
    return shift >= samples.length ? new Float32Array(0) : samples.subarray(shift);
  }
  // 伴奏先开：录音前面补静音
  const pad = -shift;
  const out = new Float32Array(samples.length + pad);
  out.set(samples, pad);
  return out;
}

/** 自由演唱时的简易音高显示：没有目标，就把你唱的画出来 */
function drawFreeMeter(view: View, trail: { t: number; midi: number }[], now: number): void {
  const { g, w, h } = view;
  if (w < 10) return;
  g.fillStyle = '#181d25';
  g.fillRect(0, 0, w, h);
  const span = 8;
  const t0 = now - span;
  const pts = trail.filter((p) => p.t >= t0);
  if (pts.length < 2) return;
  let lo = Math.min(...pts.map((p) => p.midi)) - 3;
  let hi = Math.max(...pts.map((p) => p.midi)) + 3;
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2;
    lo = mid - 5;
    hi = mid + 5;
  }
  g.strokeStyle = '#4d9fff';
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  g.beginPath();
  pts.forEach((p, i) => {
    const x = ((p.t - t0) / span) * w;
    const y = h - ((p.midi - lo) / (hi - lo)) * h;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();
}
