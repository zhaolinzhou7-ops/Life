/** 对手角色系统：程序化 CG 头像、性别化音色口音、台词与互动聊天（棋牌通用） */

export type Gender = 'female' | 'male';

export interface Character {
  id: string;
  name: string;
  gender: Gender;
  /** 口音/性格标签 */
  style: string;
  /** 语音参数 */
  voice: { pitch: number; rate: number };
  /** 主题色（头像边框/气泡） */
  color: string;
  color2: string;
  /** 外观参数 */
  look: {
    skin: string;
    hair: string;
    hair2: string;
    cloth: string;
    cloth2: string;
    /** 发型：0 长发 1 短寸 2 束发 */
    hairStyle: number;
    /** 配饰：0 无 1 眼镜 2 耳环 */
    accessory: number;
    blush: boolean;
  };
  /** 台词库 */
  lines: {
    greet: string[];
    peng: string[];
    gang: string[];
    win: string[];
    lose: string[];
    discard: string[];
    taunt: string[];
    /** 象棋专用 */
    check?: string[];
    capture?: string[];
  };
}

export const CHARACTERS: Character[] = [
  {
    id: 'xiaoman',
    name: '小满',
    gender: 'female',
    style: '川妹子 · 泼辣',
    voice: { pitch: 1.65, rate: 1.18 },
    color: '#ff6f91',
    color2: '#ffb3c6',
    look: {
      skin: '#ffd9c0',
      hair: '#2b1d19',
      hair2: '#4a332b',
      cloth: '#e05780',
      cloth2: '#ff9ebb',
      hairStyle: 0,
      accessory: 2,
      blush: true,
    },
    lines: {
      greet: ['今天手气巴适得很！', '来嘛，姐姐让你三张', '莫慌，慢慢打'],
      peng: ['碰！要得', '这张我要咯', '碰起走！'],
      gang: ['杠上开花咯！', '杠！莫挡老娘的路', '直接杠起走！'],
      win: ['胡咯！巴适惨咯', '哈哈，钱拿来！', '姐姐赢麻了'],
      lose: ['哎呀，输咯…', '算你运气好', '不服，再来一盘'],
      discard: ['打这张', '这个不要', '给你嘛'],
      taunt: ['你这牌打得有点哈哦', '莫慌嘛，输了再说', '手气不好哇？'],
      check: ['将你一军！', '看招嘛'],
      capture: ['吃咯！', '这个子归我'],
    },
  },
  {
    id: 'chenbo',
    name: '陈伯',
    gender: 'male',
    style: '老茶客 · 沉稳',
    voice: { pitch: 0.62, rate: 0.9 },
    color: '#c9a227',
    color2: '#e8cf7a',
    look: {
      skin: '#e8bb92',
      hair: '#8a8a8a',
      hair2: '#b5b5b5',
      cloth: '#4a5d4e',
      cloth2: '#7d9481',
      hairStyle: 1,
      accessory: 1,
      blush: false,
    },
    lines: {
      greet: ['老汉儿打了三十年咯', '慢慢来，喝口茶', '年轻人，看好了'],
      peng: ['碰', '这张，我要', '碰嘛'],
      gang: ['杠！', '嘿，杠一个', '老汉儿杠了'],
      win: ['胡咯，承让承让', '姜还是老的辣噻', '这盘我先走一步'],
      lose: ['哎，老咯…', '手气不佳', '下盘再说'],
      discard: ['出这张', '这个用不上', '走一个'],
      taunt: ['沉住气嘛，娃儿', '打牌要看大局', '莫急莫急'],
      check: ['将军。', '你这帅，危险咯'],
      capture: ['这个子，我收下了', '承让'],
    },
  },
  {
    id: 'alei',
    name: '阿雷',
    gender: 'male',
    style: '棋摊少侠 · 豪爽',
    voice: { pitch: 1.05, rate: 1.25 },
    color: '#3ea6ff',
    color2: '#8fd3ff',
    look: {
      skin: '#f0c39a',
      hair: '#1a1a22',
      hair2: '#39394a',
      cloth: '#1f6feb',
      cloth2: '#5aa9ff',
      hairStyle: 2,
      accessory: 0,
      blush: false,
    },
    lines: {
      greet: ['搞快点，开打！', '兄弟，接招', '来来来，杀一盘'],
      peng: ['碰！', '搞起！', '这张碰了'],
      gang: ['杠！爽快！', '直接杠！', '杠他娃儿的'],
      win: ['胡了胡了！安逸', '哈哈哈，收钱！', '这把稳得很'],
      lose: ['莫得事，再来！', '输了输了', '下把翻本'],
      discard: ['出！', '这张不要', '走起'],
      taunt: ['你也太慢咯', '快点嘛兄弟', '这都不敢碰？'],
      check: ['将军！接招！', '看你往哪跑'],
      capture: ['吃！', '拿下！'],
    },
  },
];

