/**
 * AI 教练：把结构化事实说成人话。
 *
 * 这里是 Mock 实现，也是默认实现。它不"聪明"，但它**不会说错**——
 * 每一句话里的数字都来自规则引擎，模板只负责串词。
 * 接了真模型之后，模型拿到的也是同一份事实，只是话说得更自然。
 *
 * 写文案时守三条：
 *   1. 先说结论，再说原因，最后给一句大白话
 *   2. 用具体数字（「进张从 12 张掉到 4 张」），不说「效率更高」
 *   3. 数据里没有的东西一个字都不说
 */

import { SUIT_NAMES, tileName, tilesName } from '../rules/tiles';
import { SEVERITY_TEXT } from '../analysis/efficiency';
import { BLOCK_DESC, BLOCK_NAME } from '../analysis/shanten';
import type { GameReport } from '../replay/analyze';
import { ERROR_INFO } from '../replay/analyze';
import type { DecisionFacts, SituationFacts } from './facts';
import {
  RemoteProvider, remoteEndpoint,
  type ChatRequest, type CoachMessage, type CoachProvider, type ExplainRequest,
} from './provider';

/** 没有把握时统一的说法。产品要求：不许编 */
export const UNKNOWN = '当前信息不足，无法确定。';

// ==================== Mock 教练 ====================

export class MockCoach implements CoachProvider {
  readonly id = 'mock' as const;
  readonly name = '本地教练';
  available() {
    return true;
  }

  async explain(req: ExplainRequest): Promise<CoachMessage> {
    switch (req.topic) {
      case 'discard': return explainDiscard(req.facts, req.decision);
      case 'lack': return explainLack(req.facts, req.decision);
      case 'swap': return explainSwap(req.facts, req.decision);
      case 'situation': return explainSituation(req.facts);
      case 'result': return explainSituation(req.facts);
    }
  }

  async chat(req: ChatRequest): Promise<CoachMessage> {
    return answer(req);
  }
}

// ==================== 各类解释 ====================

function explainDiscard(f: SituationFacts, d?: DecisionFacts): CoachMessage {
  const a = f.discards;
  if (!a) return { headline: UNKNOWN, body: '现在不是你的出牌回合，没有可以分析的舍牌。', source: 'mock' };
  const best = a.best;

  // 只是问「该打哪张」
  if (!d) {
    const facts = [
      `你现在${f.hero.shantenText}`,
      `手牌结构：${f.hero.structureText}`,
      `建议打 ${best.name}（${best.role}）`,
      best.ting ? `打完直接听牌，听 ${tilesName(best.waits)}` : `打完还有 ${best.ukeire} 张进张`,
    ];
    const alt = a.options[1];
    let body = `建议打 **${best.name}**。`;
    if (a.forced) {
      body = `这一步没得选：手上还有 ${f.hero.lackLeft} 张${f.hero.lackName}，规则要求先把缺门打完，所以只能打 ${best.name}。`;
      return {
        headline: `只能打 ${best.name}`,
        body,
        simple: '有缺门牌就必须先打缺门，这是四川麻将的硬规矩。',
        facts,
        source: 'mock',
      };
    }
    if (best.ting) {
      body += `打完就听牌了，听 ${tilesName(best.waits)}（${best.tingFan} 番）。听牌和不听牌在结算时差很多，能听就先听。`;
    } else {
      body += `它在你手里是${best.role}，打掉之后还能摸 ${best.ukeire} 张有效牌，是所有选择里最宽的。`;
    }
    if (alt && alt.tile !== best.tile) {
      body += `\n\n次选是 ${alt.name}（进张 ${alt.ukeire} 张）${
        best.ukeire > alt.ukeire ? `，比 ${best.name} 少 ${best.ukeire - alt.ukeire} 张` : ''
      }。`;
    }
    if (f.stance.stance !== 'attack') body += `\n\n另外：${f.stance.text}`;
    return {
      headline: `建议打 ${best.name}`,
      body,
      simple: best.ting
        ? '打这张就能听牌了，先听上再说。'
        : `${best.name} 是你手里最没用的一张，打它损失最小。`,
      facts,
      source: 'mock',
    };
  }

  // 对照式解释：你打了 X，更好的是 Y
  if (d.same) {
    return {
      headline: `打 ${d.chosenText} 是对的`,
      body: `${d.chosenText} 就是这手牌的最优选择。${
        best.ting ? `打完听 ${tilesName(best.waits)}。` : `打完还有 ${best.ukeire} 张进张。`
      }`,
      simple: '这步打得对。',
      facts: [`向听 ${f.hero.shanten}`, `进张 ${best.ukeire} 张`],
      source: 'mock',
    };
  }

  const body =
    `你打的是 **${d.chosenText}**，更好的选择是 **${d.bestText}**。\n\n` +
    d.diffs.map((x) => `· ${x}`).join('\n') +
    `\n\n${SEVERITY_TEXT[d.severity]}。`;

  return {
    headline: `${SEVERITY_TEXT[d.severity]}：${d.chosenText} → ${d.bestText}`,
    body,
    simple: simpleDiscardTip(d),
    facts: d.diffs,
    source: 'mock',
  };
}

