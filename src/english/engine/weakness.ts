/**
 * 薄弱点检测
 *
 * 这是「AI 个性化」真正落地的地方（§20）。系统必须能回答一个很具体的问题：
 * **这个孩子到底哪里不会。**
 *
 * 四种典型画像，产品需求里点名要能区分，这里逐个实现：
 *   A 词汇不错但不愿开口  → lowPressure：多选择题和跟读，少自由表达
 *   B 敢说但词汇少        → 加词汇输入量
 *   C 词汇不错但听不懂    → 加听力输入
 *   D 经常混淆颜色        → 自动生成颜色专项
 *
 * 每条薄弱点都必须带 evidence——一句能指回原始数据的话。
 * 家长问「你凭什么说我孩子听力弱」，答案是「最近 12 次听音选图错了 7 次」，
 * 而不是「AI 分析显示」。
 */

import type { EnglishProfile, SkillId, ThemeId, WordMemory } from '../types';
import { getWord } from '../data/vocab';
import { themeLabel } from '../data/vocab';
import { skillLabelZh } from './profile';
import { clamp } from './util';

export interface Prescription {
  boostSkills: SkillId[];
  boostThemes: ThemeId[];
  focusWordIds: string[];
  /** 降低开口压力：优先选择题、跟读，避免自由表达 */
  lowPressure: boolean;
  /** 给家长的一句建议 */
  note: string;
}

export interface Weakness {
  id: string;
  kind: 'skill' | 'theme' | 'word' | 'behavior';
  /** 家长端标题，中文 */
  title: string;
  /** 凭什么这么判断。必须指得回原始数据 */
  evidence: string;
  /** 0~1，用于排序，不展示成分数 */
  severity: number;
  prescription: Prescription;
}

function emptyRx(note: string): Prescription {
  return { boostSkills: [], boostThemes: [], focusWordIds: [], lowPressure: false, note };
}

/**
 * 主检测。输入是能力画像 + 全部词记忆，输出按严重度排序的薄弱点。
 *
 * 阈值都写成常量并在测试里钉住：改阈值会改变所有孩子的学习计划，
 * 这种改动应该是显式的。
 */
