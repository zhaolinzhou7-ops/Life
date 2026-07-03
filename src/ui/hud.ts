import { TOWER_DEFS, TOWER_ORDER, buildCost, type Tower } from '../entities/tower';
import type { TowerKind } from '../render/models';

const TOWER_EMOJI: Record<TowerKind, string> = {
  arrow: '🏹',
  cannon: '💣',
  frost: '❄️',
  bolt: '⚡',
};

export interface HudCallbacks {
  onStartWave: () => void;
  onSpeedToggle: () => void;
  onPauseToggle: () => void;
  onBuild: (kind: TowerKind) => void;
  onUpgrade: () => void;
  onSell: () => void;
}

/** 战斗内 HUD：顶栏状态、底部波次按钮、建塔环形菜单、塔操作面板、提示条 */
export class Hud {
  root: HTMLDivElement;
  private lives!: HTMLElement;
  private gold!: HTMLElement;
  private waveLabel!: HTMLElement;
  private waveBtn!: HTMLButtonElement;
  private speedBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private toast!: HTMLElement;
  private radial: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private rewardCard: HTMLDivElement | null = null;
  private cb: HudCallbacks;
  private toastTimer = 0;

  constructor(cb: HudCallbacks) {
    this.cb = cb;
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="topbar">
        <div class="stat lives"><span>❤</span><span data-lives>20</span></div>
        <div class="stat gold"><span>◈</span><span data-gold>0</span></div>
        <div class="stat wave"><small>波次</small><span data-wave>0/25</span></div>
        <div class="spacer"></div>
        <button class="icon-btn" data-speed>x1</button>
        <button class="icon-btn" data-pause>⏸</button>
      </div>
      <div class="toast" data-toast></div>
      <div class="bottombar">
        <button class="wave-btn" data-wave-btn>▶ 开始第 1 波</button>
      </div>
    `;
    this.lives = this.root.querySelector('[data-lives]')!;
    this.gold = this.root.querySelector('[data-gold]')!;
    this.waveLabel = this.root.querySelector('[data-wave]')!;
    this.waveBtn = this.root.querySelector('[data-wave-btn]')!;
    this.speedBtn = this.root.querySelector('[data-speed]')!;
    this.pauseBtn = this.root.querySelector('[data-pause]')!;
    this.toast = this.root.querySelector('[data-toast]')!;

    this.waveBtn.addEventListener('click', () => this.cb.onStartWave());
    this.speedBtn.addEventListener('click', () => this.cb.onSpeedToggle());
    this.pauseBtn.addEventListener('click', () => this.cb.onPauseToggle());
  }

  setStats(lives: number, gold: number, wave: number, total: number) {
    this.lives.textContent = String(lives);
    this.gold.textContent = String(gold);
    this.waveLabel.textContent = `${wave}/${total}`;
  }

  setWaveButton(text: string, enabled: boolean) {
    this.waveBtn.textContent = text;
    this.waveBtn.disabled = !enabled;
  }

  setSpeed(mult: number) {
    this.speedBtn.textContent = 'x' + mult;
    this.speedBtn.classList.toggle('active', mult > 1);
  }

  setPaused(paused: boolean) {
    this.pauseBtn.textContent = paused ? '▶' : '⏸';
    this.pauseBtn.classList.toggle('active', paused);
  }

  showToast(msg: string) {
    this.toast.textContent = msg;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1600);
  }

  /** 波次清空后的奖励卡：显示清波奖励 + 随机奖励，点击或超时消失 */
  showReward(clearBonus: number, reward: { emoji: string; name: string; desc: string }) {
    this.rewardCard?.remove();
    const card = document.createElement('div');
    card.className = 'reward-card';
    card.innerHTML = `
      <div class="rc-emoji">${reward.emoji}</div>
      <div class="rc-title">波次清空！</div>
      <div class="rc-bonus">清波奖励 +${clearBonus} 金币</div>
      <div class="rc-reward">
        <div class="rc-name">${reward.name}</div>
        <div class="rc-desc">${reward.desc}</div>
      </div>
      <div class="rc-hint">点击继续</div>
    `;
    const close = () => {
      card.remove();
      clearTimeout(timer);
      if (this.rewardCard === card) this.rewardCard = null;
    };
    card.addEventListener('click', close);
    const timer = window.setTimeout(close, 3400);
    this.root.parentElement!.appendChild(card);
    this.rewardCard = card;
  }

  // ---------- 建塔环形菜单 ----------
  openRadial(screenX: number, screenY: number, gold: number) {
    this.closeRadial();
    this.closePanel();
    const r = document.createElement('div');
    r.className = 'radial';
    r.style.left = screenX + 'px';
    r.style.top = screenY + 'px';

    const n = TOWER_ORDER.length;
    const radius = 78;
    TOWER_ORDER.forEach((kind, i) => {
      const def = TOWER_DEFS[kind];
      const cost = buildCost(kind);
      const affordable = gold >= cost;
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const item = document.createElement('div');
      item.className = 'item' + (affordable ? '' : ' disabled');
      item.style.left = x + 'px';
      item.style.top = y + 'px';
      item.innerHTML = `<span class="emoji">${TOWER_EMOJI[kind]}</span><span>${def.name}</span><span class="price">${cost}</span>`;
      if (affordable) {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.cb.onBuild(kind);
          this.closeRadial();
        });
      }
      r.appendChild(item);
    });
    const cancel = document.createElement('div');
    cancel.className = 'cancel';
    cancel.textContent = '✕';
    cancel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeRadial();
    });
    r.appendChild(cancel);

    this.root.parentElement!.appendChild(r);
    this.radial = r;
  }

  closeRadial() {
    this.radial?.remove();
    this.radial = null;
  }

  radialOpen(): boolean {
    return this.radial !== null;
  }

  // ---------- 塔操作面板 ----------
  openTowerPanel(tower: Tower, gold: number) {
    this.closeRadial();
    this.closePanel();
    const p = document.createElement('div');
    p.className = 'tower-panel';
    const s = tower.stats;
    const upCost = tower.upgradeCost();
    const canUp = !tower.maxLevel && gold >= upCost;
    p.innerHTML = `
      <div class="head">
        <div><span class="name">${TOWER_EMOJI[tower.def.kind]} ${tower.def.name}</span>
        <span class="lv"> 等级 ${tower.level}/${tower.def.levels.length}</span></div>
        <button class="close" data-close>✕</button>
      </div>
      <div class="stats-line">
        <span>伤害 ${s.damage}</span><span>射程 ${s.range.toFixed(1)}</span>
        <span>攻速 ${s.fireRate.toFixed(1)}/秒</span>
      </div>
      <div class="actions">
        <button class="act up" data-up ${canUp ? '' : 'disabled'}>
          ${tower.maxLevel ? '已满级' : `升级 · ${upCost}◈`}
        </button>
        <button class="act sell" data-sell>出售 · +${tower.sellValue()}◈</button>
      </div>
    `;
    p.querySelector('[data-close]')!.addEventListener('click', () => this.closePanel());
    const up = p.querySelector('[data-up]') as HTMLButtonElement;
    if (canUp) up.addEventListener('click', () => this.cb.onUpgrade());
    p.querySelector('[data-sell]')!.addEventListener('click', () => this.cb.onSell());

    this.root.parentElement!.appendChild(p);
    this.panel = p;
  }

  closePanel() {
    this.panel?.remove();
    this.panel = null;
  }

  panelOpen(): boolean {
    return this.panel !== null;
  }

  closeAll() {
    this.closeRadial();
    this.closePanel();
  }

  dispose() {
    this.closeAll();
    this.rewardCard?.remove();
    this.rewardCard = null;
    this.root.remove();
  }
}
