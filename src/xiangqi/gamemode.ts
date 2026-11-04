/**
 * 正式对局和练习分开。
 *
 * 原来每一盘都算实战分：悔棋不限次数（被将死了也能悔），悔过的棋照样全额算分；钟只计时、不会超时。
 * 实战分是整套水平评估的锚（给你排对手、定训练阶段），这样算出来的分不可信。
 *
 *   练习      教练提醒、🔍 求助、悔棋都行；**不计实战分**
 *   正式对局  不能悔棋、不能求助，教练不插话（下完照样复盘）；可以选限时，超时判负；**只有它计实战分**；
 *             下到一半退出、重开、扔掉没下完的那盘，都算认输
 */

export interface TimeControl {
  id: number;
  name: string;
  /** 每方开局给多少秒；0 = 不限时 */
  base: number;
  /** 每走一步加多少秒 */
  inc: number;
  desc: string;
}

/** 限时只算你自己的时间：对手是 AI，它按档位算多少个局面，不会拖时间 */
export const TIME_CONTROLS: TimeControl[] = [
  { id: 0, name: '不限时', base: 0, inc: 0, desc: '想多久都行' },
  { id: 1, name: '5 分 + 3 秒', base: 300, inc: 3, desc: '快棋：每走一步加 3 秒' },
  { id: 2, name: '10 分 + 5 秒', base: 600, inc: 5, desc: '每走一步加 5 秒' },
  { id: 3, name: '20 分 + 10 秒', base: 1200, inc: 10, desc: '慢棋：好好算' },
];

const RATED_KEY = 'xq-rated';
const TC_KEY = 'xq-tc';

/** 上次选的是不是正式对局。第一次来默认练习：教练在旁边看着是这个软件的本分 */
export function getRated(): boolean {
  try {
    return localStorage.getItem(RATED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRated(v: boolean) {
  try {
    localStorage.setItem(RATED_KEY, v ? '1' : '0');
  } catch {
    /* 记不下就下回再选 */
  }
}

export function getTc(): number {
  try {
    const v = Number(localStorage.getItem(TC_KEY) ?? 0);
    return TIME_CONTROLS.some((t) => t.id === v) ? v : 0;
  } catch {
    return 0;
  }
}

export function setTc(id: number) {
  try {
    localStorage.setItem(TC_KEY, String(id));
  } catch {
    /* 同上 */
  }
}

export const tcOf = (id: number | undefined): TimeControl => TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS[0];

/** 钟上显示：剩多少（限时）。不到一分钟显示到十分之一秒，看得出还剩多少 */
export function fmtLeft(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 60000) return `0:${(Math.floor(v / 100) / 10).toFixed(1).padStart(4, '0')}`;
  const t = Math.ceil(v / 1000);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
