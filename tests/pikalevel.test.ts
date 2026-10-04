/**
 * 各档对手（皮卡鱼 + 按档位挑着）的规则：挑着的纯函数、七档配置、分数和让子阶梯对得上。
 * 每一档实际多强是 tools/calibrate-levels.ts 对下测的，这里锁的是规则本身。
 */
import { describe, expect, it } from 'vitest';
import { chooseMove, PIKA_LEVELS, type Cand } from '../src/xiangqi/pikalevel';
import { AI_LEVEL_NAMES, AI_LEVEL_RATING, LADDER, LEVEL_FLOOR, migrateLevel, opponentFor } from '../src/xiangqi/save';
import { endgameTarget } from '../src/xiangqi/train';
import type { Puzzle } from '../src/xiangqi/puzzles';

const mv = (i: number) => ({ fx: i, fy: 0, tx: i, ty: 1 });
const seq = (xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('按档位挑着', () => {
  const cands: Cand[] = [
    { move: mv(0), score: 300 },
    { move: mv(1), score: 280 },
    { move: mv(2), score: 100 },
    { move: mv(3), score: -900 },
  ];

  it('只看第一名的档（全力）永远走引擎首选', () => {
    expect(chooseMove(cands, PIKA_LEVELS[PIKA_LEVELS.length - 1], seq([0.99]))).toEqual(mv(0));
  });

  it('一步杀谁都不会放过', () => {
    const c: Cand[] = [{ move: mv(5), score: 49999, mateIn: 1 }, ...cands];
    for (const cfg of PIKA_LEVELS) expect(chooseMove(c, cfg, seq([0.99, 0.99]))).toEqual(mv(5));
  });

  it('亏得太多的着法不挑（除非看走眼）', () => {
    const cfg = { ...PIKA_LEVELS[3], slip: 0 };
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) seen.add(chooseMove(cands, cfg, Math.random)!.fx);
    expect(seen.has(3)).toBe(false);
    expect(seen.has(0)).toBe(true);
  });

  it('不会自己走进一步杀', () => {
    const c: Cand[] = [{ move: mv(0), score: 100 }, { move: mv(1), score: -49998, mateIn: -1 }];
    const cfg = { ...PIKA_LEVELS[0], slip: 1, slipLoss: 1e9 };
    for (let k = 0; k < 100; k++) expect(chooseMove(c, cfg, Math.random)).toEqual(mv(0));
  });

  it('档位越低越随便：走首选的比例一档比一档低', () => {
    // 抽 2 万次，比例的抽样误差约 0.004；理论值约 0.43 → 0.60，一档比一档高
    const rate = (i: number) => {
      let n = 0;
      for (let k = 0; k < 20000; k++) if (chooseMove(cands, PIKA_LEVELS[i], Math.random)!.fx === 0) n++;
      return n / 20000;
    };
    const rates = [0, 1, 2, 3, 4, 5].map(rate);
    for (let i = 1; i < rates.length; i++) expect(rates[i], `第 ${i} 档`).toBeGreaterThanOrEqual(rates[i - 1] - 0.02);
    expect(rates[5]).toBeGreaterThan(rates[0] + 0.12);
  });
});

describe('十一档配置', () => {
  it('十一档，名字、分数、配置一一对应，分数一档比一档高', () => {
    expect(PIKA_LEVELS.length).toBe(11);
    expect(AI_LEVEL_NAMES.length).toBe(11);
    expect(AI_LEVEL_RATING.length).toBe(11);
    for (let i = 1; i < 11; i++) expect(AI_LEVEL_RATING[i]).toBeGreaterThan(AI_LEVEL_RATING[i - 1]);
  });

  it('大师往上细分成七档，一档之间差一百多分（用户原话："至少要从大师档位起步"）', () => {
    const top = AI_LEVEL_RATING.slice(LEVEL_FLOOR);
    expect(AI_LEVEL_NAMES[LEVEL_FLOOR]).toBe('大师');
    expect(top.length).toBe(7);
    for (let i = 1; i < top.length; i++) expect(top[i] - top[i - 1]).toBeLessThanOrEqual(220);
    // 给你排对手不低于大师
    expect(opponentFor(600)).toBe(LEVEL_FLOOR);
    expect(opponentFor(AI_LEVEL_RATING[9])).toBe(9);
  });

  it('老存档的七档编号换成新编号：特级大师、棋王的名字不变', () => {
    const OLD = ['入门', '初级', '中级', '高级', '大师', '特级大师', '棋王'];
    OLD.forEach((name, i) => expect(AI_LEVEL_NAMES[migrateLevel(i)]).toBe(name));
  });

  it('越往上算得越多、挑得越认真', () => {
    const work = (i: number) => PIKA_LEVELS[i].nodes ?? 1e9;
    for (let i = 1; i < PIKA_LEVELS.length; i++) {
      expect(work(i)).toBeGreaterThan(work(i - 1));
      expect(PIKA_LEVELS[i].temp).toBeLessThanOrEqual(PIKA_LEVELS[i - 1].temp);
    }
  });

  it('让子阶梯用的是存在的档位，参考分由档位分数推出来', () => {
    for (const r of LADDER) {
      expect(r.lv).toBeGreaterThanOrEqual(0);
      expect(r.lv).toBeLessThan(AI_LEVEL_RATING.length);
      expect(r.approx).toBeLessThanOrEqual(AI_LEVEL_RATING[r.lv]);
    }
    for (let i = 1; i < LADDER.length; i++) expect(LADDER[i].approx).toBeGreaterThan(LADDER[i - 1].approx);
  });
});

describe('残局题下到底的目标', () => {
  const p = (x: Partial<Puzzle>) => ({ id: 'x', kind: 'endgame', fen: '', answer: '', line: [], rating: 1000, ...x }) as Puzzle;
  it('领先够多要下到将死，接近均势要守和，落后的不接着下', () => {
    expect(endgameTarget(p({ ev: 900, goal: 'only' }))).toBe('win');
    expect(endgameTarget(p({ ev: 3000, goal: 'mate' }))).toBe('win');
    expect(endgameTarget(p({ ev: 20, goal: 'only' }))).toBe('draw');
    expect(endgameTarget(p({ ev: -500, goal: 'defend' }))).toBeNull();
    expect(endgameTarget(p({ kind: 'tactic', ev: 900 }))).toBeNull();
  });
});
