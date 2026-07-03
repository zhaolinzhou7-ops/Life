import { MAPS } from '../maps/maps';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../core/economy';
import { getProgress } from '../core/save';

/** 首页：选择「单人闯关」或「联机对战」。 */
export function showHome(
  container: HTMLElement,
  cb: { onSingle: () => void; onVersus: () => void },
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <h1>塔防远征</h1>
    <div class="sub">3D 塔防 · 单人闯关，或联机与好友同波竞速</div>
  `;

  const single = document.createElement('button');
  single.className = 'btn';
  single.innerHTML = '🏰 单人闯关';
  single.addEventListener('click', cb.onSingle);
  screen.appendChild(single);

  const versus = document.createElement('button');
  versus.className = 'btn ghost';
  versus.innerHTML = '⚔️ 联机对战';
  versus.addEventListener('click', cb.onVersus);
  screen.appendChild(versus);

  const hint = document.createElement('div');
  hint.style.cssText = 'color:var(--muted);font-size:11.5px;margin-top:16px;text-align:center;max-width:460px;';
  hint.textContent = '联机对战：两名玩家面对完全相同的波次，比谁守得更久、走得更远。';
  screen.appendChild(hint);

  container.appendChild(screen);
  return screen;
}

/** 主菜单 / 选关 / 难度选择：一体化流程，回调返回选择结果 */
export function showStartFlow(
  container: HTMLElement,
  onStart: (mapId: string, diff: Difficulty) => void,
  onBack?: () => void,
  ctaLabel = '开始游戏',
): HTMLElement {
  let selectedMap = MAPS[0].id;
  let selectedDiff: Difficulty = 'normal';

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
      const prog = getProgress(m.id, selectedDiff);
      const badge = prog.completed
        ? '<span class="tag">★ 已通关</span>'
        : prog.bestWave > 0
          ? `<span class="tag">最高 ${prog.bestWave} 波</span>`
          : '';
      const card = document.createElement('div');
      card.className = 'card' + (m.id === selectedMap ? ' selected' : '');
      card.innerHTML = `
        <div class="title">${m.name} ${badge}</div>
        <div class="desc">${m.desc}</div>
      `;
      card.addEventListener('click', () => {
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
        selectedDiff = d;
        render();
      });
      diffRow.appendChild(card);
    });
    screen.appendChild(diffRow);

    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.textContent = ctaLabel;
    btn.addEventListener('click', () => onStart(selectedMap, selectedDiff));
    screen.appendChild(btn);

    if (onBack) {
      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '返回';
      back.addEventListener('click', onBack);
      screen.appendChild(back);
    }

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
  won: boolean,
  wave: number,
  totalWaves: number,
  mapName: string,
  diffLabel: string,
  onRetry: () => void,
  onMenu: () => void,
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <div class="result-badge">${won ? '🏆' : '💥'}</div>
    <h1>${won ? '守卫成功' : '基地失守'}</h1>
    <div class="result-lines">
      ${mapName} · ${diffLabel}<br>
      ${won ? `顶住了全部 ${totalWaves} 波进攻！` : `坚持到第 ${wave} 波`}
    </div>
  `;
  const retry = document.createElement('button');
  retry.className = 'btn';
  retry.textContent = won ? '再玩一次' : '重新挑战';
  retry.addEventListener('click', onRetry);
  screen.appendChild(retry);

  const menu = document.createElement('button');
  menu.className = 'btn ghost';
  menu.textContent = '返回主菜单';
  menu.addEventListener('click', onMenu);
  screen.appendChild(menu);

  container.appendChild(screen);
  return screen;
}
