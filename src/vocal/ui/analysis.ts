/**
 * 分析页。产品里最重要的一页。
 *
 * 排版顺序是刻意的：先给结论（最大的问题是什么），再给证据（图和指标），
 * 最后给下一步（练什么）。不是先甩一个总分让用户自己猜。
 *
 * 逐音复盘的绿/黄/红条是「问题节点」——点红色的能看到那个音你唱成了什么、
 * 偏了多少、为什么、该怎么练。这比一个总分有用得多。
 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import { midiToName } from '../dsp/notes';
import type { PitchFrame } from '../dsp/pitch';
import type { NoteReview, PerformanceReport, Reference } from '../analysis/types';
import { SECTION_LABEL } from '../analysis/types';
import { buildReference, SONG_BY_ID } from '../songs/library';
import { getCoachFeedback, type CoachFeedback } from '../ai/coach';
import { EXERCISE_BY_ID } from '../training/exercises';
import {
  deleteAudio,
  deleteSession,
  getCurve,
  getReport,
  getSessions,
  getSettings,
  loadAudio,
  recentSessions,
  saveAudio,
  setSessionAudioFlag,
  unpackCurve,
} from '../data/store';
import { Playback } from '../audio/playback';
import { playTone } from '../audio/synth';
import {
  btn,
  card,
  el,
  esc,
  empty,
  fmtDuration,
  loading,
  makeCanvas,
  metricBlock,
  scoreColor,
  sectionTitle,
  type View,
} from './components';
import { drawComparison, drawRange } from './charts';

export function renderAnalysis(box: HTMLElement, ctx: Ctx, sessionId: string): () => void {
  const fromMemory = ctx.last && ctx.last.id === sessionId ? ctx.last : null;
  const report: PerformanceReport | null = fromMemory?.result.report ?? getReport(sessionId);

  if (!report) {
    box.appendChild(topbar('分析', () => ctx.back()));
    box.appendChild(empty('这次记录的详细报告已经不在本地了（只保留最近 20 次的完整报告）。'));
    return () => {};
  }

  // 画图需要音高轨迹：刚唱完的在内存里，历史记录读压缩过的曲线
  const frames: PitchFrame[] = fromMemory
    ? fromMemory.result.track.frames
    : (getCurve(sessionId) ?? []).length
      ? unpackCurve(getCurve(sessionId)!).map((p) => ({
          t: p.t,
          midi: p.midi,
          f0: 0,
          clarity: 1,
          rms: 0,
          voiced: p.voiced,
        }))
      : [];

  // 重建参考旋律（报告里只存了 id 和移调，旋律本身从曲库来）
  let ref: Reference | null = null;
  if (report.refId) {
    const [songId, secStr] = report.refId.split('#');
    const song = SONG_BY_ID.get(songId);
    if (song) {
      ref = buildReference(song, {
        transpose: report.transpose,
        sectionOnly: secStr !== undefined ? Number(secStr) : undefined,
      });
    }
  }

  const playback = new Playback();
  let disposed = false;
  const views: View[] = [];
  let selected: number | null = null;

  const wrap = el('div', 'v-wrap');
  box.appendChild(topbar(report.refTitle, () => ctx.go({ p: 'home' })));
  box.appendChild(wrap);

  // ---------------------------------------------------------------- 结论
  const quality = report.quality;
  if (quality.blocked) {
    const n = el('div', 'v-note bad');
    n.innerHTML =
      `<b>${esc(quality.summary)}</b><br>` +
      quality.issues.map((i) => `· ${esc(i.message)}——${esc(i.fix)}`).join('<br>');
    wrap.appendChild(n);
    wrap.appendChild(
      btn('重新唱一次', 'v-btn primary big', () =>
        report.refId
          ? ctx.go({ p: 'practice', songId: report.refId.split('#')[0] })
          : ctx.go({ p: 'songs' }),
      ),
    );
    return () => {
      disposed = true;
      playback.dispose();
    };
  }

  // 综合分（明确标注只是辅助）
  const scoreCard = card();
  const top = report.findings[0];
  if (report.overall !== null) {
    const sc = el('div', 'v-score');
    sc.innerHTML =
      `<div class="n" style="color:${scoreColor(report.overall)}">${report.overall}</div>` +
      `<div class="l">综合分 · 各维度加权，仅作辅助参考。真正有用的是下面每一项的原因</div>`;
    scoreCard.appendChild(sc);
  }
  const headline = el('div');
  headline.style.cssText = 'border-top:1px solid var(--v-line);padding-top:13px';
  headline.innerHTML =
    `<div style="font-size:12px;color:var(--v-dim);margin-bottom:5px">这次最大的问题</div>` +
    `<div style="font-size:16px;font-weight:600;line-height:1.55">${esc(top.title)}</div>` +
    `<div style="font-size:13px;color:var(--v-muted);line-height:1.7;margin-top:6px">${esc(top.evidence)}</div>`;
  scoreCard.appendChild(headline);
  wrap.appendChild(scoreCard);

  if (quality.issues.length) {
    const n = el('div', 'v-note warn');
    n.innerHTML =
      `<b>录音质量提醒</b><br>` +
      quality.issues.map((i) => `· ${esc(i.message)}——${esc(i.fix)}`).join('<br>');
    wrap.appendChild(n);
  }

  // ---------------------------------------------------------------- 对比图
  wrap.appendChild(sectionTitle('目标音高 vs 你的实际音高'));
  const chartCard = card();
  const chartView = makeCanvas(chartCard, 'v-canvas', 210);
  views.push(chartView);
  const legend = el('div', 'v-legend');
  legend.innerHTML =
    '<span><em style="background:var(--v-target)"></em>目标</span>' +
    '<span><em style="background:var(--v-green)"></em>准（±50 音分内）</span>' +
    '<span><em style="background:var(--v-yellow)"></em>有点偏</span>' +
    '<span><em style="background:var(--v-red)"></em>明显偏</span>';
  legend.style.marginTop = '8px';
  chartCard.appendChild(legend);
  if (!frames.length) {
    chartCard.appendChild(
      el('p', '', '这次的音高曲线没有留存（只保留最近 8 次），所以画不出对比图。'),
    );
  }
  wrap.appendChild(chartCard);

  const redraw = () => {
    if (disposed) return;
    drawComparison(chartView, {
      ref,
      frames,
      notes: report.intonation.notes,
      selected,
      playhead: playback.playing ? playback.positionNow() : null,
    });
  };
  requestAnimationFrame(redraw);

  // ---------------------------------------------------------------- 问题节点
  if (report.intonation.notes.length) {
    wrap.appendChild(sectionTitle('逐音复盘 · 点一下看详情'));
    const nodeCard = card();
    const timeline = el('div', 'v-timeline');
    const counts = { green: 0, yellow: 0, red: 0, miss: 0 };
    report.intonation.notes.forEach((n, i) => {
      counts[n.level]++;
      const bar = el('i', n.level);
      bar.title = `${n.lyric || midiToName(n.targetMidi)}`;
      bar.addEventListener('click', () => {
        selected = selected === i ? null : i;
        for (const c of Array.from(timeline.children)) c.classList.remove('sel');
        if (selected !== null) timeline.children[selected]?.classList.add('sel');
        showDetail();
        redraw();
      });
      timeline.appendChild(bar);
    });
    nodeCard.appendChild(timeline);
    const lg = el('div', 'v-legend');
    lg.innerHTML =
      `<span><em style="background:var(--v-green)"></em>稳 ${counts.green}</span>` +
      `<span><em style="background:var(--v-yellow)"></em>注意 ${counts.yellow}</span>` +
      `<span><em style="background:var(--v-red)"></em>问题 ${counts.red}</span>` +
      `<span><em style="background:var(--v-line)"></em>没唱 ${counts.miss}</span>`;
    nodeCard.appendChild(lg);

    const detailBox = el('div');
    nodeCard.appendChild(detailBox);

    const worst = report.intonation.notes
      .map((n, i) => ({ n, i }))
      .filter((x) => x.n.level === 'red' || x.n.level === 'miss')
      .sort((a, b) => Math.abs(b.n.cents ?? 999) - Math.abs(a.n.cents ?? 999));

    if (worst.length) {
      const jump = el('div');
      jump.style.cssText = 'margin-top:10px;display:flex;gap:6px;flex-wrap:wrap';
      const jumpLabel = el('span', '', '问题最大的几处：');
      jumpLabel.style.cssText = 'font-size:12px;color:var(--v-dim);align-self:center';
      jump.appendChild(jumpLabel);
      for (const x of worst.slice(0, 5)) {
        const b = btn(
          `${esc(x.n.lyric || midiToName(x.n.targetMidi))}`,
          'v-tag red',
          () => {
            selected = x.i;
            for (const c of Array.from(timeline.children)) c.classList.remove('sel');
            timeline.children[x.i]?.classList.add('sel');
            showDetail();
            redraw();
          },
        );
        b.style.cssText = 'cursor:pointer;padding:4px 10px;background:none';
        jump.appendChild(b);
      }
      nodeCard.appendChild(jump);
    } else {
      nodeCard.appendChild(el('p', '', '这次没有明显跑掉的音。'));
    }

    function showDetail() {
      detailBox.innerHTML = '';
      if (selected === null) return;
      const n = report!.intonation.notes[selected];
      const d = el('div', 'v-note-detail');
      const rows: [string, string][] = [
        ['歌词', n.lyric || '（无词）'],
        ['目标音', midiToName(n.targetMidi)],
        ['你唱的', n.sungMidi === null ? '没唱出来' : midiToName(n.sungMidi)],
        [
          '音高偏差',
          n.cents === null
            ? '—'
            : `${n.cents > 0 ? '高' : '低'} ${Math.abs(Math.round(n.cents))} 音分`,
        ],
        [
          '入拍偏差',
          n.timing === null
            ? '—'
            : `${n.timing > 0 ? '晚' : '早'} ${Math.abs(Math.round(n.timing * 1000))} 毫秒`,
        ],
        ['命中率', n.cents === null ? '—' : `${Math.round(n.hit * 100)}%`],
        ['所在段落', ref ? (ref.sections[n.section]?.name ?? '—') : '—'],
      ];
      for (const [k, v] of rows) {
        const r = el('div', 'row');
        r.innerHTML = `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`;
        d.appendChild(r);
      }
      if (n.issues.length) {
        const iss = el('div', '');
        iss.style.cssText =
          'margin-top:9px;padding-top:9px;border-top:1px solid var(--v-line);font-size:13px;line-height:1.7;color:var(--v-muted)';
        iss.innerHTML = n.issues.map((s) => `· ${esc(s)}`).join('<br>');
        d.appendChild(iss);
      }
      const acts = el('div', 'v-btn-row');
      acts.style.marginTop = '10px';
      acts.appendChild(
        btn('🔊 听目标音', 'v-btn ghost', () => {
          playTone(n.targetMidi, 1.2, 0, 0.3);
        }),
      );
      acts.appendChild(
        btn('▶ 听我唱的', 'v-btn ghost', () => {
          void playMySegment(n);
        }),
      );
      d.appendChild(acts);
      detailBox.appendChild(d);
    }
  }

  // ---------------------------------------------------------------- 指标
  wrap.appendChild(sectionTitle('音准'));
  const pitchCard = card();
  pitchCard.appendChild(metricBlock('音准', report.intonation.accuracy));
  pitchCard.appendChild(metricBlock('命中率', report.intonation.hitRate));
  pitchCard.appendChild(metricBlock('稳定性', report.intonation.stability));
  pitchCard.appendChild(metricBlock('高音稳定度', report.intonation.highNotes));
  if (report.intonation.bias !== null && Math.abs(report.intonation.bias) > 12) {
    pitchCard.appendChild(
      el(
        'p',
        '',
        `整体倾向：${report.intonation.bias > 0 ? '偏高' : '偏低'} ${Math.abs(report.intonation.bias)} 音分。` +
          `这是所有音偏差的中位数——它和「音准」那一项不同，音准看的是偏多少，这里看的是往哪边偏。`,
      ),
    );
  }
  wrap.appendChild(pitchCard);

  if (report.rhythm) {
    wrap.appendChild(sectionTitle('节奏'));
    const rc = card();
    if (report.rhythm.notice) {
      rc.appendChild(el('div', 'v-note warn', esc(report.rhythm.notice)));
    }
    rc.appendChild(metricBlock('入拍一致性', report.rhythm.timing));
    rc.appendChild(metricBlock('节奏稳定度', report.rhythm.steadiness));
    if (!report.rhythm.degraded && report.rhythm.absoluteTrustworthy) {
      rc.appendChild(
        el(
          'p',
          '',
          `抢拍 ${report.rhythm.rushCount} 处 · 拖拍 ${report.rhythm.dragCount} 处 · 准点 ${report.rhythm.onTimeCount} 处。${esc(report.rhythm.phraseEnd.note)}`,
        ),
      );
    }
    if (!report.rhythm.absoluteTrustworthy && !report.rhythm.degraded) {
      rc.appendChild(
        btn('去校准设备延迟（十秒）', 'v-btn ghost', () => ctx.go({ p: 'settings' })),
      );
    }
    wrap.appendChild(rc);
  }

  // 音域
  wrap.appendChild(sectionTitle('音域'));
  const rangeCard = card();
  if (report.intonation.range) {
    const r = report.intonation.range;
    const rv = makeCanvas(rangeCard, 'v-canvas', 62);
    views.push(rv);
    requestAnimationFrame(() =>
      drawRange(
        rv,
        { lo: r.lo, hi: r.hi, comfortLo: r.comfortLo, comfortHi: r.comfortHi },
        ref ? { lo: Math.min(...ref.notes.map((n) => n.midi)), hi: Math.max(...ref.notes.map((n) => n.midi)) } : null,
      ),
    );
    rangeCard.appendChild(
      el(
        'p',
        '',
        `这次唱到 ${midiToName(r.lo)} ~ ${midiToName(r.hi)}，跨度 ${Math.round(r.span)} 个半音；` +
          `舒适区（去掉最极端的 10%）是 ${midiToName(r.comfortLo)} ~ ${midiToName(r.comfortHi)}。` +
          `音域是这一次唱出来的结果，不是你的能力上限——状态、调高、歌本身都会影响它。`,
      ),
    );
  } else {
    rangeCard.appendChild(el('p', '', '发声太少，这次测不出音域。'));
  }
  wrap.appendChild(rangeCard);

  // 声音特征
  wrap.appendChild(sectionTitle('声音特征'));
  const vc = card();
  const v = report.voice;
  vc.innerHTML =
    `<p>最长连续发声 <b style="color:var(--v-text)">${v.longestNoteSec} 秒</b> · ` +
    `动态范围 <b style="color:var(--v-text)">${v.dynamicRangeDb} dB</b> · ` +
    `平均电平 ${v.meanDb} dBFS · 信噪比 ${v.snrDb} dB</p>` +
    (v.perturbationBasisSec >= 3
      ? `<p>音高微抖动 ${v.jitterPct}% · 音量微抖动 ${v.shimmerPct}%（基于 ${v.perturbationBasisSec} 秒持续音）</p>`
      : '') +
    `<p style="color:var(--v-dim);font-size:12px">以上是基于本次录音的算法指标，受设备、距离、房间影响很大。` +
    `它们不能用来判断声带健康、声带闭合或任何身体状况——一段普通录音得不出那种结论。</p>`;
  wrap.appendChild(vc);

  // 段落表现
  if (report.sections.length > 1) {
    wrap.appendChild(sectionTitle('分段表现'));
    const sc = card();
    for (const s of report.sections) {
      const row = el('div', 'v-row');
      row.style.cursor = 'default';
      const main = el('div', 'main');
      main.appendChild(el('div', 't', `${esc(s.name)} · ${esc(SECTION_LABEL[s.kind])}`));
      main.appendChild(
        el(
          'div',
          'd',
          s.accuracy === null ? '这一段没有要唱的音（纯伴奏）' : `平均偏 ${s.accuracy} 音分`,
        ),
      );
      row.appendChild(main);
      if (s.hitRate !== null) {
        const r = el('div', 'r');
        r.innerHTML = `<span class="big" style="color:${scoreColor(s.hitRate)}">${s.hitRate}</span><br>命中率`;
        row.appendChild(r);
      }
      sc.appendChild(row);
    }
    // 最差的一段直接给「单练这段」的入口
    const worstSec = report.sections
      .map((s, i) => ({ s, i }))
      .filter((x) => x.s.accuracy !== null)
      .sort((a, b) => (b.s.accuracy ?? 0) - (a.s.accuracy ?? 0))[0];
    if (worstSec && report.refId && !report.refId.includes('#')) {
      sc.appendChild(
        btn(`单练「${esc(worstSec.s.name)}」这一段`, 'v-btn', () =>
          ctx.go({ p: 'practice', songId: report.refId!.split('#')[0], section: worstSec.i }),
        ),
      );
    }
    wrap.appendChild(sc);
  }

  // ---------------------------------------------------------------- AI 教练
  wrap.appendChild(sectionTitle('AI 教练'));
  const coachCard = card('v-coach');
  coachCard.appendChild(loading('正在生成教学反馈…'));
  wrap.appendChild(coachCard);

  void (async () => {
    const settings = getSettings();
    const history = recentSessions(6).filter((s) => s.id !== sessionId);
    const fb = await getCoachFeedback(report!, history, settings.provider);
    if (disposed) return;
    coachCard.innerHTML = '';
    renderCoach(coachCard, fb, ctx);
  })();

  // ---------------------------------------------------------------- 动作
  wrap.appendChild(sectionTitle('接下来'));
  const actCard = card();
  const acts = el('div', 'v-btn-row');
  if (report.refId) {
    acts.appendChild(
      btn('🔁 再唱一次', 'v-btn primary', () =>
        ctx.go({
          p: 'practice',
          songId: report.refId!.split('#')[0],
          section: report.refId!.includes('#') ? Number(report.refId!.split('#')[1]) : undefined,
        }),
      ),
    );
  }
  acts.appendChild(btn('🎯 去训练', 'v-btn', () => ctx.go({ p: 'training' })));
  actCard.appendChild(acts);

  // 同一首歌的历史对比
  const sameSong = getSessions()
    .filter((s) => s.refId === report.refId && s.id !== sessionId)
    .sort((a, b) => b.at - a.at);
  if (sameSong.length && report.overall !== null) {
    const prev = sameSong[0];
    if (prev.overall !== null) {
      const d = report.overall - prev.overall;
      actCard.appendChild(
        el(
          'p',
          '',
          `这首歌你唱过 ${sameSong.length + 1} 次。上次综合 ${prev.overall} 分，这次 ${report.overall} 分，` +
            (Math.abs(d) < 3 ? '基本持平（3 分以内属于正常波动）。' : `${d > 0 ? '高了' : '低了'} ${Math.abs(d)} 分。`),
        ),
      );
      actCard.appendChild(btn('看这首歌的进步曲线', 'v-btn ghost', () => ctx.go({ p: 'progress' })));
    }
  }
  wrap.appendChild(actCard);

  // ---------------------------------------------------------------- 录音处置
  wrap.appendChild(sectionTitle('这段录音'));
  const audioCard = card();
  const sess = getSessions().find((s) => s.id === sessionId);
  const hasMem = !!fromMemory;
  const hasSaved = !!sess?.hasAudio;

  const audioInfo = el('p', '');
  audioInfo.innerHTML = hasSaved
    ? `已按你的设置保存在这台设备上（时长 ${fmtDuration(report.duration)}）。`
    : hasMem
      ? `录音还在内存里，<b style="color:var(--v-text)">离开这个页面就会丢掉</b>——默认不保存是为了保护你的隐私。想留就点下面的按钮。`
      : '这次录音没有保存。';
  audioCard.appendChild(audioInfo);

  const audioActs = el('div', 'v-btn-row');
  if (hasMem || hasSaved) {
    audioActs.appendChild(
      btn('▶ 播放', 'v-btn', () => {
        void playAll();
      }),
    );
  }
  if (hasMem && !hasSaved) {
    audioActs.appendChild(
      btn('💾 保存这次录音', 'v-btn', async () => {
        const rec = fromMemory!.recording;
        await saveAudio(sessionId, rec.samples, rec.sampleRate);
        setSessionAudioFlag(sessionId, true);
        ctx.refresh();
      }),
    );
  }
  if (hasSaved) {
    audioActs.appendChild(
      btn('🗑 删除录音', 'v-btn danger', async () => {
        await deleteAudio(sessionId);
        setSessionAudioFlag(sessionId, false);
        ctx.refresh();
      }),
    );
  }
  audioActs.appendChild(
    btn('🗑 删除这条记录', 'v-btn danger', async () => {
      await deleteSession(sessionId);
      ctx.go({ p: 'home' });
    }),
  );
  audioCard.appendChild(audioActs);
  wrap.appendChild(audioCard);

  // ---------------------------------------------------------------- 播放辅助
  async function ensureAudio(): Promise<boolean> {
    if (playback.duration > 0) return true;
    if (fromMemory) {
      playback.load(fromMemory.recording.samples, fromMemory.recording.sampleRate);
      return true;
    }
    const saved = await loadAudio(sessionId);
    if (!saved) return false;
    playback.load(saved.samples, saved.sampleRate);
    return true;
  }

  async function playAll() {
    if (!(await ensureAudio())) return;
    playback.play(0);
    tickPlayhead();
  }

  async function playMySegment(n: NoteReview) {
    if (!(await ensureAudio())) {
      audioInfo.innerHTML = '录音已经不在了，听不了——这次没有保存。';
      return;
    }
    // 前后各多给 0.15 秒，不然听起来像被切掉一半
    playback.play(Math.max(0, n.start - 0.15), n.end - n.start + 0.3);
    tickPlayhead();
  }

  function tickPlayhead() {
    if (disposed) return;
    redraw();
    if (playback.playing) requestAnimationFrame(tickPlayhead);
    else redraw();
  }

  return () => {
    disposed = true;
    playback.dispose();
    for (const v of views) v.dispose();
  };
}

/** 五段式教练反馈 */
function renderCoach(host: HTMLElement, fb: CoachFeedback, ctx: Ctx): void {
  const block = (label: string, text: string) => {
    const b = el('div', 'block');
    b.appendChild(el('div', 'lbl', label));
    b.appendChild(el('div', 'txt', esc(text)));
    return b;
  };

  if (fb.fallbackReason) {
    host.appendChild(el('div', 'v-note warn', esc(fb.fallbackReason)));
  }
  host.appendChild(block('① 你唱得好的地方', fb.good));
  host.appendChild(block('② 最大的问题', fb.problem));
  host.appendChild(block('③ 为什么会这样', fb.why));

  const drills = el('div', 'block');
  drills.appendChild(el('div', 'lbl', '④ 怎么练'));
  for (const d of fb.drills) {
    const ex = EXERCISE_BY_ID.get(d.exerciseId);
    const row = el('div', 'drill');
    row.innerHTML =
      `<div class="info"><div class="nm">${esc(d.name)} · ${d.minutes} 分钟</div>` +
      `<div class="rs">${esc(d.reason)}</div></div><div class="go">去练 →</div>`;
    row.addEventListener('click', () => ctx.go({ p: 'exercise', id: d.exerciseId }));
    if (!ex) row.style.opacity = '0.5';
    drills.appendChild(row);
  }
  host.appendChild(drills);

  host.appendChild(block('⑤ 下一次的目标', fb.goal));

  const src = el('div', '');
  src.style.cssText =
    'margin-top:14px;padding-top:11px;border-top:1px solid var(--v-line);font-size:11.5px;color:var(--v-dim);line-height:1.65';
  src.textContent =
    `反馈来源：${fb.source}。所有数字来自上面的算法分析，AI 只负责解释和给建议。` +
    `这不等同于专业声乐老师的评估。`;
  host.appendChild(src);
}