function simpleDiscardTip(d: DecisionFacts): string {
  if (d.best?.ting && !d.chosen?.ting) return '你已经能听牌了，换一张打就听上了。';
  if ((d.best?.ukeire ?? 0) > (d.chosen?.ukeire ?? 0) * 1.6) return '你打掉的那张其实还有用，换成更没用的那张打。';
  if ((d.chosen?.danger ?? 0) > 0.5) return '这张太危险了，别人快胡了，先打安全的。';
  return '优先保留更容易连成组合的牌，孤零零的先打。';
}

function explainLack(f: SituationFacts, d?: DecisionFacts): CoachMessage {
  const a = f.lackAnalysis;
  if (!a) return { headline: UNKNOWN, body: '现在不是定缺阶段。', source: 'mock' };

  if (!d) {
    const body =
      `${a.verdict}\n\n` +
      a.options
        .map((o) => `**${o.rank}. 缺${o.name}**（${o.count} 张）\n　${o.reasons.join('；')}`)
        .join('\n\n') +
      `\n\n定缺不是"哪门少缺哪门"。真正要比的是：打掉这门之后，剩下两门离听牌还有多远。` +
      `有时候某门张数多但全是孤张，反而该缺它。`;
    return {
      headline: a.verdict,
      body,
      simple: `建议缺${a.best.name}，因为缺了它以后剩下的牌最好用。`,
      facts: a.options.map((o) => `缺${o.name}：还差 ${o.shantenAfter} 张听牌，进张 ${o.ukeireAfter} 张`),
      source: 'mock',
    };
  }

  if (d.same) {
    return {
      headline: `${d.chosenText}，选对了`,
      body: `${d.chosenText}是这手牌的最优选择。${a.best.reasons.join('；')}。`,
      simple: '定缺选对了。',
      facts: a.options.map((o) => `缺${o.name}：还差 ${o.shantenAfter} 张听牌`),
      source: 'mock',
    };
  }

  return {
    headline: `${d.chosenText} 不如 ${d.bestText}`,
    body:
      `你选了 **${d.chosenText}**，更合适的是 **${d.bestText}**。\n\n` +
      d.diffs.map((x) => `· ${x}`).join('\n') +
      `\n\n定缺是一整局的事：缺错了，后面每一轮都在打没用的牌，想改也改不了。`,
    simple: '缺门选错了——你缺掉的那门其实是你最好的牌。',
    facts: d.diffs,
    source: 'mock',
  };
}

function explainSwap(f: SituationFacts, d?: DecisionFacts): CoachMessage {
  const a = f.swapAnalysis;
  if (!a) return { headline: UNKNOWN, body: '现在不是换三张阶段。', source: 'mock' };

  if (!d) {
    return {
      headline: a.verdict,
      body:
        `${a.verdict}\n\n**为什么是这三张**\n` +
        a.best.reasons.map((x) => `· ${x}`).join('\n') +
        `\n\n换三张要和定缺连着想：换出去的最好就是你打算缺的那门，` +
        `这样等于提前清了三张废牌。`,
      simple: `换 ${a.best.text}，这三张在你手里最没用。`,
      facts: [
        `换完还差 ${a.best.shantenAfter} 张听牌`,
        `进张 ${a.best.ukeireAfter} 张`,
        `拆掉 ${a.best.brokenMelds} 副面子`,
      ],
      source: 'mock',
    };
  }

  if (d.same) {
    return {
      headline: '换得不错',
      body: `换出 ${d.chosenText} 是最优选择。${a.best.reasons.join('；')}。`,
      simple: '换牌换对了。',
      source: 'mock',
    };
  }

  return {
    headline: `${d.chosenText} 换亏了`,
    body:
      `你换出 **${d.chosenText}**，更好的是 **${d.bestText}**。\n\n` +
      d.diffs.map((x) => `· ${x}`).join('\n') +
      `\n\n换三张只有一次机会，换错了这一局就是从落后开始打。`,
    simple: '你把还有用的牌换出去了，应该换那些互相不搭界的。',
    facts: d.diffs,
    source: 'mock',
  };
}

