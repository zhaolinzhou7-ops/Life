/**
 * 内置曲库。
 *
 * 版权边界（重要）：这里**只**收录公有领域的旋律，并且是我们自己按简谱
 * 重新编写的单声部简化版；伴奏由 Web Audio 实时合成，不含任何录音制品。
 * 应用不抓取、不内置、也不提供任何未授权的音乐资源。想练流行歌的用户，
 * 走「用自己的录音」那条路（自由演唱模式），我们只分析他的嗓音。
 *
 * 每首歌按 Intro / Verse / Chorus / Bridge / Outro 分段，
 * 段落既用来做「分段练习」，也用来做复盘时的定位（「副歌那几个高音」）。
 */

import type { Reference, RefNote, SectionKind } from '../analysis/types';

export interface SongNote {
  /** MIDI 音高，0 = 休止 */
  m: number;
  /** 时值（拍） */
  d: number;
  /** 歌词字；空串表示上一个字的延音 */
  ly?: string;
}

export interface SongSection {
  kind: SectionKind;
  /** 段落显示名，不填用默认名 */
  name?: string;
  /** 乐句列表；每个乐句是一串音符 */
  phrases: SongNote[][];
  /** 纯伴奏段落（前奏/间奏/尾奏）：播但不评分 */
  instrumental?: boolean;
}

export interface Song {
  id: string;
  name: string;
  emoji: string;
  level: '入门' | '简单' | '进阶';
  bpm: number;
  /** 来源说明，界面上要显示，让用户知道我们没在灰色地带 */
  source: string;
  sections: SongSection[];
}

// 简谱度数 → 相对 C 的半音数（1=do … 7=ti）
const DEG = [0, 0, 2, 4, 5, 7, 9, 11];

/** n(度数, 拍数, 歌词, 八度偏移, 变音) —— 度数 0 为休止 */
function n(deg: number, d: number, ly = '', oct = 0, acc = 0): SongNote {
  return { m: deg === 0 ? 0 : 60 + DEG[deg] + oct * 12 + acc, d, ly };
}
/** 休止 */
const r = (d: number): SongNote => ({ m: 0, d });

const DEFAULT_NAME: Record<SectionKind, string> = {
  intro: '前奏',
  verse: '主歌',
  prechorus: '导歌',
  chorus: '副歌',
  bridge: '桥段',
  outro: '尾声',
};

