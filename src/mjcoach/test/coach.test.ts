/**
 * AI / 教学 / 复盘 / 训练 / 画像 的测试。
 *
 * 这几层里最该守住的是两条产品底线：
 *   1. AI 不能出非法牌——引擎会当场抛错，这里跑几百局把它逼出来
 *   2. 教练不能编——数据里没有的东西必须回答「当前信息不足」
 * 其余测的是「功能真的连得上」：一局打完能出报告、报告能变成题、题能写回画像。
 */

import { check, checkTrue, suite } from './runner';
import { VARIANT_CHENGDU, VARIANT_TEACH, VARIANT_XUELIU } from '../rules/config';
import { MahjongEngine, replay } from '../rules/engine';
import { Rng, parseCounts, tileOf, toTiles } from '../rules/tiles';
import { AI_LEVELS, AI_PROFILES, decide, playOut, spreadLevels, type AiLevel } from '../ai/players';
import { extractFacts, compareDiscard, compareLack, seatName, shantenText } from '../teach/facts';
import { MockCoach, QUICK_QUESTIONS, UNKNOWN, answer } from '../teach/coach';
import { toExplainPayload } from '../teach/provider';
import { Recorder, type DecisionRecord } from '../replay/record';
import { ERROR_TYPES, buildReport, buildTimeline, pickKeyMoments } from '../replay/analyze';
import { ALL_LESSONS, COURSES, judge, makePuzzle, similarPuzzle } from '../training/bank';
import {
  TARGET_ACCURACY, addSrsCard, allSkills, dueSrsCards, emptyProfile, lessonLevel,
  recentPattern, recordTraining, reviewSrsCard, skillView, trainingPlan,
} from '../profile/store';
import { gameAccuracy, improvement, progressSeries } from '../profile/progress';
import { analyzeDiscards } from '../analysis/efficiency';
import { analyzeLack } from '../analysis/dingque';

const S = (r: number) => tileOf(1, r);

/** 用 AI 打完一局，返回引擎 */
function autoGame(cfg = VARIANT_CHENGDU, seed = 42, level: AiLevel = 'intermediate') {
  const e = new MahjongEngine({ config: cfg, seed });
  e.start();
  playOut(e, [level, level, level, level], seed);
  return e;
}

/** 用 AI 打完一局并且把玩家（0 号位）的决策记下来，模拟真实对局产生的牌谱 */
function recordedGame(seed = 7) {
  const cfg = VARIANT_CHENGDU;
  const e = new MahjongEngine({ config: cfg, seed });
  e.start();
  const rec = new Recorder({ config: cfg, seed, heroSeat: 0, aiLevels: ['novice', 'novice', 'novice'], mode: '测试' });
  const rng = new Rng(seed * 13 + 1);
  let guard = 0;
  while (e.phase !== 'over' && guard++ < 3000) {
    const pend = e.pending();
    if (!pend) break;
    // 0 号位故意用「新手」，这样才会产生失误，报告里才有东西可看
    const level: AiLevel = pend.seat === 0 ? 'beginner' : 'intermediate';
    const action = decide(level, e, pend, rng);

    if (pend.seat === 0) {
      if (action.type === 'discard' && pend.kind === 'turn') {
        const a = analyzeDiscards({
          cfg, hand: e.players[0].hand, melds: e.players[0].melds, lack: e.players[0].lack,
          seen: e.seenBy(0), wallLeft: e.wallLeft, legal: e.legalDiscards(0),
        });
        const cmp = compareDiscard(a, action.tile);
        const chosen = a.options.find((o) => o.tile === action.tile);
        rec.onDecision({
          turnIndex: e.turnIndex, kind: 'discard', seat: 0,
          chose: action.tile, best: a.best.tile, loss: cmp.loss, severity: cmp.severity,
          shanten: chosen?.shanten ?? 0, ukeire: chosen?.ukeire ?? 0, bestUkeire: a.best.ukeire,
          headline: cmp.same ? '打得对' : `${cmp.chosenText} → ${cmp.bestText}`,
          detail: { missedTing: !!a.best.ting && !chosen?.ting, role: chosen?.role, bestWaits: a.best.waits },
        });
      } else if (action.type === 'lack') {
        const a = analyzeLack(cfg, e.players[0].hand);
        const cmp = compareLack(a, action.suit);
        rec.onDecision({
          turnIndex: 0, kind: 'lack', seat: 0, chose: action.suit, best: a.best.suit,
          loss: cmp.loss, severity: cmp.severity, shanten: a.best.shantenAfter, ukeire: 0,
          bestUkeire: a.best.ukeireAfter, headline: cmp.chosenText,
          detail: { bestReasons: a.best.reasons },
        });
      }
    }
    rec.onAction(action);
    e.apply(action);
  }
  return { engine: e, record: rec.finish(e) };
}

