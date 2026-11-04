import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { describeBackup, lastBackupAt, makeBackup, parseBackup, restoreBackup, shouldNag, snoozeNag } from '../src/xiangqi/backup';
import { archiveGame, droppedCount, listGames, MAX_GAMES } from '../src/xiangqi/archive';

// 用户（评估里提的）：进度只在浏览器里，iPhone Safari 七天不用会被清，界面上却没有备份的按钮；棋局只留 40 盘、悄悄删
beforeEach(() => {
  memStore.full = false;
  memStore.clear();
});

const game = (i: number) => ({ fen: 'x', moves: '7242'.repeat(20), side: 'r' as const, result: 'win' as const, level: `第${i}盘` });

describe('备份 / 恢复', () => {
  it('备份只带 xq- 的进度，不带这台设备自己的引擎设置', () => {
    localStorage.setItem('xq-save', '{"srs":[1,2],"solved":{"a":1}}');
    localStorage.setItem('xq-archive', '[{"id":"g1"}]');
    localStorage.setItem('xq-engine-onelane', '1');
    localStorage.setItem('life-mute', '1');
    const b = makeBackup(new Date('2026-11-04T08:00:00Z'));
    expect(Object.keys(b.data).sort()).toEqual(['xq-archive', 'xq-save']);
    expect(describeBackup(b)).toMatchObject({ games: 1, srs: 2, solved: 1 });
  });

  it('导出再导回来：一模一样；现在的进度整份换掉，引擎设置留着', () => {
    localStorage.setItem('xq-save', '{"streak":9}');
    localStorage.setItem('xq-level', '6');
    const b = makeBackup();
    memStore.clear();
    localStorage.setItem('xq-save', '{"streak":1}');
    localStorage.setItem('xq-tricks-done', '["x"]');
    localStorage.setItem('xq-engine-noflag', '1');
    const r = parseBackup(JSON.stringify(b));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(restoreBackup(r.backup)).toEqual({ ok: true });
    expect(localStorage.getItem('xq-save')).toBe('{"streak":9}');
    expect(localStorage.getItem('xq-level')).toBe('6');
    expect(localStorage.getItem('xq-tricks-done')).toBeNull();
    expect(localStorage.getItem('xq-engine-noflag')).toBe('1');
    expect(lastBackupAt()?.toISOString()).toBe(b.at);
  });

  it('不是备份文件、坏了的文件：说人话，不动现在的进度', () => {
    expect(parseBackup('hello')).toMatchObject({ ok: false });
    expect(parseBackup('{"a":1}')).toMatchObject({ ok: false, error: '这不是象棋进度的备份文件。' });
    expect(parseBackup(JSON.stringify({ format: 'life-xiangqi-backup', v: 1, at: '', data: { 'other-key': 'x' } }))).toMatchObject({ ok: false });
    expect(parseBackup(JSON.stringify({ format: 'life-xiangqi-backup', v: 2, at: '', data: {} }))).toMatchObject({ ok: false });
  });

  it('恢复时存储满了：原来的进度放回去', () => {
    localStorage.setItem('xq-save', '{"streak":3}');
    const b = { format: 'life-xiangqi-backup' as const, v: 1 as const, at: new Date().toISOString(), data: { 'xq-save': '{"streak":7}' } };
    const real = memStore.setItem.bind(memStore);
    let n = 0;
    // 第一笔写进去以后就满了
    memStore.setItem = (k: string, v: string) => {
      if (n++ >= 1 && k === 'xq-backup-at') throw new DOMException('QuotaExceededError');
      real(k, v);
    };
    const r = restoreBackup(b);
    memStore.setItem = real;
    expect(r.ok).toBe(false);
    expect(localStorage.getItem('xq-save')).toBe('{"streak":3}');
  });

  it('提醒备份：攒了东西又没备份过才提；点"以后再说"两周内不提；刚备份过不提', () => {
    const now = Date.parse('2026-11-04T08:00:00Z');
    expect(shouldNag({ games: 1, srs: 0 }, now)).toBe(false);
    expect(shouldNag({ games: 3, srs: 0 }, now)).toBe(true);
    snoozeNag(now);
    expect(shouldNag({ games: 3, srs: 0 }, now + 5 * 864e5)).toBe(false);
    expect(shouldNag({ games: 3, srs: 0 }, now + 15 * 864e5)).toBe(true);
    localStorage.setItem('xq-backup-at', new Date(now + 15 * 864e5).toISOString());
    expect(shouldNag({ games: 3, srs: 0 }, now + 20 * 864e5)).toBe(false);
    expect(shouldNag({ games: 3, srs: 0 }, now + 50 * 864e5)).toBe(true);
  });
});

describe('棋局存档：不再只留 40 盘、不悄悄丢', () => {
  it('第 41 盘进来，第一盘还在', () => {
    for (let i = 0; i < 41; i++) archiveGame(game(i));
    const all = listGames();
    expect(all).toHaveLength(41);
    expect(all[40].level).toBe('第0盘');
    expect(MAX_GAMES).toBeGreaterThanOrEqual(500);
  });

  it('存储满了：从最老的删起，刚下完的那盘留下，删了几盘记着', () => {
    for (let i = 0; i < 30; i++) archiveGame(game(i));
    const real = memStore.setItem.bind(memStore);
    // 只能放下 20 盘左右
    memStore.setItem = (k: string, v: string) => {
      if (k === 'xq-archive' && v.length > 20 * 260) throw new DOMException('QuotaExceededError');
      real(k, v);
    };
    archiveGame(game(99));
    memStore.setItem = real;
    const all = listGames();
    expect(all[0].level).toBe('第99盘');
    expect(all.length).toBeLessThan(31);
    expect(droppedCount()).toBe(31 - all.length);
  });
});
