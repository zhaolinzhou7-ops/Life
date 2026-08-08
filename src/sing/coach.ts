/**
 * 高音训练营：自动模进练声 + 实时费嗓预警。
 *
 * 流程和线下声乐课一样：老师弹一条音型，你跟一遍，弹高半个音，再跟一遍，
 * 一直往上到你唱不动为止。这里把「老师」做成程序，另外多做两件老师也难做到的事：
 *   - 实时告诉你现在是在唱还是在喊（analyze.ts）
 *   - 把每天的最高音记下来，画成成长曲线
 */

import { Mic, midiToName } from './pitch';
import { MelodyPlayer, playGlide, playHold, playCue, playTone } from './synth';
import { EXERCISES, byId, dayPlan, STAGES, exerciseSeconds } from './exercises';
import { StrainMeter, strainColor, strainLabel } from './analyze';
import { getRange, getCoach, setVoiceType, completeDay, peakStats, type CoachProgress } from './save';
import { makeCanvas, rafLoop, btn } from './view';
import { Ambient, Particles, haptic, acquireWakeLock, easeOut } from './fx';

/** 判定「这一组跟上了」的最低命中率 */
const PASS_RATE = 0.35;
/** 连续几组没跟上就停止上行 */
const FAIL_STOP = 2;
/** 音高判定容差（半音） */
const TOL = 1.0;

