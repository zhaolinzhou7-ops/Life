import { MAPS } from '../maps/maps';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../core/economy';
import { getEndlessBest, getProgress } from '../core/save';
import { Sfx, initAudio } from '../audio';

/** 主菜单 / 选关 / 难度 / 模式：一体化流程，回调返回选择结果 */
export function showStartFlow(
  container: HTMLElement,
  onStart: (mapId: string, diff: Difficulty, endless: boolean) => void,
): HTMLElement {
  let selectedMap = MAPS[0].id;
  let selectedDiff: Difficulty = 'normal';
  let endless = false;

  const screen = document.createElement('div');
  screen.className = 'screen';

  const render = () => {
    screen.innerHTML = `
      <h1>塔防远征</h1>
      <div class="sub">3D 塔防 · 建塔阻击 25 波进攻 · 守住你的水晶基地</div>
      <div style="width:100%;max-width:460px;color:var(--muted);font-size:13px;margin-bottom:8px;">选择地图</div>
    `;

    const mapList = document.createElement('div');
    mapList.className = 'card-list';
    MAPS.forEach((m) => {
      let badge = '';
      if (endless) {
        const best = getEndlessBest(m.id, selectedDiff);
        badge = best > 0 ? `<span class="tag">无尽最高 ${best} 波</span>` : '';
      } else {
        const prog = getProgress(m.id, selectedDiff);
        badge = prog.completed
          ? '<span class="tag">★ 已通关</span>'
          : prog.bestWave > 0
            ? `<span class="tag">最高 ${prog.bestWave} 波</span>`
            : '';
      }
      const card = document.createElement('div');
      card.className = 'card' + (m.id === selectedMap ? ' selected' : '');
      card.innerHTML = `
        <div class="title">${m.name} ${badge}</div>
        <div class="desc">${m.desc}</div>
      `;
      card.addEventListener('click', () => {
        Sfx.click();
        selectedMap = m.id;
        render();
      });
      mapList.appendChild(card);
    });
    screen.appendChild(mapList);

    const diffLabel = document.createElement('div');
    diffLabel.style.cssText =
      'width:100%;max-width:460px;color:var(--muted);font-size:13px;margin:18px 0 2px;';
    diffLabel.textContent = '选择难度';
    screen.appendChild(diffLabel);

    const diffRow = document.createElement('div');
    diffRow.className = 'diff-row';
    DIFFICULTY_ORDER.forEach((d) => {
      const def = DIFFICULTIES[d];
      const card = document.createElement('div');
      card.className = 'card' + (d === selectedDiff ? ' selected' : '');
      card.innerHTML = `<div class="title" style="justify-content:center">${def.label}</div>
        <div class="desc" style="text-align:center">${def.startGold}◈ · ${def.lives}❤</div>`;
      card.addEventListener('click', () => {
        Sfx.click();
        selectedDiff = d;
        render();
      });
      diffRow.appendChild(card);
    });
    screen.appendChild(diffRow);

    const modeLabel = document.createElement('div');
    modeLabel.style.cssText =
      'width:100%;max-width:460px;color:var(--muted);font-size:13px;margin:18px 0 2px;';
    modeLabel.textContent = '选择模式';
    screen.appendChild(modeLabel);

    const modeRow = document.createElement('div');
    modeRow.className = 'diff-row';
    const modes: { key: boolean; title: string; desc: string }[] = [
      { key: false, title: '标准 25 波', desc: '顶住 25 波即通关' },
      { key: true, title: '无尽模式', desc: '越打越强 · 比谁撑得久' },
    ];
    modes.forEach((mo) => {
      const card = document.createElement('div');
      card.className = 'card' + (mo.key === endless ? ' selected' : '');
      card.innerHTML = `<div class="title" style="justify-content:center">${mo.title}</div>
        <div class="desc" style="text-align:center">${mo.desc}</div>`;
      card.addEventListener('click', () => {
        Sfx.click();
        endless = mo.key;
        render();
      });
      modeRow.appendChild(card);
    });
    screen.appendChild(modeRow);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = '开始游戏';
    btn.addEventListener('click', () => {
      initAudio();
      Sfx.click();
      onStart(selectedMap, selectedDiff, endless);
    });
    screen.appendChild(btn);

    const hint = document.createElement('div');
    hint.style.cssText = 'color:var(--muted);font-size:11.5px;margin-top:14px;text-align:center;max-width:460px;';
    hint.textContent = '操作：拖动移动视角 · 双指缩放 · 点空地建塔 · 点塔升级或出售';
    screen.appendChild(hint);
  };

  render();
  container.appendChild(screen);
  return screen;
}

/** 胜负结算界面 */
export function showResult(
  container: HTMLElement,
  opts: {
    won: boolean;
    wave: number;
    totalWaves: number;
    mapName: string;
    diffLabel: string;
    endless: boolean;
    newRecord: boolean;
  },
  onRetry: () => void,
  onMenu: () => void,
): HTMLElement {
  const { won, wave, totalWaves, mapName, diffLabel, endless, newRecord } = opts;
  const screen = document.createElement('div');
  screen.className = 'screen';

  let badge: string;
  let title: string;
  let detail: string;
  if (endless) {
    badge = newRecord ? '🎖️' : '🏳️';
    title = '无尽挑战结束';
    detail = `${mapName} · ${diffLabel} · 无尽模式<br>坚持到第 <b style="color:var(--accent)">${wave}</b> 波${
      newRecord ? '<br><span style="color:var(--accent2)">🎉 创造新纪录！</span>' : ''
    }`;
  } else if (won) {
    badge = '🏆';
    title = '守卫成功';
    detail = `${mapName} · ${diffLabel}<br>顶住了全部 ${totalWaves} 波进攻！`;
  } else {
    badge = '💥';
    title = '基地失守';
    detail = `${mapName} · ${diffLabel}<br>坚持到第 ${wave} 波`;
  }

  screen.innerHTML = `
    <div class="result-badge">${badge}</div>
    <h1>${title}</h1>
    <div class="result-lines">${detail}</div>
  `;
  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.textContent = endless ? '再战一场' : won ? '再玩一次' : '重新挑战';
  retry.addEventListener('click', () => {
    Sfx.click();
    onRetry();
  });
  screen.appendChild(retry);

  const menu = document.createElement('button');
  menu.className = 'btn ghost';
  menu.textContent = '返回主菜单';
  menu.addEventListener('click', () => {
    Sfx.click();
    onMenu();
  });
  screen.appendChild(menu);

  container.appendChild(screen);
  return screen;
}
