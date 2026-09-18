/**
 * AI Provider 抽象。
 *
 * 业务逻辑只认识 `AIProvider` 这个接口，不认识任何具体厂商。
 * 换模型 = 换一份配置，不需要改教学层一行代码。
 *
 * 隐私：API Key 只存在本机 localStorage，只发往用户自己配置的那个地址。
 * 请求体里只有**结构化指标**（音分、毫秒、分数），永远不包含录音。
 */

export interface CoachRequest {
  system: string;
  user: string;
  /** 输出长度上限 */
  maxTokens?: number;
}

export interface AIProvider {
  id: string;
  label: string;
  /** 生成文本。失败时抛出带人话说明的 Error */
  complete(req: CoachRequest, signal?: AbortSignal): Promise<string>;
}

export type ProviderKind = 'mock' | 'openai' | 'anthropic';

export interface ProviderConfig {
  /** 预设 ID，或 'custom' */
  preset: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  /** 去哪儿申请 Key */
  keyHint: string;
  /** 额外说明 */
  note?: string;
}

/**
 * 预设列表。
 *
 * 绝大多数厂商都提供 OpenAI 兼容的 /chat/completions，所以一个
 * openai 适配器就能覆盖一大片；Anthropic 的 Messages API 形状不同，
 * 单独走官方 SDK。想接没列出来的模型，选「自定义」填地址即可。
 */
export const PRESETS: ProviderPreset[] = [
  {
    id: 'mock',
    label: '内置教练（不联网，默认）',
    kind: 'mock',
    baseUrl: '',
    model: '',
    keyHint: '不需要 API Key',
    note: '规则引擎生成反馈。结论完全来自本次录音的分析数据，不需要联网、不上传任何东西。功能完整可用。',
  },
  {
    id: 'claude',
    label: 'Claude（Anthropic）',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    keyHint: 'console.anthropic.com',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyHint: 'platform.openai.com',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyHint: 'platform.deepseek.com',
  },
  {
    id: 'kimi',
    label: 'Kimi（月之暗面）',
    kind: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    keyHint: 'platform.moonshot.cn',
  },
  {
    id: 'doubao',
    label: '豆包（火山方舟）',
    kind: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    keyHint: 'console.volcengine.com/ark',
    note: '模型一栏填你在方舟创建的「接入点 ID」（ep- 开头），不是模型名。',
  },
  {
    id: 'local',
    label: '本机模型（Ollama / LM Studio）',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    keyHint: '本机服务通常不需要 Key',
    note: '完全离线。需要本机服务开启 CORS 允许浏览器访问。',
  },
  {
    id: 'custom',
    label: '自定义（任何 OpenAI 兼容接口）',
    kind: 'openai',
    baseUrl: '',
    model: '',
    keyHint: '按你所用服务的文档填写',
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

export const DEFAULT_CONFIG: ProviderConfig = {
  preset: 'mock',
  kind: 'mock',
  baseUrl: '',
  model: '',
  apiKey: '',
};

/** 把网络错误翻译成用户看得懂的话 */
export function explainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/401|403|invalid.*key|unauthor/i.test(msg)) return 'API Key 不对或没有权限，检查一下是否填错、是否已过期。';
  if (/429|rate.?limit|quota/i.test(msg)) return '调用太频繁或额度用完了，过一会儿再试。';
  if (/404|not found|model/i.test(msg)) return '模型名不对——确认一下这个服务商支持你填的模型 ID。';
  if (/CORS|Failed to fetch|NetworkError|ERR_/i.test(msg))
    return '连不上这个接口。可能是地址填错、网络不通，或者该服务不允许浏览器直接调用（CORS）。';
  if (/abort/i.test(msg)) return '请求被取消了。';
  return msg || '调用失败，原因未知。';
}
