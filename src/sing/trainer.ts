/** 模式二 · 音准训练：单音模仿打分 + 声控小鸟减压小游戏 */

import { Mic, midiToName, midiToSolfege } from './pitch';
import { playTone, playCue } from './synth';
import { getRange, getBirdBest, setBirdBest } from './save';
import { makeCanvas, rafLoop, foldOctave, btn } from './view';
import { Ambient, Particles, haptic } from './fx';

export function runTrainer(root: HTMLElement, mic: Mic | null, onExit: () => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'sing-stage';
  root.appendChild(wrap);

  let disposeStage: (() => void) | null = null;
  const clearStage = () => {
    disposeStage?.();
    disposeStage = null;
    wrap.innerHTML = '';
  };

  // 练习用音区：优先用测出的音域（两端各收 1 个半音），否则用大众友好区
  function trainRange(): { lo: number; hi: number } {
    const r = getRange();
    if (r && r.hi - r.lo >= 6) return { lo: r.lo + 1, hi: r.hi - 1 };
    return { lo: 55, hi: 72 }; // G3 ~ C5
  }

  function menu() {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `<h2>🎯 音准训练</h2><div class="sing-sub">练耳朵也练嗓子，全程游戏化</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const best = getBirdBest();
    const items = [
      { t: '🎯 单音模仿', d: '听一个音，唱出来稳住它。指针告诉你偏高还是偏低，连击翻倍得分。', go: mimic },
      {
        t: '🐦 声控小鸟',
        d: `用声音的高低控制小鸟飞行，穿过缺口。放声乱唱也是一种减压。${best > 0 ? `最高 ${best} 分。` : ''}`,
        go: bird,
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

  function needMic(back: () => void) {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel sing-result';
    scr.innerHTML = `<h2>🎙️ 需要麦克风</h2><div class="sing-sub">这个练习需要听到你的声音，请返回首页允许麦克风后再试。</div>`;
    scr.appendChild(btn('返回', 'sing-btn', back));
    wrap.appendChild(scr);
  }

  // ---------- 单音模仿 ----------
  function mimic() {
    if (!mic) return needMic(menu);
    clearStage();
    const view = makeCanvas(wrap);
    const ROUNDS = 8;
    const HOLD_NEED = 0.8; // 唱准累计秒数
    const { lo, hi } = trainRange();
    let round = 0;
    let target = 0;
    let hold = 0;
    let score = 0;
    let combo = 0;
    let maxCombo = 0;
    let state: 'listen' | 'sing' | 'hit' | 'done' = 'listen';
    let stateT = 0;
    let lastCents: number | null = null;
    const amb = new Ambient();
    const fx = new Particles();
    // 得分飘字
    const floats: { x: number; y: number; text: string; life: number }[] = [];

    const newTarget = () => {
      let t = target;
      while (t === target) t = lo + Math.floor(Math.random() * (hi - lo + 1));
      target = t;
      state = 'listen';
      stateT = 0;
      hold = 0;
      playTone(target, 1.1, 0, 0.32);
    };
    newTarget();

    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      g.clearRect(0, 0, w, h);
      stateT += dt;
      if (state === 'listen' && stateT > 1.2) {
        state = 'sing';
        stateT = 0;
      }
      if (state === 'hit' && stateT > 1) {
        round++;
        if (round >= ROUNDS) {
          state = 'done';
          finish();
          return;
        }
        newTarget();
      }

      lastCents = null;
      if (state === 'sing') {
        const p = mic!.read();
        if (p) {
          const folded = foldOctave(p.midi, target);
          lastCents = (folded - target) * 100;
          if (Math.abs(lastCents) < 50) {
            hold += dt;
            if (hold >= HOLD_NEED) {
              combo++;
              maxCombo = Math.max(maxCombo, combo);
              const gain = 100 + (combo - 1) * 20;
              score += gain;
              state = 'hit';
              stateT = 0;
              playCue(true);
              haptic(combo > 2 ? [20, 30, 20] : 25);
              fx.burst(view.w / 2, view.h * 0.62, '#ffd54f', 18 + combo * 3, 150);
              floats.push({ x: view.w / 2, y: view.h * 0.5, text: `+${gain}`, life: 1 });
            }
          } else {
            hold = Math.max(0, hold - dt * 2);
          }
        }
      }

      // ---- 绘制 ----
      amb.update(dt, w, h);
      amb.draw(g);
      fx.update(dt);
      const cx = w / 2;
      g.textAlign = 'center';
      g.fillStyle = '#f4eefc';
      g.font = '700 18px sans-serif';
      g.fillText(`第 ${round + 1} / ${ROUNDS} 题`, cx, h * 0.09);
      // 连击时得分带脉冲
      const comboPulse = state === 'hit' && stateT < 0.4 ? 1 + (0.4 - stateT) * 0.8 : 1;
      g.save();
      g.translate(cx, h * 0.15);
      g.scale(comboPulse, comboPulse);
      g.fillStyle = '#ffd54f';
      g.shadowColor = 'rgba(255,213,79,0.6)';
      g.shadowBlur = combo > 1 ? 14 : 0;
      g.fillText(`得分 ${score}${combo > 1 ? ` · 连击 x${combo}` : ''}`, 0, 0);
      g.restore();

      // 目标音（渐变大字）
      g.font = '800 48px sans-serif';
      const tg = g.createLinearGradient(cx, h * 0.24, cx, h * 0.31);
      if (state === 'hit') {
        tg.addColorStop(0, '#d5ffd9');
        tg.addColorStop(1, '#66bb6a');
      } else {
        tg.addColorStop(0, '#e3f6ff');
        tg.addColorStop(1, '#40c4ff');
      }
      g.save();
      g.shadowColor = state === 'hit' ? 'rgba(102,187,106,0.7)' : 'rgba(64,196,255,0.55)';
      g.shadowBlur = 22;
      g.fillStyle = tg;
      g.fillText(midiToName(target), cx, h * 0.3);
      g.restore();
      g.font = '14px sans-serif';
      g.fillStyle = '#a596c2';
      g.fillText(
        state === 'listen' ? '听…' : state === 'hit' ? '漂亮！唱准了 🎉' : `唱出这个音（${midiToSolfege(target)}），稳住半秒多`,
        cx,
        h * 0.36,
      );

      // 音准表：渐变半圆表盘 + 刻度 + 辉光指针（±100 音分）
      const gy = h * 0.62;
      const gr = Math.min(w * 0.36, h * 0.22);
      g.lineCap = 'round';
      // 底环：左红-中绿-右红 渐变
      const arcGrad = g.createLinearGradient(cx - gr, gy, cx + gr, gy);
      arcGrad.addColorStop(0, 'rgba(239,83,80,0.45)');
      arcGrad.addColorStop(0.3, 'rgba(255,213,79,0.4)');
      arcGrad.addColorStop(0.5, 'rgba(102,187,106,0.75)');
      arcGrad.addColorStop(0.7, 'rgba(255,213,79,0.4)');
      arcGrad.addColorStop(1, 'rgba(239,83,80,0.45)');
      g.strokeStyle = arcGrad;
      g.lineWidth = 13;
      g.beginPath();
      g.arc(cx, gy, gr, Math.PI, Math.PI * 2);
      g.stroke();
      // 刻度
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1.5;
      for (let k = -4; k <= 4; k++) {
        const a = Math.PI * 1.5 + (k / 8) * Math.PI;
        const r0 = gr - 12;
        const r1 = gr - (k === 0 ? 22 : 17);
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * r0, gy + Math.sin(a) * r0);
        g.lineTo(cx + Math.cos(a) * r1, gy + Math.sin(a) * r1);
        g.stroke();
      }
      if (lastCents !== null) {
        const cl = Math.max(-100, Math.min(100, lastCents));
        const ang = Math.PI * 1.5 + (cl / 100) * Math.PI * 0.5;
        const ok = Math.abs(cl) < 50;
        g.save();
        g.shadowColor = ok ? 'rgba(102,187,106,0.9)' : 'rgba(239,83,80,0.8)';
        g.shadowBlur = 14;
        g.strokeStyle = ok ? '#8ef29a' : '#ff8a80';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(cx, gy);
        g.lineTo(cx + Math.cos(ang) * gr * 0.9, gy + Math.sin(ang) * gr * 0.9);
        g.stroke();
        // 指针轴心
        g.fillStyle = '#fff';
        g.beginPath();
        g.arc(cx, gy, 5, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = '#a596c2';
        g.font = '12px sans-serif';
        g.fillText(cl > 0 ? `偏高 ${Math.round(cl)} 音分` : cl < 0 ? `偏低 ${Math.round(-cl)} 音分` : '正中', cx, gy + 24);
      }
      g.fillStyle = '#a596c2';
      g.font = '12px sans-serif';
      g.fillText('低', cx - gr, gy + 18);
      g.fillText('高', cx + gr, gy + 18);

      // 保持进度条（辉光）
      const bw = w * 0.5;
      g.fillStyle = 'rgba(255,255,255,0.1)';
      g.beginPath();
      g.roundRect(cx - bw / 2, h * 0.74, bw, 10, 5);
      g.fill();
      const prog = Math.min(1, hold / HOLD_NEED);
      if (prog > 0.01) {
        const pg = g.createLinearGradient(cx - bw / 2, 0, cx - bw / 2 + bw * prog, 0);
        pg.addColorStop(0, '#40c4ff');
        pg.addColorStop(1, '#7ce7c8');
        g.save();
        g.shadowColor = 'rgba(124,231,200,0.8)';
        g.shadowBlur = 12;
        g.fillStyle = pg;
        g.beginPath();
        g.roundRect(cx - bw / 2, h * 0.74, bw * prog, 10, 5);
        g.fill();
        g.restore();
      }

      // 命中粒子与飘字
      fx.draw(g);
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= dt;
        f.y -= dt * 46;
        if (f.life <= 0) {
          floats.splice(i, 1);
          continue;
        }
        g.globalAlpha = Math.min(1, f.life * 2);
        g.fillStyle = '#ffd54f';
        g.font = '800 26px sans-serif';
        g.fillText(f.text, f.x, f.y);
        g.globalAlpha = 1;
      }
    });

    const replay = btn('🔁 再听一遍', 'sing-btn small sing-bottom-left', () => playTone(target, 1.1, 0, 0.32));
    const skip = btn('跳过 ▸', 'sing-btn small ghost sing-bottom-right', () => {
      combo = 0;
      round++;
      if (round >= ROUNDS) {
        finish();
        return;
      }
      newTarget();
    });
    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      menu();
    });
    wrap.appendChild(replay);
    wrap.appendChild(skip);
    wrap.appendChild(back);

    function finish() {
      stop();
      view.dispose();
      replay.remove();
      skip.remove();
      back.remove();
      const scr = document.createElement('div');
      scr.className = 'sing-panel sing-result';
      scr.innerHTML = `<h2>🎯 训练完成</h2><div class="sing-big">${score} 分</div><div class="sing-sub">最高连击 x${maxCombo}。音准是练出来的，每天几分钟就有感觉。</div>`;
      const row = document.createElement('div');
      row.className = 'sing-btn-row';
      row.appendChild(btn('再来一组', 'sing-btn', mimic));
      row.appendChild(btn('返回', 'sing-btn ghost', menu));
      scr.appendChild(row);
      wrap.appendChild(scr);
    }
    disposeStage = () => {
      stop();
      view.dispose();
    };
  }

  // ---------- 声控小鸟 ----------
  function bird() {
    if (!mic) return needMic(menu);
    clearStage();
    const view = makeCanvas(wrap);
    const { lo, hi } = trainRange();
    const span = Math.max(10, hi - lo);
    let y = 0.5; // 0(顶)~1(底) 相对高度
    let vy = 0;
    let pipes: { x: number; gapY: number; passed: boolean }[] = [];
    let spawnT = 0;
    let score = 0;
    let alive = true;
    let started = false;
    let wingT = 0;
    let shake = 0;
    const fx = new Particles();
    // 三层视差星空
    const stars: { x: number; y: number; z: number; tw: number }[] = [];
    for (let i = 0; i < 70; i++) {
      stars.push({ x: Math.random(), y: Math.random(), z: 0.3 + Math.random() * 0.7, tw: Math.random() * 6 });
    }

    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      wingT += dt;
      shake = Math.max(0, shake - dt * 2);
      fx.update(dt);
      const p = mic!.read();
      if (p && alive) {
        started = true;
        // 音高映射到高度：唱得高小鸟飞得高
        const rel = Math.max(0, Math.min(1, (p.midi - lo) / span));
        const targetY = 0.9 - rel * 0.8;
        vy = (targetY - y) * 8;
        // 发声时的尾迹光点
        if (Math.random() < 0.5) {
          fx.spawn({
            x: w * 0.24 - 14,
            y: y * h + (Math.random() - 0.5) * 10,
            vx: -60 - Math.random() * 40,
            vy: (Math.random() - 0.5) * 20,
            life: 0.5,
            ttl: 0.5,
            size: 1.5 + Math.random() * 1.5,
            color: 'rgba(255,213,79,0.8)',
            shape: 'dot',
          });
        }
      } else {
        vy += dt * 1.1; // 没声音就慢慢下坠
        vy = Math.min(vy, 0.55);
      }
      if (alive && started) {
        y += vy * dt;
        y = Math.max(0.03, Math.min(0.97, y));
      }

      if (alive && started) {
        spawnT += dt;
        const interval = Math.max(1.7, 2.6 - score * 0.05);
        if (spawnT > interval) {
          spawnT = 0;
          pipes.push({ x: 1.1, gapY: 0.2 + Math.random() * 0.6, passed: false });
        }
        const speed = 0.16 + Math.min(0.1, score * 0.004);
        for (const pipe of pipes) pipe.x -= speed * dt;
        pipes = pipes.filter((pp) => pp.x > -0.2);
      }

      const birdX = w * 0.24;
      const birdY = y * h;
      const birdR = Math.min(w, h) * 0.03 + 8;
      const gapHalf = 0.17; // 缺口半高（相对）

      // 碰撞与得分
      if (alive && started) {
        for (const pipe of pipes) {
          const px = pipe.x * w;
          const pw = w * 0.09;
          if (!pipe.passed && px + pw < birdX) {
            pipe.passed = true;
            score++;
            playTone(88, 0.1, 0, 0.15);
            haptic(12);
            fx.burst(birdX, birdY, '#ffd54f', 10, 90);
          }
          if (birdX + birdR > px && birdX - birdR < px + pw) {
            if (y < pipe.gapY - gapHalf || y > pipe.gapY + gapHalf) {
              alive = false;
              playCue(false);
              haptic([60, 40, 80]);
              shake = 0.6;
              fx.burst(birdX, birdY, '#ff8a65', 26, 200);
              fx.burst(birdX, birdY, '#ffd54f', 14, 130);
              const isBest = setBirdBest(score);
              window.setTimeout(() => gameOver(isBest), 700);
            }
          }
        }
      }

      // ---- 绘制 ----
      g.clearRect(0, 0, w, h);
      g.save();
      if (shake > 0) g.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
      // 三层视差星空 + 缓移云
      for (const s of stars) {
        const sx = ((s.x - wingT * 0.008 * s.z) % 1 + 1) % 1;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(wingT * 1.4 + s.tw));
        g.globalAlpha = tw * s.z * 0.8;
        g.fillStyle = s.z > 0.75 ? '#e3d7ff' : '#9bb8d8';
        g.fillRect(sx * w, s.y * h, s.z > 0.75 ? 2 : 1.4, s.z > 0.75 ? 2 : 1.4);
      }
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(206,147,216,0.06)';
      for (let i = 0; i < 4; i++) {
        const cxx = ((i * 0.3 + wingT * 0.015) % 1.2) * w;
        g.beginPath();
        g.ellipse(cxx, h * (0.15 + i * 0.2), 52, 15, 0, 0, Math.PI * 2);
        g.fill();
      }
      // 霓虹渐变管道
      for (const pipe of pipes) {
        const px = pipe.x * w;
        const pw = w * 0.09;
        const gy0 = (pipe.gapY - gapHalf) * h;
        const gy1 = (pipe.gapY + gapHalf) * h;
        const pg = g.createLinearGradient(px, 0, px + pw, 0);
        pg.addColorStop(0, '#1d5a42');
        pg.addColorStop(0.35, '#3aa06c');
        pg.addColorStop(0.6, '#2e7d55');
        pg.addColorStop(1, '#174534');
        g.fillStyle = pg;
        g.beginPath();
        g.roundRect(px, -8, pw, gy0 + 8, 6);
        g.fill();
        g.beginPath();
        g.roundRect(px, gy1, pw, h - gy1 + 8, 6);
        g.fill();
        // 管口沿 + 缺口辉光
        g.save();
        g.shadowColor = 'rgba(124,231,200,0.65)';
        g.shadowBlur = 12;
        g.fillStyle = '#4cc389';
        g.beginPath();
        g.roundRect(px - 3, gy0 - 10, pw + 6, 10, 4);
        g.fill();
        g.beginPath();
        g.roundRect(px - 3, gy1, pw + 6, 10, 4);
        g.fill();
        g.restore();
      }
      // 小鸟
      g.save();
      g.translate(birdX, birdY);
      g.rotate(Math.max(-0.4, Math.min(0.5, vy * 0.8)));
      g.fillStyle = alive ? '#ffca28' : '#9e9e9e';
      g.beginPath();
      g.ellipse(0, 0, birdR * 1.15, birdR, 0, 0, Math.PI * 2);
      g.fill();
      // 翅膀
      g.fillStyle = alive ? '#ffb300' : '#8a8a8a';
      const flap = Math.sin(wingT * (p ? 18 : 6)) * birdR * 0.5;
      g.beginPath();
      g.ellipse(-birdR * 0.2, flap * 0.4, birdR * 0.7, birdR * 0.45, -0.4, 0, Math.PI * 2);
      g.fill();
      // 眼睛和嘴
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(birdR * 0.45, -birdR * 0.3, birdR * 0.32, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#222';
      g.beginPath();
      g.arc(birdR * 0.55, -birdR * 0.3, birdR * 0.16, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff7043';
      g.beginPath();
      g.moveTo(birdR * 1.05, -birdR * 0.05);
      g.lineTo(birdR * 1.6, birdR * 0.12);
      g.lineTo(birdR * 1.05, birdR * 0.3);
      g.fill();
      g.restore();
      fx.draw(g);
      g.restore(); // 震屏结束

      // 音高刻度提示（左侧）
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = '11px sans-serif';
      g.textAlign = 'left';
      g.fillText(midiToName(hi) + ' 高', 8, h * 0.12);
      g.fillText(midiToName(lo) + ' 低', 8, h * 0.92);

      g.textAlign = 'center';
      g.save();
      g.shadowColor = 'rgba(255,213,79,0.55)';
      g.shadowBlur = 14;
      g.fillStyle = '#ffe9a8';
      g.font = '800 28px sans-serif';
      g.fillText(String(score), w / 2, h * 0.1);
      g.restore();
      if (!started) {
        g.font = '700 17px sans-serif';
        g.fillText('出个声，小鸟就起飞！', w / 2, h * 0.45);
        g.font = '13px sans-serif';
        g.fillStyle = '#91a4b5';
        g.fillText('唱得高飞得高，唱得低飞得低，停下会慢慢下坠', w / 2, h * 0.52);
      }
    });

    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      menu();
    });
    wrap.appendChild(back);

    function gameOver(isBest: boolean) {
      stop();
      view.dispose();
      back.remove();
      const scr = document.createElement('div');
      scr.className = 'sing-panel sing-result';
      scr.innerHTML = `<h2>🐦 ${isBest ? '新纪录！' : '游戏结束'}</h2><div class="sing-big">${score} 分</div><div class="sing-sub">历史最高 ${getBirdBest()} 分。喊出来了吗？压力小一点了没？</div>`;
      const row = document.createElement('div');
      row.className = 'sing-btn-row';
      row.appendChild(btn('再来一局', 'sing-btn', bird));
      row.appendChild(btn('返回', 'sing-btn ghost', menu));
      scr.appendChild(row);
      wrap.appendChild(scr);
    }
    disposeStage = () => {
      stop();
      view.dispose();
    };
  }

  menu();
  return () => {
    disposeStage?.();
    wrap.remove();
  };
}
