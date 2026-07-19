/** 唱吧减压 · 视觉特效工具:粒子系统、五彩纸屑、辉光绘制与缓动 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 剩余寿命（秒）
  ttl: number; // 总寿命
  size: number;
  color: string;
  gravity: number;
  drag: number;
  shape: 'dot' | 'spark' | 'rect' | 'star' | 'note';
  rot: number;
  vr: number; // 角速度
}

/** 通用粒子系统：命中火花、纸屑、环境浮尘共用 */
export class Particles {
  list: Particle[] = [];

  spawn(o: Partial<Particle> & { x: number; y: number }) {
    this.list.push({
      vx: 0,
      vy: 0,
      life: 1,
      ttl: 1,
      size: 3,
      color: '#ffd54f',
      gravity: 0,
      drag: 0,
      shape: 'dot',
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 6,
      ...o,
    });
  }

  /** 命中火花：从 (x,y) 向四周迸发 */
  burst(x: number, y: number, color: string, count = 10, speed = 90) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.5 + Math.random() * 0.4,
        ttl: 0.9,
        size: 1.5 + Math.random() * 2.5,
        color,
        drag: 2.5,
        gravity: 60,
        shape: Math.random() < 0.5 ? 'spark' : 'dot',
      });
    }
  }

  /** 全屏五彩纸屑（结算庆祝） */
  confetti(w: number, count = 90) {
    const colors = ['#ff5d8f', '#ffd54f', '#7ce7c8', '#40c4ff', '#ce93d8', '#ff8a65'];
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: Math.random() * w,
        y: -20 - Math.random() * 120,
        vx: (Math.random() - 0.5) * 60,
        vy: 60 + Math.random() * 120,
        life: 2.2 + Math.random() * 1.6,
        ttl: 3.8,
        size: 4 + Math.random() * 4,
        color: colors[(Math.random() * colors.length) | 0],
        gravity: 30,
        drag: 0.4,
        shape: Math.random() < 0.7 ? 'rect' : 'star',
      });
    }
  }

  update(dt: number) {
    const arr = this.list;
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) {
        arr.splice(i, 1);
        continue;
      }
      p.vx -= p.vx * p.drag * dt;
      p.vy += p.gravity * dt - p.vy * p.drag * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  draw(g: CanvasRenderingContext2D) {
    for (const p of this.list) {
      const a = Math.max(0, Math.min(1, p.life / (p.ttl * 0.55)));
      g.save();
      g.globalAlpha = a;
      g.fillStyle = p.color;
      g.translate(p.x, p.y);
      g.rotate(p.rot);
      switch (p.shape) {
        case 'spark': {
          g.strokeStyle = p.color;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(-p.size * 1.6, 0);
          g.lineTo(p.size * 1.6, 0);
          g.stroke();
          break;
        }
        case 'rect':
          g.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
          break;
        case 'star': {
          g.beginPath();
          for (let k = 0; k < 5; k++) {
            const ang = (k * 2 * Math.PI) / 5 - Math.PI / 2;
            const ang2 = ang + Math.PI / 5;
            g.lineTo(Math.cos(ang) * p.size, Math.sin(ang) * p.size);
            g.lineTo(Math.cos(ang2) * p.size * 0.45, Math.sin(ang2) * p.size * 0.45);
          }
          g.closePath();
          g.fill();
          break;
        }
        case 'note': {
          g.font = `${p.size * 4}px sans-serif`;
          g.textAlign = 'center';
          g.fillText('♪', 0, 0);
          break;
        }
        default:
          g.beginPath();
          g.arc(0, 0, p.size, 0, Math.PI * 2);
          g.fill();
      }
      g.restore();
    }
  }
}

/** 环境浮尘：缓慢上升的光点与音符，铺在各模式背景里 */
export class Ambient {
  private p = new Particles();
  private acc = 0;

  update(dt: number, w: number, h: number) {
    this.acc += dt;
    // 每 ~0.5s 生成一颗，控制总量
    if (this.acc > 0.5 && this.p.list.length < 26) {
      this.acc = 0;
      const isNote = Math.random() < 0.18;
      this.p.spawn({
        x: Math.random() * w,
        y: h + 12,
        vx: (Math.random() - 0.5) * 8,
        vy: -(6 + Math.random() * 14),
        life: 9,
        ttl: 9,
        size: isNote ? 2.4 + Math.random() * 1.6 : 1 + Math.random() * 2,
        color: ['rgba(206,147,216,0.5)', 'rgba(124,231,200,0.4)', 'rgba(64,196,255,0.4)', 'rgba(255,213,79,0.35)'][
          (Math.random() * 4) | 0
        ],
        shape: isNote ? 'note' : 'dot',
        vr: (Math.random() - 0.5) * 0.8,
      });
    }
    this.p.update(dt);
  }

  draw(g: CanvasRenderingContext2D) {
    this.p.draw(g);
  }
}

/** 带辉光地画一段圆角条（音符条用） */
export function glowRoundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
  glow: string,
  blur: number,
) {
  g.save();
  g.shadowColor = glow;
  g.shadowBlur = blur;
  g.fillStyle = fill;
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
  g.restore();
}

/** 缓动 */
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const easeInOut = (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, t)));

/** 颜色插值（rgb 数组间） */
export function lerpColor(c1: [number, number, number], c2: [number, number, number], t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * k);
  const gg = Math.round(c1[1] + (c2[1] - c1[1]) * k);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * k);
  return `rgb(${r},${gg},${b})`;
}

/** 手机震动反馈（不支持时静默） */
export function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // 忽略
  }
}

/** 唱歌期间保持屏幕常亮；返回释放函数 */
export function acquireWakeLock(): () => void {
  let sentinel: { release: () => Promise<void> } | null = null;
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
  };
  nav.wakeLock
    ?.request('screen')
    .then((s) => (sentinel = s))
    .catch(() => {});
  return () => {
    void sentinel?.release().catch(() => {});
    sentinel = null;
  };
}