export const pickLine = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

/** 玩家可选的快捷聊天短语 */
export const QUICK_CHAT = [
  '快点嘛，等到起花儿都谢咯',
  '手气不错噻！',
  '承让承让',
  '这张我要不起',
  '莫慌，稳起',
  '再来一盘！',
];

// ---------------- CG 头像绘制 ----------------

/** 绘制半写实卡通 CG 头像，size 为正方形边长 */
export function drawAvatar(ctx: CanvasRenderingContext2D, c: Character, size: number, mood: 'idle' | 'happy' | 'sad' | 'talk' = 'idle') {
  const S = size;
  const L = c.look;
  ctx.clearRect(0, 0, S, S);
  ctx.save();

  // 背景光晕
  const bg = ctx.createRadialGradient(S * 0.5, S * 0.4, S * 0.05, S * 0.5, S * 0.5, S * 0.62);
  bg.addColorStop(0, c.color2 + 'cc');
  bg.addColorStop(1, '#10151cee');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.clip();

  const cx = S * 0.5;
  const cy = S * 0.52;
  const hw = S * 0.27; // 头半宽
  const hh = S * 0.33; // 头半高

  // 肩/衣服
  const clothGrad = ctx.createLinearGradient(0, S * 0.72, 0, S);
  clothGrad.addColorStop(0, L.cloth2);
  clothGrad.addColorStop(1, L.cloth);
  ctx.fillStyle = clothGrad;
  ctx.beginPath();
  ctx.ellipse(cx, S * 1.12, S * 0.46, S * 0.34, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  // 领口
  ctx.fillStyle = L.cloth;
  ctx.beginPath();
  ctx.moveTo(cx - S * 0.12, S * 0.8);
  ctx.lineTo(cx, S * 0.92);
  ctx.lineTo(cx + S * 0.12, S * 0.8);
  ctx.closePath();
  ctx.fill();
  // 脖子
  ctx.fillStyle = shade(L.skin, -14);
  ctx.fillRect(cx - S * 0.09, cy + hh * 0.6, S * 0.18, S * 0.18);

  // 后发（长发在头后）
  if (L.hairStyle === 0) {
    ctx.fillStyle = L.hair;
    ctx.beginPath();
    ctx.ellipse(cx, cy + S * 0.06, hw * 1.28, hh * 1.24, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 脸
  const faceGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy + hh);
  faceGrad.addColorStop(0, tint(L.skin, 12));
  faceGrad.addColorStop(0.55, L.skin);
  faceGrad.addColorStop(1, shade(L.skin, -12));
  ctx.fillStyle = faceGrad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
  ctx.fill();
  // 下巴收窄
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.86, cy + hh * 0.28);
  ctx.quadraticCurveTo(cx, cy + hh * 1.16, cx + hw * 0.86, cy + hh * 0.28);
  ctx.fill();
  // 面部高光
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.ellipse(cx - hw * 0.42, cy - hh * 0.3, hw * 0.3, hh * 0.28, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // 耳朵
  ctx.fillStyle = shade(L.skin, -8);
  ctx.beginPath();
  ctx.ellipse(cx - hw * 0.98, cy + hh * 0.05, S * 0.035, S * 0.055, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + hw * 0.98, cy + hh * 0.05, S * 0.035, S * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  // 耳环
  if (L.accessory === 2) {
    ctx.fillStyle = '#ffd76e';
    ctx.beginPath();
    ctx.arc(cx - hw * 0.98, cy + hh * 0.26, S * 0.022, 0, Math.PI * 2);
    ctx.arc(cx + hw * 0.98, cy + hh * 0.26, S * 0.022, 0, Math.PI * 2);
    ctx.fill();
  }

  // 前发
  const hairGrad = ctx.createLinearGradient(cx - hw, cy - hh, cx + hw, cy);
  hairGrad.addColorStop(0, L.hair2);
  hairGrad.addColorStop(1, L.hair);
  ctx.fillStyle = hairGrad;
  ctx.beginPath();
  if (L.hairStyle === 1) {
    // 短寸
    ctx.ellipse(cx, cy - hh * 0.44, hw * 1.02, hh * 0.6, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (L.hairStyle === 2) {
    // 束发 + 发髻
    ctx.ellipse(cx, cy - hh * 0.42, hw * 1.06, hh * 0.66, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy - hh * 1.06, S * 0.055, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 长发刘海
    ctx.ellipse(cx, cy - hh * 0.4, hw * 1.1, hh * 0.72, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - hw * 1.08, cy - hh * 0.3);
    ctx.quadraticCurveTo(cx - hw * 0.5, cy - hh * 0.05, cx - hw * 0.2, cy - hh * 0.5);
    ctx.quadraticCurveTo(cx + hw * 0.3, cy - hh * 0.1, cx + hw * 1.05, cy - hh * 0.34);
    ctx.lineTo(cx + hw * 1.05, cy - hh * 1.1);
    ctx.lineTo(cx - hw * 1.08, cy - hh * 1.1);
    ctx.closePath();
    ctx.fill();
  }
  // 发丝高光
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = Math.max(1, S * 0.012);
  ctx.beginPath();
  ctx.arc(cx - hw * 0.3, cy - hh * 0.62, hw * 0.5, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  // 眉毛
  ctx.strokeStyle = shade(L.hair, -10);
  ctx.lineWidth = Math.max(1.6, S * 0.022);
  ctx.lineCap = 'round';
  const browY = cy - hh * 0.24 + (mood === 'sad' ? S * 0.012 : 0);
  const browTilt = mood === 'sad' ? -S * 0.02 : mood === 'happy' ? S * 0.012 : 0;
  ctx.beginPath();
  ctx.moveTo(cx - hw * 0.62, browY + browTilt);
  ctx.quadraticCurveTo(cx - hw * 0.36, browY - S * 0.028, cx - hw * 0.12, browY - S * 0.004);
  ctx.moveTo(cx + hw * 0.62, browY + browTilt);
  ctx.quadraticCurveTo(cx + hw * 0.36, browY - S * 0.028, cx + hw * 0.12, browY - S * 0.004);
  ctx.stroke();

  // 眼睛
  const eyeY = cy - hh * 0.04;
  const eyeDx = hw * 0.38;
  const eyeW = S * 0.062;
  const eyeH = mood === 'happy' ? S * 0.028 : S * 0.05;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * eyeDx;
    if (mood === 'happy') {
      // 眯眼笑
      ctx.strokeStyle = '#2a2018';
      ctx.lineWidth = Math.max(2, S * 0.022);
      ctx.beginPath();
      ctx.arc(ex, eyeY + S * 0.012, eyeW * 0.9, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      continue;
    }
    // 眼白
    ctx.fillStyle = '#fdfbf7';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    // 虹膜
    const irisGrad = ctx.createRadialGradient(ex, eyeY, 1, ex, eyeY, eyeW * 0.72);
    irisGrad.addColorStop(0, '#6b4a2f');
    irisGrad.addColorStop(1, '#241610');
    ctx.fillStyle = irisGrad;
    ctx.beginPath();
    ctx.arc(ex, eyeY, eyeW * 0.62, 0, Math.PI * 2);
    ctx.fill();
    // 瞳孔高光
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ex - eyeW * 0.24, eyeY - eyeH * 0.3, eyeW * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // 上眼睑线
    ctx.strokeStyle = '#221a14';
    ctx.lineWidth = Math.max(1.4, S * 0.016);
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeW, eyeH, 0, Math.PI * 1.02, Math.PI * 1.98);
    ctx.stroke();
  }

  // 眼镜
  if (L.accessory === 1) {
    ctx.strokeStyle = 'rgba(40,40,50,0.85)';
    ctx.lineWidth = Math.max(1.6, S * 0.016);
    ctx.beginPath();
    ctx.roundRect(cx - eyeDx - eyeW * 1.5, eyeY - eyeH * 1.7, eyeW * 3, eyeH * 3.2, S * 0.02);
    ctx.roundRect(cx + eyeDx - eyeW * 1.5, eyeY - eyeH * 1.7, eyeW * 3, eyeH * 3.2, S * 0.02);
    ctx.moveTo(cx - eyeDx + eyeW * 1.5, eyeY);
    ctx.lineTo(cx + eyeDx - eyeW * 1.5, eyeY);
    ctx.stroke();
  }

  // 鼻
  ctx.strokeStyle = shade(L.skin, -30);
  ctx.lineWidth = Math.max(1.2, S * 0.012);
  ctx.beginPath();
  ctx.moveTo(cx - S * 0.008, cy + hh * 0.12);
  ctx.quadraticCurveTo(cx + S * 0.022, cy + hh * 0.26, cx - S * 0.012, cy + hh * 0.28);
  ctx.stroke();

  // 腮红
  if (L.blush) {
    ctx.fillStyle = 'rgba(255,120,140,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx - hw * 0.6, cy + hh * 0.3, hw * 0.24, hh * 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + hw * 0.6, cy + hh * 0.3, hw * 0.24, hh * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 嘴
  const mouthY = cy + hh * 0.52;
  ctx.lineCap = 'round';
  if (mood === 'talk') {
    ctx.fillStyle = '#8d3b3b';
    ctx.beginPath();
    ctx.ellipse(cx, mouthY, S * 0.045, S * 0.038, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(cx, mouthY - S * 0.016, S * 0.036, S * 0.012, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (mood === 'happy') {
    ctx.strokeStyle = '#a3453f';
    ctx.lineWidth = Math.max(2, S * 0.022);
    ctx.beginPath();
    ctx.arc(cx, mouthY - S * 0.03, S * 0.07, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
  } else if (mood === 'sad') {
    ctx.strokeStyle = '#a3453f';
    ctx.lineWidth = Math.max(2, S * 0.02);
    ctx.beginPath();
    ctx.arc(cx, mouthY + S * 0.05, S * 0.06, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#a3453f';
    ctx.lineWidth = Math.max(2, S * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx - S * 0.05, mouthY);
    ctx.quadraticCurveTo(cx, mouthY + S * 0.022, cx + S * 0.05, mouthY);
    ctx.stroke();
  }

  ctx.restore();

  // 外圈金边
  ctx.strokeStyle = c.color;
  ctx.lineWidth = Math.max(2, S * 0.035);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();
}

function tint(hex: string, amt: number) {
  return shade(hex, amt);
}
function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** 生成一个头像 canvas 元素（离屏缓存后拷贝像素，cloneNode 不会复制画布内容） */
const avatarCache = new Map<string, HTMLCanvasElement>();
export function avatarCanvas(c: Character, size: number, mood: 'idle' | 'happy' | 'sad' | 'talk' = 'idle'): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${c.id}-${size}-${mood}-${dpr}`;
  let src = avatarCache.get(key);
  if (!src) {
    src = document.createElement('canvas');
    src.width = Math.round(size * dpr);
    src.height = Math.round(size * dpr);
    const g = src.getContext('2d')!;
    g.scale(dpr, dpr);
    drawAvatar(g, c, size, mood);
    avatarCache.set(key, src);
  }
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.style.width = size + 'px';
  out.style.height = size + 'px';
  out.getContext('2d')!.drawImage(src, 0, 0);
  return out;
}
