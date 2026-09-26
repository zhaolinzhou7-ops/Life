/** 某一手之后的杀棋，引擎要算多久才看得见（每次都清空置换表）。排查教练漏拦用 */
import { startPikafish } from './pikafish-node';
import { parseInfo } from '../src/xiangqi/pikafish';
const [, , fen, mv, runs = '6', ms = '8000'] = process.argv;
const e = await startPikafish(32);
for (let i = 0; i < Number(runs); i++) {
  e.send('ucinewgame');
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send(`go movetime ${ms}${mv ? ` searchmoves ${mv}` : ''}`);
  const first = lines.map((l) => ({ l, p: parseInfo(l) })).find((x) => x.p && !x.p.bound && x.p.mateIn !== undefined);
  const t = first ? Number(/ time (\d+)/.exec(first.l)?.[1]) : NaN;
  const last = lines.map(parseInfo).filter((x) => x && !x.bound).pop();
  console.log(`run ${i}: ${first ? `杀 ${first.p!.mateIn} 在第 ${first.p!.depth} 层、${t}ms 看见` : '没看见杀'}；最后 ${last?.depth} 层 ${last?.mateIn ?? last?.score}`);
}
