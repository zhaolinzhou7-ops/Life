/**
 * 教练模式测试。
 *
 * 教练模式的成败全在**什么时候开口**。开口太多，用户三分钟就关掉；
 * 开口太少，等于没有教练。所以提示策略被单独抽成 shouldWarn 这个纯函数，
 * 就是为了能在这里钉死它的行为。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { HINT_LEVELS, checkMove, getHintLevel, setHintLevel, shouldWarn, warnText } from '../src/xiangqi/livecoach';
import { moveRisk, type MoveRisk } from '../src/xiangqi/teach';
import { initialBoard } from '../src/xiangqi/rules';
import { board, bare, mv, put } from './helpers';

const risk = (severity: 1 | 2 | 3, kind: MoveRisk['kind'] = 'hang-moved'): MoveRisk => ({
  kind,
  severity,
  net: -severity * 400,
  brief: '这里有风险：你的马走过去会被吃。',
  detail: '详细说明',
});

beforeEach(() => {
  memStore.clear();
  memStore.full = false;
});

describe('提示档位', () => {
  it('四个档位，和规格一一对应', () => {
    expect(HINT_LEVELS.map((h) => h.name)).toEqual(['关闭', '轻提示', '标准提示', '教学提示']);
  });

  it('默认是标准提示', () => {
    expect(getHintLevel()).toBe(2);
  });

  it('设置能存能读', () => {
    setHintLevel(3);
    expect(getHintLevel()).toBe(3);
    setHintLevel(0);
    expect(getHintLevel()).toBe(0);
  });

  it('存档里是垃圾值时退回默认，不会把界面搞坏', () => {
    memStore.setItem('xq-hint-level', '99');
    expect(getHintLevel()).toBe(2);
    memStore.setItem('xq-hint-level', '乱写');
    expect(getHintLevel()).toBe(2);
  });

  it('localStorage 写不进去也不抛错', () => {
    memStore.full = true;
    expect(() => setHintLevel(1)).not.toThrow();
  });
});

describe('shouldWarn：什么时候该开口', () => {
  it('关闭档任何情况都不开口', () => {
    for (const sev of [1, 2, 3] as const) expect(shouldWarn(0, risk(sev))).toBe(false);
  });

  it('轻提示只在要出大事的时候开口', () => {
    expect(shouldWarn(1, risk(1))).toBe(false);
    expect(shouldWarn(1, risk(2))).toBe(false);
    expect(shouldWarn(1, risk(3))).toBe(true);
  });

  it('标准提示从丢马炮开始管', () => {
    expect(shouldWarn(2, risk(1))).toBe(false);
    expect(shouldWarn(2, risk(2))).toBe(true);
    expect(shouldWarn(2, risk(3))).toBe(true);
  });

  it('教学提示连小亏也说', () => {
    expect(shouldWarn(3, risk(1))).toBe(true);
    expect(shouldWarn(3, risk(2))).toBe(true);
  });

  it('没有风险时任何档位都不开口', () => {
    for (const lv of [0, 1, 2, 3] as const) expect(shouldWarn(lv, null)).toBe(false);
  });

  it('档位越高开口越多，不会反过来', () => {
    for (const sev of [1, 2, 3] as const) {
      const on = ([0, 1, 2, 3] as const).map((lv) => shouldWarn(lv, risk(sev)));
      // 一旦开始开口，更高的档位必须也开口
      const first = on.indexOf(true);
      if (first >= 0) expect(on.slice(first).every(Boolean)).toBe(true);
    }
  });
});

describe('warnText：说到什么程度', () => {
  it('轻提示只给一句模糊的提醒，不点名具体的子', () => {
    const t = warnText(1, risk(2));
    expect(t).toContain('风险');
    expect(t).not.toContain('马'); // 轻提示不能泄露是哪个子，那样就不用自己想了
  });

  it('标准提示点名具体的子', () => {
    expect(warnText(2, risk(2))).toContain('马');
  });

  it('被将死的警告任何档位都说得清楚', () => {
    expect(warnText(1, risk(3, 'mate-next'))).toContain('危险');
  });
});

describe('checkMove：对局里的完整一次判断', () => {
  it('关闭档直接放行，连算都不算', () => {
    const b = bare();
    put(b, 4, 6, 'n'); // 随便摆一个会送掉的局面
    expect(checkMove(0, initialBoard(), mv(1, 7, 4, 7), 'r')).toBeNull();
  });

  it('开局的正常一手不拦', () => {
    for (const lv of [1, 2, 3] as const) {
      expect(checkMove(lv, initialBoard(), mv(1, 7, 4, 7), 'r')).toBeNull();
      expect(checkMove(lv, initialBoard(), mv(1, 9, 2, 7), 'r')).toBeNull();
    }
  });

  it('把马送到车口上，标准档会拦', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const r = checkMove(2, b, mv(4, 6, 3, 4), 'r');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('hang-moved');
  });

  it('同一手棋，轻提示档放行（只丢一个马，不到大事级别）', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    expect(checkMove(1, b, mv(4, 6, 3, 4), 'r')).toBeNull();
  });

  it('要被将死的一手，连轻提示档都会拦', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . p . . . .',
      '. . . . . . . . .',
      '. . . . . . . . P',
      '. . . . . . . . .',
      'r . . . . . . . r',
      '. . . R K R . . .',
    );
    const r = checkMove(1, b, mv(8, 6, 8, 5), 'r');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('mate-next');
  });

  it('判断是确定性的：同一个局面永远给同一个答复', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const a = checkMove(2, b, mv(4, 6, 3, 4), 'r');
    const c = checkMove(2, b, mv(4, 6, 3, 4), 'r');
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('checkMove 的结论和 moveRisk 一致，只是多了一层档位过滤', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const raw = moveRisk(b, mv(4, 6, 3, 4), 'r');
    expect(checkMove(3, b, mv(4, 6, 3, 4), 'r')).toEqual(raw);
  });
});