export const SONGS: Song[] = [
  {
    id: 'star',
    name: '小星星',
    emoji: '⭐',
    level: '入门',
    bpm: 96,
    source: '公有领域（法国童谣 Ah! vous dirai-je, maman，18 世纪）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(1, 1, '一'), n(1, 1, '闪'), n(5, 1, '一'), n(5, 1, '闪'), n(6, 1, '亮'), n(6, 1, '晶'), n(5, 2, '晶')],
          [n(4, 1, '满'), n(4, 1, '天'), n(3, 1, '都'), n(3, 1, '是'), n(2, 1, '小'), n(2, 1, '星'), n(1, 2, '星')],
        ],
      },
      {
        kind: 'bridge',
        phrases: [
          [n(5, 1, '挂'), n(5, 1, '在'), n(4, 1, '天'), n(4, 1, '上'), n(3, 1, '放'), n(3, 1, '光'), n(2, 2, '明')],
          [n(5, 1, '好'), n(5, 1, '像'), n(4, 1, '许'), n(4, 1, '多'), n(3, 1, '小'), n(3, 1, '眼'), n(2, 2, '睛')],
        ],
      },
      {
        kind: 'outro',
        name: '尾段',
        phrases: [
          [n(1, 1, '一'), n(1, 1, '闪'), n(5, 1, '一'), n(5, 1, '闪'), n(6, 1, '亮'), n(6, 1, '晶'), n(5, 2, '晶')],
          [n(4, 1, '满'), n(4, 1, '天'), n(3, 1, '都'), n(3, 1, '是'), n(2, 1, '小'), n(2, 1, '星'), n(1, 2, '星')],
        ],
      },
    ],
  },
  {
    id: 'tiger',
    name: '两只老虎',
    emoji: '🐯',
    level: '入门',
    bpm: 108,
    source: '公有领域（法国民谣 Frère Jacques）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(1, 1, '两'), n(2, 1, '只'), n(3, 1, '老'), n(1, 1, '虎'), n(1, 1, '两'), n(2, 1, '只'), n(3, 1, '老'), n(1, 1, '虎')],
          [n(3, 1, '跑'), n(4, 1, '得'), n(5, 2, '快'), n(3, 1, '跑'), n(4, 1, '得'), n(5, 2, '快')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(5, 0.5, '一'), n(6, 0.5, '只'), n(5, 0.5, '没'), n(4, 0.5, '有'), n(3, 1, '眼'), n(1, 1, '睛'), n(5, 0.5, '一'), n(6, 0.5, '只'), n(5, 0.5, '没'), n(4, 0.5, '有'), n(3, 1, '尾'), n(1, 1, '巴')],
          [n(1, 1, '真'), n(5, 1, '奇', -1), n(1, 2, '怪'), n(1, 1, '真'), n(5, 1, '奇', -1), n(1, 2, '怪')],
        ],
      },
    ],
  },
  {
    id: 'joy',
    name: '欢乐颂（唱名版）',
    emoji: '🎶',
    level: '简单',
    bpm: 104,
    source: '公有领域（贝多芬第九交响曲主题，1824）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(3, 1, '咪'), n(3, 1, '咪'), n(4, 1, '发'), n(5, 1, '梭'), n(5, 1, '梭'), n(4, 1, '发'), n(3, 1, '咪'), n(2, 1, '来')],
          [n(1, 1, '哆'), n(1, 1, '哆'), n(2, 1, '来'), n(3, 1, '咪'), n(3, 1.5, '咪'), n(2, 0.5, '来'), n(2, 2, '来')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(3, 1, '咪'), n(3, 1, '咪'), n(4, 1, '发'), n(5, 1, '梭'), n(5, 1, '梭'), n(4, 1, '发'), n(3, 1, '咪'), n(2, 1, '来')],
          [n(1, 1, '哆'), n(1, 1, '哆'), n(2, 1, '来'), n(3, 1, '咪'), n(2, 1.5, '来'), n(1, 0.5, '哆'), n(1, 2, '哆')],
        ],
      },
    ],
  },
  {
    id: 'birthday',
    name: '生日快乐',
    emoji: '🎂',
    level: '简单',
    bpm: 84,
    source: '公有领域（旋律 Good Morning to All，1893；2016 年美国法院确认版权无效）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(5, 0.5, '祝', -1), n(5, 0.5, '你', -1), n(6, 1, '生', -1), n(5, 1, '日', -1), n(1, 1, '快'), n(7, 2, '乐', -1)],
          [n(5, 0.5, '祝', -1), n(5, 0.5, '你', -1), n(6, 1, '生', -1), n(5, 1, '日', -1), n(2, 1, '快'), n(1, 2, '乐')],
        ],
      },
      {
        kind: 'chorus',
        name: '高音句',
        phrases: [
          [n(5, 0.5, '祝', -1), n(5, 0.5, '你', -1), n(5, 1, '生'), n(3, 1, '日'), n(1, 1, '快'), n(7, 1, '乐', -1), n(6, 2, '', -1)],
          [n(4, 0.5, '祝'), n(4, 0.5, '你'), n(3, 1, '生'), n(1, 1, '日'), n(2, 1, '快'), n(1, 2, '乐')],
        ],
      },
    ],
  },
  {
    id: 'jingle',
    name: '铃儿响叮当',
    emoji: '🔔',
    level: '简单',
    bpm: 116,
    source: '公有领域（James Lord Pierpont，Jingle Bells，1857）',
    sections: [
      {
        kind: 'intro',
        instrumental: true,
        phrases: [[n(3, 1), n(3, 1), n(3, 2)]],
      },
      {
        kind: 'verse',
        phrases: [
          [n(3, 1, '冲'), n(3, 1, '破'), n(3, 2, '大'), n(3, 1, '风'), n(3, 1, '雪'), n(3, 2, '呀'), n(3, 1, '我'), n(5, 1, '们'), n(1, 1, '坐'), n(2, 1, '在'), n(3, 3, '雪橇上')],
          [n(4, 1, '奔'), n(4, 1, '驰'), n(4, 1, '过'), n(4, 1, '田'), n(4, 1, '野'), n(3, 1, '我'), n(3, 1, '们'), n(3, 1, '欢'), n(3, 1, '笑'), n(2, 1, '又'), n(2, 1, '歌'), n(3, 1, '唱'), n(2, 2, '呀'), n(5, 2, '嘿')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(3, 1, '叮'), n(3, 1, '叮'), n(3, 2, '当'), n(3, 1, '叮'), n(3, 1, '叮'), n(3, 2, '当'), n(3, 1, '铃'), n(5, 1, '儿'), n(1, 1, '响'), n(2, 1, '叮'), n(3, 3, '当')],
          [n(4, 1, '雪'), n(4, 1, '花'), n(4, 1, '飘'), n(4, 1, '呀'), n(4, 1, '风'), n(3, 1, '儿'), n(3, 1, '在'), n(3, 1, '唱'), n(3, 1, '一'), n(2, 1, '路'), n(2, 1, '好'), n(3, 1, '风'), n(2, 2, '光'), n(5, 2, '嘿')],
          [n(3, 1, '叮'), n(3, 1, '叮'), n(3, 2, '当'), n(3, 1, '叮'), n(3, 1, '叮'), n(3, 2, '当'), n(3, 1, '铃'), n(5, 1, '儿'), n(1, 1, '响'), n(2, 1, '叮'), n(3, 3, '当')],
          [n(4, 1, '唱'), n(4, 1, '起'), n(4, 1, '歌'), n(4, 1, '来'), n(4, 1, '跑'), n(3, 1, '起'), n(3, 1, '来'), n(3, 1, '呀'), n(5, 1, '烦'), n(5, 1, '恼'), n(4, 1, '全'), n(2, 1, '忘'), n(1, 3, '光')],
        ],
      },
    ],
  },
  {
    id: 'susanna',
    name: '噢！苏珊娜',
    emoji: '🪕',
    level: '简单',
    bpm: 116,
    source: '公有领域（Stephen Foster，Oh! Susanna，1848）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(1, 0.5, '我'), n(1, 0.5, '来'), n(2, 0.5, '自'), n(3, 1, '阿'), n(3, 0.5, '拉'), n(2, 0.5, '巴'), n(1, 0.5, '马'), n(2, 1, '')],
          [n(3, 0.5, '带'), n(3, 0.5, '着'), n(2, 0.5, '心'), n(1, 1, '爱'), n(2, 0.5, '的'), n(1, 2, '琴')],
          [n(1, 0.5, '我'), n(1, 0.5, '要'), n(2, 0.5, '去'), n(3, 1, '路'), n(3, 0.5, '易'), n(2, 0.5, '斯'), n(1, 0.5, '安'), n(2, 1, '那')],
          [n(3, 0.5, '寻'), n(3, 0.5, '找'), n(2, 0.5, '我'), n(1, 1, '的'), n(1, 2, '爱')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(4, 1, '噢'), n(4, 1, '苏'), n(6, 1, '珊'), n(6, 1, '娜'), n(5, 1, '别'), n(3, 1, '为'), n(1, 1, '我'), n(2, 1, '哭')],
          [n(3, 0.5, '我'), n(3, 0.5, '从'), n(2, 0.5, '远'), n(1, 1, '方'), n(2, 0.5, '来'), n(1, 2, '呀')],
        ],
      },
    ],
  },
  {
    id: 'jasmine',
    name: '茉莉花',
    emoji: '🌸',
    level: '进阶',
    bpm: 88,
    source: '公有领域（江苏民歌，清代《鲜花调》）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(3, 0.5, '好'), n(3, 0.5, '一'), n(5, 1, '朵'), n(6, 0.5, '美'), n(1, 0.5, '丽', 1), n(1, 0.5, '的', 1), n(6, 0.5, '茉'), n(5, 1, '莉'), n(5, 0.5, '花'), n(6, 0.5, ''), n(5, 1, '')],
          [n(3, 0.5, '好'), n(3, 0.5, '一'), n(5, 1, '朵'), n(6, 0.5, '美'), n(1, 0.5, '丽', 1), n(1, 0.5, '的', 1), n(6, 0.5, '茉'), n(5, 1, '莉'), n(5, 0.5, '花'), n(6, 0.5, ''), n(5, 1, '')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(5, 1, '芬'), n(5, 1, '芳'), n(5, 0.5, '美'), n(3, 0.5, '丽'), n(5, 1, '满'), n(6, 1, '枝'), n(5, 2, '桠')],
          [n(3, 1, '又'), n(2, 0.5, '香'), n(3, 0.5, '又'), n(5, 1, '白'), n(3, 0.5, '人'), n(2, 0.5, '人'), n(1, 2, '夸')],
        ],
      },
    ],
  },
  {
    id: 'farewell',
    name: '送别',
    emoji: '🌅',
    level: '进阶',
    bpm: 72,
    source: '公有领域（John P. Ordway 曲，1868；李叔同填词，1915）',
    sections: [
      { kind: 'intro', instrumental: true, phrases: [[n(5, 2), n(3, 1), n(5, 1)]] },
      {
        kind: 'verse',
        phrases: [
          [n(5, 1, '长'), n(3, 0.5, '亭'), n(5, 0.5, ''), n(1, 2, '外', 1)],
          [n(6, 1, '古'), n(1, 1, '道', 1), n(5, 2, '边')],
          [n(5, 1, '芳'), n(1, 0.5, '草'), n(2, 0.5, ''), n(3, 1, '碧'), n(2, 0.5, '连'), n(1, 0.5, ''), n(2, 3, '天')],
        ],
      },
      {
        kind: 'chorus',
        name: '高潮句',
        phrases: [
          [n(5, 1, '晚'), n(3, 0.5, '风'), n(5, 0.5, ''), n(1, 1.5, '拂', 1), n(7, 0.5, '柳'), n(6, 1, '笛'), n(1, 1, '声', 1), n(5, 2, '残')],
          [n(6, 1, '夕'), n(1, 1, '阳', 1), n(1, 1, '山', 1), n(7, 1, '外'), n(1, 3, '山', 1)],
        ],
      },
      { kind: 'outro', instrumental: true, phrases: [[n(5, 2), n(1, 4)]] },
    ],
  },
  {
    id: 'amazing',
    name: '奇异恩典',
    emoji: '✨',
    level: '进阶',
    bpm: 68,
    source: '公有领域（旋律 New Britain，1835；歌词 John Newton，1779）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(5, 1, '奇', -1), n(1, 2, '异'), n(3, 0.5, ''), n(1, 0.5, ''), n(3, 2, '恩'), n(2, 1, '典')],
          [n(1, 2, '何'), n(6, 1, '等', -1), n(5, 3, '甜', -1)],
          [n(5, 1, '美', -1), n(1, 2, '曾'), n(3, 0.5, ''), n(1, 0.5, ''), n(3, 2, '救'), n(2, 1, '了')],
          [n(3, 3, '我'), r(1), n(5, 1, '呀'), n(5, 1, '')],
        ],
      },
      {
        kind: 'chorus',
        name: '高音段',
        phrases: [
          [n(1, 2, '我', 1), n(1, 1, '曾', 1), n(1, 2, '迷', 1), n(6, 0.5, ''), n(1, 0.5, '失', 1), n(6, 1, '在')],
          [n(5, 2, '黑'), n(3, 1, '暗'), n(3, 1, '之'), n(2, 2, '中')],
          [n(1, 2, '如'), n(3, 0.5, '今'), n(1, 0.5, ''), n(3, 2, '被'), n(2, 1, '寻')],
          [n(1, 2, '回'), n(6, 1, '来', -1), n(5, 3, '了', -1)],
        ],
      },
    ],
  },
  {
    id: 'greensleeves',
    name: '绿袖子',
    emoji: '💚',
    level: '进阶',
    bpm: 92,
    source: '公有领域（英格兰传统曲调，16 世纪）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(6, 1, '我'), n(1, 1, '心', 1), n(2, 1, '爱', 1), n(3, 1.5, '的', 1), n(4, 0.5, '人', 1), n(3, 1, '啊', 1)],
          [n(2, 1, '你', 1), n(7, 1, '为'), n(5, 1.5, '何'), n(6, 0.5, '离'), n(7, 1, '去')],
          [n(1, 1, '把', 1), n(6, 1, '我'), n(6, 1.5, '的'), n(7, 0.5, '心'), n(6, 1, '伤')],
          [n(5, 3, '透', 0, 1)],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(3, 1.5, '绿', 1), n(3, 0.5, '袖', 1), n(3, 1, '子', 1), n(2, 1.5, '啊', 1), n(1, 0.5, '我', 1), n(7, 1, '的')],
          [n(6, 1, '欢'), n(1, 1, '乐', 1), n(6, 1.5, ''), n(7, 0.5, '与'), n(6, 1, '悲')],
          [n(5, 3, '伤', 0, 1)],
        ],
      },
    ],
  },
  {
    id: 'redriver',
    name: '红河谷',
    emoji: '🏞️',
    level: '简单',
    bpm: 88,
    source: '公有领域（北美民谣 Red River Valley，19 世纪）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(1, 1, '人'), n(1, 1, '们'), n(3, 1, '说'), n(5, 1, '你'), n(5, 2, '就'), n(6, 1, '要'), n(5, 1, '走')],
          [n(3, 2, '离'), n(2, 1, '开'), n(1, 1, '村'), n(2, 4, '庄')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(1, 1, '我'), n(1, 1, '们'), n(3, 1, '将'), n(5, 1, '怀'), n(5, 2, '念'), n(6, 1, '你'), n(5, 1, '的')],
          [n(3, 2, '微'), n(2, 1, '笑'), n(1, 4, '呀')],
        ],
      },
    ],
  },
  {
    id: 'sakura',
    name: '樱花',
    emoji: '🌸',
    level: '简单',
    bpm: 76,
    source: '公有领域（日本传统曲调 さくらさくら，江户时代）',
    sections: [
      {
        kind: 'verse',
        phrases: [
          [n(6, 1, '樱'), n(6, 1, '花'), n(7, 2, '呀')],
          [n(6, 1, '樱'), n(6, 1, '花'), n(7, 2, '呀')],
          [n(6, 1, '漫'), n(7, 1, '山'), n(1, 1, '遍', 1), n(7, 1, '野'), n(6, 1, '都'), n(7, 1, '开'), n(6, 1, '满'), n(3, 1, '了')],
        ],
      },
      {
        kind: 'chorus',
        phrases: [
          [n(3, 1, '放'), n(4, 1, '眼'), n(7, 2, '望'), n(3, 1, '一'), n(4, 1, '片'), n(7, 2, '白')],
          [n(6, 1, '像'), n(7, 1, '云'), n(1, 1, '像', 1), n(7, 1, '雾'), n(6, 1, '又'), n(7, 1, '像'), n(6, 2, '霞')],
        ],
      },
    ],
  },
  // ---- 开发/测试用音频：不是歌，是给自己和用户校准用的 ----
  {
    id: 'dev-scale',
    name: 'C 大调音阶（测试音频）',
    emoji: '🧪',
    level: '入门',
    bpm: 80,
    source: '开发测试素材（音阶，非乐曲）',
    sections: [
      {
        kind: 'verse',
        name: '上行',
        phrases: [
          [n(1, 1, '哆'), n(2, 1, '来'), n(3, 1, '咪'), n(4, 1, '发'), n(5, 1, '梭'), n(6, 1, '拉'), n(7, 1, '西'), n(1, 2, '哆', 1)],
        ],
      },
      {
        kind: 'outro',
        name: '下行',
        phrases: [
          [n(1, 1, '哆', 1), n(7, 1, '西'), n(6, 1, '拉'), n(5, 1, '梭'), n(4, 1, '发'), n(3, 1, '咪'), n(2, 1, '来'), n(1, 2, '哆')],
        ],
      },
    ],
  },
];