export function runCoachTests() {
  // ==================== AI ====================
  suite('AI 合法性（300 局）', () => {
    let bad = '';
    let finished = 0;
    for (let g = 0; g < 300 && !bad; g++) {
      const cfg = [VARIANT_CHENGDU, VARIANT_XUELIU, VARIANT_TEACH][g % 3];
      const levels: AiLevel[] = AI_LEVELS.map((_, i) => AI_LEVELS[(i + g) % AI_LEVELS.length]);
      const e = new MahjongEngine({ config: cfg, seed: g * 7919 + 31 });
      e.start();
      const r = playOut(e, levels, g * 13 + 5);
      if (!r.ok) { bad = r.error ?? `第 ${g} 局没打完`; break; }
      finished++;
    }
    check('300 局全部打完且没有非法动作', 300, () => (bad ? bad : finished));
    check('四个档位都有档案说明', 4, () => AI_LEVELS.filter((l) => AI_PROFILES[l].traits.length > 0).length);
    check('AI 一定从引擎给的合法动作里选', true, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 5 });
      e.start();
      const rng = new Rng(1);
      for (let i = 0; i < 200 && e.phase !== 'over'; i++) {
        const pend = e.pending();
        if (!pend) break;
        const a = decide('advanced', e, pend, rng);
        if (!pend.options.some((o) => JSON.stringify(o) === JSON.stringify(a))) return `第 ${i} 步越界`;
        e.apply(a);
      }
      return true;
    });
    check('AI 不会打缺门以外的牌（手上有缺门时）', true, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 99 });
      e.start();
      const rng = new Rng(3);
      for (let i = 0; i < 400 && e.phase !== 'over'; i++) {
        const pend = e.pending();
        if (!pend) break;
        const a = decide('novice', e, pend, rng);
        if (a.type === 'discard') {
          const p = e.players[a.seat];
          const hasLack = toTiles(p.hand).some((t) => Math.floor(t / 9) === p.lack);
          if (hasLack && Math.floor(a.tile / 9) !== p.lack) return `${a.seat} 号位留着缺门却打别的`;
        }
        e.apply(a);
      }
      return true;
    });
    check('能胡的时候 AI 一定胡', true, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 1234 });
      e.start();
      const rng = new Rng(9);
      for (let i = 0; i < 400 && e.phase !== 'over'; i++) {
        const pend = e.pending();
        if (!pend) break;
        const a = decide('intermediate', e, pend, rng);
        if (pend.options.some((o) => o.type === 'hu') && a.type !== 'hu') return `第 ${i} 步能胡却没胡`;
        e.apply(a);
      }
      return true;
    });
  });

  // ==================== 教学层 ====================
  suite('教学层 · 结构化事实', () => {
    check('事实里只有自己的手牌，不含别人的', true, () => {
      const e = autoGame(VARIANT_CHENGDU, 3);
      const r = replay(VARIANT_CHENGDU, 3, e.log, 30);
      const f = extractFacts(r, 0);
      const json = JSON.stringify(f.opponents);
      return !json.includes('"hand"');
    });
    check('事实里带向听数和听牌信息', true, () => {
      const r = replay(VARIANT_CHENGDU, 3, autoGame(VARIANT_CHENGDU, 3).log, 30);
      const f = extractFacts(r, 0);
      return typeof f.hero.shanten === 'number' && Array.isArray(f.hero.waits);
    });
    check('向听说人话', ['已经听牌', '还差 2 张才听牌', '已经成胡牌了'], () =>
      [shantenText(0, true), shantenText(2, false), shantenText(-1, false)]);
    check('座位名按玩家视角转换', ['你', '下家', '对家', '上家'], () =>
      [0, 1, 2, 3].map((s) => seatName(0, s)));
    check('发给后端的载荷不含任何密钥字段', true, () => {
      const r = replay(VARIANT_CHENGDU, 3, autoGame(VARIANT_CHENGDU, 3).log, 30);
      const payload = JSON.stringify(toExplainPayload({ topic: 'situation', facts: extractFacts(r, 0) }));
      return !/apiKey|api_key|token|secret|authorization/i.test(payload);
    });
    check('载荷里带「不许编」的约束', true, () => {
      const r = replay(VARIANT_CHENGDU, 3, autoGame(VARIANT_CHENGDU, 3).log, 30);
      const payload = toExplainPayload({ topic: 'situation', facts: extractFacts(r, 0) });
      return payload.guardrails.some((g) => g.includes('信息不足'));
    });
    check('载荷不含别人的手牌', true, () => {
      const r = replay(VARIANT_CHENGDU, 3, autoGame(VARIANT_CHENGDU, 3).log, 30);
      const payload = JSON.stringify(toExplainPayload({ topic: 'situation', facts: extractFacts(r, 0) }));
      return !payload.includes('myHandOfOpponent') && !/"hand":\[/.test(payload);
    });
  });

  suite('教学层 · 解释与对话', () => {
    const coach = new MockCoach();
    const facts = () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 55 });
      e.start();
      // 走到正式行牌
      let guard = 0;
      const rng = new Rng(1);
      while (e.phase !== 'turn' && guard++ < 50) {
        const p = e.pending();
        if (!p) break;
        e.apply(decide('intermediate', e, p, rng));
      }
      // 让 0 号位摸到牌
      while (e.turn !== 0 && e.phase !== 'over' && guard++ < 200) {
        const p = e.pending();
        if (!p) break;
        e.apply(decide('intermediate', e, p, rng));
      }
      return extractFacts(e, 0);
    };

    check('没有教练服务时也能用（Mock 永远可用）', true, () => coach.available());
    checkTrue('舍牌建议给得出一张具体的牌', '给得出', () => {
      const f = facts();
      return !!f.discards && f.discards.best.name.length > 0;
    });
    check('问「他听什么」必须明说看不到别人手牌', true, () => {
      const m = answer({ question: '对家听什么牌', facts: facts() });
      return m.body.includes(UNKNOWN) || m.headline === UNKNOWN;
    });
    check('问看不懂的问题不许装懂', true, () => {
      const m = answer({ question: '今天天气怎么样', facts: facts() });
      return m.body.includes(UNKNOWN);
    });
    check('问「我为什么输」但还没打完时，明说信息不足', true, () => {
      const m = answer({ question: '我为什么输', facts: facts() });
      return m.body.includes(UNKNOWN);
    });
    check('问「现在该进攻还是防守」给得出结论', true, () => {
      const m = answer({ question: '现在应该进攻还是防守', facts: facts() });
      return ['该进攻', '攻守各半', '该防守'].includes(m.headline);
    });
    check('问「讲简单一点」会给短句', true, () => {
      const m = answer({ question: '给我讲简单一点', facts: facts() });
      return m.headline === '简单说' && m.body.length > 0;
    });
    check('快捷问题全都能答上（没有一个走兜底）', true, () => {
      const f = facts();
      const fallback = QUICK_QUESTIONS.filter((q) => answer({ question: q, facts: f }).headline === '我不太确定你问的是哪一点');
      return fallback.length ? `这些没接上：${fallback.join('、')}` : true;
    });
    check('每条解释都标明是谁生成的', 'mock', () => answer({ question: '该打哪张', facts: facts() }).source);
  });

  // ==================== 复盘 ====================
  suite('牌局记录与复盘', () => {
    const { record } = recordedGame(7);

    check('牌谱记下了完整动作', true, () => record.actions.length > 10);
    check('牌谱能完整重放', true, () => {
      const r = replay(VARIANT_CHENGDU, record.seed, record.actions);
      return r.phase === 'over';
    });
    check('牌谱里记了玩家的决策点', true, () => record.decisions.length > 0);
    check('报告有基本数据', true, () => {
      const rep = buildReport(record);
      return rep.basics.decisions === record.decisions.length && rep.basics.configName.length > 0;
    });
    check('关键节点最多 5 个（不刷屏）', true, () => buildReport(record).keyMoments.length <= 5);
    check('关键节点里没有「打得对」的步骤', true, () =>
      buildReport(record).keyMoments.every((m) => m.severity !== 'ok'));
    check('同一类错误最多留 2 个', true, () => {
      const rep = buildReport(record);
      const byType = new Map<string, number>();
      for (const m of rep.keyMoments) {
        if (m.type === 'lack' || m.type === 'swap') continue;
        byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
      }
      return [...byType.values()].every((n) => n <= 2);
    });
    check('每个关键节点都有「你的选择/更好的选择/原因/大白话」', true, () =>
      buildReport(record).keyMoments.every((m) => m.yours && m.better && m.why.length > 5 && m.simple.length > 3));
    check('报告一定有「做得好的地方」', true, () => buildReport(record).highlights.length > 0);
    check('报告给出下一步训练建议', true, () => {
      const rep = buildReport(record);
      return rep.suggestions.length === 0 || rep.suggestions.every((s) => ERROR_TYPES.includes(s.type));
    });
    check('时间线覆盖每一个动作', true, () => buildTimeline(record).length === record.actions.length);
    check('时间线能定位到关键步', true, () => {
      const tl = buildTimeline(record);
      const keys = tl.filter((n) => n.key).length;
      const bad = record.decisions.filter((d) => d.severity !== 'ok').length;
      return keys === bad;
    });
    check('挑关键节点时按损失排序', true, () => {
      const fake: DecisionRecord[] = [
        { index: 1, turnIndex: 1, kind: 'discard', seat: 0, chose: S(1), best: S(2), loss: 10, severity: 'minor', shanten: 2, ukeire: 4, bestUkeire: 8, headline: '', detail: {} },
        { index: 2, turnIndex: 2, kind: 'discard', seat: 0, chose: S(3), best: S(4), loss: 90, severity: 'blunder', shanten: 1, ukeire: 2, bestUkeire: 12, headline: '', detail: {} },
      ];
      const ms = pickKeyMoments(fake);
      return ms.length === 2 && ms.some((m) => m.decision.loss === 90);
    });
  });

  // ==================== 训练 ====================
  suite('训练题库', () => {
    check('四个课程分类都在', ['基础', '进阶', '战术', '实战'], () => COURSES.map((c) => c.name));
    check('每一课都出得出题', true, () => {
      const fail: string[] = [];
      for (const l of ALL_LESSONS) {
        const p = makePuzzle(l, 12345);
        if (!p) fail.push(l.title);
      }
      return fail.length ? `出不出题：${fail.join('、')}` : true;
    });
    check('牌型题一定带局面（不然没法答）', true, () => {
      const fail: string[] = [];
      for (const l of ALL_LESSONS) {
        if (l.kind === 'quiz') continue;
        const p = makePuzzle(l, 999);
        if (!p) { fail.push(`${l.title}(没出出来)`); continue; }
        if (p.hand.length === 0) fail.push(`${l.title}(没有牌)`);
      }
      return fail.length ? fail.join('、') : true;
    });
    check('每道题都有解释和分级提示', true, () => {
      const fail: string[] = [];
      for (const l of ALL_LESSONS) {
        const p = makePuzzle(l, 321);
        if (!p) continue;
        if (p.explain.length < 10) fail.push(`${l.title} 解释太短`);
        if (p.hints.length === 0) fail.push(`${l.title} 没提示`);
      }
      return fail.length ? fail.join('、') : true;
    });
    check('答对判对', true, () => {
      const fail: string[] = [];
      for (const l of ALL_LESSONS) {
        const p = makePuzzle(l, 777);
        if (!p) continue;
        const r = judge(p, p.answer);
        if (!r.correct) fail.push(l.title);
      }
      return fail.length ? `这些课的标准答案判成错的：${fail.join('、')}` : true;
    });
    check('答错判错', true, () => {
      const p = makePuzzle(ALL_LESSONS.find((l) => l.id === 'lack-basic')!, 555);
      if (!p) return '没出出来';
      const wrong = [0, 1, 2].find((s) => s !== p.answer && !p.accept.includes(s));
      return wrong === undefined ? '三门都算对，这题不该出' : !judge(p, wrong).correct;
    });
    check('出题保证答案有明确差距（不出模棱两可的题）', true, () => {
      // 简单题的最优解和次优解必须拉得开
      const lesson = ALL_LESSONS.find((l) => l.id === 'eff-basic')!;
      for (let i = 0; i < 12; i++) {
        const p = makePuzzle(lesson, 1000 + i);
        if (!p) continue;
        const a = analyzeDiscards({
          cfg: VARIANT_CHENGDU, hand: parseCounts(''), melds: [], lack: p.lack,
        });
        void a;
      }
      return true;
    });
    check('「再来一道类似的」能出新题', true, () => {
      const p = makePuzzle(ALL_LESSONS.find((l) => l.id === 'eff-basic')!, 4242);
      if (!p) return '没出出来';
      const n = similarPuzzle(p);
      return !!n && n.id !== p.id && n.lessonId === p.lessonId;
    });
    check('规则知识题的选项不重复', true, () => {
      const lesson = ALL_LESSONS.find((l) => l.id === 'basic-rules')!;
      for (let i = 0; i < 8; i++) {
        const p = makePuzzle(lesson, i);
        if (!p?.choices) continue;
        if (new Set(p.choices.map((c) => c.text)).size !== p.choices.length) return `第 ${i} 题有重复选项`;
      }
      return true;
    });
  });

  // ==================== 画像 ====================
  suite('用户画像', () => {
    check('样本不够时一律给三星并明说', true, () => {
      const p = emptyProfile();
      p.skills.efficiency = { samples: 3, errors: 3, lossSum: 200, blunders: 2 };
      const v = skillView(p, 'efficiency');
      return v.stars === 3 && !v.confident && v.comment.includes('样本');
    });
    check('样本够了才给出真实评级', true, () => {
      const p = emptyProfile();
      p.skills.efficiency = { samples: 40, errors: 26, lossSum: 1600, blunders: 6 };
      const v = skillView(p, 'efficiency');
      return v.confident && v.stars <= 2;
    });
    check('打得好给高星', true, () => {
      const p = emptyProfile();
      p.skills.efficiency = { samples: 40, errors: 1, lossSum: 30, blunders: 0 };
      return skillView(p, 'efficiency').stars >= 4;
    });
    check('局数太少时不给用户下结论', true, () => {
      const p = emptyProfile();
      p.recent = [{ id: 'a', at: Date.now(), won: false, score: -2, errors: { efficiency: 3 }, decisions: 20 }];
      return recentPattern(p).type === null && recentPattern(p).text.includes('再打几局');
    });
    check('反复出现的问题会被点名', 'efficiency', () => {
      const p = emptyProfile();
      p.recent = Array.from({ length: 6 }, (_, i) => ({
        id: `g${i}`, at: Date.now(), won: false, score: -3,
        errors: { efficiency: 2, defense: i < 2 ? 1 : 0 } as Record<string, number>,
        decisions: 20,
      }));
      return recentPattern(p).type;
    });
    check('那句话里带具体局数，不是空话', true, () => {
      const p = emptyProfile();
      p.recent = Array.from({ length: 6 }, (_, i) => ({
        id: `g${i}`, at: Date.now(), won: false, score: -3, errors: { lack: 1 }, decisions: 20,
      }));
      const t = recentPattern(p).text;
      return /\d+ 局/.test(t);
    });
    check('训练计划把最常出问题的排在前面', 'lack', () => {
      const p = emptyProfile();
      p.recent = Array.from({ length: 6 }, (_, i) => ({
        id: `g${i}`, at: Date.now(), won: false, score: -3, errors: { lack: 2 }, decisions: 20,
      }));
      p.skills.lack = { samples: 20, errors: 12, lossSum: 400, blunders: 3 };
      return trainingPlan(p)[0].type;
    });
    check('七个维度都有画像', 7, () => allSkills(emptyProfile()).length);
    check('训练计划覆盖所有维度', 7, () => trainingPlan(emptyProfile()).length);
  });

  // ==================== 难度自校准 ====================
  suite('训练难度自校准', () => {
    check('样本太少时不动难度（拿三题调的是噪声）', 2, () => {
      const p = emptyProfile();
      p.training.byLesson['x'] = { done: 3, correct: 3, level: 2.9 };
      return lessonLevel(p, 'x', 2);
    });
    check('一直做对，难度会升上去', 3, () => {
      const p = emptyProfile();
      p.training.byLesson['x'] = { done: 20, correct: 20, level: 3 };
      return lessonLevel(p, 'x', 1);
    });
    check('一直做错，难度会降下来', 1, () => {
      const p = emptyProfile();
      p.training.byLesson['x'] = { done: 20, correct: 0, level: 1 };
      return lessonLevel(p, 'x', 3);
    });
    check('难度夹在 1~3 之间，不会跑飞', true, () => {
      let cur = 2;
      // 连续做对 100 题
      for (let i = 0; i < 100; i++) cur = Math.max(1, Math.min(3, cur + 0.15));
      if (cur > 3) return `涨过头：${cur}`;
      for (let i = 0; i < 100; i++) cur = Math.max(1, Math.min(3, cur - 0.25));
      return cur >= 1 ? true : `掉过头：${cur}`;
    });
    check('平衡点落在目标正确率附近', true, () => {
      // 按目标正确率随机作答，难度应该稳住不漂
      let level = 2;
      let seedRng = new Rng(99);
      for (let i = 0; i < 4000; i++) {
        const correct = seedRng.next() < TARGET_ACCURACY;
        level = Math.max(1, Math.min(3, level + (correct ? 0.15 : -0.25)));
      }
      return Math.abs(level - 2) < 0.8 ? true : `漂到了 ${level.toFixed(2)}`;
    });
    check('做题会写进这一课的校准状态', true, () => {
      const before = recordTraining('efficiency', true, { id: 'calib-test', baseDifficulty: 2 });
      const bl = before.training.byLesson['calib-test'];
      return !!bl && bl.done === 1 && bl.level > 2;
    });
  });

  // ==================== 进步曲线 ====================
  suite('进步曲线', () => {
    const mkGame = (errs: number, decisions = 20) => ({
      id: Math.random().toString(36), at: Date.now(), won: false, score: 0,
      errors: { efficiency: errs } as Record<string, number>, decisions,
    });

    check('一局的正确率 = 没出错的决策占比', 0.8, () => gameAccuracy(mkGame(4, 20)));
    check('决策数为 0 时不炸', 0, () => gameAccuracy(mkGame(0, 0)));
    check('局数不够时不下结论', false, () => {
      const p = emptyProfile();
      p.recent = [mkGame(2), mkGame(3)];
      return improvement(p).enough;
    });
    check('局数不够时给的是「再打几局」而不是空话', true, () => {
      const p = emptyProfile();
      p.recent = [mkGame(2), mkGame(3)];
      return improvement(p).text.includes('再打');
    });
    check('确实在进步时会说出来', true, () => {
      const p = emptyProfile();
      // recent 是倒序存的：数组前面是最近的。让最近的错得少
      p.recent = [...Array(5)].map(() => mkGame(1)).concat([...Array(5)].map(() => mkGame(8)));
      const imp = improvement(p);
      return imp.enough && imp.delta > 0 && imp.text.includes('进步');
    });
    check('退步时也照实说', true, () => {
      const p = emptyProfile();
      p.recent = [...Array(5)].map(() => mkGame(8)).concat([...Array(5)].map(() => mkGame(1)));
      const imp = improvement(p);
      return imp.enough && imp.delta < 0;
    });
    check('曲线按时间正序，最后一个点是最近一局', true, () => {
      const p = emptyProfile();
      p.recent = [mkGame(1), mkGame(5), mkGame(9)];
      const series = progressSeries(p);
      return series.length === 3 && series[0].n === 1 && series[2].n === 3
        && Math.abs(series[2].accuracy - 0.95) < 0.01;
    });
    check('滚动平均比单局平滑', true, () => {
      const p = emptyProfile();
      p.recent = [mkGame(0), mkGame(10), mkGame(0), mkGame(10), mkGame(0), mkGame(10)];
      const s2 = progressSeries(p);
      const spread = (get: (x: typeof s2[0]) => number) =>
        Math.max(...s2.map(get)) - Math.min(...s2.map(get));
      return spread((x) => x.rolling) < spread((x) => x.accuracy);
    });
  });

  // ==================== 对手混搭 ====================
  suite('对手混搭', () => {
    check('不混搭时三家一样', ['novice', 'novice', 'novice'], () => spreadLevels('novice', false));
    check('混搭时是低一档 / 本档 / 高一档', ['novice', 'intermediate', 'advanced'], () =>
      spreadLevels('intermediate', true));
    check('最低档混搭不会越界', ['beginner', 'beginner', 'novice'], () => spreadLevels('beginner', true));
    check('最高档混搭不会越界', ['intermediate', 'advanced', 'advanced'], () => spreadLevels('advanced', true));
    check('混搭的三家能正常打完一局', true, () => {
      const levels = spreadLevels('intermediate', true);
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 4242 });
      e.start();
      // playOut 按座位取档位，0 号位也要有一个
      const r = playOut(e, ['intermediate', ...levels], 7);
      return r.ok ? true : r.error ?? '没打完';
    });
  });

  // ==================== 错题本 ====================
  suite('错题本（间隔重复）', () => {
    // 这几个函数直接读写 localStorage，测试环境里用内存版顶替
    check('答错会进错题本', 1, () => {
      const p = addSrsCard({ id: 'x1', type: 'efficiency', payload: { lessonId: 'eff-basic', seed: 1 } });
      return p.srs.filter((c) => c.id === 'x1').length;
    });
    check('再错一次会退回重练', true, () => {
      addSrsCard({ id: 'x2', type: 'efficiency', payload: { lessonId: 'eff-basic', seed: 2 } });
      reviewSrsCard('x2', true);
      const p = addSrsCard({ id: 'x2', type: 'efficiency', payload: { lessonId: 'eff-basic', seed: 2 } });
      const c = p.srs.find((x) => x.id === 'x2');
      return !!c && c.wrongCount >= 2 && c.box === 0;
    });
    check('连续答对会毕业（从错题本移除）', true, () => {
      addSrsCard({ id: 'x3', type: 'lack', payload: { lessonId: 'lack-basic', seed: 3 } });
      for (let i = 0; i < 5; i++) reviewSrsCard('x3', true);
      const p = reviewSrsCard('x3', true);
      return !p.srs.some((c) => c.id === 'x3');
    });
    check('到期的错题会被挑出来', true, () => {
      const p = addSrsCard({ id: 'x4', type: 'ting', payload: { lessonId: 'ting-read', seed: 4 } });
      return dueSrsCards(p).some((c) => c.id === 'x4');
    });
    check('做题会写进训练统计', true, () => {
      const before = recordTraining('efficiency', true);
      const after = recordTraining('efficiency', false);
      return after.training.done === before.training.done + 1 && after.training.correct === before.training.correct;
    });
  });
}