export function detectWeakness(p: EnglishProfile, mems: WordMemory[], now = Date.now()): Weakness[] {
  const out: Weakness[] = [];
  const seen = mems.filter((m) => m.seen >= 2);

  // ——— 1. 维度落差：某一项明显低于自己的其它项 ———
  const dims: { id: SkillId; v: number }[] = [
    { id: 'listening', v: p.listening },
    { id: 'speaking', v: p.speaking },
    { id: 'vocabulary', v: p.vocabulary },
    { id: 'comprehension', v: p.comprehension },
    { id: 'pronunciation', v: p.pronunciation },
    { id: 'retention', v: p.retention },
  ];
  const avg = dims.reduce((a, d) => a + d.v, 0) / dims.length;
  for (const d of dims) {
    const gap = avg - d.v;
    if (gap < 9) continue;
    const rx = emptyRx('');
    rx.boostSkills = [d.id];
    if (d.id === 'speaking' || d.id === 'pronunciation') {
      // 口语落后时不是加压，而是降压：多跟读、多选择，让他先敢开口
      rx.lowPressure = true;
      rx.note = '口语比其它方面弱。先别急着要求说整句，多做跟读和"听到就指出来"这类低压力练习，等愿意开口了再加长度。';
    } else if (d.id === 'listening') {
      rx.note = '听力是短板。每天的听音找图和故事朗读要保证，比背新词更重要。';
    } else if (d.id === 'vocabulary') {
      rx.note = '认识的词偏少，先把日常高频词铺开，再去追求说长句。';
    } else if (d.id === 'retention') {
      rx.note = '学过的词容易忘。系统已经自动加密复习频率，家长只需保证每天都学，别隔太久。';
    } else {
      rx.note = `${skillLabelZh(d.id)}相对落后，这周会多安排相关练习。`;
    }
    out.push({
      id: `skill-${d.id}`,
      kind: 'skill',
      title: `${skillLabelZh(d.id)}明显落后于其它方面`,
      evidence: `八项能力平均在 ${Math.round(avg)} 左右，${skillLabelZh(d.id)}只有 ${Math.round(d.v)}。`,
      severity: clamp(gap / 30, 0.2, 1),
      prescription: rx,
    });
  }

  // ——— 2. 行为：频繁放弃 / 不肯开口 ———
  const sig = p.participation;
  const totalTries = sig.attempts + sig.skips;
  if (totalTries >= 10 && sig.skips / totalTries >= 0.28) {
    const rx = emptyRx('遇到不会的容易直接跳过。这几天会把题目难度降一档，先把"我能答对"的体验找回来。');
    rx.lowPressure = true;
    out.push({
      id: 'behavior-skip',
      kind: 'behavior',
      title: '遇到不会的容易放弃',
      evidence: `最近 ${totalTries} 次作答里跳过了 ${sig.skips} 次。`,
      severity: clamp(sig.skips / totalTries, 0.3, 1),
      prescription: rx,
    });
  }
  const speakTotal = sig.voluntarySpeak + sig.promptedSpeak;
  if (sig.attempts >= 12 && speakTotal <= sig.attempts * 0.25) {
    const rx = emptyRx('很少主动开口。跟读环节会先放一遍示范再邀请，答不上来也不追问，别在家里催他说。');
    rx.lowPressure = true;
    rx.boostSkills = ['speaking'];
    out.push({
      id: 'behavior-silent',
      kind: 'behavior',
      title: '不太愿意开口',
      evidence: `作答 ${sig.attempts} 次，其中只有 ${speakTotal} 次开口说话。`,
      severity: 0.6,
      prescription: rx,
    });
  }

  // ——— 3. 主题聚集的错误：比如总是混淆颜色 ———
  const byTheme = new Map<ThemeId, { wrong: number; seen: number; ids: string[] }>();
  for (const m of seen) {
    const w = getWord(m.wordId);
    if (!w) continue;
    const t = byTheme.get(w.theme) ?? { wrong: 0, seen: 0, ids: [] };
    t.wrong += m.wrong;
    t.seen += m.seen;
    if (m.wrong >= 2) t.ids.push(m.wordId);
    byTheme.set(w.theme, t);
  }
  for (const [theme, t] of byTheme) {
    if (t.seen < 8) continue;
    const rate = t.wrong / t.seen;
    if (rate < 0.3) continue;
    // 主题名直接嵌进句子会读不通（「我自己这一类…」），加引号才是一句人话
    const rx = emptyRx(`「${themeLabel(theme)}」这组词错得比较集中，已经自动排了专项练习。`);
    rx.boostThemes = [theme];
    rx.focusWordIds = t.ids;
    out.push({
      id: `theme-${theme}`,
      kind: 'theme',
      title: `「${themeLabel(theme)}」这组词容易混淆`,
      evidence: `这一类词一共练了 ${t.seen} 次，错了 ${t.wrong} 次。`,
      severity: clamp(rate, 0.3, 1),
      prescription: rx,
    });
  }

  // ——— 4. 错误环节归因：同一批词，错在"听"还是错在"认" ———
  const stage = { recognize: 0, listen: 0, speak: 0, use: 0 };
  for (const m of seen) {
    stage.recognize += m.errors.recognize;
    stage.listen += m.errors.listen;
    stage.speak += m.errors.speak;
    stage.use += m.errors.use;
  }
  const stageTotal = stage.recognize + stage.listen + stage.speak + stage.use;
  if (stageTotal >= 6) {
    const worst = (Object.entries(stage) as [keyof typeof stage, number][]).sort((a, b) => b[1] - a[1])[0];
    if (worst[1] / stageTotal >= 0.45) {
      const map: Record<keyof typeof stage, { title: string; skill: SkillId; note: string }> = {
        listen: { title: '错误集中在"听不出来"', skill: 'listening', note: '看图认得出，但一听就懵。会增加听力输入和听音找图，少加新词。' },
        recognize: { title: '错误集中在"看图认不出"', skill: 'vocabulary', note: '词本身还没记住。会增加图片配对和故事里的复现。' },
        speak: { title: '错误集中在"说不出来"', skill: 'speaking', note: '听得懂但说不出。会增加跟读，先跟读整句再要求自己说。' },
        use: { title: '错误集中在"不会用"', skill: 'sentence', note: '单个词会，放进句子就不会。会增加故事提问和对话练习。' },
      };
      const info = map[worst[0]];
      const rx = emptyRx(info.note);
      rx.boostSkills = [info.skill];
      if (worst[0] === 'speak') rx.lowPressure = true;
      out.push({
        id: `stage-${worst[0]}`,
        kind: 'skill',
        title: info.title,
        evidence: `最近 ${stageTotal} 次错误里，有 ${worst[1]} 次发生在这个环节。`,
        severity: clamp(worst[1] / stageTotal, 0.3, 1),
        prescription: rx,
      });
    }
  }

  // ——— 5. 具体的顽固词 ———
  const stubborn = seen
    .filter((m) => m.wrong >= 3 && m.wrong > m.correct)
    .sort((a, b) => b.wrong - a.wrong)
    .slice(0, 6);
  if (stubborn.length >= 2) {
    const names = stubborn.map((m) => getWord(m.wordId)?.en ?? m.wordId);
    const rx = emptyRx(`这几个词反复出错：${names.join('、')}。已经排进每天的复习里，会换图片、语音、故事等不同方式重复。`);
    rx.focusWordIds = stubborn.map((m) => m.wordId);
    out.push({
      id: 'word-stubborn',
      kind: 'word',
      title: '有几个词一直记不住',
      evidence: `${names.join('、')} 各自错了 3 次以上。`,
      severity: 0.7,
      prescription: rx,
    });
  }

  // 不用 now，但保留参数以便将来加入"最近 N 天"的时间窗
  void now;
  return out.sort((a, b) => b.severity - a.severity);
}

/** 把多条薄弱点的处方合并成一份，供任务生成器使用 */
export function mergePrescriptions(ws: Weakness[]): Prescription {
  const rx = emptyRx('');
  const notes: string[] = [];
  for (const w of ws) {
    for (const s of w.prescription.boostSkills) if (!rx.boostSkills.includes(s)) rx.boostSkills.push(s);
    for (const t of w.prescription.boostThemes) if (!rx.boostThemes.includes(t)) rx.boostThemes.push(t);
    for (const id of w.prescription.focusWordIds) if (!rx.focusWordIds.includes(id)) rx.focusWordIds.push(id);
    if (w.prescription.lowPressure) rx.lowPressure = true;
    if (w.prescription.note) notes.push(w.prescription.note);
  }
  rx.note = notes.slice(0, 3).join(' ');
  return rx;
}