export const SONG_BY_ID = new Map(SONGS.map((s) => [s.id, s]));

/** 这首歌原调下的音域 */
export function songRange(song: Song): { lo: number; hi: number } {
  let lo = 127;
  let hi = 0;
  for (const sec of song.sections)
    for (const ph of sec.phrases)
      for (const nt of ph)
        if (nt.m > 0) {
          lo = Math.min(lo, nt.m);
          hi = Math.max(hi, nt.m);
        }
  return hi === 0 ? { lo: 60, hi: 60 } : { lo, hi };
}

/** 这首歌总共有多少个要唱的音 */
export function songNoteCount(song: Song): number {
  let c = 0;
  for (const sec of song.sections) {
    if (sec.instrumental) continue;
    for (const ph of sec.phrases) for (const nt of ph) if (nt.m > 0) c++;
  }
  return c;
}

export interface BuildOptions {
  /** 移调半音数 */
  transpose?: number;
  /** 起唱前留几拍（给用户准备） */
  leadInBeats?: number;
  /** 只练某一个段落（下标）；不填则整首 */
  sectionOnly?: number;
  /** 速度倍率，0.8 = 放慢到 80% */
  tempoScale?: number;
}

/**
 * 把一首歌展开成分析层要的 Reference：所有时间都换算成「相对录音起点的秒」。
 *
 * 录音是和伴奏同时开始的，所以这里的秒数可以直接和音高轨迹的时间轴对齐——
 * 唯一的偏差是设备延迟，那个在节奏分析里单独处理。
 */
