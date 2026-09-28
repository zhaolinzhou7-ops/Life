/**
 * 备份页：数据保护状态、导出、恢复、防丢指南。
 */

import { BackupError, describe } from '../backup';
import { daysBetween, formatFull, todayStr } from '../dates';
import { isIOS, isPersisted, isPhone, isStandalone, requestPersist } from '../env';
import { liveEntries, state, storageAvailable } from '../store';
import { commitMerge, copyBackupText, planMerge, readBackup } from '../transfer';
import type { Ctx } from './context';
import { button, el, openSheet, saveFailed, toast } from './ui';

function statusRow(label: string, value: string, kind: 'ok' | 'warn' | 'bad' | 'plain'): HTMLElement {
  const r = el('div', `g-status s-${kind}`);
  r.append(el('span', 'g-status-label', label), el('span', 'g-status-value', value));
  return r;
}

export function renderBackup(ctx: Ctx): HTMLElement {
  const page = el('section', 'g-page g-backup');
  const head = el('header', 'g-head');
  head.appendChild(el('h1', '', '备份'));
  page.appendChild(head);
  page.appendChild(el('p', 'g-hint', '所有记录只存在这台设备里，不上传任何地方。备份文件是你唯一的保险。'));

  // ---- 状态 ----
  const status = el('div', 'g-card g-status-card');
  if (!storageAvailable()) {
    status.appendChild(statusRow('存储', '存不进去！关掉页面就会丢。是不是开了无痕浏览？', 'bad'));
  }
  if (isPhone()) {
    status.appendChild(
      isStandalone()
        ? statusRow('打开方式', '主屏幕图标 ✓', 'ok')
        : statusRow('打开方式', isIOS() ? '在 Safari 里（请改从主屏幕图标打开）' : '在浏览器里（建议装到桌面）', 'warn'),
    );
  } else {
    status.appendChild(statusRow('打开方式', '电脑浏览器（适合导入备份来查看）', 'plain'));
  }
  const persistRow = statusRow('长期保存', '检查中…', 'plain');
  status.appendChild(persistRow);
  void isPersisted().then((p) => {
    const v = persistRow.querySelector('.g-status-value')!;
    if (p === true) {
      persistRow.className = 'g-status s-ok';
      v.textContent = '已开启 ✓';
    } else if (p === false) {
      persistRow.className = 'g-status s-warn';
      v.textContent = '未开启';
      const again = button('再申请一次', 'g-link', async () => {
        const ok = await requestPersist();
        if (ok) {
          toast('已开启长期保存 ✓');
          ctx.refresh();
        } else {
          toast(isIOS() ? '没批准。从主屏幕图标打开后再试试' : '浏览器没批准。装到桌面后会更容易拿到', 'err', 4000);
        }
      });
      persistRow.appendChild(again);
    } else {
      v.textContent = '这个浏览器不支持申请';
    }
  });
  const today = todayStr();
  if (state.lastExportAt) {
    const d = todayStr(new Date(state.lastExportAt));
    const ago = daysBetween(d, today);
    status.appendChild(statusRow('上次备份', `${formatFull(d)}（${ago === 0 ? '今天' : `${ago} 天前`}）`, ago > 31 ? 'warn' : 'ok'));
  } else {
    status.appendChild(statusRow('上次备份', '还没备份过', liveEntries().length ? 'warn' : 'plain'));
  }
  status.appendChild(statusRow('记录', `共 ${liveEntries().length} 条`, 'plain'));
  page.appendChild(status);

  // ---- 导出 ----
  const ex = el('div', 'g-card');
  ex.appendChild(el('h2', 'g-card-title', '导出备份'));
  ex.appendChild(
    el(
      'p',
      'g-hint',
      isPhone()
        ? '点下面的按钮会弹出分享面板：选“存储到文件”→ iCloud 云盘，或者发给微信“文件传输助手”再存到电脑。存在手机以外的地方才安全。'
        : '会下载一个 .json 文件，放到网盘或别的硬盘里保存。',
    ),
  );
  ex.appendChild(button('导出备份文件', 'g-btn g-btn-primary g-btn-big', () => ctx.runExport()));
  ex.appendChild(
    button('复制备份内容（文件导不出来时用）', 'g-btn g-btn-ghost', async () => {
      if (await copyBackupText()) {
        toast('已复制。粘贴到微信“文件传输助手”或备忘录里保存', 'ok', 4000);
        ctx.refresh();
      } else toast('复制失败，请用上面的“导出备份文件”', 'err');
    }),
  );
  page.appendChild(ex);

  // ---- 恢复 ----
  const im = el('div', 'g-card');
  im.appendChild(el('h2', 'g-card-title', '从备份恢复'));
  im.appendChild(el('p', 'g-hint', '按“合并”处理：备份里有、这里没有的补上；已有的不会重复，也不会被删掉。'));
  const file = el('input', 'g-hidden-file');
  file.type = 'file';
  file.accept = '.json,application/json,text/plain,.txt';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      startRestore(ctx, await f.text());
    } catch {
      toast('读不了这个文件', 'err');
    }
  });
  im.append(file, button('选择备份文件…', 'g-btn g-btn-soft', () => file.click()));

  const paste = el('details', 'g-fold g-paste');
  paste.appendChild(el('summary', '', '或者：粘贴备份内容'));
  const ta = el('textarea', 'g-input');
  ta.rows = 4;
  ta.placeholder = '把之前复制的备份内容粘贴到这里';
  paste.append(
    ta,
    button('读取', 'g-btn g-btn-soft g-btn-sm', () => {
      if (!ta.value.trim()) {
        toast('先粘贴内容', 'err', 1800);
        return;
      }
      startRestore(ctx, ta.value);
    }),
  );
  im.appendChild(paste);
  page.appendChild(im);

  page.appendChild(guides());
  return page;
}

