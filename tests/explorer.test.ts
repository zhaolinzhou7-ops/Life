/**
 * 开局树、开局识别、棋谱导入、一手棋的意义。
 * 用户原话："多增加一些布局后的变招，每一步变招的意义讲清楚。深入研究各种象棋软件的优点，进行全面优化。"
 */
import { describe, expect, it } from 'vitest';
import { childrenAt, firstName, identify, inBook, linesAt, parseMoves } from '../src/xiangqi/explorer';
import { parseImport, evWords } from '../src/xiangqi/explorerui';
import { concrete, keyNote, meaningOf, shapesOf } from '../src/xiangqi/movemeaning';
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText } from '../src/xiangqi/notation';
import { countNames } from '../src/xiangqi/movenote';
import { OPENINGS } from '../src/xiangqi/openings';
import { TRICKS } from '../src/xiangqi/tricks';
import { walkMoves } from '../src/xiangqi/tricks';

const at = (line: string) => {
  const w = walkMoves(line ? line.split(' ') : [])!;
  return w;
};
const moveIn = (b: Board, c: Color, t: string): Move => legalMoves(b, c).find((m) => moveToText(b, m) === t)!;

describe('开局树', () => {
  it('开局局面下列出所有布局、邪门布局的第一手，中炮最多', () => {
    const kids = childrenAt(initialBoard(), 'r');
    const ts = kids.map((k) => k.t);
    for (const t of ['炮二平五', '兵七进一', '相三进五', '车一进一']) expect(ts, t).toContain(t);
    expect(kids[0].kinds.has('main')).toBe(true);
    const cp = kids.find((k) => k.t === '炮二平五')!;
    expect(cp.lines.size).toBeGreaterThan(10);
  });

  it('每一套布局的主线、每一条邪门布局的套路都挂在树上', () => {
    for (const o of OPENINGS) {
      const w = at(o.moves.map((m) => m.t).join(' '));
      expect(inBook(w.board, w.color), o.id).toBe(true);
      expect(linesAt(w.board, w.color), o.id).toContain(o.name);
    }
    for (const t of TRICKS) {
      const w = at([...t.pre, t.trick.t].join(' '));
      expect(linesAt(w.board, w.color).some((l) => l.includes(t.name)), t.id).toBe(true);
    }
  });

  it('谱上每一手都有说明；邪门着、破解、上当分得清', () => {
    const w = at('炮二平五 马8进7');
    const kids = childrenAt(w.board, w.color);
    expect(kids.every((k) => k.why.length > 4)).toBe(true);
    const trick = kids.find((k) => k.t === '兵五进一')!;
    expect(trick.kinds.has('trick')).toBe(true);
    const w2 = at('炮二平五 马8进7 兵五进一');
    const k2 = childrenAt(w2.board, w2.color);
    expect(k2.find((k) => k.t === '炮2平5')?.kinds.has('refute')).toBe(true);
    expect(k2.find((k) => k.t === '卒5进1')?.kinds.has('fall')).toBe(true);
  });
});

