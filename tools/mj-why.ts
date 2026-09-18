/**
 * 「这手牌该打哪张、为什么」的命令行版：`npm run mj:why`
 *
 * 它和 App 里教练面板调的是**同一套分析层**，所以你在命令行看到的数字，
 * 就是牌桌上教练给你的数字。做这个工具有两个用处：
 *   1. 学的时候可以把自己犹豫的牌型敲进来，一次看完所有打法的账
 *   2. 改了分析层之后，用它对着几手经典牌型看一眼，比读测试报告直观
 *
 * 用法：
 *   npm run mj:why                                   # 跑内置示例
 *   npm run mj:why -- "1234567m 3457s 99p" --lack p  # 自己的牌
 *   npm run mj:why -- "..." --lack p --seen "9m9m5s" # 带上场上已经出现过的牌
 *   npm run mj:why -- "..." --lack p --ting 1        # 假设有一家已经听牌
 *
 * 牌的写法：数字 + 花色字母，m/w=万 s/t=条 p/b=筒，也认 "3万4条" 这种中文写法。
 */

import { VARIANT_CHENGDU } from '../src/mjcoach/rules/config';
import {
  SUIT_NAMES, countTotal, parseCounts, parseHand, tileName, tilesName, toTiles,
  type Counts, type TileId,
} from '../src/mjcoach/rules/tiles';
import { analyzeDiscards } from '../src/mjcoach/analysis/efficiency';
import { BLOCK_NAME, decompose, shantenWithLack } from '../src/mjcoach/analysis/shanten';
import { stanceAdvice, type OpponentRead } from '../src/mjcoach/analysis/defense';

declare const process: { argv: string[]; exit(code: number): void };

// ---------- 参数 ----------

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const SUIT_LETTER: Record<string, number> = { m: 0, w: 0, 万: 0, s: 1, t: 1, 条: 1, p: 2, b: 2, 筒: 2 };

const EXAMPLES: { hand: string; lack: number; seen?: string; ting?: number; note: string }[] = [
  {
    hand: '234567m 3457s 99p 55p',
    lack: 2,
    note: '缺筒还没打完——这时候根本轮不到"选"，规则先替你决定了',
  },
  {
    hand: '234567m 34578s 99s 2s',
    lack: 2,
    note: '缺筒已打完的中盘局面：一个两面、一个坎张、一张孤张，只能留两个',
  },
  {
    hand: '234567m 34578s 99s 2s',
    lack: 2,
    seen: '6s6s6s6s 9s9s',
    note: '同一手牌，但 6 条已经四张全见光、9 条也见了两张——数牌会把答案整个翻过来',
  },
  {
    hand: '23456789m 234s 55s',
    lack: 2,
    note: '已经听牌的局面：这时候比的是听口宽度，不是进张',
  },
];

// ---------- 输出工具 ----------

const width = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
const padL = (s: string, n: number) => ' '.repeat(Math.max(0, n - width(s))) + s;
const bar = (v: number, max: number, n = 10) => {
  const k = max > 0 ? Math.round((v / max) * n) : 0;
  return '█'.repeat(k) + '·'.repeat(n - k);
};

