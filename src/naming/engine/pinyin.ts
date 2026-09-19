/**
 * 音律工具
 *
 * 判断一个名字「好不好念」，靠的不是玄学，是几条可以写成代码的规律：
 *   - 三个字声调完全一样会念得很平（张昌丰、李美雅）
 *   - 连着两个上声会被迫变调，念起来别扭
 *   - 声母相同的音节连着出现会绕口（方芳、孙山）
 *   - 韵母相同更绕口（张昌、刘秋）
 *   - 结尾落在开口大的韵母上更响亮，落在闭口音上偏内敛
 *
 * 这些规律有例外，所以它们只用来排序和提示，不用来下断言。
 */

const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/** 把 zhou1 渲染成 zhōu */
export function toneMark(syl: string, tone: number): string {
  if (tone < 1 || tone > 4) return syl;
  // 标调规则：有 a 标 a；没 a 有 o/e 标 o/e；iu/ui 标在后一个；其余标第一个元音
  let idx = -1;
  const a = syl.indexOf('a');
  if (a >= 0) idx = a;
  else {
    const o = syl.indexOf('o');
    const e = syl.indexOf('e');
    if (o >= 0) idx = o;
    else if (e >= 0) idx = e;
    else if (syl.includes('iu')) idx = syl.indexOf('iu') + 1;
    else if (syl.includes('ui')) idx = syl.indexOf('ui') + 1;
    else {
      for (let i = 0; i < syl.length; i++) {
        if ('iuü'.includes(syl[i])) {
          idx = i;
          break;
        }
      }
    }
  }
  if (idx < 0) return syl;
  const v = syl[idx];
  const marks = TONE_MARKS[v];
  if (!marks) return syl;
  return syl.slice(0, idx) + marks[tone - 1] + syl.slice(idx + 1);
}

/** 韵母的响亮程度：开口越大越响。用于判断名字收尾是「响」还是「收」 */
const SONORITY: Record<string, number> = {
  a: 5, ia: 5, ua: 5, ai: 5, uai: 5, ao: 5, iao: 5, an: 4, ian: 4, uan: 4, üan: 4,
  ang: 5, iang: 5, uang: 5, o: 4, uo: 4, ou: 4, iou: 4, iu: 3, ong: 4, iong: 4,
  e: 3, ie: 3, üe: 3, ei: 3, uei: 3, ui: 3, en: 2, in: 2, un: 2, ün: 2,
  eng: 3, ing: 3, ueng: 3, er: 3, i: 2, u: 2, ü: 2,
};

export function sonority(ym: string): number {
  return SONORITY[ym] ?? 3;
}

export interface ToneReading {
  /** 0~100，只用于内部排序 */
  score: number;
  notes: string[];
  /** 声调串，如 "1-4-2" */
  pattern: string;
}

const TONE_NAME = ['', '阴平', '阳平', '上声', '去声'];

/**
 * 读一串声调，给出评价。
 * tones 是完整姓名的声调（含姓），这是关键——只看名字部分判断不了顺不顺口。
 */
export function readTones(tones: number[]): ToneReading {
  const notes: string[] = [];
  let score = 70;
  const pattern = tones.join('-');

  const uniq = new Set(tones);
  if (uniq.size === 1) {
    score -= 26;
    notes.push(`三个字都是${TONE_NAME[tones[0]]}，一路平下去，读起来没有起伏`);
  } else if (uniq.size === tones.length) {
    score += 12;
    notes.push('声调各不相同，念起来有高低变化');
  }

  // 连续上声：普通话里前一个会变调成阳平，说快了容易含混
  for (let i = 0; i + 1 < tones.length; i++) {
    if (tones[i] === 3 && tones[i + 1] === 3) {
      score -= 14;
      notes.push('连着两个三声，实际说出口会被迫变调，容易念含糊');
    }
    if (tones[i] === 4 && tones[i + 1] === 4) {
      score -= 8;
      notes.push('连着两个四声，语气偏硬、偏急');
    }
  }

  // 收尾：落在平声（一二声）显得舒展，落在去声显得干脆，落在上声最容易拖
  const last = tones[tones.length - 1];
  if (last === 1 || last === 2) {
    score += 8;
    notes.push('收在平声上，尾音能放开，叫起来舒展');
  } else if (last === 4) {
    score += 3;
    notes.push('收在去声上，语气干脆利落');
  } else if (last === 3) {
    score -= 6;
    notes.push('收在三声上，尾音容易拖长发飘');
  }

  // 平仄交错：古人讲的「抑扬」，用现代话说就是别一直往上或一直往下
  let turns = 0;
  const level = tones.map((t) => (t === 1 || t === 2 ? 0 : 1)); // 0 平 1 仄
  for (let i = 0; i + 1 < level.length; i++) if (level[i] !== level[i + 1]) turns++;
  if (turns >= tones.length - 1 && tones.length >= 3) {
    score += 6;
    notes.push('平仄相间，是传统认为最顺口的排法');
  }

  return { score: Math.max(0, Math.min(100, score)), notes, pattern };
}

export interface RepeatIssue {
  kind: 'sm' | 'ym' | 'same';
  at: [number, number];
  text: string;
  penalty: number;
}

/** 检查声母/韵母重复造成的绕口 */
export function checkRepeat(units: { sm: string; ym: string; syl: string; c: string }[]): RepeatIssue[] {
  const out: RepeatIssue[] = [];
  for (let i = 0; i + 1 < units.length; i++) {
    const a = units[i];
    const b = units[i + 1];
    if (a.syl === b.syl) {
      out.push({
        kind: 'same',
        at: [i, i + 1],
        text: `「${a.c}${b.c}」两个字同音，连读几乎分不开`,
        penalty: 24,
      });
      continue;
    }
    if (a.ym === b.ym && a.ym.length > 1) {
      out.push({
        kind: 'ym',
        at: [i, i + 1],
        text: `「${a.c}${b.c}」韵母都是 -${a.ym}，连读发黏`,
        penalty: 14,
      });
    }
    if (a.sm && a.sm === b.sm) {
      out.push({
        kind: 'sm',
        at: [i, i + 1],
        text: `「${a.c}${b.c}」声母都是 ${a.sm}-，舌头要连着做两次同样的动作`,
        penalty: 9,
      });
    }
  }
  return out;
}