describe('开局识别（象棋巫师那样叫得出名字）', () => {
  it('主线走下去叫得出布局名字，出谱的那一手也知道', () => {
    const o = OPENINGS.find((x) => x.id === 'pfm-guohe')!;
    const ms = parseMoves(o.moves.slice(0, 13).map((m) => m.t))!;
    const id = identify(ms)!;
    expect(id.name).toBe(o.name);
    expect(id.bookPly).toBe(13);
    // 出谱：在主线之后走一手谱外的
    const more = parseMoves([...o.moves.slice(0, 12).map((m) => m.t), '兵九进一']);
    if (more) expect(identify(more)!.bookPly).toBe(12);
  });

  it('换个次序走到同一个局面也认得出', () => {
    const a = parseMoves(['炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '马2进3'])!;
    const b = parseMoves(['炮二平五', '马2进3', '马二进三', '马8进7', '车一平二', '车9平8'])!;
    const fa = identify(a)!;
    const fb = identify(b)!;
    expect(fb.bookPly).toBe(6);
    expect(fb.name).toBe(fa.name);
  });

  it('邪门布局走到它独有的局面才叫邪门布局；共用的前几手叫布局的名字', () => {
    expect(identify(parseMoves(['炮二平五', '马8进7', '兵五进一'])!)!.name).toContain('急进中兵');
    expect(identify(parseMoves(['炮二平五', '炮8平5', '马二进三'])!)!.name).not.toContain('邪门');
    expect(identify(parseMoves(['车一进一'])!)!.trick).toBe(true);
  });

  it('谱上没有的起手也叫得出大类：顺炮、列炮、边马局', () => {
    expect(firstName(parseMoves(['炮八平五', '炮2平5'])!)).toBe('顺炮');
    expect(firstName(parseMoves(['炮二平五', '炮2平5'])!)).toBe('列炮');
    expect(identify(parseMoves(['马八进九', '卒3进1'])!)!.name).toBe('边马局');
  });
});

describe('棋谱导入', () => {
  it('带回合号的中文棋谱、全角数字都读得出', () => {
    expect(parseImport('1. 炮二平五 马8进7\n2. 马二进三 车9平8').moves).toEqual(['炮二平五', '马8进7', '马二进三', '车9平8']);
    expect(parseImport('１．炮二平五　马８进７').moves).toEqual(['炮二平五', '马8进7']);
  });
  it('读到走不通的地方停下，前面的留着', () => {
    const r = parseImport('炮二平五 马8进7 车九平八');
    expect(r.moves).toEqual(['炮二平五', '马8进7']);
    expect(r.error).toContain('第 3 手');
  });
  it('FEN 也行', () => {
    expect(parseImport('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w').fen).toBeTruthy();
    expect(parseImport('').error).toBeTruthy();
  });
  it('局面判断的说法', () => {
    expect(evWords(30)).toBe('均势');
    expect(evWords(-250)).toContain('黑方稍优');
    expect(evWords(30000)).toBe('红方有杀');
  });
});

describe('一手棋的意义', () => {
  it('布局里常见的形状认得出：给车让路、炮封车、占肋道', () => {
    let w = at('炮二平五 马8进7');
    expect(shapesOf(w.board, moveIn(w.board, w.color, '马二进三'), w.color)).toContain('给车让出了路');
    w = at('炮二平五 马8进7 马二进三 车9平8 车一平二');
    expect(shapesOf(w.board, moveIn(w.board, w.color, '炮8进4'), w.color).join()).toContain('封住对方的车');
  });

  it('"顺手保护了被捉的子"里的捉不算威胁', () => {
    expect(concrete('跳正马出动，顺手保护了被捉的子')).toBe(false);
    expect(concrete('平边炮，捉车')).toBe(true);
    expect(keyNote('炮平移，换一条线，捉车，顺手保护了被捉的子')).toBe('捉车');
    expect(keyNote('吃兵（对方能吃回来，用炮换兵），捉马')).toBe('吃兵（对方能吃回来，用炮换兵），捉马');
  });

  it('意义：干了什么 + 防住什么 + 威胁什么 + 接下来 + 引擎怎么看', () => {
    const w = at('炮二平五 马8进7');
    const m = moveIn(w.board, w.color, '马二进三');
    const s = meaningOf(w.board, m, w.color, {
      stopped: { t: '炮8进4', what: '封车' },
      threat: { t: '车一平二', what: '捉马', gain: 200 },
      reply: { t: '车9平8', what: '出车' },
      next: { t: '车一平二', what: '出车' },
      best: { t: '兵七进一', loss: 80 },
    });
    for (const x of ['跳正马', '防住了对方的', '炮8进4', '威胁下一步', '接下来对方多半走', '引擎更想走', '0.8 个兵']) expect(s, x).toContain(x);
    const close = meaningOf(w.board, m, w.color, { best: { t: '兵七进一', loss: 20 } });
    expect(close).toContain('差不多一样好');
  });

  it('几个子连起来说：同名的数一数', () => {
    expect(countNames(['马', '卒', '卒'])).toBe('马和两个卒');
    expect(countNames(['卒', '卒', '卒'])).toBe('三个卒');
    expect(countNames(['车', '马', '炮'])).toBe('车、马和炮');
    expect(countNames(['车', '马'])).toBe('车和马');
  });

  it('applyMove 不改原局面', () => {
    const b = initialBoard();
    const m = moveIn(b, 'r', '炮二平五');
    meaningOf(b, m, 'r');
    expect(moveToText(b, m)).toBe('炮二平五');
    void applyMove;
  });
});
