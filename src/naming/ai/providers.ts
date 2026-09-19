/**
 * 两个 provider：本地引擎 与 远端模型
 *
 * 关键设计：远端模型**只提供候选名**，分析、评分、风险提示一律由本地引擎做。
 * 这样做的好处是：
 *   - 模型编不出假的出处和假的重名数据，因为那些字段根本不由它填
 *   - 模型挂了、超时了、返回了垃圾，随时可以降级回本地，用户不会看到空白页
 *   - 换模型不影响产品逻辑，Prompt 和引擎各自独立演进
 */

import type { NamingRequest, NamingResult } from '../types';
import { runPipeline } from '../engine';
import { understand } from '../engine/understand';
import { getChar } from '../data/chars';
import type { NamingProvider, ProviderContext } from './types';
import { buildMessages, parseResponse } from './prompt';
import { loadConfig } from './config';

export const localProvider: NamingProvider = {
  id: 'local',
  name: '本地引擎',
  available: () => ({ ok: true }),
  async run(req: NamingRequest, ctx: ProviderContext): Promise<NamingResult> {
    return runPipeline(req, { seed: ctx.seed });
  },
};

/** 名字里的字必须都在本地字库里，否则无法分析，就不该展示给用户 */
function usableGiven(given: string, req: NamingRequest): boolean {
  const g = given.trim();
  if (g.length < 1 || g.length > 2) return false;
  if (g.startsWith(req.surname)) return false; // 模型偶尔会把姓也带上
  return [...g].every((c) => !!getChar(c));
}

export const remoteProvider: NamingProvider = {
  id: 'remote',
  name: '远端模型',
  available() {
    const c = loadConfig();
    if (c.mode !== 'remote') return { ok: false, reason: '当前设置为使用本地引擎' };
    if (!c.endpoint) return { ok: false, reason: '还没有填写 AI 网关地址' };
    return { ok: true };
  },
  async run(req: NamingRequest, ctx: ProviderContext): Promise<NamingResult> {
    const cfg = loadConfig();
    const profile = understand(req);
    const msgs = buildMessages(req, profile, Math.max(ctx.count + 6, 16));

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    ctx.signal?.addEventListener('abort', () => ctl.abort());

    let text: string;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
      const resp = await fetch(cfg.endpoint, {
        method: 'POST',
        headers,
        signal: ctl.signal,
        body: JSON.stringify({ system: msgs.system, user: msgs.user, model: cfg.model || undefined }),
      });
      if (!resp.ok) throw new Error(`网关返回 ${resp.status}`);
      const data = (await resp.json()) as { text?: string; content?: string };
      text = data.text ?? data.content ?? '';
      if (!text) throw new Error('网关返回的内容是空的');
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseResponse(text);
    const injected = parsed.names
      .map((n) => n.given.trim())
      .filter((g) => usableGiven(g, req))
      .map((given) => ({ given }));

    // 模型给的名字照样走本地流水线，不开后门
    const result = runPipeline(req, { seed: ctx.seed, injected });
    result.engine = 'remote';
    const dropped = parsed.names.length - injected.length;
    if (dropped > 0) {
      result.profile.unknowns.push(
        `模型给的 ${parsed.names.length} 个名字里，有 ${dropped} 个用到了本地字库没有的字，没法做音律和字形分析，这一轮先没有展示。`,
      );
    }
    if (parsed.understanding) {
      result.profile.unknowns.push(`模型对需求的理解：${parsed.understanding}`);
    }
    return result;
  },
};

/** 按配置选 provider，远端不可用时自动降级回本地并说明原因 */
export async function runNaming(req: NamingRequest, ctx: ProviderContext): Promise<NamingResult> {
  const avail = remoteProvider.available();
  if (!avail.ok) return localProvider.run(req, ctx);
  try {
    return await remoteProvider.run(req, ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const r = await localProvider.run(req, ctx);
    r.fallbackNote = `调用 AI 网关失败（${msg}），这一轮用的是本地引擎。结果依然可用，只是少了模型的创意补充。`;
    return r;
  }
}