function explainSituation(f: SituationFacts): CoachMessage {
  const threats = f.opponents.filter((o) => o.tingGuess && !o.outOfPlay);
  const body =
    `**你的牌**：${f.hero.handText}\n` +
    `${f.hero.meldsText !== '没有碰杠' ? `**副露**：${f.hero.meldsText}\n` : ''}` +
    `**缺门**：${f.hero.lackName}${f.hero.lackLeft > 0 ? `（还剩 ${f.hero.lackLeft} 张没打完）` : '（已打完）'}\n` +
    `**进度**：${f.hero.shantenText}${f.hero.ting ? `，听 ${f.hero.waitsText}` : ''}\n` +
    `**结构**：${f.hero.structureText}\n` +
    `**牌墙**：还剩 ${f.wallLeft} 张\n\n` +
    `**场上情况**\n` +
    f.opponents
      .map((o) => `· ${o.name}：${o.outOfPlay ? '已经胡牌下桌' : o.tingGuess ? '看起来像听牌了' : '还没听牌'}${o.meldCount ? `，碰杠 ${o.meldCount} 副` : ''}`)
      .join('\n') +
    `\n\n**建议**：${f.stance.text}`;

  return {
    headline: threats.length ? `有 ${threats.length} 家像听牌了` : f.hero.shantenText,
    body,
    simple: f.stance.text,
    source: 'mock',
  };
}

// ==================== 对话 ====================

interface Intent {
  id: string;
  /** 命中的关键词 */
  keys: string[];
  run: (req: ChatRequest) => CoachMessage;
}

