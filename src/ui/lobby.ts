import type { StatPayload } from '../net/protocol';

/** 联机首页：选择创建房间（房主）或加入房间（访客）。 */
export function showVersusHome(
  container: HTMLElement,
  cb: { onCreate: () => void; onJoin: () => void; onBack: () => void },
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <h1>联机对战</h1>
    <div class="sub">同一套波次，比谁守得更久 · 走得更远</div>
  `;

  const create = document.createElement('button');
  create.className = 'btn';
  create.innerHTML = '➕ 创建房间';
  create.addEventListener('click', cb.onCreate);
  screen.appendChild(create);

  const join = document.createElement('button');
  join.className = 'btn ghost';
  join.innerHTML = '🔑 加入房间';
  join.addEventListener('click', cb.onJoin);
  screen.appendChild(join);

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '返回';
  back.addEventListener('click', cb.onBack);
  screen.appendChild(back);

  const hint = document.createElement('div');
  hint.style.cssText = 'color:var(--muted);font-size:11.5px;margin-top:14px;text-align:center;max-width:460px;';
  hint.textContent = '需要双方都能联网。连接通过浏览器点对点（WebRTC）建立，可能因严格的网络环境失败。';
  screen.appendChild(hint);

  container.appendChild(screen);
  return screen;
}

/** 房主等待界面：展示房间码，等对手加入。 */
export function showRoomWait(
  container: HTMLElement,
  cb: { code: string; onCancel: () => void },
): { root: HTMLElement; setStatus: (t: string) => void } {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <h1>房间已创建</h1>
    <div class="sub">把房间码告诉好友，让 TA 加入</div>
    <div class="room-code">${cb.code}</div>
    <div class="lobby-status" data-status>等待对手加入…</div>
  `;

  const cancel = document.createElement('button');
  cancel.className = 'btn ghost';
  cancel.textContent = '取消';
  cancel.addEventListener('click', cb.onCancel);
  screen.appendChild(cancel);

  container.appendChild(screen);
  return {
    root: screen,
    setStatus: (t: string) => {
      const el = screen.querySelector('[data-status]') as HTMLElement | null;
      if (el) el.textContent = t;
    },
  };
}

/** 访客加入界面：输入房间码。 */
export function showJoin(
  container: HTMLElement,
  cb: { onConfirm: (code: string) => void; onBack: () => void },
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <h1>加入房间</h1>
    <div class="sub">输入好友给你的 4 位房间码</div>
  `;

  const input = document.createElement('input');
  input.className = 'code-input';
  input.maxLength = 4;
  input.placeholder = '____';
  input.autocapitalize = 'characters';
  input.spellcheck = false;
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  });
  screen.appendChild(input);

  const submit = () => {
    const code = input.value.trim().toUpperCase();
    if (code.length === 4) cb.onConfirm(code);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  const go = document.createElement('button');
  go.className = 'btn';
  go.textContent = '加入';
  go.addEventListener('click', submit);
  screen.appendChild(go);

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '返回';
  back.addEventListener('click', cb.onBack);
  screen.appendChild(back);

  container.appendChild(screen);
  setTimeout(() => input.focus(), 50);
  return screen;
}

/** 通用状态界面（连接中 / 等待对手结束等）。 */
export function showStatus(
  container: HTMLElement,
  cb: { title: string; text: string; onCancel?: () => void; cancelLabel?: string },
): { root: HTMLElement; setText: (t: string) => void } {
  const screen = document.createElement('div');
  screen.className = 'screen';
  screen.innerHTML = `
    <h1>${cb.title}</h1>
    <div class="lobby-status" data-status>${cb.text}</div>
    <div class="spinner"></div>
  `;
  if (cb.onCancel) {
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost';
    cancel.textContent = cb.cancelLabel ?? '取消';
    cancel.addEventListener('click', cb.onCancel);
    screen.appendChild(cancel);
  }
  container.appendChild(screen);
  return {
    root: screen,
    setText: (t: string) => {
      const el = screen.querySelector('[data-status]') as HTMLElement | null;
      if (el) el.textContent = t;
    },
  };
}

/** 对战结算界面。 */
export function showVersusResult(
  container: HTMLElement,
  cb: {
    outcome: 'win' | 'lose' | 'draw';
    me: StatPayload;
    opp: StatPayload;
    mapName: string;
    diffLabel: string;
    onRematch: () => void;
    onMenu: () => void;
  },
): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'screen';
  const badge = cb.outcome === 'win' ? '🏆' : cb.outcome === 'lose' ? '🥈' : '🤝';
  const title = cb.outcome === 'win' ? '你赢了！' : cb.outcome === 'lose' ? '惜败' : '平局';
  const line = (s: StatPayload) =>
    `第 ${s.wave} 波 · ${s.won ? '通关' : `剩余 ${s.lives}❤`}`;

  screen.innerHTML = `
    <div class="result-badge">${badge}</div>
    <h1>${title}</h1>
    <div class="result-lines">${cb.mapName} · ${cb.diffLabel}</div>
    <div class="vs-table">
      <div class="vs-row me"><span class="vs-who">我</span><span class="vs-val">${line(cb.me)}</span></div>
      <div class="vs-row"><span class="vs-who">对手</span><span class="vs-val">${line(cb.opp)}</span></div>
    </div>
  `;

  const rematch = document.createElement('button');
  rematch.className = 'btn';
  rematch.textContent = '再来一局';
  rematch.addEventListener('click', cb.onRematch);
  screen.appendChild(rematch);

  const menu = document.createElement('button');
  menu.className = 'btn ghost';
  menu.textContent = '返回主菜单';
  menu.addEventListener('click', cb.onMenu);
  screen.appendChild(menu);

  container.appendChild(screen);
  return screen;
}
