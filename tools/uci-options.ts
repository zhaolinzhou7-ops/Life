/** 打印皮卡鱼的 UCI 选项（看它支持哪些削弱棋力的开关）。node tools/run.mjs uci-options */
import { startPikafish } from './pikafish-node';
const e = await startPikafish(16);
console.log(e.send('uci').filter((l) => l.startsWith('option') || l.startsWith('id')).join('\n'));
