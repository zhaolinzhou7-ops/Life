/**
 * OpenAI 兼容接口适配器（/chat/completions）。
 *
 * 覆盖 OpenAI、DeepSeek、Kimi、豆包方舟、通义、智谱、Groq，
 * 以及 Ollama / LM Studio 这类本机服务——它们的请求体形状是一样的。
 * 这类服务没有官方浏览器 SDK，所以直接用 fetch 调 REST。
 */

import type { AIProvider, CoachRequest, ProviderConfig } from '../provider';

interface ChatChoice {
  message?: { content?: string };
}
interface ChatResponse {
  choices?: ChatChoice[];
  error?: { message?: string };
}

export function createOpenAIProvider(cfg: ProviderConfig): AIProvider {
  return {
    id: `openai:${cfg.model}`,
    label: `${cfg.model}`,
    async complete(req: CoachRequest, signal?: AbortSignal): Promise<string> {
      const base = cfg.baseUrl.replace(/\/+$/, '');
      if (!base) throw new Error('没有填接口地址');
      if (!cfg.model) throw new Error('没有填模型名');

      const headers: Record<string, string> = { 'content-type': 'application/json' };
      // 本机服务（Ollama 等）通常不需要 Key，留空就不发这个头
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: req.maxTokens ?? 1400,
          temperature: 0.4,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const j = (await res.json()) as ChatResponse;
          detail = j.error?.message ?? '';
        } catch {
          detail = await res.text().catch(() => '');
        }
        throw new Error(`HTTP ${res.status} ${detail}`.trim());
      }

      const data = (await res.json()) as ChatResponse;
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('接口返回里没有内容');
      return text;
    },
  };
}
