/** 模式一 · 减压开嗓：引导呼吸放松、音阶开嗓、测音域 */

import { Mic, midiToName } from './pitch';
import { playTone, MelodyPlayer } from './synth';
import { getRange, setRange } from './save';
import { makeCanvas, rafLoop, foldOctave, btn } from './view';

export function runWarmup(root: HTMLElement, mic: Mic | null, onExit: () => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'sing-stage';
  root.appendChild(wrap);

  let disposeStage: (() => void) | null = null;
  const clearStage = () => {
    disposeStage?.();
    disposeStage = null;
    wrap.innerHTML = '';
  };

  function menu() {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `<h2>🫁 减压开嗓</h2><div class="sing-sub">下班先放松，再温柔地打开嗓子</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const range = getRange();
    const items = [
      { t: '🌬️ 引导呼吸 · 2 分钟', d: '跟着圆圈「吸气 4 秒 → 屏住 4 秒 → 呼气 6 秒」，先把压力吐出去。', go: breathing },
      { t: '🎵 音阶开嗓', d: '跟着参考音哼五度音阶，一组比一组高半音，轻声即可，别喊。', go: scales },
      {
        t: '🎙️ 测一测你的音域',
        d: range
          ? `当前记录：${midiToName(range.lo)} ~ ${midiToName(range.hi)}。重测可以更准。`
          : '唱出你最低和最高的舒服音，之后歌曲会自动推荐适合你的调。',
        go: rangeTest,
      },
    ];
    for (const it of items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="title">${it.t}</div><div class="desc">${it.d}</div>`;
      card.addEventListener('click', it.go);
      list.appendChild(card);
    }
    scr.appendChild(list);
    scr.appendChild(btn('← 返回', 'sing-btn ghost', onExit));
    wrap.appendChild(scr);
  }

  // ---------- 引导呼吸 ----------
  function breathing() {
    clearStage();
    const view = makeCanvas(wrap);
    const phases = [
      { name: '吸气', dur: 4, hint: '用鼻子慢慢吸，肚子鼓起来' },
      { name: '屏住', dur: 4, hint: '轻轻停住，肩膀放松' },
      { name: '呼气', dur: 6, hint: '像吹蜡烛一样细细吐出' },
    ];
    const CYCLES = 5;
    let t = 0;
    let lastPhase = -1;
    let done = false;

    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      g.clearRect(0, 0, w, h);
      if (!done) t += dt;
      const cycleDur = 14;
      const cycle = Math.floor(t / cycleDur);
      if (cycle >= CYCLES && !done) {
        done = true;
        playTone(76, 0.5, 0, 0.2);
        playTone(79, 0.7, 0.2, 0.2);
        finish();
        return;
      }
      let tc = t % cycleDur;
      let pi = 0;
      while (pi < 2 && tc >= phases[pi].dur) {
        tc -= phases[pi].dur;
        pi++;
      }
      if (pi !== lastPhase) {
        lastPhase = pi;
        playTone(pi === 0 ? 64 : pi === 1 ? 67 : 60, 0.4, 0, 0.12);
      }
      const p = tc / phases[pi].dur;
      // 圆半径：吸气变大、屏住保持、呼气缩小
      const rMin = Math.min(w, h) * 0.12;
      const rMax = Math.min(w, h) * 0.3;
      const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);
      const r = pi === 0 ? rMin + (rMax - rMin) * ease(p) : pi === 1 ? rMax : rMax - (rMax - rMin) * ease(p);

      const cx = w / 2;
      const cy = h * 0.45;
      const grad = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      grad.addColorStop(0, 'rgba(64,196,255,0.55)');
      grad.addColorStop(1, 'rgba(64,196,255,0.08)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(124,231,200,0.7)';
      g.lineWidth = 2;
      g.stroke();

      g.fillStyle = '#e8eef4';
      g.textAlign = 'center';
      g.font = '700 30px sans-serif';
      g.fillText(phases[pi].name, cx, cy + 10);
      g.font = '13px sans-serif';
      g.fillStyle = '#91a4b5';
      g.fillText(phases[pi].hint, cx, cy + r + 34);
      g.fillText(`第 ${cycle + 1} / ${CYCLES} 轮 · 剩 ${Math.ceil(phases[pi].dur - tc)} 秒`, cx, h * 0.08);
    });

    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      stop();
      view.dispose();
      menu();
    });
    wrap.appendChild(back);

    function finish() {
      stop();
      view.dispose();
      back.remove();
      resultPanel('😌 呼吸放松完成', '压力吐出去了，现在嗓子和心情都热好身了。', [
        ['再来一轮', breathing],
        ['去开嗓 →', scales],
      ]);
    }
    disposeStage = () => {
      stop();
      view.dispose();
    };
  }

  // ---------- 音阶开嗓 ----------
  function scales() {
    clearStage();
    const view = makeCanvas(wrap);
    const player = new MelodyPlayer();
    const ROUNDS = 5;
    const degrees = [0, 2, 4, 5, 7, 5, 4, 2, 0]; // do re mi fa sol fa mi re do
    const range = getRange();
    const base0 = range ? Math.max(50, Math.min(range.lo + 2, 62)) : 57;
    let round = 0;
    let state: 'ready' | 'sing' | 'done' = 'ready';
    let hitFrames = 0;
    let voicedFrames = 0;
    let trail: { beat: number; midi: number }[] = [];
    let notes = degrees.map((d) => ({ m: base0 + d, d: 1 }));

    const startRound = () => {
      state = 'sing';
      trail = [];
      notes = degrees.map((d) => ({ m: base0 + round + d, d: 1 }));
      player.play(notes, 100, 0, 2, 0.3, () => {
        round++;
        if (round >= ROUNDS) {
          state = 'done';
          finish();
        } else {
          state = 'ready';
          window.setTimeout(() => state !== 'done' && startRound(), 900);
        }
      });
    };
    startRound();

    const stop = rafLoop(() => {
      const { g, w, h } = view;
      g.clearRect(0, 0, w, h);
      const beat = player.beatNow() - 2; // 去掉前奏
      const total = degrees.length;
      const x0 = w * 0.08;
      const x1 = w * 0.92;
      const bx = (b: number) => x0 + ((x1 - x0) * b) / total;
      const lo = notes[0].m - 3;
      const hi = notes[0].m + 10;
      const my = (m: number) => h * 0.78 - ((m - lo) / (hi - lo)) * h * 0.55;

      // 目标音阶台阶
      for (let i = 0; i < notes.length; i++) {
        const active = beat >= i && beat < i + 1;
        g.fillStyle = active ? '#40c4ff' : 'rgba(255,255,255,0.16)';
        const y = my(notes[i].m);
        g.beginPath();
        g.roundRect(bx(i) + 2, y - 6, bx(i + 1) - bx(i) - 4, 12, 6);
        g.fill();
      }

      // 用户音高
      if (mic && state === 'sing' && beat >= 0 && beat < total) {
        const p = mic.read();
        if (p) {
          const idx = Math.min(total - 1, Math.floor(Math.max(0, beat)));
          const folded = foldOctave(p.midi, notes[idx].m);
          trail.push({ beat, midi: folded });
          voicedFrames++;
          if (Math.abs(folded - notes[idx].m) < 0.7) hitFrames++;
        }
      }
      g.strokeStyle = '#7ce7c8';
      g.lineWidth = 2.5;
      g.beginPath();
      let pen = false;
      for (const pt of trail) {
        const x = bx(pt.beat);
        const y = my(pt.midi);
        if (!pen) {
          g.moveTo(x, y);
          pen = true;
        } else g.lineTo(x, y);
      }
      g.stroke();

      g.fillStyle = '#e8eef4';
      g.textAlign = 'center';
      g.font = '700 18px sans-serif';
      g.fillText(`第 ${Math.min(round + 1, ROUNDS)} / ${ROUNDS} 组 · 起音 ${midiToName(notes[0].m)}`, w / 2, h * 0.1);
      g.font = '13px sans-serif';
      g.fillStyle = '#91a4b5';
      g.fillText(
        state === 'ready' ? '准备，下一组马上开始…' : mic ? '轻声跟着哼：do re mi fa sol fa mi re do' : '（未开麦克风，跟着听哼即可）',
        w / 2,
        h * 0.16,
      );
      if (voicedFrames > 12) {
        const acc = Math.round((hitFrames / voicedFrames) * 100);
        g.fillStyle = '#ffca28';
        g.fillText(`跟准率 ${acc}%`, w / 2, h * 0.92);
      }
    });

    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      menu();
    });
    wrap.appendChild(back);

    function finish() {
      const acc = voicedFrames > 12 ? Math.round((hitFrames / voicedFrames) * 100) : -1;
      stop();
      view.dispose();
      back.remove();
      player.stop();
      resultPanel(
        '🎵 开嗓完成',
        acc >= 0 ? `五组音阶唱完，跟准率 ${acc}%。嗓子已经打开，去唱歌吧！` : '五组音阶听完，嗓子活动开了！',
        [
          ['再来一遍', scales],
          ['返回', menu],
        ],
      );
    }
    disposeStage = () => {
      stop();
      view.dispose();
      player.stop();
    };
  }

  // ---------- 测音域 ----------
  function rangeTest() {
    if (!mic) {
      resultPanelFresh('🎙️ 需要麦克风', '测音域需要听到你的声音，请返回首页允许麦克风后再试。', [['返回', menu]]);
      return;
    }
    clearStage();
    const view = makeCanvas(wrap);
    let phase: 'low' | 'high' | 'done' = 'low';
    let lowMidi = 0;
    const samples: { t: number; midi: number }[] = [];
    let capturedFlash = 0;

    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      g.clearRect(0, 0, w, h);
      capturedFlash = Math.max(0, capturedFlash - dt);
      const now = performance.now() / 1000;
      const p = mic!.read();
      if (p) samples.push({ t: now, midi: p.midi });
      while (samples.length && samples[0].t < now - 1.2) samples.shift();

      let stable = 0;
      let current = 0;
      if (samples.length > 8) {
        const vals = samples.map((s) => s.midi).sort((a, b) => a - b);
        current = vals[Math.floor(vals.length / 2)];
        const spread = vals[vals.length - 1] - vals[0];
        stable = spread < 1 ? Math.min(1, samples.length / 40) : 0;
        if (stable >= 1 && phase !== 'done') {
          const captured = Math.round(current);
          samples.length = 0;
          capturedFlash = 1;
          playTone(captured, 0.5, 0, 0.2);
          if (phase === 'low') {
            lowMidi = captured;
            phase = 'high';
          } else {
            const hi = Math.max(captured, lowMidi + 4);
            setRange({ lo: Math.min(lowMidi, captured), hi });
            phase = 'done';
            finish(Math.min(lowMidi, captured), hi);
            return;
          }
        }
      }

      const cx = w / 2;
      const cy = h * 0.42;
      const r = Math.min(w, h) * 0.22;
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 10;
      g.beginPath();
      g.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5);
      g.stroke();
      g.strokeStyle = capturedFlash > 0 ? '#66bb6a' : '#40c4ff';
      g.beginPath();
      g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * stable);
      g.stroke();

      g.fillStyle = '#e8eef4';
      g.textAlign = 'center';
      g.font = '700 40px sans-serif';
      g.fillText(p ? midiToName(p.midi) : '…', cx, cy + 14);

      g.font = '700 18px sans-serif';
      g.fillText(phase === 'low' ? '第 1 步 · 唱出你最低的舒服音' : '第 2 步 · 唱出你最高的舒服音', cx, h * 0.1);
      g.font = '13px sans-serif';
      g.fillStyle = '#91a4b5';
      g.fillText('用「呜」或「啊」稳住不动，圆环充满即记录', cx, h * 0.16);
      if (phase === 'high' && lowMidi) {
        g.fillStyle = '#7ce7c8';
        g.fillText(`最低音已记录：${midiToName(lowMidi)}`, cx, h * 0.86);
      }
    });

    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      menu();
    });
    wrap.appendChild(back);

    function finish(lo: number, hi: number) {
      stop();
      view.dispose();
      back.remove();
      resultPanel(
        '🎙️ 你的音域',
        `${midiToName(lo)} ~ ${midiToName(hi)}，跨 ${hi - lo} 个半音。跟唱打分会按它推荐移调，音域会随练习慢慢变宽。`,
        [
          ['重测一次', rangeTest],
          ['返回', menu],
        ],
      );
    }
    disposeStage = () => {
      stop();
      view.dispose();
    };
  }

  // ---------- 通用结果面板 ----------
  function resultPanel(title: string, desc: string, actions: [string, () => void][]) {
    const scr = document.createElement('div');
    scr.className = 'sing-panel sing-result';
    scr.innerHTML = `<h2>${title}</h2><div class="sing-sub">${desc}</div>`;
    const row = document.createElement('div');
    row.className = 'sing-btn-row';
    for (const [label, fn] of actions) row.appendChild(btn(label, 'sing-btn', fn));
    scr.appendChild(row);
    wrap.appendChild(scr);
  }
  function resultPanelFresh(title: string, desc: string, actions: [string, () => void][]) {
    clearStage();
    resultPanel(title, desc, actions);
  }

  menu();
  return () => {
    disposeStage?.();
    wrap.remove();
  };
}
