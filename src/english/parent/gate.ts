/**
 * 家长验证
 *
 * 先把话说清楚：**这不是安全措施。** 它挡的是一个不会做两位数乘法的孩子，
 * 不是任何有心的人。代码在前端，答案就在代码里，谁都能绕过去。
 *
 * 它要解决的真实问题只有一个：孩子自己点进家长端，把每日时长调成 60 分钟、
 * 把难度调到最高、或者不小心把学习记录删了。一道算术题就足够了。
 *
 * 所以这里不做任何"看起来很安全"的表演——不加密、不哈希、不锁定尝试次数。
 * 假装有安全性比明说没有更糟：家长会以为这道门真的锁得住什么。
 */

import { getParentPin } from '../store';
import { el, btn, page, topbar, card } from '../ui';

/** 出一道两位数乘法。孩子做不出来，家长心算一下就行 */
function question(): { text: string; answer: number } {
  const a = 3 + Math.floor(Math.random() * 7); // 3~9
  const b = 11 + Math.floor(Math.random() * 9); // 11~19
  return { text: `${a} × ${b} = ?`, answer: a * b };
}

export function renderGate(onPass: () => void, onCancel: () => void): HTMLElement {
  const pin = getParentPin();
  const q = question();

  const root = page('parent');
  root.appendChild(topbar('家长验证', onCancel));

  const c = card();
  c.appendChild(
    el('p', undefined, pin ? '请输入家长密码。' : '请回答下面的问题，确认是家长在操作。'),
  );

  const label = el('div', 'en-field');
  const lab = el('label', undefined, pin ? '家长密码' : q.text);
  label.appendChild(lab);
  const input = el('input', 'en-input');
  input.type = pin ? 'password' : 'text';
  input.inputMode = pin ? 'text' : 'numeric';
  input.autocomplete = 'off';
  input.placeholder = pin ? '' : '输入答案';
  label.appendChild(input);
  c.appendChild(label);

  const err = el('p');
  err.style.color = 'var(--bad)';
  err.style.minHeight = '20px';
  c.appendChild(err);

  const submit = () => {
    const v = input.value.trim();
    if (pin ? v === pin : Number(v) === q.answer) {
      onPass();
    } else {
      err.textContent = pin ? '密码不对，再试一次。' : '答案不对，再算一次。';
      input.value = '';
      input.focus();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  const row = el('div', 'en-pbtn-row');
  row.appendChild(btn('进入', 'en-pbtn primary', submit));
  row.appendChild(btn('取消', 'en-pbtn', onCancel));
  c.appendChild(row);

  const note = el('p');
  note.style.fontSize = '12px';
  note.style.color = 'var(--ink-3)';
  note.textContent =
    '这道题只是为了挡住孩子误入设置页，不是安全措施——代码在浏览器里，有心的人随时能绕过。真正的保护是：所有数据都只存在这台设备上，不上传。';
  c.appendChild(note);

  root.appendChild(c);
  setTimeout(() => input.focus(), 60);
  return root;
}
