/** 塔防远征启动入口：封装原有的菜单/战斗/结算流程，返回清理函数 */
import { MAPS } from './maps/maps';
import { DIFFICULTIES, TOTAL_WAVES, type Difficulty } from './core/economy';
import { Battle, type GameResult } from './core/game';
import { showResult, showStartFlow } from './ui/menus';
import { initAudio } from './audio';

export function bootTowerDefense(app: HTMLElement): () => void {
  // 首次触摸/点击时解锁音频（浏览器要求用户手势）
  const unlockAudio = () => initAudio();
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  let battle: Battle | null = null;
  let currentScreen: HTMLElement | null = null;

  const clearScreen = () => {
    currentScreen?.remove();
    currentScreen = null;
  };
  const disposeBattle = () => {
    battle?.dispose();
    battle = null;
  };

  const toMenu = () => {
    disposeBattle();
    clearScreen();
    currentScreen = showStartFlow(app, (mapId, diff, endless) => startBattle(mapId, diff, endless));
  };

  const startBattle = (mapId: string, diff: Difficulty, endless: boolean) => {
    clearScreen();
    disposeBattle();
    const def = MAPS.find((m) => m.id === mapId)!;
    battle = new Battle(app, def, diff, endless, (result: GameResult) =>
      onBattleEnd(mapId, diff, endless, result),
    );
  };

  const onBattleEnd = (mapId: string, diff: Difficulty, endless: boolean, result: GameResult) => {
    disposeBattle();
    const def = MAPS.find((m) => m.id === mapId)!;
    currentScreen = showResult(
      app,
      {
        won: result.won,
        wave: result.wave,
        totalWaves: TOTAL_WAVES,
        mapName: def.name,
        diffLabel: DIFFICULTIES[diff].label,
        endless,
        newRecord: result.newRecord,
      },
      () => startBattle(mapId, diff, endless),
      () => toMenu(),
    );
  };

  toMenu();

  return () => {
    window.removeEventListener('pointerdown', unlockAudio);
    disposeBattle();
    clearScreen();
  };
}
