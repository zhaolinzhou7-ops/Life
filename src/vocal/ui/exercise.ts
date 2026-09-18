/**
 * 单条练习的执行页面。
 *
 * 一步的节奏是：说明 → 示范 → 倒数 → 你唱（录音）→ 当场打分 → 下一步。
 * 打分用的是和唱歌完全一样的分析代码，所以练习成绩和演唱成绩可比。
 *
 * 高音类练习有一条硬规则：连续两步唱得明显吃力就自动停下来，
 * 并且明说「今天到这儿」。产品需求里写得很清楚——不能鼓励用户硬顶。
 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import { midiToName } from '../dsp/notes';
import { EXERCISE_BY_ID } from '../training/exercises';
import { anchorMidi, buildSteps, scoreStep, type StepDef, type StepResult } from '../training/runner';
import { audioCtx, resumeAudio } from '../audio/context';
import type { Recorder } from '../audio/recorder';
import { LiveDetector } from '../dsp/pitch';
import { buildProfile } from '../data/profile';
import { addTraining, getSettings, saveSettings } from '../data/store';
import { btn, card, el, esc, empty, makeCanvas, rafLoop, sectionTitle, type View } from './components';

export function renderExercise(box: HTMLElement, ctx: Ctx, exerciseId: string): () => void {
  const ex = EXERCISE_BY_ID.get(exerciseId);
  if (!ex) {
    box.appendChild(topbar('练习', () => ctx.back()));
    box.appendChild(empty('找不到这条练习。'));
    return () => {};
  }

  let cleanup: (() => void) | null = null;
  const dispose = () => {
    cleanup?.();
    cleanup = null;
  };
  const clear = () => {
    dispose();
    box.innerHTML = '';
  };

  // ------------------------------------------------------------ 说明页
  function intro() {
    clear();
    const wrap = el('div', 'v-wrap');
    box.appendChild(topbar(ex!.name, () => ctx.back()));
    box.appendChild(wrap);
    wrap.style.padding = '16px';

    const c = card();
    c.innerHTML =
      `<h3>练什么</h3><p>${esc(ex!.goal)}</p>` +
      `<h3 style="margin-top:14px">怎么做</h3><p>${esc(ex!.how)}</p>` +
      `<h3 style="margin-top:14px">为什么有用</h3><p>${esc(ex!.why)}</p>` +
      `<h3 style="margin-top:14px">最容易做错的地方</h3><p>${esc(ex!.pitfall)}</p>`;
    wrap.appendChild(c);

    const settings = getSettings();
    const profile = buildProfile();

    // 没测过音域时，需要知道大致声部才能定起始音——问一次就够了
    if (!profile.range && !settings.voiceType) {
      wrap.appendChild(sectionTitle('先确认一下'));
      const vc = card();
      vc.appendChild(
        el(
          'p',
          '',
          '还没有你的音域记录，所以不知道该从哪个音起。先粗略选一下——唱过一次歌之后，' +
            '起始音会自动按你的实际音域来定。',
        ),
      );
      const row = el('div', 'v-btn-row');
      row.appendChild(
        btn('偏低（多数男声）', 'v-btn', () => {
          saveSettings({ voiceType: 'low' });
          intro();
        }),
      );
      row.appendChild(
        btn('偏高（多数女声）', 'v-btn', () => {
          saveSettings({ voiceType: 'high' });
          intro();
        }),
      );
      vc.appendChild(row);
      wrap.appendChild(vc);
      return () => {};
    }

    const base = anchorMidi(ex!.run.anchor, profile.range, settings.voiceType ?? 'low');
    const steps = buildSteps(ex!, base);
    wrap.appendChild(
      el(
        'div',
        'v-note',
        `这一轮共 ${steps.length} 步，从 ${midiToName(base)} 起。` +
          (profile.range
            ? '起始音是按你最近的舒适音域定的。'
            : '起始音是按你选的声部定的，唱过歌之后会自动校准。') +
          (ex!.run.anchor === 'bridge'
            ? '（说明：真正的换声点需要专业判断，录音测不出来。这里用的是你舒适区的上沿作为近似。）'
            : ''),
      ),
    );

    const hint = ctx.micHint();
    if (hint) {
      const n = el('div', 'v-note bad');
      n.innerHTML = `<b>${esc(hint.text)}</b><br>${esc(hint.fix)}`;
      wrap.appendChild(n);
    }

    const go = btn('▶ 开始练习', 'v-btn primary big', async () => {
      go.disabled = true;
      go.innerHTML = '<span class="v-spinner"></span> 正在打开麦克风…';
      resumeAudio();
      const mic = await ctx.requestMic();
      if (!mic) {
        ctx.refresh();
        return;
      }
      run(mic, steps, base);
    });
    wrap.appendChild(go);
    return () => {};
  }

  // ------------------------------------------------------------ 执行
  function run(mic: Recorder, steps: StepDef[], base: number) {
    clear();
    const wrap = el('div', 'v-wrap');
    box.appendChild(topbar(ex!.name, () => ctx.back()));
    box.appendChild(wrap);
    wrap.style.padding = '16px';

    const stage = card();
    const big = el('div', 'v-drill-stage');
    big.innerHTML =
      '<div class="target" id="v-ex-big">—</div>' +
      '<div class="hint" id="v-ex-hint">准备…</div>' +
      '<div class="step" id="v-ex-step"></div>';
    stage.appendChild(big);
    const liveView = makeCanvas(stage, 'v-canvas', 110);
    wrap.appendChild(stage);

    const resultBox = el('div');
    wrap.appendChild(resultBox);

    const ctrl = el('div', 'v-btn-row');
    ctrl.style.marginTop = '12px';
    const skipBtn = btn('⏭ 跳过这步', 'v-btn ghost', () => {
      if (phase === 'listen') stopListening(true);
    });
    const stopBtn = btn('结束练习', 'v-btn danger', () => finish());
    ctrl.appendChild(skipBtn);
    ctrl.appendChild(stopBtn);
    wrap.appendChild(ctrl);

    const bigEl = big.querySelector('#v-ex-big') as HTMLElement;
    const hintEl = big.querySelector('#v-ex-hint') as HTMLElement;
    const stepEl = big.querySelector('#v-ex-step') as HTMLElement;

    const detector = new LiveDetector(audioCtx().sampleRate);
    const results: StepResult[] = [];
    const trail: { t: number; midi: number }[] = [];
    let idx = 0;
    let phase: 'demo' | 'count' | 'listen' | 'done' = 'demo';
    let listenStart = 0;
    let stopLoop: (() => void) | null = null;
    let timer = 0;
    let ended = false;
    let hardStops = 0;

    const abort = () => {
      ended = true;
      clearTimeout(timer);
      stopLoop?.();
      if (mic.isRecording) mic.stop();
      liveView.dispose();
    };
    cleanup = abort;

    stopLoop = rafLoop(() => {
      if (ended) return;
      const p = detector.detect(mic.readFrame());
      const now = audioCtx().currentTime;
      if (phase === 'listen' && p) {
        trail.push({ t: now - listenStart, midi: p.midi });
      }
      drawLive(liveView, trail, steps[idx]?.expect ?? [], phase === 'listen' ? now - listenStart : 0);
    });

    function nextStep() {
      if (ended) return;
      if (idx >= steps.length) return finish();
      const step = steps[idx];
      trail.length = 0;
      phase = 'demo';
      bigEl.textContent = step.big;
      hintEl.textContent = step.label;
      stepEl.textContent = `第 ${idx + 1} / ${steps.length} 步`;
      skipBtn.disabled = true;

      const demoSec = step.demo();
      timer = window.setTimeout(() => {
        if (ended) return;
        phase = 'count';
        hintEl.textContent = '该你了 →';
        timer = window.setTimeout(() => {
          if (ended) return;
          void startListening(step);
        }, 350);
      }, demoSec * 1000);
    }

    async function startListening(step: StepDef) {
      phase = 'listen';
      skipBtn.disabled = false;
      hintEl.textContent = '🎤 唱吧…';
      trail.length = 0;
      await mic.start();
      listenStart = audioCtx().currentTime;
      timer = window.setTimeout(() => stopListening(false), step.listenSec * 1000);
    }

    function stopListening(skipped: boolean) {
      if (phase !== 'listen') return;
      clearTimeout(timer);
      phase = 'done';
      skipBtn.disabled = true;
      const rec = mic.stop();
      const step = steps[idx];

      if (skipped) {
        idx++;
        showResult(null, '跳过了这一步。');
        timer = window.setTimeout(nextStep, 600);
        return;
      }

      const r = scoreStep(step, rec.samples, rec.sampleRate);
      results.push(r);
      if (r.shouldStop) hardStops++;
      else hardStops = 0;
      idx++;
      showResult(r.score, r.detail);

      // 高音类：连着两步都吃力就停，别硬顶
      if (ex!.kind === 'high' && hardStops >= 2) {
        hintEl.textContent = '今天到这儿';
        resultBox.prepend(
          el(
            'div',
            'v-note warn',
            '连着两次都唱得比较吃力了——今天这条到此为止。' +
              '高音是靠一次次小幅度累积上去的，硬顶只会让明天更差。',
          ),
        );
        timer = window.setTimeout(finish, 1400);
        return;
      }
      timer = window.setTimeout(nextStep, 1100);
    }

    function showResult(score: number | null, detail: string) {
      resultBox.innerHTML = '';
      const c = card();
      c.innerHTML =
        `<h3>${score === null ? '这一步没评上' : `${score} 分`}</h3>` +
        `<p>${esc(detail)}</p>`;
      resultBox.appendChild(c);
    }

    function finish() {
      if (ended) return;
      abort();
      const scored = results.filter((r) => r.score !== null).map((r) => r.score!);
      const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;
      const peaks = results.map((r) => r.peakMidi).filter((m): m is number => m !== null);
      const peak = peaks.length ? Math.max(...peaks) : null;

      addTraining({
        at: Date.now(),
        exerciseId: ex!.id,
        done: steps.length ? Math.min(1, idx / steps.length) : 0,
        score: avg,
        peakMidi: peak,
        minutes: Math.max(1, Math.round((idx / Math.max(1, steps.length)) * ex!.minutes)),
      });

      summary(avg, scored.length, peak, base);
    }

    nextStep();
    return abort;
  }

  // ------------------------------------------------------------ 小结
  function summary(avg: number | null, n: number, peak: number | null, base: number) {
    clear();
    const wrap = el('div', 'v-wrap');
    box.appendChild(topbar(`${ex!.name} · 完成`, () => ctx.go({ p: 'training' })));
    box.appendChild(wrap);
    wrap.style.padding = '16px';

    const c = card();
    if (avg === null) {
      c.innerHTML = '<h3>这一轮没有有效数据</h3><p>可能是没录到声音。检查麦克风，或者离得近一点再来一次。</p>';
    } else {
      c.innerHTML =
        `<div class="v-score"><div class="n">${avg}</div><div class="l">本轮平均分 · 共 ${n} 步</div></div>` +
        `<p>${
          avg >= 80
            ? '这条练得挺扎实。下次可以把起始音往上挪两个半音，或者换更难的一条。'
            : avg >= 60
              ? '基本到位，但还不够稳。同一条再练两三天，分数上到 80 以上再加难度。'
              : '这条现在还吃力。明天用同样的起始音再练一次，别急着往上加。'
        }</p>` +
        (peak !== null ? `<p>本轮唱到的最高音：${midiToName(peak)}（起始音 ${midiToName(base)}）。</p>` : '');
    }
    wrap.appendChild(c);

    wrap.appendChild(
      el(
        'div',
        'v-note',
        '练习分数记进档案了。想知道有没有真的变好，去唱一首歌——' +
          '练习和唱歌用的是同一套指标，唱歌的分数动了才算数。',
      ),
    );

    const row = el('div', 'v-btn-row');
    row.appendChild(btn('🔁 再练一轮', 'v-btn', () => intro()));
    row.appendChild(btn('🎤 去唱一首验证', 'v-btn primary', () => ctx.go({ p: 'songs' })));
    wrap.appendChild(row);
    wrap.appendChild(btn('← 回训练中心', 'v-btn ghost', () => ctx.go({ p: 'training' })));
  }

  /** 练习时的实时反馈：把目标音画成横线，把你唱的画成曲线 */
  function drawLive(
    view: View,
    trail: { t: number; midi: number }[],
    expect: { midi: number; start: number; dur: number }[],
    now: number,
  ) {
    const { g, w, h } = view;
    if (w < 10) return;
    g.fillStyle = '#181d25';
    g.fillRect(0, 0, w, h);

    const all = [...expect.map((e) => e.midi), ...trail.map((t) => t.midi)];
    if (!all.length) return;
    let lo = Math.min(...all) - 3;
    let hi = Math.max(...all) + 3;
    if (hi - lo < 8) {
      const mid = (hi + lo) / 2;
      lo = mid - 4;
      hi = mid + 4;
    }
    const span = Math.max(
      3,
      expect.length ? expect[expect.length - 1].start + expect[expect.length - 1].dur + 0.5 : 4,
    );
    const x = (t: number) => (t / span) * w;
    const y = (m: number) => h - ((m - lo) / (hi - lo)) * h;

    for (const e of expect) {
      g.fillStyle = 'rgba(107,122,141,0.32)';
      g.fillRect(x(e.start), y(e.midi) - 4, Math.max(3, x(e.dur)), 8);
    }
    g.strokeStyle = '#4d9fff';
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath();
    trail.forEach((p, i) => {
      if (i === 0) g.moveTo(x(p.t), y(p.midi));
      else g.lineTo(x(p.t), y(p.midi));
    });
    g.stroke();

    if (now > 0) {
      g.strokeStyle = 'rgba(233,237,243,0.4)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x(now), 0);
      g.lineTo(x(now), h);
      g.stroke();
    }
  }

  intro();
  return () => dispose();
}
