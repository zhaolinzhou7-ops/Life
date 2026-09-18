/**
 * AI 配置集中管理
 *
 * ⚠️ API Key 绝不进代码库，也绝不硬编码进前端构建产物。
 *
 * 这是一个纯静态站点，没有后端。所以这里采用的方案是：用户在设置页填自己的
 * **网关地址**，密钥由那个网关持有。填进来的地址只存在这台设备的 localStorage
 * 里，不会上传到任何地方。
 *
 * 如果用户想直接填 key（自己本地跑着代理、或者用完即走），也允许，但
 * 设置页会明确写清楚风险：填在浏览器里的东西，装了扩展的浏览器就能读到。
 *
 * 想接真实模型时要写的网关，契约见同目录 README.md。
 */

const KEY = 'naming-ai-config';

export interface AiConfig {
  /** 'local' 用本地引擎；'remote' 调用下面的网关 */
  mode: 'local' | 'remote';
  /** 网关地址，例如 https://your-worker.example.com/naming */
  endpoint: string;
  /** 可选的鉴权头。留空时不发 */
  token: string;
  /** 模型名，透传给网关，由网关决定怎么用 */
  model: string;
  /** 超时（毫秒） */
  timeoutMs: number;
}

export const DEFAULT_CONFIG: AiConfig = {
  mode: 'local',
  endpoint: '',
  token: '',
  model: '',
  timeoutMs: 30000,
};

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    // 隐私模式或数据损坏：用默认值，本地引擎照样能跑
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(c: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // 存不进去不影响这次会话使用
  }
}