const INTENTS: Intent[] = [
  {
    id: 'why-lose',
    keys: ['为什么输', '为啥输', '怎么输', '输了'],
    run: (req) => {
      const r = req.report as GameReport | undefined;
      if (!r) {
        return {
          headline: UNKNOWN,
          body: `${UNKNOWN}这一局还没结束，等打完我再给你完整的复盘。`,
          source: 'mock',
        };
      }
      const top = r.keyMoments[0];
      const body = top
        ? `这局最关键的问题是**${ERROR_INFO[top.type].name}**。\n\n${top.title}\n你选了 ${top.yours}，更好的是 ${top.better}。\n${top.why}\n\n` +
          (r.keyMoments.length > 1 ? `另外还有 ${r.keyMoments.length - 1} 处可以改进，复盘页面里都列了。` : '')
        : `这局没有明显失误。${r.verdict}麻将本来就有运气成分，方向对了就不用怀疑自己。`;
      return { headline: r.verdict, body, simple: top ? top.simple : '这局打法没问题，是牌不好。', source: 'mock' };
    },
  },
  {
    id: 'biggest-mistake',
    keys: ['最大的错误', '最大错误', '哪里错', '错在哪'],
    run: (req) => {
      const r = req.report as GameReport | undefined;
      const top = r?.keyMoments[0];
      if (!top) {
        return { headline: '没有明显失误', body: '这一局我没找到明显的错误。', simple: '没什么大错。', source: 'mock' };
      }
      return {
        headline: top.title,
        body: `${top.why}\n\n你选了 ${top.yours}，更好的是 ${top.better}。`,
        simple: top.simple,
        source: 'mock',
      };
    },
  },
  {
    id: 'which-discard',
    keys: ['该打哪张', '打哪张', '该出哪张', '出哪张', '打什么'],
    run: (req) => explainDiscard(req.facts),
  },
  {
    id: 'why-this-discard',
    keys: ['为什么打', '为啥打', '这张为什么', '刚才为什么'],
    run: (req) => explainDiscard(req.facts),
  },
  {
    id: 'better-choice',
    keys: ['更好的选择', '有没有更好', '还有别的', '更好吗'],
    run: (req) => {
      const a = req.facts.discards;
      if (!a) return { headline: UNKNOWN, body: `${UNKNOWN}现在不是出牌的时候。`, source: 'mock' };
      const top = a.options.slice(0, 3);
      return {
        headline: `最好的三个选择：${top.map((o) => o.name).join('、')}`,
        body: top
          .map((o, i) => `**${i + 1}. ${o.name}**（${o.role}）\n　${o.ting ? `听 ${tilesName(o.waits)}` : `还差 ${o.shanten} 张听牌`}，进张 ${o.ukeire} 张${o.danger > 0.45 ? `，但比较危险：${o.dangerReason}` : ''}`)
          .join('\n\n'),
        simple: `打 ${top[0].name} 最好。`,
        source: 'mock',
      };
    },
  },
  {
    id: 'attack-or-defend',
    keys: ['进攻还是防守', '该防守吗', '要不要防', '攻还是守', '安全吗'],
    run: (req) => {
      const f = req.facts;
      const threats = f.opponents.filter((o) => o.tingGuess && !o.outOfPlay);
      const safest = f.discards?.options.slice().sort((a, b) => a.danger - b.danger)[0];
      return {
        headline: { attack: '该进攻', balance: '攻守各半', defend: '该防守' }[f.stance.stance],
        body:
          `${f.stance.text}\n\n` +
          (threats.length
            ? `看起来像听牌的：${threats.map((o) => o.name).join('、')}。判断依据是他们打牌的轮数、碰杠数量，以及最近开始打中张——` +
              `注意这是**推测**，我看不到他们的手牌。\n\n`
            : '目前没有明显的听牌迹象。\n\n') +
          (safest ? `如果要打安全牌，${safest.name} 最稳：${safest.dangerReason}。` : ''),
        simple: f.stance.text,
        source: 'mock',
      };
    },
  },
  {
    id: 'why-no-shape',
    keys: ['没有成型', '一直没成', '牌为什么这么烂', '做不起来', '为什么听不了'],
    run: (req) => {
      const f = req.facts;
      const blocks = f.hero.blocks;
      const gudan = blocks.filter((b) => b.kind === 'gudan').length;
      const partials = blocks.filter((b) => ['liangmian', 'kanzhang', 'bianzhang', 'duizi'].includes(b.kind));
      const bad = partials.filter((b) => b.kind === 'kanzhang' || b.kind === 'bianzhang');
      let body = `现在你${f.hero.shantenText}。手牌结构是：${f.hero.structureText}。\n\n`;
      if (gudan >= 3) body += `问题主要在**孤张太多**（${gudan} 张）：这些牌互相搭不上，摸到什么都用不上。\n`;
      if (bad.length >= 2) {
        body += `另外你有 ${bad.length} 个${bad.map((b) => BLOCK_NAME[b.kind]).join('、')}，` +
          `${BLOCK_DESC[bad[0].kind]}——这种搭子进张只有两面搭子的一半，牌自然慢。\n`;
      }
      if (f.hero.lackLeft > 0) body += `还有 ${f.hero.lackLeft} 张${f.hero.lackName}没打完，这几轮都得先清缺门，进度会被拖住。\n`;
      if (gudan < 3 && bad.length < 2 && f.hero.lackLeft === 0) {
        body += `结构其实没问题，进张也够，就是还没摸到——这种情况不用改打法，继续按效率打。\n`;
      }
      return { headline: f.hero.shantenText, body, simple: gudan >= 3 ? '你手上散牌太多，先把连不上的牌打掉。' : '结构没问题，是还没摸到好牌。', source: 'mock' };
    },
  },
  {
    id: 'simple',
    keys: ['简单一点', '讲简单', '说人话', '听不懂'],
    run: (req) => {
      const f = req.facts;
      const best = f.discards?.best;
      const lines = [`你现在${f.hero.shantenText}。`];
      if (f.hero.lackLeft > 0) lines.push(`手上还有 ${f.hero.lackLeft} 张${f.hero.lackName}，必须先打完。`);
      else if (best) lines.push(`这一步打 ${best.name} 就行。`);
      if (f.hero.ting) lines.push(`你听 ${f.hero.waitsText}，等这几张牌出现。`);
      lines.push(f.stance.text);
      return { headline: '简单说', body: lines.join('\n'), simple: lines.join(' '), source: 'mock' };
    },
  },
  {
    id: 'opponent-hand',
    keys: ['他听什么', '他听啥', '对家听', '下家听', '上家听', '别人听', '对家什么牌', '下家什么牌', '上家什么牌', '别人手牌', '别人的牌', '他手里'],
    run: (req) => {
      const f = req.facts;
      const guesses = f.opponents.filter((o) => o.tingGuess && !o.outOfPlay);
      return {
        headline: UNKNOWN,
        body:
          `我看不到别人的手牌，只能从他们打过的牌推测——这一点必须说清楚，` +
          `不然你会以为有内幕消息。\n\n` +
          (guesses.length
            ? guesses.map((o) => `· ${o.name}：${o.discardsText ? `打过 ${o.discardsText}` : '还没打牌'}，缺${o.lackName}，看起来像听牌了`).join('\n')
            : '目前没人明显像听牌。') +
          `\n\n具体听什么牌，${UNKNOWN}`,
        simple: '看不到别人的牌，只能猜个大概。',
        source: 'mock',
      };
    },
  },
  {
    id: 'ting-what',
    keys: ['听什么', '我听啥', '现在听'],
    run: (req) => {
      const f = req.facts;
      if (!f.hero.ting) {
        return {
          headline: '还没听牌',
          body: `你现在${f.hero.shantenText}。${f.discards?.best.ting ? `打 ${f.discards.best.name} 就能听牌。` : ''}`,
          simple: '还没听牌。',
          source: 'mock',
        };
      }
      return {
        headline: `听 ${f.hero.waitsText}`,
        body: `你听 ${f.hero.waitsText}，一共 ${f.hero.waits.length} 种牌。`,
        simple: `你听 ${f.hero.waitsText}。`,
        source: 'mock',
      };
    },
  },
  {
    id: 'lack-advice',
    keys: ['缺什么', '定缺', '该缺哪'],
    run: (req) => explainLack(req.facts),
  },
  {
    id: 'swap-advice',
    keys: ['换哪三张', '换三张', '换什么'],
    run: (req) => explainSwap(req.facts),
  },
];