function explain(hand: string, lackSuit: number, seenText?: string, tingSeat?: number) {
  const cfg = VARIANT_CHENGDU;
  const counts = parseCounts(hand);
  const total = countTotal(counts);

  console.log('─'.repeat(78));
  console.log(`手牌　${tilesName(toTiles(counts))}　（${total} 张）`);
  console.log(`缺门　${SUIT_NAMES[lackSuit]}`);

  if (total % 3 !== 2) {
    console.log(`\n⚠ 出牌前手上应该是 14 张（或碰杠后的 11/8/5 张），现在是 ${total} 张，没法分析该打哪张。`);
    return;
  }

  // 已见牌：自己的手牌一定算见过，再加上场上出现过的
  const seen: Counts = counts.slice();
  if (seenText) {
    for (const t of parseHand(seenText)) seen[t] = Math.min(4, seen[t] + 1);
  }

  const reads: OpponentRead[] = [];
  if (tingSeat !== undefined) {
    reads.push({
      seat: tingSeat, discards: [], lack: lackSuit,
      ting: true, tingConfidence: 0.8, meldCount: 1, outOfPlay: false,
    });
    console.log(`场上　假设 ${tingSeat} 号位已经听牌`);
  }
  if (seenText) console.log(`已见　${tilesName(parseHand(seenText))}（自己的手牌已自动计入）`);

  // ---------- 1. 手牌结构 ----------
  const blocks = decompose(counts, lackSuit);
  console.log('\n【第一步】把牌拆开看：这手牌由什么组成');
  for (const b of blocks) {
    const names = tilesName(b.tiles);
    const waits = b.waits.length ? `　还差 ${tilesName(b.waits)}` : '';
    console.log(`  ${pad(names, 14)}${pad(BLOCK_NAME[b.kind], 10)}${waits}`);
  }
  const sh = shantenWithLack(counts, 0, cfg.win.sevenPairs, lackSuit);
  console.log(`  → 现在${sh < 0 ? '已经成胡牌' : sh === 0 ? '已经听牌' : `还差 ${sh} 张才听牌`}`);

  // ---------- 2. 逐张算账 ----------
  const a = analyzeDiscards({
    cfg, hand: counts, melds: [], lack: lackSuit,
    seen, reads, wallLeft: reads.length ? 20 : 40,
  });

  if (a.forced) {
    console.log('\n【第二步】这一步没有选择');
    console.log(`  手上还有 ${a.lackLeft} 张${SUIT_NAMES[lackSuit]}，规则要求先把缺门打完，只能打 ${a.best.name}。`);
    console.log('  → 想"选牌"，得先把缺门清干净。这也是定缺为什么那么重要：缺错了，前几轮全是白打。');
    console.log('─'.repeat(78));
    return;
  }

  console.log('\n【第二步】每一张打出去之后会怎样（按好坏排序）');
  const maxUke = Math.max(...a.options.map((o) => o.ukeire));
  console.log(
    `  ${pad('打', 6)}${padL('向听', 6)}  ${padL('进张', 6)} ${pad('', 12)}${pad('角色', 16)}${pad('危险', 6)}摸到这些牌会前进`,
  );
  for (const o of a.options) {
    // 听牌时真正要比的是「听的牌还剩几张」——听 2 种但一张不剩，等于没听
    const left = o.waits.reduce((n, w) => n + Math.max(0, 4 - seen[w]), 0);
    const uke = o.ting ? `剩${left}张` : `${o.ukeire} 张`;
    const tiles = o.ting
      ? `听 ${o.waits.map((w) => `${tileName(w)}(${Math.max(0, 4 - seen[w])})`).join(' ')}${left === 0 ? '  ← 死听！' : ''}`
      : o.ukeireTiles.slice(0, 8).map((t) => `${tileName(t)}${seen[t] < 4 ? `(${4 - seen[t]})` : ''}`).join(' ');
    console.log(
      `  ${pad(o.name, 6)}${padL(o.ting ? '听牌' : String(o.shanten), 6)}  ${padL(uke, 6)} ${bar(o.ukeire, maxUke)}  ${pad(o.role, 16)}${pad(o.danger > 0.5 ? '高' : o.danger > 0.2 ? '中' : '低', 6)}${tiles}`,
    );
  }

  // ---------- 3. 结论 ----------
  const best = a.best;
  const second = a.options[1];
  console.log(`\n【结论】打 ${best.name}`);
  if (best.ting) {
    const left = best.waits.reduce((n, w) => n + Math.max(0, 4 - seen[w]), 0);
    console.log(`  打完直接听牌，听 ${tilesName(best.waits)}，场上还剩 ${left} 张（${best.tingFan} 番）。`);
  } else {
    console.log(`  它在你手里是${best.role}，打掉之后还能摸 ${best.ukeire} 张有效牌。`);
  }
  if (second) {
    const gap = best.ukeire - second.ukeire;
    console.log(
      `  次选 ${second.name}：${second.ting ? `听 ${second.waits.length} 种` : `进张 ${second.ukeire} 张`}` +
        `${gap > 0 ? `，比 ${best.name} 少 ${gap} 张` : ''}。`,
    );
  }
  if (reads.length) console.log(`  防守：${stanceAdvice(sh, reads, 20).text}`);
  console.log('─'.repeat(78));
}

// ---------- 主程序 ----------

if (positional.length === 0) {
  console.log('四川麻将 · 舍牌分析（和 App 里教练用的是同一套算法）\n');
  console.log('用法：npm run mj:why -- "234567m 34578s 99s 2s" --lack p [--seen "2s2s8s"] [--ting 1]\n');
  console.log('下面先跑几个内置示例，看懂了就可以换成自己的牌：\n');
  for (const ex of EXAMPLES) {
    console.log(`\n■ ${ex.note}`);
    explain(ex.hand, ex.lack, ex.seen, ex.ting);
  }
  console.log('\n提示：进张后面括号里的数字，是这张牌场上还剩几张——');
  console.log('      这就是「看别人打过什么」在算账时起作用的地方。');
} else {
  const lackArg = flag('lack') ?? 'p';
  const lack = SUIT_LETTER[lackArg[0].toLowerCase()] ?? SUIT_LETTER[lackArg[0]];
  if (lack === undefined) {
    console.log(`不认识的缺门：${lackArg}（用 m/万、s/条、p/筒）`);
    process.exit(1);
  }
  const tingArg = flag('ting');
  explain(positional.join(' '), lack, flag('seen'), tingArg === undefined ? undefined : Number(tingArg));
}

export {};
