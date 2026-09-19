/**
 * 本地存档
 *
 * 全部存在这台设备的 localStorage 里。**没有服务器，没有账号，不上传任何东西。**
 * 这是儿童产品在隐私上能做的最直接的选择（§24）：数据不离开设备，
 * 就不存在「被用于不必要的第三方用途」的可能。
 *
 * 几条硬规则：
 *  · 语音音频永远不写入存储，任何分支都没有。只有转写文本，而且转写文本
 *    默认也不存——家长在设置里主动打开 keepTranscripts 才会保留。
 *  · 写不进去（隐私模式、配额满）时产品照常能用，只是关掉页面就没了。
 *    不弹「请开启存储权限」的框——那对家长毫无意义。
 *  · 提供一键删除。不是把 key 置空，是真的 removeItem。
 *
 * 学习记录会按 90 天滚动裁剪：家长需要的是趋势，不是三年前的流水账，
 * 而且 localStorage 有配额，留着早晚会写满。
 */

import type { ChildProfile, DailyMission, SessionRecord, WordMemory } from './types';
import { dayKey, daysBetween } from './engine/util';

const KEY = 'english-save';
const VERSION = 1;

export interface ChildData {
  profile: ChildProfile;
  memories: WordMemory[];
  sessions: SessionRecord[];
  /** 今天的任务缓存。同一天重进不重新生成 */
  mission?: DailyMission;
  /** 读过的故事，用于选故事时降权 */
  readStories: string[];
  /** 对话转写。只有 settings.keepTranscripts=true 时才有内容 */
  transcripts: { at: number; role: 'coach' | 'child'; text: string }[];
}

export interface SaveData {
  version: number;
  children: ChildData[];
  activeId?: string;
  /** 家长验证用。存的是很弱的混淆值，不是安全措施，见 parent/gate.ts 的说明 */
  parentPin?: string;
  /** 是否已经看过首次引导 */
  onboarded: boolean;
}

/**
 * 空存档必须每次新建。
 *
 * 之前这里是一个模块级常量加 `{ ...EMPTY }` 展开——那是浅拷贝，
 * children 数组是同一个引用。于是「读到空存档 → push 一个孩子」
 * 会把那个孩子永久留在这个常量里，下一次读空存档时他又冒出来。
 * 删完数据再建档会看见幽灵档案，就是这么来的。
 */
function emptySave(): SaveData {
  return { version: VERSION, children: [], onboarded: false };
}

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptySave();
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      version: d.version ?? VERSION,
      children: Array.isArray(d.children) ? (d.children as ChildData[]) : [],
      activeId: d.activeId,
      parentPin: d.parentPin,
      onboarded: !!d.onboarded,
    };
  } catch {
    // 存档损坏：当作没存过，不让一个坏 JSON 把整个产品挡在门外
    return emptySave();
  }
}

function write(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // 配额满 / 隐私模式。这次会话照常能用
  }
}

export function loadAll(): SaveData {
  return read();
}

export function isOnboarded(): boolean {
  return read().onboarded;
}

export function setOnboarded(v: boolean): void {
  const d = read();
  d.onboarded = v;
  write(d);
}

export function listChildren(): ChildProfile[] {
  return read().children.map((c) => c.profile);
}

export function activeChildId(): string | undefined {
  const d = read();
  if (d.activeId && d.children.some((c) => c.profile.id === d.activeId)) return d.activeId;
  return d.children[0]?.profile.id;
}

export function setActiveChild(id: string): void {
  const d = read();
  if (d.children.some((c) => c.profile.id === id)) {
    d.activeId = id;
    write(d);
  }
}

export function getChildData(id?: string): ChildData | undefined {
  const d = read();
  const wanted = id ?? d.activeId ?? d.children[0]?.profile.id;
  return d.children.find((c) => c.profile.id === wanted);
}

export function addChild(profile: ChildProfile): ChildData {
  const d = read();
  const entry: ChildData = {
    profile,
    memories: [],
    sessions: [],
    readStories: [],
    transcripts: [],
  };
  d.children.push(entry);
  d.activeId = profile.id;
  d.onboarded = true;
  write(d);
  return entry;
}

export function saveChild(data: ChildData): void {
  const d = read();
  const i = d.children.findIndex((c) => c.profile.id === data.profile.id);
  // 90 天以外的会话记录不再保留：家长要的是趋势，不是流水账
  const today = dayKey();
  const trimmed: ChildData = {
    ...data,
    sessions: data.sessions.filter((s) => daysBetween(s.date, today) <= 90).slice(-200),
    transcripts: data.profile.settings.keepTranscripts ? data.transcripts.slice(-120) : [],
    readStories: data.readStories.slice(-60),
  };
  if (i >= 0) d.children[i] = trimmed;
  else d.children.push(trimmed);
  write(d);
}

export function removeChild(id: string): void {
  const d = read();
  d.children = d.children.filter((c) => c.profile.id !== id);
  if (d.activeId === id) d.activeId = d.children[0]?.profile.id;
  write(d);
}

/** 家长验证码。见 parent/gate.ts 里关于「这不是安全措施」的说明 */
export function getParentPin(): string | undefined {
  return read().parentPin;
}

export function setParentPin(pin: string | undefined): void {
  const d = read();
  d.parentPin = pin;
  write(d);
}

/**
 * 删除全部数据。
 *
 * 不是清空字段，是真的把 key 从 localStorage 里去掉。
 * 家长点了「删除」，就应该什么都不剩。
 */
export function eraseEverything(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 删不掉也要让调用方继续走完 UI 流程
  }
}

/** 估算已经占了多少存储，家长端展示用 */
export function storageSize(): number {
  try {
    return (localStorage.getItem(KEY) ?? '').length;
  } catch {
    return 0;
  }
}
