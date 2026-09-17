/**
 * AI 调用层 · 接口契约
 *
 * 分层的原则：**AI 负责创意，本地引擎负责把关**。
 *
 * 模型擅长的是想出人想不到的组合、写出贴合这家人的解释；不擅长的是稳定地
 * 遵守约束、不编出处、不重复、不把生僻字当高级。所以远端模型只被允许提出
 * 候选名，提出来之后照样要走本地的过滤和六维评分，一个后门都不留。
 */

import type { NamingRequest, NamingResult } from '../types';

export interface ProviderContext {
  /** 要几个候选 */
  count: number;
  /** 换一批时的种子 */
  seed: number;
  signal?: AbortSignal;
}

export interface NamingProvider {
  id: 'local' | 'remote';
  name: string;
  /** 这个 provider 现在能不能用；不能用时说明原因 */
  available(): { ok: boolean; reason?: string };
  run(req: NamingRequest, ctx: ProviderContext): Promise<NamingResult>;
}

/** 远端模型被要求返回的结构。字段刻意少——分析是本地做的，不用模型算分 */
export interface RemoteNameSuggestion {
  given: string;
  /** 模型给的取名理由，会作为补充展示，但不替代本地分析 */
  why?: string;
}

export interface RemoteResponse {
  names: RemoteNameSuggestion[];
  /** 模型对需求的理解，用来和本地理解做对照 */
  understanding?: string;
}
