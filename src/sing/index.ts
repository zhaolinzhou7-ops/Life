/** 唱吧减压 · 启动入口:模式主页、麦克风授权与模式切换。返回清理函数 */

import { Mic, midiToName } from './pitch';
import { audioCtx, resumeAudio } from './synth';
import { getRange, getTotals, getBirdBest, getCoach } from './save';
import { runWarmup } from './warmup';
import { runTrainer } from './trainer';
import { runKaraoke } from './karaoke';
import { runCoach } from './coach';

export function bootSing(app: HTMLElement, onExit: () => void): () => void {
  const root = document.createElement('div');
  root.className = 'sing-root';
  app.appendChild(root);

  let mic: Mic | null = null;
  let micState: 'none' | 'asking' | 'ok' | 'denied' = 'none';
  let disposeMode: (() => void) | null = null;

  const clearMode = () => {
    disposeMode?.();
    disposeMode = null;
    root.innerHTML = '';
  };

  /** 申请麦克风（幂等）；结果反映在 micState 上 */
  async function ensureMic(): Promise<void> {
    if (micState === 'ok' || micState === 'asking') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      micState = 'denied';
      return;
    }
    micState = 'asking';
    try {
      mic = await Mic.create(audioCtx());
      micState = 'ok';
    } catch {
      micState = 'denied';
    }
  }

  function enterMode(run: (root: HTMLElement, mic: Mic | null, onBack: () => void) => () => void) {
    resumeAudio();
    void ensureMic().then(() => {
      if (!root.isConnected) return;
      clearMode();
      disposeMode = run(root, mic, showMenu);
    });
  }

  function showMenu() {
    clearMode();
    const scr = document.createElement('div');
    scr.className = 'screen sing-home';
    const range = getRange();
    const totals = getTotals();
    const birdBest = getBirdBest();
    const chips: string[] = [];
    if (totals.stars > 0) chips.push(`⭐ 累计 <b>${totals.stars}</b> 星`);
    if (totals.sung > 0) chips.push(`🎵 唱过 <b>${totals.sung}</b> 首`);
    if (birdBest > 0) chips.push(`🐦 小鸟 <b>${birdBest}</b> 分`);
    if (range) chips.push(`🎙️ 音域 <b>${midiToName(range.lo)}~${midiToName(range.hi)}</b>`);
    scr.innerHTML = `
      <h1><span class="sing-eq"><i></i><i></i><i></i><i></i><i></i></span>唱吧减压</h1>
      <div class="sub">上班压力大？唱出来。开嗓 → 练音准 → 跟唱打分</div>
      ${chips.length ? `<div class="sing-stats">${chips.map((c) => `<span class="sing-chip">${c}</span>`).join('')}</div>` : ''}`;
    const list = document.createElement('div');
    list.className = 'card-list';

    const coach = getCoach();
    const modes = [
      {
        t: '🎯 高音训练营',
        d: `唱高音费嗓、上不去？按声乐老师的路子，30 天把喊改成唱。21 条专业练声曲 + 实时告诉你什么时候在硬撑。${
          coach.done.length ? `已练到第 ${Math.min(30, coach.day)} 天。` : ''
        }`,
        go: () => enterMode(runCoach),
      },
      {
        t: '🫁 减压开嗓',
        d: '引导呼吸放松 2 分钟，跟音阶温柔开嗓，再测出你的音域。每次唱歌前的仪式感。',
        go: () => enterMode(runWarmup),
      },
      {
        t: '🎯 音准训练',
        d: '听音模仿拿连击，或者玩声控小鸟——用声音的高低控制小鸟飞行，放声乱唱也解压。',
        go: () => enterMode(runTrainer),
      },
      {
        t: '🎤 跟唱打分',
        d: '十二首经典旋律，钢琴卷帘 + 歌词滚动，实时画出你的音高曲线，唱完打分评星。',
        go: () => enterMode(runKaraoke),
      },
    ];
    for (const m of modes) {
      const card = document.createElement('div');
      card.className = 'card home-card';
      card.innerHTML = `<div class="title">${m.t}</div><div class="desc">${m.d}</div>`;
      card.addEventListener('click', m.go);
      list.appendChild(card);
    }
    scr.appendChild(list);

    const hint = document.createElement('div');
    hint.className = 'sing-mic-hint';
    hint.textContent =
      micState === 'denied'
        ? '⚠️ 麦克风被拒绝或不可用：打分类玩法用不了，可先用欣赏模式。可在浏览器地址栏权限里重新允许。'
        : '进入玩法时会请求麦克风权限，声音只在本机分析，不会上传。';
    scr.appendChild(hint);

    const backBtn = document.createElement('button');
    backBtn.className = 'sing-btn ghost';
    backBtn.textContent = '← 返回合集首页';
    backBtn.addEventListener('click', onExit);
    scr.appendChild(backBtn);

    root.appendChild(scr);
  }

  showMenu();

  return () => {
    clearMode();
    mic?.dispose();
    mic = null;
    root.remove();
  };
}
