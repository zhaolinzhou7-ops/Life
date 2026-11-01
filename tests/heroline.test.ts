import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { HEROES } from '../src/xiangqi/intro';

// 用户原话："这 9 个人的声音每一个都需要去调整一下。有些说话发音不太像中国人，还有一些是直接没有声音"
// 录音是 tools/gen-voice.py 离线做的，report.json 记着两个识别器听成了什么、话说到第几秒
interface Rec {
  text: string;
  voice: string;
  heard: string[];
  acc: number;
  talk: number;
  bytes: number;
}
const DIR = new URL('../src/xiangqi/voice/', import.meta.url);
const report = JSON.parse(readFileSync(new URL('report.json', DIR), 'utf8')) as Record<string, Rec>;

describe('九位人物的开场白录音', () => {
  for (const h of HEROES) {
    const recs = h.lines.map((_, i) => report[`hero-${h.id}-${i + 1}`]);

    it(`${h.id}：五句都有录音、有声音`, () => {
      expect(recs.every(Boolean)).toBe(true);
      for (const [i, r] of recs.entries()) {
        const size = statSync(new URL(`hero-${h.id}-${i + 1}.mp3`, DIR)).size;
        expect(size).toBe(r.bytes);
        // 连着回声两三秒，80 kbps 立体声至少二三十 KB；几 KB 就是没念出来
        expect(size).toBeGreaterThan(20000);
        // 最短的一句"墨未干，你已败！"六个字，也要说上快一秒
        expect(r.talk).toBeGreaterThan(0.8);
      }
    });

    it(`${h.id}：一个人一个嗓子`, () => {
      expect(new Set(recs.map((r) => r.voice)).size).toBe(1);
    });

    it(`${h.id}：两个识别器都听得出说的是什么`, () => {
      // 两个识别器准确率的平均：只有一个听对的（上一版"鼠辈谁敢"被另一个听成"处被水赶"）不算
      for (const r of recs) expect(r.acc, `${r.text} 听成 ${r.heard.join('／')}`).toBeGreaterThanOrEqual(0.9);
    });

    it(`${h.id}：出场动画的长短跟着录音走（话说完才收）`, () => {
      for (const [i, r] of recs.entries()) expect(Math.abs(h.voiceSec[i] - r.talk), `第 ${i + 1} 句`).toBeLessThanOrEqual(0.05);
    });
  }
});