/** 快捷问题，界面上做成按钮 */
export const QUICK_QUESTIONS = [
  '这一步该打哪张？',
  '有没有更好的选择？',
  '现在应该进攻还是防守？',
  '我的牌为什么一直没有成型？',
  '我这局最大的错误是什么？',
  '给我讲简单一点',
];

export function answer(req: ChatRequest): CoachMessage {
  const q = req.question.trim();
  if (!q) return { headline: '', body: '你想问什么？', source: 'mock' };

  for (const it of INTENTS) {
    if (it.keys.some((k) => q.includes(k))) return it.run(req);
  }
  // 兜底：问到了理解不了的，给当前局面概况，并且**明说没听懂**，不装懂
  const s = explainSituation(req.facts);
  return {
    headline: '我不太确定你问的是哪一点',
    body: `这个问题我没完全听懂。${UNKNOWN}\n\n先把现在的局面说一下，也许里面有你要的答案：\n\n${s.body}`,
    simple: s.simple,
    source: 'mock',
  };
}

// ==================== 出口 ====================

let cached: CoachProvider | null = null;

/**
 * 拿到当前可用的教练。
 * 有后端就用后端，后端出错自动退回 Mock——教学功能不能因为网络挂了就整个消失。
 */
export function getCoach(): CoachProvider {
  if (cached) return cached;
  const base = remoteEndpoint();
  const mock = new MockCoach();
  if (!base) {
    cached = mock;
    return cached;
  }
  const remote = new RemoteProvider(base);
  cached = {
    id: 'remote',
    name: remote.name,
    available: () => true,
    async explain(req) {
      try {
        return await remote.explain(req);
      } catch {
        return mock.explain(req);
      }
    },
    async chat(req) {
      try {
        return await remote.chat(req);
      } catch {
        return mock.chat(req);
      }
    },
  };
  return cached;
}

/** 测试用：重置缓存 */
export function resetCoach() {
  cached = null;
}

export { SUIT_NAMES, tileName };
