/**
 * 棋盘、棋子样式：选哪套、存档读回来、棋子上写什么字。
 * 用户原话："最大限度增加棋盘，棋子的美化效果，增加可以选择的样式。"
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('棋盘样式', async () => {
  const T = await import('../src/xiangqi/boardtheme');
  beforeEach(() => {
    localStorage.clear();
    T.setLook(T.DEFAULT_LOOK);
  });

  it('十二种棋盘（四种典藏：三种水墨、一种壁画）、八种棋子、五种字体，十三套搭配都指向有的样式', () => {
    expect(T.BOARDS).toHaveLength(12);
    expect(T.BOARDS.filter((b) => b.premium).map((b) => b.id)).toEqual(['inkland', 'goldlac', 'qinglv', 'dunhuang']);
    expect(T.PIECES).toHaveLength(8);
    expect(T.FONTS).toHaveLength(5);
    expect(T.PRESETS).toHaveLength(13);
    for (const p of T.PRESETS) {
      expect(T.BOARDS.some((b) => b.id === p.look.board), p.id).toBe(true);
      expect(T.PIECES.some((x) => x.id === p.look.piece), p.id).toBe(true);
      expect(T.FONTS.some((f) => f.id === p.look.font), p.id).toBe(true);
      // 搭配里勾了繁体，字体就得有繁体字
      if (p.look.trad) expect(T.FONTS.find((f) => f.id === p.look.font)!.trad, p.id).toBe(true);
    }
    expect(new Set(T.PRESETS.map((p) => JSON.stringify(p.look))).size).toBe(T.PRESETS.length);
  });

  it('搭配里不用认字慢的行书', () => {
    expect(T.PRESETS.some((p) => p.look.font === 'xingshu')).toBe(false);
  });

  it('选过、后来拿掉了的棋盘和棋子（星河、霓虹、烽火，琉璃、霓虹棋子）读出来回到默认', async () => {
    localStorage.setItem('xq-look', JSON.stringify({ board: 'neon', piece: 'glass', font: 'hei', trad: false }));
    vi.resetModules();
    const T2 = await import('../src/xiangqi/boardtheme');
    expect(T2.getLook()).toEqual({ board: 'wood', piece: 'ivory', font: 'hei', trad: false });
  });

  it('换了存档、通知所有棋盘；存档读回来是同一套', () => {
    const fn = vi.fn();
    const off = T.onLook(fn);
    T.setLook({ board: 'jade', piece: 'lacquer' });
    expect(fn).toHaveBeenCalled();
    off();
    expect(JSON.parse(localStorage.getItem('xq-look')!)).toEqual({ board: 'jade', piece: 'lacquer', font: 'wenkai', trad: false });
    expect(T.presetOf()).toBeNull();
    T.setLook(T.PRESETS[1].look);
    expect(T.presetOf()?.id).toBe(T.PRESETS[1].id);
  });

  it('简体、繁体：黑炮写"砲"，没有"砲"字的字体写"炮"', () => {
    expect(T.glyph('K', 'r')).toBe('帅');
    expect(T.glyph('K', 'b')).toBe('将');
    expect(T.glyph('C', 'b')).toBe('砲');
    T.setLook({ trad: true });
    expect(['K', 'H', 'R'].map((t) => T.glyph(t as never, 'r')).join('')).toBe('帥馬車');
    expect(T.glyph('K', 'b')).toBe('將');
    expect(T.riverText()[1]).toBe('漢　界');
    // 毛笔字：只有简体，没有"砲"
    T.setLook({ font: 'mashan' });
    expect(T.glyph('K', 'r')).toBe('帅');
    expect(T.glyph('C', 'b')).toBe('炮');
    expect(T.riverText()[1]).toBe('汉　界');
  });

  it('深色棋盘上可走点换亮色', () => {
    expect(T.markColors({ ...T.DEFAULT_LOOK, board: 'night' }).dot).not.toBe(T.markColors(T.DEFAULT_LOOK).dot);
    expect(T.markColors({ ...T.DEFAULT_LOOK, board: 'jade' }).dot).not.toBe(T.markColors(T.DEFAULT_LOOK).dot);
  });

  it('红黑两方颜色分得开：字色不一样，或者棋面不一样', () => {
    for (const p of T.PIECES) {
      const sameText = JSON.stringify(p.r.text) === JSON.stringify(p.b.text);
      const sameFace = p.r.face[1] === p.b.face[1];
      expect(sameText && sameFace, p.id).toBe(false);
    }
  });

  it('典藏棋盘都带会动的那一层（流光一定有），其余不带', () => {
    for (const b of T.BOARDS) {
      if (b.premium) expect(b.ambient?.sheen, b.id).toBeTruthy();
      else expect(b.ambient, b.id).toBeUndefined();
    }
  });
});
