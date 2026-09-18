/**
 * AI 对局模拟器：`npm run mj:sim`
 *
 * 用它回答两个问题：
 *   1. AI 会不会出非法牌（会的话引擎直接抛错，这里能立刻发现）
 *   2. 四个档位到底有没有强弱差别（不然「分档」就是假的）
 *
 * 做法是让四个档位互相打几百局，统计胡牌率和净得分。
 * 注意麻将方差极大，几百局只能看出粗略趋势，所以这里跑的局数多一些，
 * 而且座位轮换，避免庄家位置带来的偏差。
 */

import { MahjongEngine } from '../src/mjcoach/rules/engine';
import { VARIANT_CHENGDU, VARIANT_TEACH, VARIANT_XUELIU, listVariants } from '../src/mjcoach/rules/config';
import { AI_LEVELS, AI_PROFILES, decide, type AiLevel } from '../src/mjcoach/ai/players';
import { Rng } from '../src/mjcoach/rules/tiles';

const GAMES = Number(process.env.GAMES ?? 400);

interface Stat {
  level: AiLevel;
  games: number;
  wins: number;
  score: number;
  huazhu: number;
  noting: number;
  fanSum: number;
}

function runSet(cfgId: string, games: number) {
  const cfg = listVariants().find((v) => v.id === cfgId)!;
  const stats: Record<AiLevel, Stat> = Object.fromEntries(
    AI_LEVELS.map((l) => [l, { level: l, games: 0, wins: 0, score: 0, huazhu: 0, noting: 0, fanSum: 0 }]),
  ) as Record<AiLevel, Stat>;

  let illegal = 0;
  let unfinished = 0;
  let totalSteps = 0;
  const t0 = Date.now();

  for (let g = 0; g < games; g++) {
    // 座位轮换：第 g 局把档位顺序整体右移，抵消座次优势
    const levels: AiLevel[] = AI_LEVELS.map((_, i) => AI_LEVELS[(i + g) % AI_LEVELS.length]);
    const engine = new MahjongEngine({ config: cfg, seed: g * 2654435761 + 12345 });
    engine.start();
    const rng = new Rng(g * 7919 + 1);
    let steps = 0;
    while (engine.phase !== 'over' && steps < 4000) {
      const pending = engine.pending();
      if (!pending) break;
      const action = decide(levels[pending.seat], engine, pending, rng);
      try {
        engine.apply(action);
      } catch (e) {
        illegal++;
        console.error(`✗ ${levels[pending.seat]} 非法动作：${(e as Error).message}`);
        break;
      }
      steps++;
    }
    totalSteps += steps;
    if (engine.phase !== 'over') { unfinished++; continue; }

    for (const p of engine.players) {
      const s = stats[levels[p.seat]];
      s.games++;
      s.score += p.score;
      if (p.won) {
        s.wins += p.winCount;
        s.fanSum += p.wins.reduce((a, w) => a + w.score.fan, 0);
      }
      const row = engine.result?.drawRows.find((r) => r.seat === p.seat);
      if (row?.status === 'huazhu') s.huazhu++;
      if (row?.status === 'noting') s.noting++;
    }
  }

  const ms = Date.now() - t0;
  console.log(`\n【${cfg.name}】${games} 局 · ${ms}ms · 平均 ${(totalSteps / games).toFixed(0)} 步/局`);
  if (illegal) console.log(`  ⚠ 非法动作 ${illegal} 次`);
  if (unfinished) console.log(`  ⚠ 未正常结束 ${unfinished} 局`);
  // 血流成河一局能胡多次，所以这一列是「每局胡牌次数」，可能超过 100%
  console.log('  档位      胡牌次数 平均得分   花猪率   未听牌率  平均番');
  for (const l of AI_LEVELS) {
    const s = stats[l];
    const pad = (x: string, n: number) => {
      let w = 0;
      for (const ch of x) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
      return x + ' '.repeat(Math.max(0, n - w));
    };
    console.log(
      `  ${pad(AI_PROFILES[l].name, 10)}${pad(`${((s.wins / s.games) * 100).toFixed(1)}%`, 9)}` +
        `${pad((s.score / s.games).toFixed(2), 11)}${pad(`${((s.huazhu / s.games) * 100).toFixed(1)}%`, 9)}` +
        `${pad(`${((s.noting / s.games) * 100).toFixed(1)}%`, 10)}${s.wins ? (s.fanSum / s.wins).toFixed(1) : '—'}`,
    );
  }
  return { illegal, unfinished, stats };
}

console.log(`AI 对局模拟：每套规则 ${GAMES} 局，四档轮流坐庄`);
let bad = 0;
for (const id of [VARIANT_CHENGDU.id, VARIANT_XUELIU.id, VARIANT_TEACH.id]) {
  const r = runSet(id, GAMES);
  bad += r.illegal + r.unfinished;
}

// 强弱顺序检查：用成都规则多跑一轮，确认高级确实比新手强
console.log('\n强弱验证（成都血战到底，只看净得分排序）');
const check = runSet(VARIANT_CHENGDU.id, GAMES * 2);
const order = AI_LEVELS.map((l) => ({ l, s: check.stats[l].score / check.stats[l].games }));
order.sort((a, b) => b.s - a.s);
console.log('  实际强弱：' + order.map((o) => `${AI_PROFILES[o.l].name}(${o.s.toFixed(2)})`).join(' > '));
const advanced = order.findIndex((o) => o.l === 'advanced');
const beginner = order.findIndex((o) => o.l === 'beginner');
if (advanced < beginner) console.log('  ✓ 高级 AI 强于新手 AI');
else { console.log('  ✗ 分档没有产生强弱差异'); bad++; }

if (bad > 0) {
  console.log(`\n发现 ${bad} 个问题`);
  process.exit(1);
}
console.log('\n全部通过：没有非法动作，牌局都能正常结束，分档有效。');
