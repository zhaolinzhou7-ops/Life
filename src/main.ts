import './style.css';
import { MAPS } from './maps/maps';
import { DIFFICULTIES, TOTAL_WAVES, type Difficulty } from './core/economy';
import { Battle, type GameResult } from './core/game';
import { showResult, showStartFlow } from './ui/menus';
import { initAudio } from './audio';

// 首次触摸/点击时解锁音频（浏览器要求用户手势）
window.addEventListener('pointerdown', () => initAudio(), { once: true });

const app = document.getElementById('app') as HTMLElement;

let battle: Battle | null = null;
let currentScreen: HTMLElement | null = null;

function clearScreen() {
  currentScreen?.remove();
  currentScreen = null;
}

function disposeBattle() {
  battle?.dispose();
  battle = null;
}

function toMenu() {
  disposeBattle();
  clearScreen();
  currentScreen = showStartFlow(app, (mapId, diff, endless) => startBattle(mapId, diff, endless));
}

function startBattle(mapId: string, diff: Difficulty, endless: boolean) {
  clearScreen();
  disposeBattle();
  const def = MAPS.find((m) => m.id === mapId)!;
  battle = new Battle(app, def, diff, endless, (result: GameResult) => onBattleEnd(mapId, diff, endless, result));
}

function onBattleEnd(mapId: string, diff: Difficulty, endless: boolean, result: GameResult) {
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
}

toMenu();