export function buildReference(song: Song, opts: BuildOptions = {}): Reference {
  const transpose = opts.transpose ?? 0;
  const leadIn = opts.leadInBeats ?? 4;
  const tempoScale = opts.tempoScale ?? 1;
  const bpm = song.bpm * tempoScale;
  const spb = 60 / bpm;

  const secs = opts.sectionOnly !== undefined ? [song.sections[opts.sectionOnly]] : song.sections;

  const notes: RefNote[] = [];
  const playback: { midi: number; start: number; dur: number }[] = [];
  const sections: Reference['sections'] = [];
  const phrases: Reference['phrases'] = [];

  let beat = leadIn;
  secs.forEach((sec, si) => {
    const secFrom = notes.length;
    const secStartSec = beat * spb;
    for (const ph of sec.phrases) {
      const phFrom = notes.length;
      const phStartSec = beat * spb;
      let text = '';
      for (const nt of ph) {
        const start = beat * spb;
        const dur = nt.d * spb;
        if (nt.m > 0) {
          const midi = nt.m + transpose;
          playback.push({ midi, start, dur });
          if (!sec.instrumental) {
            notes.push({
              midi,
              start,
              dur,
              lyric: nt.ly ?? '',
              section: si,
              phrase: phrases.length,
            });
            text += nt.ly ?? '';
          }
        }
        beat += nt.d;
      }
      if (notes.length > phFrom) {
        phrases.push({ from: phFrom, to: notes.length, text, startSec: phStartSec, endSec: beat * spb });
      }
    }
    sections.push({
      kind: sec.kind,
      name: sec.name ?? DEFAULT_NAME[sec.kind],
      from: secFrom,
      to: notes.length,
      startSec: secStartSec,
      endSec: beat * spb,
    });
  });

  return {
    id: song.id + (opts.sectionOnly !== undefined ? `#${opts.sectionOnly}` : ''),
    title: song.name + (opts.sectionOnly !== undefined ? ` · ${sections[0]?.name ?? ''}` : ''),
    bpm,
    // 内置曲库的时值是我们自己编的，节拍当然可靠；
    // 用户导入的音频走另一条路（buildFreeReference），那里 beatReliable 是 false
    beatReliable: true,
    notes,
    playback,
    sections,
    phrases,
    transpose,
    totalSec: (beat + 1) * spb,
  };
}
