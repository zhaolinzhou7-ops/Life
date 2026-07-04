/** 触屏/鼠标控制：左侧虚拟摇杆移动，右侧技能按钮 */
import { SKILLS } from './config';

export interface SkillButtonState {
  el: HTMLButtonElement;
  cd: HTMLElement;
  label: HTMLElement;
}

export class Controls {
  root: HTMLElement;
  /** 归一化移动向量（-1..1），长度 0 表示不动 */
  move = { x: 0, y: 0 };
  /** 本帧被按下的技能键集合（消费后清空） */
  private queued = new Set<string>();

  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private joyId: number | null = null;
  private joyCx = 0;
  private joyCy = 0;
  private readonly joyR = 62;

  private buttons: Record<string, SkillButtonState> = {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'moba-controls';

    // 摇杆
    const joy = document.createElement('div');
    joy.className = 'moba-joy';
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'moba-joy-base';
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'moba-joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    joy.appendChild(this.joyBase);
    this.root.appendChild(joy);

    // 技能按钮
    const skillWrap = document.createElement('div');
    skillWrap.className = 'moba-skills';
    for (const key of ['E', 'W', 'Q', 'R']) {
      const def = SKILLS[key];
      const btn = document.createElement('button');
      btn.className = 'moba-skill skill-' + key.toLowerCase();
      const label = document.createElement('span');
      label.className = 'moba-skill-key';
      label.textContent = key;
      const name = document.createElement('span');
      name.className = 'moba-skill-name';
      name.textContent = def.name;
      const cd = document.createElement('span');
      cd.className = 'moba-skill-cd';
      btn.appendChild(label);
      btn.appendChild(name);
      btn.appendChild(cd);
      skillWrap.appendChild(btn);
      this.buttons[key] = { el: btn, cd, label };
      const press = (e: Event) => {
        e.preventDefault();
        this.queued.add(key);
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('mousedown', press);
    }
    this.root.appendChild(skillWrap);

    parent.appendChild(this.root);

    joy.addEventListener('touchstart', this.onJoyStart, { passive: false });
    window.addEventListener('touchmove', this.onJoyMove, { passive: false });
    window.addEventListener('touchend', this.onJoyEnd);
    window.addEventListener('touchcancel', this.onJoyEnd);

    // 桌面端鼠标支持
    joy.addEventListener('mousedown', this.onMouseStart);
  }

  /** 取出并清空本帧技能输入 */
  consumeSkills(): string[] {
    const out = [...this.queued];
    this.queued.clear();
    return out;
  }

  /** 更新技能按钮冷却显示。ready=可用, frac=冷却剩余比例(0..1), locked=未解锁 */
  setSkillUI(key: string, frac: number, ready: boolean, locked: boolean) {
    const b = this.buttons[key];
    if (!b) return;
    b.el.classList.toggle('ready', ready && !locked);
    b.el.classList.toggle('locked', locked);
    if (locked) {
      b.cd.textContent = '🔒';
    } else if (frac > 0) {
      b.cd.textContent = Math.ceil(frac * SKILLS[key].cooldown).toString();
    } else {
      b.cd.textContent = '';
    }
  }

  private setJoy(clientX: number, clientY: number) {
    let dx = clientX - this.joyCx;
    let dy = clientY - this.joyCy;
    const len = Math.hypot(dx, dy);
    if (len > this.joyR) {
      dx = (dx / len) * this.joyR;
      dy = (dy / len) * this.joyR;
    }
    this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.move.x = dx / this.joyR;
    this.move.y = dy / this.joyR;
  }

  private resetJoy() {
    this.joyId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.joyKnob.style.transform = 'translate(0px, 0px)';
  }

  private onJoyStart = (e: TouchEvent) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    this.joyId = t.identifier;
    const r = this.joyBase.getBoundingClientRect();
    this.joyCx = r.left + r.width / 2;
    this.joyCy = r.top + r.height / 2;
    this.setJoy(t.clientX, t.clientY);
  };

  private onJoyMove = (e: TouchEvent) => {
    if (this.joyId === null) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        e.preventDefault();
        this.setJoy(t.clientX, t.clientY);
      }
    }
  };

  private onJoyEnd = (e: TouchEvent) => {
    if (this.joyId === null) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) this.resetJoy();
    }
  };

  // --- 鼠标（桌面调试） ---
  private onMouseStart = (e: MouseEvent) => {
    e.preventDefault();
    const r = this.joyBase.getBoundingClientRect();
    this.joyCx = r.left + r.width / 2;
    this.joyCy = r.top + r.height / 2;
    this.joyId = -1;
    this.setJoy(e.clientX, e.clientY);
    const mv = (ev: MouseEvent) => this.setJoy(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      this.resetJoy();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  };

  dispose() {
    window.removeEventListener('touchmove', this.onJoyMove);
    window.removeEventListener('touchend', this.onJoyEnd);
    window.removeEventListener('touchcancel', this.onJoyEnd);
    this.root.remove();
  }
}
