/**
 * AI 配置
 *
 * ⚠️ 这是一个纯静态站点，构建产物是公开文件。**任何 API Key 都不能出现在
 * 这个仓库里，也不能硬编码进前端。** 谁都能在浏览器里看到里面的字符串。
 *
 * 所以走的是网关方案：
 *
 *     浏览器 ──POST──> 你自己的网关（持有 Key） ──> 模型 API
 *
 * 用户在设置页里填的是**网关地址**，只存在这台设备的 localStorage 里，
 * 不会上传到任何地方。网关契约见同目录 README.md。
 *
 * 默认是 local（Mock 模式）：不填任何东西，产品的每一个功能都能跑完整流程，
 * 因为纠错、评分、场景推进、间隔复习全部在本地。模型是加分项，不是前提。
 */

const KEY = 'coach-ai-config';

export interface AiConfig {
  /** 'local' 只用本地引擎；'remote' 调用网关，失败自动降级回本地 */
  mode: 'local' | 'remote';
  /** 网关地址，例如 https://your-worker.example.com/coach */
  endpoint: string;
  /** 可选的鉴权头，留空时不发 */
  token: string;
  /** 模型名，透传给网关 */
  model: string;
  timeoutMs: number;
}

export const DEFAULT_CONFIG: AiConfig = {
  mode: 'local',
  endpoint: '',
  token: '',
  model: '',
  timeoutMs: 20000,
};

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AiConfig>;
      const cfg = { ...DEFAULT_CONFIG, ...parsed };
      // 超时必须是个合理的正数，否则一个坏存档能让所有请求立刻失败
      if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1000) cfg.timeoutMs = DEFAULT_CONFIG.timeoutMs;
      if (cfg.mode !== 'remote') cfg.mode = 'local';
      return cfg;
    }
  } catch {
    // 隐私模式或存档损坏：用默认值，本地引擎照样跑
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

/** 远端现在能不能用；不能用时说明原因，界面直接显示这句话 */
export function remoteAvailable(cfg = loadConfig()): { ok: boolean; reason?: string } {
  if (cfg.mode !== 'remote') return { ok: false, reason: '当前设置为只用本地引擎' };
  if (!cfg.endpoint.trim()) return { ok: false, reason: '还没有填写 AI 网关地址' };
  if (!/^https?:\/\//i.test(cfg.endpoint.trim())) return { ok: false, reason: '网关地址要以 http:// 或 https:// 开头' };
  return { ok: true };
}
