/**
 * AI 服务封装。
 *
 * 两条硬约束：
 *
 * 1. **API Key 绝对不能出现在前端。**
 *    前端代码是公开的，打包进去的密钥等于贴在网上。
 *    所以这里只允许调用「自己的后端地址」（VITE_MJ_COACH_API），
 *    由后端保管密钥、转发给模型厂商。代码里没有任何地方接受 apiKey 参数，
 *    这是故意的——留个口子迟早会有人用。
 *
 * 2. **没有后端也要能用。**
 *    默认走 Mock：用本地模板 + 规则引擎算出来的事实生成解释。
 *    Mock 不是占位符，它是正式功能——事实本来就是算出来的，
 *    模板只是把数字串成句子，讲清楚一步棋绰绰有余。
 *    接真模型的收益在于「对话更自然、能回答开放问题」，不在于「算得更准」。
 */

import type { SituationFacts, DecisionFacts } from './facts';

export interface CoachMessage {
  /** 一句话结论 */
  headline: string;
  /** 详细解释 */
  body: string;
  /** 大白话版本，用户点「讲简单一点」时给这个 */
  simple?: string;
  /** 依据（都来自规则引擎，可核对） */
  facts?: string[];
  /** 这条是谁生成的，界面上要标明 */
  source: 'mock' | 'remote';
}

export interface ExplainRequest {
  /** 解释什么 */
  topic: 'discard' | 'lack' | 'swap' | 'situation' | 'result';
  facts: SituationFacts;
  decision?: DecisionFacts;
  /** 用户要求的详细程度 */
  level?: 'normal' | 'simple';
}

export interface ChatRequest {
  question: string;
  facts: SituationFacts;
  /** 最近几条对话，给模型上下文 */
  history?: { role: 'user' | 'coach'; text: string }[];
  /** 本局报告，问「我为什么输」时要用 */
  report?: unknown;
}

export interface CoachProvider {
  id: 'mock' | 'remote';
  name: string;
  /** 现在能不能用 */
  available(): boolean;
  explain(req: ExplainRequest): Promise<CoachMessage>;
  chat(req: ChatRequest): Promise<CoachMessage>;
}

/**
 * 远程教练：把结构化事实发给**自己的后端**，后端再去调模型。
 *
 * 后端需要实现两个接口（约定很简单，自己写一个 20 行的转发服务即可）：
 *   POST {base}/explain  body: ExplainPayload  → { headline, body, simple? }
 *   POST {base}/chat     body: ChatPayload     → { headline, body, simple? }
 *
 * 发过去的只有算好的事实，不含任何密钥，也不含别人的手牌。
 */
export class RemoteProvider implements CoachProvider {
  readonly id = 'remote' as const;
  readonly name = '在线 AI 教练';
  private base: string;
  private timeoutMs: number;

  constructor(base: string, timeoutMs = 12000) {
    this.base = base.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  available(): boolean {
    return this.base.length > 0;
  }

  private async post(path: string, payload: unknown): Promise<CoachMessage> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`后端返回 ${res.status}`);
      const data = (await res.json()) as Partial<CoachMessage>;
      if (!data.body) throw new Error('后端返回的内容是空的');
      return {
        headline: data.headline ?? '',
        body: data.body,
        simple: data.simple,
        facts: data.facts,
        source: 'remote',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  explain(req: ExplainRequest) {
    return this.post('/explain', toExplainPayload(req));
  }

  chat(req: ChatRequest) {
    return this.post('/chat', toChatPayload(req));
  }
}

/**
 * 发给后端的载荷：只有算好的结论，没有原始局面。
 * 这样即使后端日志被人看到，也不包含可以反推别人手牌的信息。
 */
export function toExplainPayload(req: ExplainRequest) {
  const f = req.facts;
  return {
    topic: req.topic,
    level: req.level ?? 'normal',
    rule: f.configName,
    situation: {
      turn: f.turnIndex,
      wallLeft: f.wallLeft,
      myHand: f.hero.handText,
      myMelds: f.hero.meldsText,
      myLack: f.hero.lackName,
      shanten: f.hero.shanten,
      shantenText: f.hero.shantenText,
      ting: f.hero.ting,
      waits: f.hero.waitsText,
      structure: f.hero.structureText,
      stance: f.stance.text,
      opponents: f.opponents.map((o) => ({
        who: o.name, discards: o.discardsText, lack: o.lackName,
        melds: o.meldCount, maybeTing: o.tingGuess, out: o.outOfPlay,
      })),
    },
    options: (f.discards?.options ?? []).slice(0, 5).map((o) => ({
      tile: o.name, shanten: o.shanten, ukeire: o.ukeire,
      ting: o.ting, waits: o.waits.length, danger: Number(o.danger.toFixed(2)), role: o.role,
    })),
    decision: req.decision
      ? {
          chose: req.decision.chosenText,
          best: req.decision.bestText,
          same: req.decision.same,
          loss: req.decision.loss,
          severity: req.decision.severity,
          diffs: req.decision.diffs,
        }
      : null,
    /* 给后端提示词用：不许编，数据里没有就说不知道 */
    guardrails: [
      '所有数字必须来自 situation/options/decision，不得自行推算或虚构',
      '看不到别人的手牌，不许猜别人具体听什么牌',
      '数据里没有的信息，直接说「当前信息不足，无法确定」',
    ],
  };
}

export function toChatPayload(req: ChatRequest) {
  return {
    question: req.question,
    history: (req.history ?? []).slice(-6),
    ...toExplainPayload({ topic: 'situation', facts: req.facts }),
    report: req.report ?? null,
  };
}

/** 读配置：只读后端地址，读不到就用 Mock */
export function remoteEndpoint(): string {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    return env?.VITE_MJ_COACH_API ?? '';
  } catch {
    return '';
  }
}