export function runCoach(root: HTMLElement, mic: Mic | null, onExit: () => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'sing-stage';
  root.appendChild(wrap);

  let disposeStage: (() => void) | null = null;
  const clearStage = () => {
    disposeStage?.();
    disposeStage = null;
    wrap.innerHTML = '';
  };

  /** 各条练习的起始音：以你的舒适低音为基准，没测过音域就按声部给默认值 */
  function baseMidi(): number {
    const r = getRange();
    const c = getCoach();
    if (r && r.hi - r.lo >= 7) return Math.round(r.lo) + 3;
    return c.voice === 'high' ? 55 : 48; // G3 / C3
  }

  // ---------- 首页 ----------
  function home() {
    clearStage();
    const c = getCoach();
    if (!c.voice) return pickVoice();

    const day = Math.min(30, c.day);
    const plan = dayPlan(day);
    const stage = STAGES[plan.stage - 1];
    const stats = peakStats();
    const totalSec = plan.exercises.reduce((a, id) => {
      const ex = byId(id);
      return a + exerciseSeconds(ex, Math.min(ex.rounds, 8));
    }, 0);

    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `
      <h2>🎯 高音训练营</h2>
      <div class="sing-sub">${stage.emoji} 阶段${plan.stage} · ${stage.name}<br><span style="opacity:.75">${stage.desc}</span></div>
      <div class="sing-stats">
        <span class="sing-chip">📅 第 <b>${day}</b> / 30 天</span>
        ${c.streak > 0 ? `<span class="sing-chip">🔥 连续 <b>${c.streak}</b> 天</span>` : ''}
        ${stats.best > 0 ? `<span class="sing-chip">🚀 最高 <b>${midiToName(stats.best)}</b></span>` : ''}
        ${
          stats.best > stats.first && stats.first > 0
            ? `<span class="sing-chip">📈 比第一天高 <b>${stats.best - stats.first}</b> 个半音</span>`
            : ''
        }
      </div>`;

    // 今日任务卡
    const todayCard = document.createElement('div');
    todayCard.className = 'card sing-today';
    todayCard.innerHTML = `
      <div class="title">今天：${plan.title}<span class="tag">约 ${Math.round(totalSec / 60)} 分钟</span></div>
      <div class="desc">🎯 目标：${plan.goal}</div>
      <div class="sing-ex-chips">${plan.exercises
        .map((id) => {
          const ex = byId(id);
          return `<span class="sing-ex-chip${ex.safe ? ' safe' : ''}">${ex.emoji} ${ex.name}</span>`;
        })
        .join('')}</div>`;
    todayCard.addEventListener('click', () => startDay(day));

    const list = document.createElement('div');
    list.className = 'card-list';
    list.appendChild(todayCard);

    // 成长曲线
    if (c.peaks.length >= 2) {
      const chart = document.createElement('div');
      chart.className = 'card sing-chart-card';
      chart.innerHTML = `<div class="title">📈 音域成长</div>`;
      const cv = document.createElement('canvas');
      cv.className = 'sing-chart';
      chart.appendChild(cv);
      list.appendChild(chart);
      requestAnimationFrame(() => drawGrowth(cv, c));
    }

    // 自由练习入口
    const free = document.createElement('div');
    free.className = 'card';
    free.innerHTML = `<div class="title">🎼 单条练习<span class="tag">自由选</span></div>
      <div class="desc">不想按课程走？直接挑一条练，共 ${EXERCISES.length} 条。嗓子累的时候就只做带 🌱 的省力练习。</div>`;
    free.addEventListener('click', exerciseLibrary);
    list.appendChild(free);

    scr.appendChild(list);

    const hint = document.createElement('div');
    hint.className = 'sing-mic-hint';
    hint.textContent = mic
      ? '天天练几分钟，比一次练一小时有用得多——音域是慢慢长出来的。嗓子不舒服就休息，别硬练。'
      : '⚠️ 没有麦克风，只能听示范。开启麦克风才能得到费嗓提醒和音域记录。';
    scr.appendChild(hint);
    scr.appendChild(btn('← 返回', 'sing-btn ghost', onExit));
    wrap.appendChild(scr);
  }

  /** 首次进入：选声部（决定练习从哪个音起头） */
  function pickVoice() {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `<h2>🎯 高音训练营</h2>
      <div class="sing-sub">开始之前先告诉我：你的说话声音偏低还是偏高？<br>这决定练习从哪个音起头，选错了随时能改。</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const opts: { t: string; d: string; v: 'low' | 'high' }[] = [
      { t: '🧔 偏低（多数男生）', d: '说话声音低沉厚实。练习会从 C3 附近起头。', v: 'low' },
      { t: '👩 偏高（多数女生）', d: '说话声音清亮。练习会从 G3 附近起头。', v: 'high' },
    ];
    for (const o of opts) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="title">${o.t}</div><div class="desc">${o.d}</div>`;
      card.addEventListener('click', () => {
        setVoiceType(o.v);
        home();
      });
      list.appendChild(card);
    }
    scr.appendChild(list);
    scr.appendChild(btn('← 返回', 'sing-btn ghost', onExit));
    wrap.appendChild(scr);
  }

  /** 音域成长折线 */
  function drawGrowth(cv: HTMLCanvasElement, c: CoachProgress) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 300;
    const h = 120;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pts = c.peaks.slice(-20);
    const lo = Math.min(...pts.map((p) => p.midi)) - 1;
    const hi = Math.max(...pts.map((p) => p.midi)) + 1;
    const px = (i: number) => 26 + (i * (w - 40)) / Math.max(1, pts.length - 1);
    const py = (m: number) => h - 22 - ((m - lo) / Math.max(1, hi - lo)) * (h - 44);

    // 网格与音名
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.font = '9px sans-serif';
    g.textAlign = 'left';
    for (let m = Math.ceil(lo); m <= hi; m++) {
      if (m % 3) continue;
      g.beginPath();
      g.moveTo(24, py(m));
      g.lineTo(w - 8, py(m));
      g.stroke();
      g.fillText(midiToName(m), 2, py(m) + 3);
    }
    // 填充 + 折线
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(124,231,200,0.35)');
    grad.addColorStop(1, 'rgba(124,231,200,0)');
    g.beginPath();
    g.moveTo(px(0), h - 22);
    pts.forEach((p, i) => g.lineTo(px(i), py(p.midi)));
    g.lineTo(px(pts.length - 1), h - 22);
    g.closePath();
    g.fillStyle = grad;
    g.fill();

    g.save();
    g.shadowColor = 'rgba(124,231,200,0.8)';
    g.shadowBlur = 8;
    g.strokeStyle = '#7ce7c8';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(i), py(p.midi)) : g.moveTo(px(i), py(p.midi))));
    g.stroke();
    g.restore();
    pts.forEach((p, i) => {
      g.fillStyle = i === pts.length - 1 ? '#ffd54f' : '#7ce7c8';
      g.beginPath();
      g.arc(px(i), py(p.midi), i === pts.length - 1 ? 4 : 2.5, 0, Math.PI * 2);
      g.fill();
    });
  }

  // ---------- 练习库 ----------
  function exerciseLibrary() {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `<h2>🎼 单条练习</h2><div class="sing-sub">🌱 = 半闭合练习，几乎不伤嗓，累的时候只做这些</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const st of STAGES) {
      const head = document.createElement('div');
      head.className = 'sing-group-head';
      head.textContent = `${st.emoji} 阶段${st.n} · ${st.name}`;
      list.appendChild(head);
      for (const ex of EXERCISES.filter((e) => e.stage === st.n)) {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<div class="title">${ex.emoji} ${ex.name}${ex.safe ? '<span class="tag">🌱 省力</span>' : ''}</div>
          <div class="desc">唱「${ex.sound}」· ${ex.why}</div>`;
        card.addEventListener('click', () => intro([ex.id], 0, null));
        list.appendChild(card);
      }
    }
    scr.appendChild(list);
    scr.appendChild(btn('← 返回', 'sing-btn ghost', home));
    wrap.appendChild(scr);
  }

  // ---------- 今日训练 ----------
  function startDay(day: number) {
    intro(dayPlan(day).exercises, 0, day);
  }

  /** 练习开始前的说明页——「怎么做」是这个软件最该说清楚的东西 */
  function intro(ids: string[], idx: number, day: number | null) {
    clearStage();
    const ex = byId(ids[idx]);
    const scr = document.createElement('div');
    scr.className = 'sing-panel sing-intro';
    scr.innerHTML = `
      <div class="sing-step">${day ? `第 ${day} 天 · ` : ''}练习 ${idx + 1} / ${ids.length}</div>
      <div class="sing-ex-emoji">${ex.emoji}</div>
      <h2>${ex.name}</h2>
      <div class="sing-sound">唱「${ex.sound}」</div>
      <div class="sing-howto">
        <div class="row"><span class="k">怎么做</span><span class="v">${ex.how}</span></div>
        <div class="row"><span class="k">为什么</span><span class="v">${ex.why}</span></div>
        <div class="row warn"><span class="k">注意</span><span class="v">${ex.watch}</span></div>
      </div>`;
    const row = document.createElement('div');
    row.className = 'sing-btn-row';
    row.appendChild(btn('▶ 开始练', 'sing-btn primary', () => session(ids, idx, day)));
    row.appendChild(
      btn('跳过 ▸', 'sing-btn ghost', () => (idx + 1 < ids.length ? intro(ids, idx + 1, day) : dayDone(day, 0, 0))),
    );
    scr.appendChild(row);
    scr.appendChild(btn('← 退出', 'sing-btn ghost', () => (day ? home() : exerciseLibrary())));
    wrap.appendChild(scr);
  }

  /** 一条练习的模进训练 */
  function session(ids: string[], idx: number, day: number | null) {
    clearStage();
    const ex = byId(ids[idx]);
    const view = makeCanvas(wrap);
    const amb = new Ambient();
    const fx = new Particles();
    const strain = new StrainMeter();
    const player = new MelodyPlayer();
    const wake = acquireWakeLock();

    const start0 = baseMidi() + ex.startOffset;
    const maxRounds = Math.min(ex.rounds, 12);
    let round = 0; // 第几组（每组升半音）
    let fails = 0;
    let peak = 0; // 本条练习唱到的最高音
    let peakStrain = 0;
    let stopSound: (() => void) | null = null;

    // 一组内的统计
    let hitFrames = 0;
    let totalFrames = 0;
    let trail: { t: number; midi: number }[] = [];
    let phase: 'ready' | 'run' | 'judge' | 'done' = 'ready';
    let phaseT = 0;
    let judgeText = '';
    let judgeOk = false;

    const startMidi = () => start0 + round;
    /** 本组音型里的最高音（用于记录你实际唱到的高度） */
    const topOfRound = () => {
      if (ex.kind === 'glide' && ex.glide) return startMidi() + ex.glide.to;
      return startMidi() + Math.max(...ex.pattern);
    };

    /** 当前时刻的目标音高；返回 null 表示此刻没有目标（间隙） */
    function targetAt(tSec: number): number | null {
      const s = startMidi();
      if (ex.kind === 'glide' && ex.glide) {
        const { from, to, upSec, downSec } = ex.glide;
        if (tSec < 0 || tSec > upSec + downSec) return null;
        const k = tSec < upSec ? tSec / upSec : 1 - (tSec - upSec) / downSec;
        return s + from + (to - from) * k;
      }
      if (ex.kind === 'hold') {
        const d = ex.holdSec ?? 8;
        return tSec >= 0 && tSec <= d ? s + ex.pattern[0] : null;
      }
      // scale / staccato：按拍走
      const beats = ex.beats ?? ex.pattern.map(() => 1);
      const spb = 60 / ex.bpm;
      let acc = 0;
      for (let i = 0; i < ex.pattern.length; i++) {
        const dur = beats[i] * spb;
        if (tSec >= acc && tSec < acc + dur) {
          // 断音只在前半个音符内要求发声
          if (ex.kind === 'staccato' && tSec > acc + dur * 0.55) return null;
          return s + ex.pattern[i];
        }
        acc += dur;
      }
      return null;
    }

    function roundDuration(): number {
      if (ex.kind === 'glide' && ex.glide) return ex.glide.upSec + ex.glide.downSec;
      if (ex.kind === 'hold') return ex.holdSec ?? 8;
      const beats = ex.beats ?? ex.pattern.map(() => 1);
      return beats.reduce((a, b) => a + b, 0) * (60 / ex.bpm);
    }

    function beginRound() {
      phase = 'run';
      phaseT = 0;
      hitFrames = 0;
      totalFrames = 0;
      trail = [];
      strain.reset();
      const s = startMidi();
      if (ex.kind === 'glide' && ex.glide) {
        stopSound = playGlide(s + ex.glide.from, s + ex.glide.to, ex.glide.upSec, ex.glide.downSec);
      } else if (ex.kind === 'hold') {
        stopSound = playHold(s + ex.pattern[0], ex.holdSec ?? 8);
      } else {
        const beats = ex.beats ?? ex.pattern.map(() => 1);
        player.play(
          ex.pattern.map((p, i) => ({ m: s + p, d: beats[i] })),
          ex.bpm,
          0,
          0,
          0.26,
        );
        stopSound = () => player.stop();
      }
    }

    function endRound() {
      stopSound?.();
      stopSound = null;
      const rate = totalFrames > 8 ? hitFrames / totalFrames : 0;
      const ok = !mic || rate >= PASS_RATE;
      // 无调练习没有「唱到多高」可言，不参与音域记录
      if (mic && rate >= PASS_RATE && !ex.unpitched) peak = Math.max(peak, topOfRound());
      judgeOk = ok;
      if (!mic) judgeText = '（没开麦克风，听示范）';
      else if (rate >= 0.7) judgeText = '很稳！';
      else if (rate >= PASS_RATE) judgeText = '跟上了';
      else judgeText = '这组没跟上';
      if (ok) {
        fails = 0;
        if (rate >= PASS_RATE && mic) {
          fx.burst(view.w / 2, view.h * 0.42, '#7ce7c8', 14, 130);
          haptic(15);
        }
      } else {
        fails++;
      }
      phase = 'judge';
      phaseT = 0;
    }

    function nextRound() {
      const st = strain.read();
      // 连续跟不上、或已经明显在喊，就停下来——训练营的原则是宁可少练不练坏
      if (fails >= FAIL_STOP || round + 1 >= maxRounds || st.level > 0.9) {
        finishExercise();
        return;
      }
      round++;
      phase = 'ready';
      phaseT = 0;
    }

    function finishExercise() {
      stopSound?.();
      player.stop();
      stop();
      view.dispose();
      wake();
      bar.remove();
      backBtn.remove();
      exerciseDone(ids, idx, day, peak, peakStrain);
    }

    // ---- 主循环 ----
    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      phaseT += dt;
      g.clearRect(0, 0, w, h);
      amb.update(dt, w, h);
      amb.draw(g);
      fx.update(dt);

      if (phase === 'ready' && phaseT > 1.0) beginRound();
      if (phase === 'run' && phaseT > roundDuration() + 0.25) endRound();
      if (phase === 'judge' && phaseT > 1.1) nextRound();

      // ---- 采样 ----
      const p = mic?.read() ?? null;
      strain.push(p, dt);
      const st = strain.read();
      peakStrain = Math.max(peakStrain, st.level);
      const tgt = phase === 'run' ? targetAt(phaseT) : null;
      if (phase === 'run' && tgt !== null) {
        totalFrames++;
        if (ex.unpitched) {
          // 嘶音这类没有基频，只看有没有在持续送气
          if ((mic?.lastLevel ?? 0) > 0.012) hitFrames++;
        } else if (p) {
          trail.push({ t: phaseT, midi: p.midi });
          // 高音训练不能折叠八度——唱低八度不算过
          if (Math.abs(p.midi - tgt) <= TOL) hitFrames++;
        }
      }

      // ---- 画音型 ----
      const dur = roundDuration();
      const s = startMidi();
      const lo = s - 3;
      const hi = topOfRound() + 3;
      const top = h * 0.2;
      const bot = h * 0.66;
      const my = (m: number) => bot - ((m - lo) / Math.max(1, hi - lo)) * (bot - top);
      const mx = (t: number) => w * 0.1 + (t / dur) * w * 0.8;

      // 目标轨迹
      g.save();
      g.lineWidth = 9;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      if (ex.unpitched) {
        // 无调练习：画时间进度条 + 实时气流强度，音高线对它没意义
        const py = (top + bot) / 2;
        const x0 = w * 0.1;
        const x1 = w * 0.9;
        g.lineWidth = 14;
        g.beginPath();
        g.moveTo(x0, py);
        g.lineTo(x1, py);
        g.stroke();
        if (phase === 'run') {
          const k = Math.min(1, phaseT / dur);
          g.save();
          g.shadowColor = 'rgba(124,231,200,0.8)';
          g.shadowBlur = 14;
          g.strokeStyle = '#7ce7c8';
          g.beginPath();
          g.moveTo(x0, py);
          g.lineTo(x0 + (x1 - x0) * k, py);
          g.stroke();
          g.restore();
        }
        // 气流强度柱：让你看见自己送气稳不稳
        const lvl = Math.min(1, (mic?.lastLevel ?? 0) * 14);
        const barH = 70 * lvl;
        g.fillStyle = lvl > 0.08 ? '#7ce7c8' : 'rgba(255,255,255,0.2)';
        g.beginPath();
        g.roundRect(w / 2 - 16, py - 34 - barH, 32, barH, 8);
        g.fill();
        g.fillStyle = '#8d7fae';
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        g.fillText('气流强度（保持匀速就好）', w / 2, py + 40);
      } else if (ex.kind === 'glide' || ex.kind === 'hold') {
        g.beginPath();
        for (let i = 0; i <= 60; i++) {
          const t = (i / 60) * dur;
          const m = targetAt(t);
          if (m === null) continue;
          if (i === 0) g.moveTo(mx(t), my(m));
          else g.lineTo(mx(t), my(m));
        }
        g.stroke();
      } else {
        const beats = ex.beats ?? ex.pattern.map(() => 1);
        const spb = 60 / ex.bpm;
        let acc = 0;
        for (let i = 0; i < ex.pattern.length; i++) {
          const d0 = beats[i] * spb;
          const y = my(s + ex.pattern[i]);
          const active = phase === 'run' && phaseT >= acc && phaseT < acc + d0;
          g.beginPath();
          g.moveTo(mx(acc) + 3, y);
          g.lineTo(mx(acc + d0) - 3, y);
          g.strokeStyle = active ? '#40c4ff' : 'rgba(255,255,255,0.13)';
          if (active) {
            g.shadowColor = 'rgba(64,196,255,0.9)';
            g.shadowBlur = 16;
          } else g.shadowBlur = 0;
          g.stroke();
          acc += d0;
        }
      }
      g.restore();

      // 你的音高轨迹
      if (trail.length > 1) {
        g.save();
        g.shadowColor = 'rgba(124,231,200,0.8)';
        g.shadowBlur = 9;
        g.strokeStyle = '#7ce7c8';
        g.lineWidth = 2.5;
        g.lineJoin = 'round';
        g.beginPath();
        let pen = false;
        let pt = -9;
        for (const q of trail) {
          const x = mx(q.t);
          const y = my(q.midi);
          if (!pen || q.t - pt > 0.2) {
            g.moveTo(x, y);
            pen = true;
          } else g.lineTo(x, y);
          pt = q.t;
        }
        g.stroke();
        g.restore();
      }
      // 当前光球
      if (p && phase === 'run') {
        const x = mx(Math.min(phaseT, dur));
        const y = my(p.midi);
        const orb = g.createRadialGradient(x, y, 1, x, y, 13);
        orb.addColorStop(0, '#fff');
        orb.addColorStop(0.35, strainColor(st.level));
        orb.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = orb;
        g.beginPath();
        g.arc(x, y, 13, 0, Math.PI * 2);
        g.fill();
      }
      fx.draw(g);

      // ---- 文字层 ----
      g.textAlign = 'center';
      g.fillStyle = '#f4eefc';
      g.font = '700 17px sans-serif';
      g.fillText(`${ex.emoji} ${ex.name}`, w / 2, h * 0.08);
      g.font = '13px sans-serif';
      g.fillStyle = '#a596c2';
      g.fillText(`唱「${ex.sound}」`, w / 2, h * 0.12);

      // 起始音（无调练习显示秒数计时，音高对它没意义）
      g.font = '800 26px sans-serif';
      g.fillStyle = '#ffd54f';
      if (ex.unpitched) {
        const done = phase === 'run' ? Math.min(phaseT, dur) : 0;
        g.fillText(`${done.toFixed(1)}s / ${dur.toFixed(0)}s`, w / 2, h * 0.165);
      } else {
        g.fillText(midiToName(startMidi()), w / 2, h * 0.165);
      }
      g.font = '11px sans-serif';
      g.fillStyle = '#8d7fae';
      g.fillText(
        ex.unpitched ? `第 ${round + 1} 次 / 共 ${maxRounds} 次` : `第 ${round + 1} 组 / 最多 ${maxRounds} · 每组升半音`,
        w / 2,
        h * 0.72,
      );

      if (phase === 'ready') {
        g.fillStyle = '#7ce7c8';
        g.font = '700 18px sans-serif';
        g.fillText('准备…', w / 2, h * 0.45);
      }
      if (phase === 'judge') {
        const k = easeOut(Math.min(1, phaseT * 4));
        g.save();
        g.globalAlpha = k;
        g.fillStyle = judgeOk ? '#8ef29a' : '#ff8a65';
        g.font = '800 24px sans-serif';
        g.fillText(judgeText, w / 2, h * 0.45);
        g.restore();
      }

      // ---- 费嗓指示条 ----
      const bw = w * 0.62;
      const bx0 = w / 2 - bw / 2;
      const by = h * 0.79;
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.beginPath();
      g.roundRect(bx0, by, bw, 12, 6);
      g.fill();
      const col = strainColor(st.level);
      g.save();
      g.shadowColor = col;
      g.shadowBlur = 12;
      g.fillStyle = col;
      g.beginPath();
      g.roundRect(bx0, by, Math.max(10, bw * st.level), 12, 6);
      g.fill();
      g.restore();
      g.font = '12px sans-serif';
      g.fillStyle = '#a596c2';
      g.textAlign = 'left';
      g.fillText('嗓子状态', bx0, by - 8);
      g.textAlign = 'right';
      g.fillStyle = col;
      g.fillText(mic ? strainLabel(st.level) : '未开麦', bx0 + bw, by - 8);

      // 提示语
      if (st.tip && mic) {
        g.textAlign = 'center';
        g.fillStyle = '#ff8a65';
        g.font = '700 14px sans-serif';
        g.fillText(st.tip, w / 2, h * 0.86);
      }
    });

    // ---- 底部控制 ----
    const bar = document.createElement('div');
    bar.className = 'sing-ctrl';
    bar.appendChild(
      btn('⏭ 这条够了', 'sing-btn small', () => {
        finishExercise();
      }),
    );
    bar.appendChild(
      btn('⬇ 降两个音', 'sing-btn small ghost', () => {
        round = Math.max(0, round - 2);
        fails = 0;
        stopSound?.();
        phase = 'ready';
        phaseT = 0;
        playTone(startMidi(), 0.4, 0, 0.2);
      }),
    );
    wrap.appendChild(bar);

    const backBtn = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      day ? home() : exerciseLibrary();
    });
    wrap.appendChild(backBtn);

    disposeStage = () => {
      stop();
      stopSound?.();
      player.stop();
      view.dispose();
      wake();
    };
  }

  /** 一条练习结束 */
  function exerciseDone(ids: string[], idx: number, day: number | null, peak: number, peakStrain: number) {
    clearStage();
    const ex = byId(ids[idx]);
    const meter = new StrainMeter();
    const v = meter.verdict(peakStrain);
    const last = idx + 1 >= ids.length;
    const scr = document.createElement('div');
    scr.className = 'sing-panel sing-result';
    scr.innerHTML = `<h2>${ex.emoji} ${ex.name} 完成</h2>
      ${peak > 0 ? `<div class="sing-big">${midiToName(peak)}</div><div class="sing-sub">这条练到的最高音</div>` : ''}
      <div class="sing-verdict ${v.ok ? 'ok' : 'warn'}">${v.text}</div>`;
    const row = document.createElement('div');
    row.className = 'sing-btn-row';
    if (last) {
      row.appendChild(btn(day ? '看今日总结 ▸' : '完成', 'sing-btn primary', () => dayDone(day, peak, peakStrain)));
    } else {
      row.appendChild(btn('下一条 ▸', 'sing-btn primary', () => intro(ids, idx + 1, day)));
    }
    row.appendChild(btn('再练一次', 'sing-btn ghost', () => session(ids, idx, day)));
    scr.appendChild(row);
    wrap.appendChild(scr);
    // 把这条的峰值带到下一条
    dayPeak = Math.max(dayPeak, peak);
    dayStrain = Math.max(dayStrain, peakStrain);
  }

  let dayPeak = 0;
  let dayStrain = 0;

  /** 今日训练总结 */
  function dayDone(day: number | null, peak: number, peakStrain: number) {
    dayPeak = Math.max(dayPeak, peak);
    dayStrain = Math.max(dayStrain, peakStrain);
    clearStage();
    const before = peakStats();
    const c = day ? completeDay(day, dayPeak) : getCoach();
    const scr = document.createElement('div');
    scr.className = 'sing-panel sing-result';
    const grew = dayPeak > 0 && before.best > 0 && dayPeak > before.best;
    const vs = new StrainMeter().verdict(dayStrain);
    scr.innerHTML = `
      <h2>${day ? `第 ${day} 天完成` : '练习完成'} 🎉</h2>
      ${dayPeak > 0 ? `<div class="sing-big">${midiToName(dayPeak)}</div><div class="sing-sub">今天唱到的最高音${grew ? ' · <b style="color:#7ce7c8">突破纪录！</b>' : ''}</div>` : ''}
      <div class="sing-stats">
        ${c.streak > 0 ? `<span class="sing-chip">🔥 连续 <b>${c.streak}</b> 天</span>` : ''}
        ${before.first > 0 && dayPeak > 0 ? `<span class="sing-chip">📈 比第一天高 <b>${Math.max(0, dayPeak - before.first)}</b> 个半音</span>` : ''}
      </div>
      <div class="sing-verdict ${vs.ok ? 'ok' : 'warn'}">${vs.text}</div>
      <div class="sing-sub" style="margin-top:14px">${
        vs.ok
          ? '明天同一时间再来。音域是靠天天练一点点涨的，不是靠一次练狠。'
          : '今天到此为止。嗓子累了就休息一天，恢复比硬练重要。'
      }</div>`;
    const row = document.createElement('div');
    row.className = 'sing-btn-row';
    row.appendChild(btn('回训练营', 'sing-btn primary', () => {
      dayPeak = 0;
      dayStrain = 0;
      home();
    }));
    scr.appendChild(row);
    wrap.appendChild(scr);
    playCue(true);
    haptic([30, 60, 30]);
  }

  home();
  return () => {
    disposeStage?.();
    wrap.remove();
  };
}
