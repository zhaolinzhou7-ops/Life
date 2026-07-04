/** MOBA 启动入口：画布、HUD、商店、主循环与结算。返回清理函数 */
import { SHOP } from './config';
import { Controls } from './input';
import { MobaGame, type MobaResult } from './game';

/** onExit(restart): restart=true 表示重开一局，false 表示返回首页 */
export function bootMoba(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'moba-root';
  app.appendChild(wrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'moba-canvas';
  wrap.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  let cssW = 0;
  let cssH = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  // ---- 顶部 HUD ----
  const hud = document.createElement('div');
  hud.className = 'moba-top';
  hud.innerHTML = `
    <div class="moba-bases">
      <span class="moba-base enemy">敌方水晶 <b id="mb-enemy">100%</b></span>
      <span class="moba-time" id="mb-time">0:00</span>
      <span class="moba-base ally">我方水晶 <b id="mb-ally">100%</b></span>
    </div>
    <div class="moba-hero-row">
      <span class="moba-lv" id="mb-lv">Lv.1</span>
      <div class="moba-bar hp"><i id="mb-hp"></i><em id="mb-hp-t"></em></div>
      <div class="moba-bar mp"><i id="mb-mp"></i></div>
      <span class="moba-gold">💰 <b id="mb-gold">0</b></span>
      <span class="moba-kda" id="mb-kda">0/0</span>
    </div>`;
  wrap.appendChild(hud);

  // 返回按钮
  const backBtn = document.createElement('button');
  backBtn.className = 'moba-back';
  backBtn.textContent = '← 退出';
  backBtn.addEventListener('click', () => onExit(false));
  wrap.appendChild(backBtn);

  // ---- 商店 ----
  const shopBtn = document.createElement('button');
  shopBtn.className = 'moba-shop-btn';
  shopBtn.innerHTML = '🛒';
  wrap.appendChild(shopBtn);

  const shop = document.createElement('div');
  shop.className = 'moba-shop hidden';
  shop.innerHTML = `<div class="moba-shop-head">装备商店<span class="moba-shop-hint" id="shop-hint"></span></div>`;
  const shopItems: Record<string, HTMLElement> = {};
  for (const it of SHOP) {
    const b = document.createElement('button');
    b.className = 'moba-shop-item';
    b.innerHTML = `<span class="si-ic">${it.icon}</span><span class="si-name">${it.name}</span><span class="si-desc">${it.desc}</span><span class="si-cost" data-id="${it.id}">${it.baseCost}</span>`;
    b.addEventListener('click', () => {
      game.buy(it.id);
    });
    shop.appendChild(b);
    shopItems[it.id] = b.querySelector('.si-cost') as HTMLElement;
  }
  wrap.appendChild(shop);
  shopBtn.addEventListener('click', () => shop.classList.toggle('hidden'));

  const toast = document.createElement('div');
  toast.className = 'moba-toast';
  wrap.appendChild(toast);
  let lastMsg = '';

  const controls = new Controls(wrap);

  // ---- 主循环 ----
  const game = new MobaGame((r) => showResult(r));
  let raf = 0;
  let last = performance.now();
  let disposed = false;
  let resultScreen: HTMLElement | null = null;

  const pct = (a: number, b: number) => Math.max(0, Math.round((a / b) * 100)) + '%';

  const loop = (now: number) => {
    if (disposed) return;
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // 限制卡顿时的步长

    if (!resultScreen) {
      game.update(dt, controls);
      game.render(ctx, cssW, cssH);
      updateHud();
    }
    raf = requestAnimationFrame(loop);
  };

  function updateHud() {
    const p = game.player;
    const enemyBase = game.structures.find((s) => s.team === 'enemy' && s.kind === 'base')!;
    const allyBase = game.structures.find((s) => s.team === 'ally' && s.kind === 'base')!;
    setText('mb-enemy', pct(enemyBase.hp, enemyBase.maxHp));
    setText('mb-ally', pct(allyBase.hp, allyBase.maxHp));
    const t = Math.floor(game.time);
    setText('mb-time', `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`);
    setText('mb-lv', 'Lv.' + p.level);
    setBar('mb-hp', p.hp / p.maxHp);
    setText('mb-hp-t', `${Math.max(0, Math.ceil(p.hp))}/${Math.round(p.maxHp)}`);
    setBar('mb-mp', p.mana / p.maxMana);
    setText('mb-gold', Math.floor(game.gold).toString());
    setText('mb-kda', `${p.kills}/${p.deaths}`);

    // 商店
    const canShop = game.canShop();
    setText('shop-hint', canShop ? '（可购买）' : '（需回到己方水晶附近）');
    for (const it of SHOP) {
      const count = (p.up as Record<string, number>)[it.id];
      const cost = game.itemCost(it.id, count);
      const el = shopItems[it.id];
      el.textContent = '💰' + cost;
      el.parentElement!.classList.toggle('afford', canShop && game.gold >= cost);
    }
    if (game.shopMsg && game.shopMsg !== lastMsg) {
      lastMsg = game.shopMsg;
      showToast(game.shopMsg);
      game.shopMsg = '';
    }
  }

  function setText(id: string, v: string) {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  }
  function setBar(id: string, frac: number) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, frac * 100)) + '%';
  }
  let toastTimer = 0;
  function showToast(msg: string) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1400);
  }

  function showResult(r: MobaResult) {
    const s = document.createElement('div');
    s.className = 'screen moba-result';
    const t = Math.floor(r.time);
    s.innerHTML = `
      <h1 style="color:${r.won ? '#66bb6a' : '#ef5350'}">${r.won ? '胜利 · 摧毁敌方水晶' : '失败 · 水晶被摧毁'}</h1>
      <div class="sub">对局时长 ${Math.floor(t / 60)}分${(t % 60).toString().padStart(2, '0')}秒 · KDA ${game.player.kills}/${game.player.deaths} · 等级 ${game.player.level}</div>`;
    const again = document.createElement('button');
    again.className = 'btn';
    again.textContent = '再来一局';
    again.addEventListener('click', () => onExit(true));
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '返回首页';
    back.addEventListener('click', () => onExit(false));
    s.appendChild(again);
    s.appendChild(back);
    wrap.appendChild(s);
    resultScreen = s;
  }

  raf = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    window.removeEventListener('resize', resize);
    controls.dispose();
    wrap.remove();
  };
}
