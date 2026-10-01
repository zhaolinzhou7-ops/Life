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

async function launchSing() {
  clear();
  const { bootSing } = await import('./sing/index');
  dispose = bootSing(app, showHome);
}

async function launchXiangqi() {
  clear();
  const { bootXiangqi } = await import('./xiangqi/index');
  dispose = bootXiangqi(app, (restart) => {
    if (restart) launchXiangqi();
    else showHome();
  });
}

async function launchNaming() {
  clear();
  const { bootNaming } = await import('./naming/index');
  dispose = bootNaming(app, showHome);
}

async function launchEnglish() {
  clear();
  const { bootEnglish } = await import('./english/index');
  dispose = bootEnglish(app, showHome);
}

async function launchDoudizhu() {
  clear();
  const { bootDoudizhu } = await import('./doudizhu/index');
  dispose = bootDoudizhu(app, (restart) => {
    if (restart) launchDoudizhu();
    else showHome();
  });
}

async function launchMahjong() {
  clear();
  const { bootMahjong } = await import('./mahjong/index');
  dispose = bootMahjong(app, (restart) => {
    if (restart) launchMahjong();
    else showHome();
  });
}

/**
 * 每个应用都是按需加载的：点卡片 → clear() 清掉首页 → import 那个应用的代码。
 *
 * import 失败时首页已经没了，不接住就是一整屏空白，只能手动刷新。会失败的情况有两种：
 *  · 断网（手机在地铁里、平板只连着家里的 Wi-Fi 被带出门）
 *  · 刚部署过新版本：旧页面里引用的带 hash 的文件名在服务器上已经不存在了。
 *    GitHub Pages 每次部署都会这样，开着旧页面的人点任何一个入口都会白屏。
 */
function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to fetch/i.test(msg);
}

function showLoadError(e: unknown, retry: () => void) {
  clear();
  const chunk = isChunkLoadError(e);
  const screen = document.createElement('div');
  screen.className = 'screen home-screen';
  const h1 = document.createElement('h1');
  h1.textContent = '没能打开';
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.style.maxWidth = '340px';
  sub.style.lineHeight = '1.7';
  sub.textContent = !navigator.onLine
    ? '网络好像断了，这个应用还没下载下来。连上网之后点「重试」。'
    : chunk
      ? '页面可能刚更新过，点「重试」会加载最新版本。'
      : '打开的时候出了点问题，可以再试一次。';
  const list = document.createElement('div');
  list.className = 'card-list';
  const button = (title: string, onClick: () => void) => {
    const card = document.createElement('div');
    card.className = 'card home-card';
    card.innerHTML = `<div class="title" style="text-align:center"></div>`;
    (card.firstElementChild as HTMLElement).textContent = title;
    card.addEventListener('click', onClick);
    return card;
  };
  list.appendChild(
    button('重试', () => {
      if (!navigator.onLine) {
        sub.textContent = '还没连上网。连上之后再点一次「重试」。';
        return;
      }
      // 浏览器会把失败的动态 import 缓存到页面关闭为止，原地再 import 一次还是失败，
      // 只能整页重新加载。不是加载失败（是应用自己出错）的才原地重试。
      if (chunk) location.reload();
      else retry();
    }),
  );
  list.appendChild(button('返回首页', showHome));
  screen.append(h1, sub, list);
  app.appendChild(screen);
}

/** 打开一个应用。加载失败时给出能走下去的界面，而不是白屏 */
function open(go: () => Promise<void>) {
  go().catch((e: unknown) => {
    console.error(e);
    showLoadError(e, () => open(go));
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
      title: '🦜 AI 儿童英语学习伙伴',
      desc: '4~12 岁英语启蒙：每天一个 10~15 分钟的小任务，学词、听故事、玩游戏、和 AI 说几句。会记住孩子哪里不会，自动安排复习。带家长端。',
      go: launchEnglish,
      tag: 'NEW',
    },
    {
      title: '✒️ AI 智能取名',
      desc: '给孩子取个名字：说清你想要什么，从音律、寓意、字形、出处到日常好不好用逐项筛过，只给少量真正值得考虑的。',
      go: launchNaming,
      tag: 'NEW',
    },
    {
      title: '🃏 斗地主 · 单人对战',
      desc: '一个人加两个 AI，叫地主、抢底牌、飞机炸弹全都有。AI 会记牌、会配合队友，三档难度。',
      go: launchDoudizhu,
      tag: 'NEW',
    },
    {
      title: '🀄 四川麻将 · 血战到底',
      desc: '3D 麻将桌实景，定缺、碰杠、自摸血战到底，和 3 个 AI 打一圈。',
      go: launchMahjong,
      tag: 'NEW',
    },
    {
      title: '♟️ 中国象棋 · 3D 对弈',
      desc: '3D 木纹棋盘、立体棋子与走子动画，楚河汉界排兵布阵，单人对战 AI。',
      go: launchXiangqi,
      tag: 'NEW',
    },
    {
      title: '🎤 唱吧减压 · 学唱歌',
      desc: '上班压力大就唱出来：引导呼吸开嗓、音准训练、声控小鸟，还有跟唱打分卡拉 OK。',
      go: launchSing,
      tag: 'NEW',
    },
    {
      title: '⚔️ 手机 MOBA · 一路推塔',
      desc: '虚拟摇杆走位，四个技能连招，带兵推塔，摧毁敌方水晶取胜。1v1 单人对战 AI。',
      go: launchMoba,
      tag: '',
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
    card.addEventListener('click', () => open(g.go));
    list.appendChild(card);
  }
  screen.appendChild(list);
  app.appendChild(screen);
}

showHome();
