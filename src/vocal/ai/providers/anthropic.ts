/**
 * Anthropic Claude 适配器。
 *
 * 走官方 SDK（@anthropic-ai/sdk）而不是手搓 fetch。SDK 是动态 import 的：
 * 用户没选 Claude 时这个 chunk 根本不会下载，不影响首屏。
 *
 * 浏览器直连需要 dangerouslyAllowBrowser。这在本应用里是成立的——
 * 用的是**用户自己的 Key、跑在用户自己的浏览器里**，没有第三方能看到它；
 * 但设置页面必须把这一点写清楚，不能让用户以为 Key 存在我们这儿。
 */

import type { AIProvider, CoachRequest, ProviderConfig } from '../provider';

export function createAnthropicProvider(cfg: ProviderConfig): AIProvider {
  return {
    id: `anthropic:${cfg.model}`,
    label: cfg.model,
    async complete(req: CoachRequest, signal?: AbortSignal): Promise<string> {
      if (!cfg.apiKey) throw new Error('没有填 API Key');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseUrl || undefined,
        dangerouslyAllowBrowser: true,
      });

      const res = await client.messages.create(
        {
          model: cfg.model || 'claude-opus-5',
          max_tokens: req.maxTokens ?? 1400,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          // 这是一个短小的结构化生成任务，不需要深想，低 effort 更快更省
          output_config: { effort: 'low' },
        },
        { signal },
      );

      if (res.stop_reason === 'refusal') {
        throw new Error('模型拒绝了这次请求');
      }
      const text = res.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      if (!text.trim()) throw new Error('接口返回里没有内容');
      return text;
    },
  };
}
