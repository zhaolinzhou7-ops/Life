/**
 * 斗地主批量自动模拟（验收脚本）。
 *
 * 用法：npm run dd:sim         默认 200 局
 *       GAMES=1000 npm run dd:sim
 *
 * 三个 AI 自己打，每一步都由独立裁判复核（见 src/doudizhu/simulate.ts）。
 * 只要有一局出问题就以非 0 退出，方便挂到 CI 上。
 */
import { simulateGame, simulateMany } from '../src/doudizhu/simulate';
import type { Difficulty } from '../src/doudizhu/ai';

const GAMES = Number(process.env.GAMES || 200);
const MIXES: [string, [Difficulty, Difficulty, Difficulty]][] = [
  ['全困难', ['hard', 'hard', 'hard']],
  ['全普通', ['normal', 'normal', 'normal']],
  ['全简单', ['easy', 'easy', 'easy']],
  ['混合（地主困难）', ['hard', 'normal', 'easy']],
  ['混合（地主简单）', ['easy', 'hard', 'hard']],
];

let failed = 0;
console.log(`每档 ${GAMES} 局\n`);
console.log('难度              局数  失败  地主胜率  均轮数  均出牌  炸弹  春天  重发  最长  耗时');
console.log('─'.repeat(86));

for (const [name, diffs] of MIXES) {
  const t0 = Date.now();
  const r = simulateMany(GAMES, { difficulties: diffs, seed: 20260918 });
  const ms = Date.now() - t0;
  failed += r.failures.length;
  console.log(
    `${name.padEnd(17)} ${String(r.games).padStart(4)}  ${String(r.failures.length).padStart(4)}  ` +
      `${((r.landlordWins / r.games) * 100).toFixed(1).padStart(7)}%  ${r.avgRounds.toFixed(1).padStart(6)}  ` +
      `${r.avgPlays.toFixed(1).padStart(6)}  ${String(r.totalBombs).padStart(4)}  ${String(r.springs).padStart(4)}  ` +
      `${String(r.redeals).padStart(4)}  ${String(r.maxRounds).padStart(4)}  ${ms}ms`,
  );
  for (const f of r.failures.slice(0, 5)) console.log(`   ✗ seed ${f.seed}: ${f.problems.join('；')}`);
}

console.log('─'.repeat(86));

/*
 * 难度强弱对比。
 * 注意不能看上面那张表的"地主胜率"——地主是叫分叫出来的，不一定是座位 0，
 * 三档难度的差异会被这个数字抹平。要固定另外两家、只换座位 0，比它的平均得分。
 */
console.log('\n难度强弱（另外两家固定普通，同一批种子，比座位 0 的平均得分）：');
for (const d of ['easy', 'normal', 'hard'] as Difficulty[]) {
  let score = 0;
  let wins = 0;
  for (let i = 0; i < GAMES; i++) {
    const r = simulateGame({ seed: (10007 + i * 7919) >>> 0, difficulties: [d, 'normal', 'normal'] });
    if (!r.ok) failed++;
    score += r.scores[0];
    const won = r.landlord === 0 ? r.winner === 'landlord' : r.winner === 'farmers';
    if (won) wins++;
  }
  console.log(`  ${d.padEnd(7)} 平均得分 ${(score / GAMES).toFixed(2).padStart(7)}   胜率 ${((wins / GAMES) * 100).toFixed(1)}%`);
}

console.log(failed ? `\n✗ 共 ${failed} 局出问题` : `\n✓ 全部牌局正常：没有非法牌、重复牌、卡死或状态错误`);
process.exit(failed ? 1 : 0);
