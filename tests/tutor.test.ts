/**
 * 私教：该上什么课、作业怎么检查。
 * 用户原话："思考怎么才能当好一个象棋私教。"——先看你的棋再开口、一节课只讲一件事、下节课先检查作业。
 */
import { describe, expect, it } from 'vitest';
import { CHECK_GAMES, checkLesson, habitCounts, planLesson, ratePerGame, type LessonRecord, type Theme, type TutorInput } from '../src/xiangqi/tutor';
import type { ArchivedGame } from '../src/xiangqi/archive';
import type { ErrTag } from '../src/xiangqi/teach';
import { TRICKS } from '../src/xiangqi/tricks';

const DAY = 86400000;
let seq = 0;
function game(ts: number, tags: Partial<Record<ErrTag, number>> | null): ArchivedGame {
  return {
    id: `g${seq++}`,
    d: new Date(ts).toLocaleDateString('sv'),
    ts,
    fen: '',
    moves: '',
    side: 'r',
    result: 'loss',
    level: '初级',
    review: tags ? { blunders: 1, mistakes: 1, avgLoss: 80, tags } : undefined,
  };
}
const R = (r = 1200) => ({ safety: { r }, mate: { r }, tactic: { r }, endgame: { r: r - 100 }, opening: { r } });
const base = (over: Partial<TutorInput> = {}): TutorInput => ({
  games: [],
  assessed: false,
  ratings: R(),
  log: [],
  ownByDim: {},
  ...over,
});
const rec = (theme: Theme, ts: number, before: number | null, done = 3, steps = 3): LessonRecord => ({
  ts,
  d: '',
  theme,
  round: 1,
  done: Array.from({ length: done }, (_, i) => i),
  steps,
  before,
});

describe('私教排课', () => {
  it('第一次见面：没测评、没实战 → 见面课，先测评再下一盘', () => {
    const l = planLesson(base());
    expect(l.theme).toBe('intro');
    expect(l.steps.map((s) => s.kind)).toEqual(['assess', 'game']);
  });

  it('测评过、还没有复盘过的实战 → 按测评补残局、布局里弱的那一块', () => {
    const l = planLesson(base({ assessed: true }));
    expect(l.theme).toBe('endgame');
    expect(l.why).toContain('测评');
  });

  it('实战里哪个毛病最多就先上哪一课，理由里有数出来的证据', () => {
    const now = Date.now();
    const games = [game(now - DAY, { 'missed-threat': 2, hang: 1 }), game(now - 2 * DAY, { 'missed-threat': 3 }), game(now - 3 * DAY, { greedy: 1 })];
    const l = planLesson(base({ assessed: true, games }));
    expect(l.theme).toBe('missed-threat');
    expect(l.why).toContain('5 次');
    expect(l.why).toContain('2 盘');
    expect(l.points.length).toBe(3);
    expect(l.steps.some((s) => s.kind === 'game')).toBe(true);
  });

  it('错题本里没有你自己的实战题，"先看你自己的"那一步就不排', () => {
    const games = [game(Date.now(), { hang: 2 })];
    const none = planLesson(base({ assessed: true, games }));
    expect(none.steps.some((s) => s.kind === 'own')).toBe(false);
    const some = planLesson(base({ assessed: true, games, ownByDim: { safety: 4 } }));
    expect(some.steps[0].kind).toBe('own');
  });

  it('上节课没上完 → 接着上同一课', () => {
    const now = Date.now();
    const l = planLesson(base({ assessed: true, games: [game(now, { slow: 3 })], log: [rec('greedy', now - DAY, 1, 1, 4)] }));
    expect(l.theme).toBe('greedy');
    expect(l.why).toContain('接着');
  });

  it('作业检查：之后的实战里少了三成以上 → 过关，换下一课', () => {
    const t0 = Date.now() - 10 * DAY;
    const games = [game(t0 + 2 * DAY, { hang: 1 }), game(t0 + DAY, { 'missed-threat': 1 }), game(t0 - DAY, { hang: 3 })];
    const r = rec('hang', t0, 2.5);
    expect(checkLesson(r, games)).toEqual({ after: 0.5, passed: true, n: 2 });
    const l = planLesson(base({ assessed: true, games, log: [r] }));
    expect(l.theme).not.toBe('hang');
  });

  it('作业检查：没怎么少 → 同一课换个角度再上一遍', () => {
    const t0 = Date.now() - 10 * DAY;
    const games = [game(t0 + 2 * DAY, { greedy: 2 }), game(t0 + DAY, { greedy: 2 }), game(t0 - DAY, { greedy: 2 })];
    const r = rec('greedy', t0, 2);
    expect(checkLesson(r, games)?.passed).toBe(false);
    const l = planLesson(base({ assessed: true, games, log: [r] }));
    expect(l.theme).toBe('greedy');
    expect(l.round).toBe(2);
    expect(l.title).toContain('换个角度');
    // 换个角度：第二次上用的不是同一条套路
    const first = planLesson(base({ assessed: true, games }));
    const tr = (x: typeof l) => x.steps.find((s) => s.kind === 'trick');
    expect(tr(first)).not.toEqual(tr(l));
  });

  it(`作业还没法检查（之后复盘过的实战不到 ${CHECK_GAMES} 盘）→ 不重复上同一课，说明作业还没检查`, () => {
    const t0 = Date.now() - 10 * DAY;
    const games = [game(t0 + DAY, { hang: 2 }), game(t0 - DAY, { hang: 3, slow: 1 })];
    const r = rec('hang', t0, 3);
    expect(checkLesson(r, games)).toBeNull();
    const l = planLesson(base({ assessed: true, games, log: [r] }));
    expect(l.theme).toBe('slow');
    expect(l.why).toContain('作业还没法检查');
  });

  it('统计只看复盘过的棋', () => {
    const games = [game(1, { hang: 2 }), game(2, null), game(3, { hang: 1, greedy: 1 })];
    expect(ratePerGame(games, 'hang')).toBe(1.5);
    expect(habitCounts(games)[0]).toEqual({ tag: 'hang', count: 3, games: 2 });
    expect(ratePerGame([game(1, null)], 'hang')).toBeNull();
  });

  it('课上用到的邪门布局都在库里', () => {
    const ids = new Set(TRICKS.map((t) => t.id));
    const tags: Theme[] = ['hang', 'greedy', 'missed-threat', 'walk-into-mate', 'missed-mate', 'slow'];
    for (const tag of tags) {
      for (let round = 1; round <= 3; round++) {
        const games = [game(Date.now(), { [tag]: 2 })];
        const log = Array.from({ length: round - 1 }, (_, i) => ({ ...rec(tag, i, 1), passed: false }));
        const l = planLesson(base({ assessed: true, games, log: log.length ? log : [] }));
        for (const s of l.steps) if (s.kind === 'trick') expect(ids.has(s.id), `${tag} ${s.id}`).toBe(true);
      }
    }
    for (const side of ['endgame', 'opening'] as const) {
      const ratings = side === 'endgame' ? R() : { ...R(), opening: { r: 900 } };
      const l = planLesson(base({ assessed: true, ratings }));
      expect(l.theme).toBe(side);
      for (const s of l.steps) if (s.kind === 'trick') expect(ids.has(s.id), s.id).toBe(true);
    }
  });
});
