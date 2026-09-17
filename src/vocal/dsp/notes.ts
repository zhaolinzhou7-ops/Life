/** 音高单位换算与音名。全应用共用一套，避免各处各写一份换算。 */

export const A4 = 440;

export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / A4);
export const midiToFreq = (m: number) => A4 * Math.pow(2, (m - 69) / 12);

/** 两个音高差多少音分（100 音分 = 1 个半音） */
export const centsBetween = (midiA: number, midiB: number) => (midiA - midiB) * 100;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CN = ['do', 'do#', 're', 're#', 'mi', 'fa', 'fa#', 'sol', 'sol#', 'la', 'la#', 'si'];

/** MIDI → 音名，如 60 → C4 */
export function midiToName(m: number): string {
  const r = Math.round(m);
  return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

/** MIDI → 唱名（固定调，C = do） */
export function midiToSolfege(m: number): string {
  const r = Math.round(m);
  return CN[((r % 12) + 12) % 12];
}

/** 音名 → MIDI，如 'C4' → 60；解析失败返回 NaN */
export function nameToMidi(s: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s.trim());
  if (!m) return NaN;
  const base = NAMES.indexOf(m[1].toUpperCase());
  if (base < 0) return NaN;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}

/**
 * 把用户音高按整八度折到目标附近。
 * 男声照着女声的原调唱低八度，听感上是对的，评分不该因此判错。
 */
export function foldOctave(userMidi: number, targetMidi: number): number {
  return userMidi - Math.round((userMidi - targetMidi) / 12) * 12;
}

/** 半音数 → 人话，如 3 → "3 个半音（小三度）" */
export function semitoneText(n: number): string {
  const abs = Math.abs(Math.round(n));
  const iv = ['同度', '小二度', '大二度', '小三度', '大三度', '纯四度', '三全音', '纯五度', '小六度', '大六度', '小七度', '大七度', '八度'];
  return abs <= 12 ? `${abs} 个半音（${iv[abs]}）` : `${abs} 个半音`;
}
