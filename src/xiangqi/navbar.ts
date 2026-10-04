/**
 * 每一屏左上角的"← 返回"和"现在在哪"。
 *
 * 用户原话："有些界面甚至没有返回键（比如复盘界面）……我希望有一个统一的私教入口，点进去之后能通过层级菜单一级一级往下选。"
 * 原来返回按钮放在每屏最底下（列表一长就要滚到底才找得到），有几屏干脆没有。
 * 现在统一：顶上一条，左边"← 返回"，右边写现在在哪（私教 › 布局），滚动时钉在顶上。
 */
export function navBar(path: string, onBack: () => void): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'xq-nav';
  bar.innerHTML = `<button class="xq-nav-back" data-nav-back>← 返回</button><span class="xq-nav-path"></span>`;
  (bar.querySelector('.xq-nav-path') as HTMLElement).textContent = path;
  (bar.querySelector('button') as HTMLButtonElement).onclick = () => onBack();
  return bar;
}

/**
 * 把一屏底下那个"← 返回"挪到顶栏上（不重复放）。back 给了就用 back，
 * 没给就用原来那个按钮的去处；两样都没有就用 fallback。返回顶栏元素。
 */
export function liftBack(scr: HTMLElement, path: string, back?: () => void, fallback?: () => void): HTMLElement {
  const old = [...scr.querySelectorAll<HTMLButtonElement>(':scope > button.btn.ghost')].reverse().find((b) => /返回/.test(b.textContent ?? ''));
  const oldGo = old?.onclick ? (old.onclick as unknown as () => void) : null;
  const go = back ?? oldGo ?? fallback ?? (() => history.back());
  old?.remove();
  const bar = navBar(path, go);
  scr.prepend(bar);
  return bar;
}

/**
 * 长说明折起来：用户原话"现在界面上的信息太多、太繁杂了，看起来很费劲"。
 * 一屏上那些一大段的说明框（.xq-advice，超过一百多字的）改成可以点开的折叠框，标题留着、正文点开才看；
 * 这一课真正要学的那几块（data-keep）不折。
 */
export function foldLong(scr: HTMLElement, limit = 140) {
  for (const el of [...scr.querySelectorAll<HTMLElement>(':scope > .xq-advice')]) {
    if (el.dataset.keep !== undefined || el.tagName === 'DETAILS') continue;
    if ((el.textContent ?? '').replace(/\s+/g, '').length <= limit) continue;
    const head = el.querySelector(':scope > b');
    const d = document.createElement('details');
    d.className = `${el.className} xq-fold`;
    for (const [k, v] of Object.entries(el.dataset)) if (v !== undefined) d.dataset[k] = v;
    const sum = document.createElement('summary');
    sum.innerHTML = head ? head.innerHTML : '说明';
    head?.remove();
    d.appendChild(sum);
    while (el.firstChild) d.appendChild(el.firstChild);
    el.replaceWith(d);
  }
}
