import './style.css';
import { MAPS } from './maps/maps';
import { DIFFICULTIES, TOTAL_WAVES, type Difficulty } from './core/economy';
import { Battle, type GameResult } from './core/game';
import { showHome, showResult, showStartFlow } from './ui/menus';
import { runVersus } from './net/versus';

const app = document.getElementById('app') as HTMLElement;

let battle: Battle | null = null;
let currentScreen: HTMLElement | null = null;
let disposeFlow: (() => void) | null = null; // 联机流程自管理的清理句柄

function clearScreen() {
  currentScreen?.remove();
  currentScreen = null;
}

function disposeBattle() {
  battle?.dispose();
  battle = null;
}

/** 离开当前任何界面/对局/联机流程，回到干净状态。 */
function disposeAll() {
  disposeFlow?.();
  disposeFlow = null;
  clearScreen();
  disposeBattle();
}

function toHome() {
  disposeAll();
  currentScreen = showHome(app, { onSingle: toSingleSelect, onVersus: toVersus });
}

function toSingleSelect() {
  disposeAll();
  currentScreen = showStartFlow(app, (mapId, diff) => startBattle(mapId, diff), toHome);
}

function toVersus() {
  disposeAll();
  disposeFlow = runVersus(app, toHome);
}

function startBattle(mapId: string, diff: Difficulty) {
  clearScreen();
  disposeBattle();
  const def = MAPS.find((m) => m.id === mapId)!;
  battle = new Battle(app, def, diff, (result: GameResult) => onBattleEnd(mapId, diff, result));
}

function onBattleEnd(mapId: string, diff: Difficulty, result: GameResult) {
  disposeBattle();
  const def = MAPS.find((m) => m.id === mapId)!;
  currentScreen = showResult(
    app,
    result.won,
    result.wave,
    TOTAL_WAVES,
    def.name,
    DIFFICULTIES[diff].label,
    () => startBattle(mapId, diff),
    () => toSingleSelect(),
  );
}

toHome();
