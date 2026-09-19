/**
 * AI 网关配置
 *
 * ⚠️ API Key 不进代码库，也不进前端构建产物（§24）。
 *
 * 这是一个纯静态站点，没有后端。所以方案是：家长在设置页填**自己的网关地址**，
 * 密钥由那个网关持有。填进来的地址只存在这台设备的 localStorage 里。
 *
 * 想直接在浏览器里填 key 的（本地跑着代理、或者用完即走）也允许，
 * 但设置页会把风险写明白：填在浏览器里的东西，装了扩展的浏览器就能读到。
 * 儿童产品尤其不该把这件事说得含糊。
 *
 * 网关契约见同目录 README.md。
 */

const KEY = 'english-ai-config';

export interface AiConfig {
  /** 'mock' 用内置引擎，完全离线；'remote' 调用下面的网关 */
  mode: 'mock' | 'remote';
  endpoint: string;
  token: string;
  model: string;
  timeoutMs: number;
}

export const DEFAULT_CONFIG: AiConfig = {
  mode: 'mock',
  endpoint: '',
  token: '',
  model: '',
  timeoutMs: 20000,
};

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    // 隐私模式或数据损坏：用默认值，Mock 照样跑
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(c: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // 存不进去不影响这次会话
  }
}
