import './style.css';
import { MAPS } from './maps/maps';
import { DIFFICULTIES, TOTAL_WAVES, type Difficulty } from './core/economy';
import { Battle, type GameResult } from './core/game';
import { showResult, showStartFlow } from './ui/menus';

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
  currentScreen = showStartFlow(app, (mapId, diff) => startBattle(mapId, diff));
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
    () => toMenu(),
  );
}

toMenu();
