import './style.css';

const app = document.getElementById('app') as HTMLElement;

let dispose: (() => void) | null = null;

function clear() {
  dispose?.();
  dispose = null;
  app.innerHTML = '';
}

// 两款游戏各自按需加载，避免打开首页/MOBA 时就下载 3D 塔防依赖
async function launchTowerDefense() {
  clear();
  const { bootTowerDefense } = await import('./td');
  dispose = bootTowerDefense(app);
}

async function launchMoba() {
  clear();
  const { bootMoba } = await import('./moba/index');
  dispose = bootMoba(app, (restart) => {
    if (restart) launchMoba();
    else showHome();
  });
}

function showHome() {
  clear();
  const screen = document.createElement('div');
  screen.className = 'screen home-screen';
  screen.innerHTML = `
    <h1>Life · 小游戏合集</h1>
    <div class="sub">打开网页即玩 · 手机电脑都支持 · 无需安装</div>
  `;
  const list = document.createElement('div');
  list.className = 'card-list';

  const games = [
    {
      title: '⚔️ 手机 MOBA · 一路推塔',
      desc: '虚拟摇杆走位，四个技能连招，带兵推塔，摧毁敌方水晶取胜。1v1 单人对战 AI。',
      go: launchMoba,
      tag: 'NEW',
    },
    {
      title: '🏹 塔防远征 · 3D 塔防',
      desc: '建塔升级，顶住 25 波进攻或挑战无尽模式，守住你的水晶基地。两张地图三档难度。',
      go: launchTowerDefense,
      tag: '',
    },
  ];

  for (const g of games) {
    const card = document.createElement('div');
    card.className = 'card home-card';
    card.innerHTML = `
      <div class="title">${g.title} ${g.tag ? `<span class="tag">${g.tag}</span>` : ''}</div>
      <div class="desc">${g.desc}</div>`;
    card.addEventListener('click', g.go);
    list.appendChild(card);
  }
  screen.appendChild(list);
  app.appendChild(screen);
}

showHome();
