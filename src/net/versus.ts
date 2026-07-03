import { MAPS } from '../maps/maps';
import { DIFFICULTIES, type Difficulty } from '../core/economy';
import { Battle, type GameResult } from '../core/game';
import { randomSeed } from '../core/rng';
import { showStartFlow } from '../ui/menus';
import { showJoin, showRoomWait, showStatus, showVersusHome, showVersusResult } from '../ui/lobby';
import { createRoom, joinRoom, type NetConn, type Room } from './peer';
import type { NetMsg, StatPayload } from './protocol';

interface MatchConfig {
  mapId: string;
  diff: Difficulty;
  seed: number;
  opponentName: string;
}

/** 判定胜负：先比到达波次，再比剩余生命，皆同为平局。 */
function decide(me: StatPayload, opp: StatPayload): 'win' | 'lose' | 'draw' {
  if (me.wave !== opp.wave) return me.wave > opp.wave ? 'win' : 'lose';
  if (me.lives !== opp.lives) return me.lives > opp.lives ? 'win' : 'lose';
  return 'draw';
}

/**
 * 运行整个联机对战流程（选择角色 → 建立连接 → 对局 → 结算）。
 * 自行管理内部界面与资源，返回清理函数供外层在离开时调用。
 */
export function runVersus(app: HTMLElement, onExit: () => void): () => void {
  let destroyed = false;
  let curScreen: HTMLElement | null = null;
  let conn: NetConn | null = null;
  let room: Room | null = null;
  let battle: Battle | null = null;

  const clearScreen = () => {
    curScreen?.remove();
    curScreen = null;
  };
  const disposeBattle = () => {
    battle?.dispose();
    battle = null;
  };
  const dropConn = () => {
    try {
      conn?.close();
    } catch {
      /* ignore */
    }
    conn = null;
    room?.cancel();
    room = null;
  };

  const cleanup = () => {
    destroyed = true;
    disposeBattle();
    clearScreen();
    dropConn();
  };

  const backToHome = () => {
    if (destroyed) return;
    dropConn();
    disposeBattle();
    clearScreen();
    onExit();
  };

  // ---------------------------------------------------------------- 角色选择
  const showHome = () => {
    disposeBattle();
    dropConn();
    clearScreen();
    curScreen = showVersusHome(app, {
      onCreate: hostSetup,
      onJoin: guestJoin,
      onBack: backToHome,
    });
  };

  // ---------------------------------------------------------------- 房主
  const hostSetup = () => {
    clearScreen();
    curScreen = showStartFlow(
      app,
      (mapId, diff) => hostCreate(mapId, diff),
      showHome,
      '创建房间',
    );
  };

  const hostCreate = (mapId: string, diff: Difficulty) => {
    clearScreen();
    const status = showStatus(app, { title: '联机对战', text: '正在创建房间…', onCancel: showHome });
    curScreen = status.root;

    createRoom()
      .then((r) => {
        if (destroyed) {
          r.cancel();
          return;
        }
        room = r;
        clearScreen();
        const wait = showRoomWait(app, { code: r.code, onCancel: showHome });
        curScreen = wait.root;

        r.waitForGuest().then((c) => {
          if (destroyed) {
            c.close();
            return;
          }
          conn = c;
          room = null; // 已收到连接，peer 交由 conn 生命周期管理
          const seed = randomSeed();
          const hostName = '房主';
          c.send({ t: 'config', mapId, diff, seed, hostName } satisfies NetMsg);
          startMatch(c, { mapId, diff, seed, opponentName: '对手' });
        });
      })
      .catch((err) => {
        if (destroyed) return;
        showError('创建房间失败：' + (err?.message ?? '网络不可用'));
      });
  };

  // ---------------------------------------------------------------- 访客
  const guestJoin = () => {
    clearScreen();
    curScreen = showJoin(app, { onConfirm: guestConnect, onBack: showHome });
  };

  const guestConnect = (code: string) => {
    clearScreen();
    const status = showStatus(app, { title: '联机对战', text: `正在连接房间 ${code}…`, onCancel: showHome });
    curScreen = status.root;

    joinRoom(code)
      .then((c) => {
        if (destroyed) {
          c.close();
          return;
        }
        conn = c;
        c.send({ t: 'hello', name: '访客' } satisfies NetMsg);
        status.setText('已连接，等待房主开始…');

        // 等待房主下发对局配置
        c.onMessage((raw) => {
          const msg = raw as NetMsg;
          if (msg?.t === 'config') {
            startMatch(c, {
              mapId: msg.mapId,
              diff: msg.diff,
              seed: msg.seed,
              opponentName: msg.hostName || '房主',
            });
          }
        });
        c.onClose(() => {
          if (!destroyed && !battle) showError('房主已离开');
        });
      })
      .catch((err) => {
        if (destroyed) return;
        showError(err?.message ?? '连接失败');
      });
  };

  // ---------------------------------------------------------------- 对局
  const startMatch = (c: NetConn, cfg: MatchConfig) => {
    clearScreen();
    const def = MAPS.find((m) => m.id === cfg.mapId);
    if (!def) {
      showError('地图不存在');
      return;
    }

    let myFinal: StatPayload | null = null;
    let oppFinal: StatPayload | null = null;
    let waiting: { root: HTMLElement; setText: (t: string) => void } | null = null;

    const tryResolve = () => {
      if (!myFinal || !oppFinal) return;
      const outcome = decide(myFinal, oppFinal);
      clearScreen();
      curScreen = showVersusResult(app, {
        outcome,
        me: myFinal,
        opp: oppFinal,
        mapName: def.name,
        diffLabel: DIFFICULTIES[cfg.diff].label,
        onRematch: showHome,
        onMenu: backToHome,
      });
    };

    const onLocalEnd = (result: GameResult) => {
      // 正常情况下 myFinal 已由 Battle 结束时的最终 stat 回调填好（含真实剩余生命）；这里兜底。
      if (!myFinal) {
        myFinal = {
          wave: result.wave,
          lives: 0,
          maxLives: DIFFICULTIES[cfg.diff].lives,
          gold: 0,
          over: true,
          won: result.won,
        };
      }
      disposeBattle();
      if (oppFinal) {
        tryResolve();
      } else {
        const w = showStatus(app, {
          title: '对局结束',
          text: '等待对手结束…',
          onCancel: backToHome,
          cancelLabel: '退出',
        });
        waiting = w;
        curScreen = w.root;
      }
    };

    // 收网络消息
    c.onMessage((raw) => {
      const msg = raw as NetMsg;
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'stat') {
        if (msg.s.over) {
          oppFinal = msg.s;
          if (waiting) waiting.setText('对手已结束，正在结算…');
          if (myFinal) tryResolve();
          else battle?.setOpponentStat(msg.s);
        } else {
          battle?.setOpponentStat(msg.s);
          if (waiting) waiting.setText(`对手仍在战斗 · 第 ${msg.s.wave} 波（剩 ${msg.s.lives}❤）`);
        }
      }
    });

    c.onClose(() => {
      if (destroyed) return;
      // 对手掉线：若尚未结算，判对手弃权
      if (!oppFinal) {
        oppFinal = { wave: 0, lives: 0, maxLives: DIFFICULTIES[cfg.diff].lives, gold: 0, over: true, won: false };
        if (waiting) waiting.setText('对手已掉线');
        if (myFinal) tryResolve();
      }
    });

    battle = new Battle(app, def, cfg.diff, onLocalEnd, {
      seed: cfg.seed,
      net: {
        opponentName: cfg.opponentName,
        onStat: (s) => {
          // 记录本方真实最终战况（含正确的剩余生命）
          if (s.over) myFinal = s;
          c.send({ t: 'stat', s } satisfies NetMsg);
        },
      },
    });
  };

  const showError = (text: string) => {
    dropConn();
    disposeBattle();
    clearScreen();
    const s = showStatus(app, { title: '联机对战', text, onCancel: showHome, cancelLabel: '返回' });
    curScreen = s.root;
  };

  showHome();
  return cleanup;
}
