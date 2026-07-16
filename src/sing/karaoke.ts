/** 模式三 · 跟唱打分：钢琴卷帘卡拉 OK，实时音高曲线 + 逐音符评分 */

import { Mic, midiToName } from './pitch';
import { MelodyPlayer } from './synth';
import { SONGS, flattenSong, songRange, type Song, type SongNote } from './songs';
import { getRange, getBest, setBest } from './save';
import { makeCanvas, rafLoop, foldOctave, btn } from './view';

const LEAD = 4; // 前奏空拍

interface TimedNote extends SongNote {
  start: number; // 起始拍
  line: number; // 所属句
}

export function runKaraoke(root: HTMLElement, mic: Mic | null, onExit: () => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'sing-stage';
  root.appendChild(wrap);

  let disposeStage: (() => void) | null = null;
  const clearStage = () => {
    disposeStage?.();
    disposeStage = null;
    wrap.innerHTML = '';
  };

  function songList() {
    clearStage();
    const scr = document.createElement('div');
    scr.className = 'sing-panel';
    scr.innerHTML = `<h2>🎤 跟唱打分</h2><div class="sing-sub">${
      mic ? '跟着卷帘唱，实时看到自己的音高曲线' : '未开麦克风 · 欣赏模式（只播旋律不打分）'
    }</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const song of SONGS) {
      const best = getBest(song.id);
      const stars = best ? '⭐'.repeat(best.stars) || '—' : '';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="title">${song.emoji} ${song.name}<span class="tag">${song.level}</span></div>
        <div class="desc">${best ? `最佳 ${best.score} 分 ${stars}` : '还没唱过'}</div>`;
      card.addEventListener('click', () => songScreen(song));
      list.appendChild(card);
    }
    scr.appendChild(list);
    scr.appendChild(btn('← 返回', 'sing-btn ghost', onExit));
    wrap.appendChild(scr);
  }

  function suggestTranspose(song: Song): number {
    const r = getRange();
    if (!r) return 0;
    const sr = songRange(song);
    let t = Math.round((r.lo + r.hi) / 2 - (sr.lo + sr.hi) / 2);
    t -= Math.round(t / 12) * 12; // 八度交给评分折叠，这里只调 ±6 内
    return Math.max(-6, Math.min(6, t));
  }

  function songScreen(song: Song) {
    clearStage();
    const { notes: flat, lineStart } = flattenSong(song);
    const notes: TimedNote[] = [];
    {
      let beat = 0;
      let li = 0;
      flat.forEach((nt, i) => {
        while (li + 1 < lineStart.length && i >= lineStart[li + 1]) li++;
        notes.push({ ...nt, start: beat, line: li });
        beat += nt.d;
      });
    }
    const lineText = song.lines.map((ln) => ln.map((nt) => nt.ly ?? '').join(''));
    const sr = songRange(song);

    let transpose = suggestTranspose(song);
    const player = new MelodyPlayer();
    let playing = false;
    // 每个音符的评分累计
    let frames = new Float32Array(notes.length);
    let hits = new Float32Array(notes.length);
    let trail: { beat: number; midi: number }[] = [];
    let noteIdx = 0;

    // ---- 顶部栏 ----
    const top = document.createElement('div');
    top.className = 'sing-topbar';
    top.innerHTML = `<span class="sing-song-name">${song.emoji} ${song.name}</span><span class="sing-live" id="sing-live"></span>`;
    wrap.appendChild(top);

    const view = makeCanvas(wrap, 'sing-canvas sing-roll');

    // ---- 底部控制 ----
    const bar = document.createElement('div');
    bar.className = 'sing-ctrl';
    const keyLabel = document.createElement('span');
    keyLabel.className = 'sing-key';
    const updateKey = () => {
      keyLabel.textContent = `调 ${transpose > 0 ? '+' + transpose : transpose}`;
    };
    updateKey();
    const down = btn('♭', 'sing-btn small', () => {
      if (!playing && transpose > -6) {
        transpose--;
        updateKey();
      }
    });
    const up = btn('♯', 'sing-btn small', () => {
      if (!playing && transpose < 6) {
        transpose++;
        updateKey();
      }
    });
    const playBtn = btn('▶ 开始', 'sing-btn primary', () => (playing ? stopSong() : startSong()));
    bar.appendChild(down);
    bar.appendChild(keyLabel);
    bar.appendChild(up);
    bar.appendChild(playBtn);
    wrap.appendChild(bar);

    const back = btn('← 退出', 'sing-btn ghost sing-corner', () => {
      disposeStage?.();
      disposeStage = null;
      songList();
    });
    wrap.appendChild(back);

    function startSong() {
      frames = new Float32Array(notes.length);
      hits = new Float32Array(notes.length);
      trail = [];
      noteIdx = 0;
      playing = true;
      playBtn.textContent = '■ 停止';
      player.play(notes, song.bpm, transpose, LEAD, 0.26, () => finish());
    }
    function stopSong() {
      player.stop();
      playing = false;
      playBtn.textContent = '▶ 开始';
    }

    const live = top.querySelector('#sing-live') as HTMLElement;

    const stop = rafLoop(() => {
      const { g, w, h } = view;
      const beat = playing ? player.beatNow() - LEAD : -LEAD;

      // ---- 采样与评分 ----
      let sungMidi: number | null = null;
      if (mic) {
        const p = mic.read();
        if (p && playing && beat > -LEAD * 0.5) {
          while (noteIdx < notes.length - 1 && beat >= notes[noteIdx].start + notes[noteIdx].d) noteIdx++;
          const cur = notes[noteIdx];
          const active = beat >= cur.start && beat < cur.start + cur.d && cur.m > 0;
          const ref = active ? cur.m + transpose : sr.lo + transpose;
          sungMidi = foldOctave(p.midi, ref);
          trail.push({ beat, midi: sungMidi });
          if (active) {
            frames[noteIdx] += 1;
            const cents = Math.abs(sungMidi - (cur.m + transpose)) * 100;
            if (cents < 60) hits[noteIdx] += 1;
            else if (cents < 120) hits[noteIdx] += 0.5;
          }
        }
      }
      while (trail.length && trail[0].beat < beat - 10) trail.shift();

      // 实时得分显示
      if (playing && mic) {
        live.textContent = `${liveScore()} 分`;
      } else if (!playing) {
        live.textContent = mic ? '' : '欣赏模式';
      }

      // ---- 绘制卷帘 ----
      g.clearRect(0, 0, w, h);
      const pxPerBeat = Math.max(48, Math.min(100, w / 9));
      const nowX = w * 0.26;
      const lo = sr.lo + transpose - 3;
      const hi = sr.hi + transpose + 3;
      const rollTop = h * 0.06;
      const rollBottom = h * 0.72;
      const my = (m: number) => rollBottom - ((m - lo) / (hi - lo)) * (rollBottom - rollTop);
      const bx = (b: number) => nowX + (b - beat) * pxPerBeat;

      // 横向参考线（每个白键 C/E/G）
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.lineWidth = 1;
      for (let m = Math.ceil(lo); m <= hi; m++) {
        if (m % 12 === 0 || m % 12 === 4 || m % 12 === 7) {
          g.beginPath();
          g.moveTo(0, my(m));
          g.lineTo(w, my(m));
          g.stroke();
          if (m % 12 === 0) {
            g.fillStyle = 'rgba(255,255,255,0.28)';
            g.font = '10px sans-serif';
            g.textAlign = 'left';
            g.fillText(midiToName(m), 4, my(m) - 3);
          }
        }
      }

      // 音符条 + 歌词字
      g.textAlign = 'center';
      for (let i = 0; i < notes.length; i++) {
        const nt = notes[i];
        if (nt.m <= 0) continue;
        const x0 = bx(nt.start);
        const x1 = bx(nt.start + nt.d);
        if (x1 < -20 || x0 > w + 20) continue;
        const active = beat >= nt.start && beat < nt.start + nt.d;
        const past = beat >= nt.start + nt.d;
        const quality = frames[i] > 0 ? hits[i] / frames[i] : 0;
        g.fillStyle = active
          ? '#40c4ff'
          : past
            ? mic && frames[i] > 2
              ? quality > 0.6
                ? 'rgba(102,187,106,0.8)'
                : 'rgba(239,83,80,0.55)'
              : 'rgba(255,255,255,0.18)'
            : 'rgba(255,255,255,0.3)';
        const y = my(nt.m + transpose);
        g.beginPath();
        g.roundRect(x0 + 1.5, y - 7, Math.max(6, x1 - x0 - 3), 14, 7);
        g.fill();
        if (nt.ly) {
          g.fillStyle = active ? '#ffca28' : 'rgba(232,238,244,0.75)';
          g.font = `${active ? '700 15px' : '13px'} sans-serif`;
          g.fillText(nt.ly, (x0 + x1) / 2, y - 13);
        }
      }

      // 当前时间线
      g.strokeStyle = 'rgba(255,202,40,0.6)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(nowX, rollTop - 8);
      g.lineTo(nowX, rollBottom + 8);
      g.stroke();

      // 用户音高曲线
      if (trail.length > 1) {
        g.strokeStyle = '#7ce7c8';
        g.lineWidth = 2.5;
        g.beginPath();
        let pen = false;
        let prevBeat = -999;
        for (const pt of trail) {
          const x = bx(pt.beat);
          const y = my(pt.midi);
          if (!pen || pt.beat - prevBeat > 0.35) {
            g.moveTo(x, y);
            pen = true;
          } else g.lineTo(x, y);
          prevBeat = pt.beat;
        }
        g.stroke();
      }
      if (sungMidi !== null) {
        g.fillStyle = '#7ce7c8';
        g.beginPath();
        g.arc(nowX, my(sungMidi), 5, 0, Math.PI * 2);
        g.fill();
      }

      // 倒计时
      if (playing && beat < 0) {
        g.fillStyle = '#ffca28';
        g.font = '700 44px sans-serif';
        g.textAlign = 'center';
        g.fillText(String(Math.ceil(-beat)), w / 2, h * 0.4);
      }

      // ---- 歌词区（当前句 + 下一句）----
      const curLine = playing ? (notes[Math.min(noteIdx, notes.length - 1)]?.line ?? 0) : 0;
      g.textAlign = 'center';
      g.font = '700 20px sans-serif';
      const lineY = h * 0.84;
      const text = lineText[curLine] ?? '';
      if (text) {
        // 已唱到的字高亮
        let sung = 0;
        if (playing) {
          const start = lineStart[curLine];
          const end = curLine + 1 < lineStart.length ? lineStart[curLine + 1] : notes.length;
          for (let i = start; i < end; i++) if (beat >= notes[i].start && notes[i].ly) sung += notes[i].ly!.length;
        }
        const full = g.measureText(text).width;
        let x = w / 2 - full / 2;
        for (let ci = 0; ci < text.length; ci++) {
          const chW = g.measureText(text[ci]).width;
          g.fillStyle = ci < sung ? '#ffca28' : '#e8eef4';
          g.fillText(text[ci], x + chW / 2, lineY);
          x += chW;
        }
      }
      const nextText = lineText[curLine + 1];
      if (nextText) {
        g.font = '14px sans-serif';
        g.fillStyle = 'rgba(145,164,181,0.8)';
        g.fillText(nextText, w / 2, lineY + 26);
      }
      if (!playing) {
        g.font = '13px sans-serif';
        g.fillStyle = '#91a4b5';
        g.fillText(mic ? '按 ▶ 开始，跟着黄线唱出音符上的字' : '按 ▶ 听旋律（欣赏模式）', w / 2, h * 0.78);
      }
    });

    function liveScore(): number {
      let sw = 0;
      let sd = 0;
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].m <= 0 || notes[i].start + notes[i].d > player.beatNow() - LEAD) continue;
        const q = Math.min(1, frames[i] > 0 ? hits[i] / Math.max(1, frames[i] * 0.6) : 0);
        sw += q * notes[i].d;
        sd += notes[i].d;
      }
      return sd > 0 ? Math.round((sw / sd) * 100) : 0;
    }

    function finish() {
      playing = false;
      playBtn.textContent = '▶ 开始';
      if (!mic) return; // 欣赏模式无结算
      let sw = 0;
      let sd = 0;
      for (let i = 0; i < notes.length; i++) {
        if (notes[i].m <= 0) continue;
        const q = Math.min(1, frames[i] > 0 ? hits[i] / Math.max(1, frames[i] * 0.6) : 0);
        sw += q * notes[i].d;
        sd += notes[i].d;
      }
      const score = sd > 0 ? Math.round((sw / sd) * 100) : 0;
      const stars = score >= 85 ? 3 : score >= 65 ? 2 : score >= 40 ? 1 : 0;
      const isBest = setBest(song.id, score, stars);

      const overlay = document.createElement('div');
      overlay.className = 'sing-panel sing-result sing-overlay';
      overlay.innerHTML = `<h2>${song.emoji} ${song.name}</h2>
        <div class="sing-stars">${'⭐'.repeat(stars) || '🌱'}</div>
        <div class="sing-big">${score} 分${isBest ? ' <span class="tag">新纪录</span>' : ''}</div>
        <div class="sing-sub">${
          score >= 85
            ? '太棒了，几乎每个音都在线上！'
            : score >= 65
              ? '很不错！红色的音符条就是跑调的地方，再来一遍针对性攻克。'
              : score >= 40
                ? '有模有样了。试试先用「音准训练」找感觉，或者用 ♭♯ 换个更舒服的调。'
                : '别灰心，唱歌减压重在放声。先去「减压开嗓」热热身再回来！'
        }</div>`;
      const row = document.createElement('div');
      row.className = 'sing-btn-row';
      row.appendChild(
        btn('再唱一次', 'sing-btn primary', () => {
          overlay.remove();
          startSong();
        }),
      );
      row.appendChild(btn('换一首', 'sing-btn ghost', songList));
      overlay.appendChild(row);
      wrap.appendChild(overlay);
    }

    disposeStage = () => {
      stop();
      player.stop();
      view.dispose();
    };
  }

  songList();
  return () => {
    disposeStage?.();
    wrap.remove();
  };
}