function startRestore(ctx: Ctx, text: string) {
  let parsed;
  try {
    parsed = readBackup(text);
  } catch (err) {
    toast(err instanceof BackupError ? err.message : '读不懂这份备份', 'err');
    return;
  }
  const info = describe(parsed.data);
  const plan = planMerge(parsed);
  const body = el('div', 'g-sheet-body');
  if (parsed.exportedAt) {
    const t = new Date(parsed.exportedAt);
    if (!isNaN(t.getTime())) body.appendChild(el('p', '', `备份时间：${formatFull(todayStr(t))}`));
  }
  body.appendChild(
    el('p', '', info.entries ? `备份里有 ${info.entries} 条记录（${formatFull(info.from)} 到 ${formatFull(info.to)}）。` : '备份里没有记录。'),
  );
  const s = plan.stats;
  const changes: string[] = [];
  if (s.added) changes.push(`新增 ${s.added} 条记录`);
  if (s.updated) changes.push(`更新 ${s.updated} 条记录`);
  if (s.removed) changes.push(`删掉 ${s.removed} 条（在别处已删除的）`);
  if (s.others) changes.push('更新健康节点、发育对照或出生日期');
  body.appendChild(el('p', 'g-strong', changes.length ? `恢复后：${changes.join('，')}。` : '这份备份里的内容，这里都已经有了，不用恢复。'));
  if (parsed.skipped) body.appendChild(el('p', 'g-hint', `有 ${parsed.skipped} 项格式不对，会跳过。`));

  const actions = el('div', 'g-sheet-actions');
  const sheet = openSheet('从备份恢复', body);
  if (changes.length) {
    actions.appendChild(
      button('合并到这台设备', 'g-btn g-btn-primary', async () => {
        const p = commitMerge(plan);
        sheet.close();
        ctx.refresh();
        try {
          await p;
          toast(`已恢复 ✓ ${changes.join('，')}`, 'ok', 3500);
        } catch (err) {
          saveFailed(err);
        }
      }),
    );
  }
  actions.appendChild(button(changes.length ? '取消' : '知道了', 'g-btn g-btn-ghost', () => sheet.close()));
  body.appendChild(actions);
}

function guides(): HTMLElement {
  const box = el('div', 'g-guides');
  const sections: [string, string[]][] = [
    [
      'iPhone：怎样避免数据被清掉',
      [
        '一定要“添加到主屏幕”，以后只从主屏幕图标打开。Safari 里的普通网页，一段时间不打开，数据可能被自动清掉；主屏幕图标不受这条限制。',
        'Safari 和主屏幕图标是两个互不相通的“抽屉”：在 Safari 里记的，图标里看不到。',
        '不要删除这个主屏幕图标——删图标会连数据一起删掉。',
        '不要点“设置 → Safari → 清除历史记录与网站数据”；不要用无痕浏览；不要在微信里打开这个链接。',
        '手机存储空间别塞满，空间太紧时系统可能清理网页数据。',
        '每月导出一次备份，存到 iCloud 云盘或电脑上。这是唯一可靠的保险。',
      ],
    ],
    [
      '在电脑上查看',
      [
        '电脑浏览器打开同一个网址 → “备份”页 → 选择备份文件，就能看到全部记录。',
        '电脑上的是一份独立的副本：在电脑上改了，手机上不会跟着变。建议电脑只用来看。',
      ],
    ],
    [
      '安卓手机',
      [
        '用浏览器菜单里的“添加到主屏幕/安装应用”，以后从桌面图标打开。',
        '手机管家、清理加速里，不要清理这个浏览器的数据，最好把浏览器加进白名单。',
        '不要在“设置 → 应用 → 浏览器”里点“清除数据”。',
      ],
    ],
    [
      '换手机 / 数据丢了怎么办',
      [
        '在新手机上添加到主屏幕，从图标打开 → “备份”页 → 选择备份文件恢复。',
        '网址不要换：数据是跟着网址走的，换了网址就是一个新的空抽屉。',
      ],
    ],
  ];
  for (const [title, items] of sections) {
    const d = el('details', 'g-fold');
    d.appendChild(el('summary', '', title));
    const ul = el('ul', 'g-list');
    for (const t of items) ul.appendChild(el('li', '', t));
    d.appendChild(ul);
    box.appendChild(d);
  }
  return box;
}
