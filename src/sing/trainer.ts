/** 模式二 · 音准训练：单音模仿打分 + 声控小鸟减压小游戏 */

import { Mic, midiToName, midiToSolfege } from './pitch';
import { playTone, playCue } from './synth';
import { getRange, getBirdBest, setBirdBest } from './save';
import { makeCanvas, rafLoop, foldOctave, btn } from './view';

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
              score += 100 + (combo - 1) * 20;
              state = 'hit';
              stateT = 0;
              playCue(true);
            }
          } else {
            hold = Math.max(0, hold - dt * 2);
          }
        }
      }

      // ---- 绘制 ----
      const cx = w / 2;
      g.textAlign = 'center';
      g.fillStyle = '#e8eef4';
      g.font = '700 18px sans-serif';
      g.fillText(`第 ${round + 1} / ${ROUNDS} 题`, cx, h * 0.09);
      g.fillStyle = '#ffca28';
      g.fillText(`得分 ${score}${combo > 1 ? ` · 连击 x${combo}` : ''}`, cx, h * 0.15);

      // 目标音
      g.fillStyle = state === 'hit' ? '#66bb6a' : '#40c4ff';
      g.font = '700 44px sans-serif';
      g.fillText(midiToName(target), cx, h * 0.3);
      g.font = '14px sans-serif';
      g.fillStyle = '#91a4b5';
      g.fillText(
        state === 'listen' ? '听…' : state === 'hit' ? '漂亮！唱准了 🎉' : `唱出这个音（${midiToSolfege(target)}），稳住半秒多`,
        cx,
        h * 0.36,
      );

      // 音准表：半圆表盘，指针指向偏差（±100 音分）
      const gy = h * 0.62;
      const gr = Math.min(w * 0.36, h * 0.22);
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 12;
      g.beginPath();
      g.arc(cx, gy, gr, Math.PI, Math.PI * 2);
      g.stroke();
      // 中央绿色安全区（±50 音分）
      g.strokeStyle = 'rgba(102,187,106,0.5)';
      g.beginPath();
      g.arc(cx, gy, gr, Math.PI * 1.25, Math.PI * 1.75);
      g.stroke();
      if (lastCents !== null) {
        const cl = Math.max(-100, Math.min(100, lastCents));
        const ang = Math.PI * 1.5 + (cl / 100) * Math.PI * 0.5;
        g.strokeStyle = Math.abs(cl) < 50 ? '#66bb6a' : '#ef5350';
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(cx, gy);
        g.lineTo(cx + Math.cos(ang) * gr * 0.92, gy + Math.sin(ang) * gr * 0.92);
        g.stroke();
        g.fillStyle = '#91a4b5';
        g.font = '12px sans-serif';
        g.fillText(cl > 0 ? `偏高 ${Math.round(cl)} 音分` : cl < 0 ? `偏低 ${Math.round(-cl)} 音分` : '正中', cx, gy + 24);
      }
      g.fillStyle = '#91a4b5';
      g.font = '12px sans-serif';
      g.fillText('低', cx - gr, gy + 18);
      g.fillText('高', cx + gr, gy + 18);

      // 保持进度条
      const bw = w * 0.5;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(cx - bw / 2, h * 0.74, bw, 10, 5);
      g.fill();
      g.fillStyle = '#7ce7c8';
      g.beginPath();
      g.roundRect(cx - bw / 2, h * 0.74, (bw * Math.min(1, hold / HOLD_NEED)), 10, 5);
      g.fill();
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

    const stop = rafLoop((dt) => {
      const { g, w, h } = view;
      wingT += dt;
      const p = mic!.read();
      if (p && alive) {
        started = true;
        // 音高映射到高度：唱得高小鸟飞得高
        const rel = Math.max(0, Math.min(1, (p.midi - lo) / span));
        const targetY = 0.9 - rel * 0.8;
        vy = (targetY - y) * 8;
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
          }
          if (birdX + birdR > px && birdX - birdR < px + pw) {
            if (y < pipe.gapY - gapHalf || y > pipe.gapY + gapHalf) {
              alive = false;
              playCue(false);
              const isBest = setBirdBest(score);
              window.setTimeout(() => gameOver(isBest), 700);
            }
          }
        }
      }

      // ---- 绘制 ----
      g.clearRect(0, 0, w, h);
      // 云
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (let i = 0; i < 4; i++) {
        const cxx = ((i * 0.3 + wingT * 0.015) % 1.2) * w;
        g.beginPath();
        g.ellipse(cxx, h * (0.15 + i * 0.2), 46, 14, 0, 0, Math.PI * 2);
        g.fill();
      }
      // 管道
      for (const pipe of pipes) {
        const px = pipe.x * w;
        const pw = w * 0.09;
        const gy0 = (pipe.gapY - gapHalf) * h;
        const gy1 = (pipe.gapY + gapHalf) * h;
        g.fillStyle = '#2e7d55';
        g.beginPath();
        g.roundRect(px, -8, pw, gy0 + 8, 6);
        g.fill();
        g.beginPath();
        g.roundRect(px, gy1, pw, h - gy1 + 8, 6);
        g.fill();
        g.fillStyle = '#3aa06c';
        g.fillRect(px - 3, gy0 - 10, pw + 6, 10);
        g.fillRect(px - 3, gy1, pw + 6, 10);
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

      // 音高刻度提示（左侧）
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = '11px sans-serif';
      g.textAlign = 'left';
      g.fillText(midiToName(hi) + ' 高', 8, h * 0.12);
      g.fillText(midiToName(lo) + ' 低', 8, h * 0.92);

      g.textAlign = 'center';
      g.fillStyle = '#e8eef4';
      g.font = '700 26px sans-serif';
      g.fillText(String(score), w / 2, h * 0.1);
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
