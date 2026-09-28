/**
 * 在 Node 里跑皮卡鱼，给离线工具用（验证布局破解、残局结论……）。
 * 引擎文件和浏览器里用的是同一份（vendor/pikafish/），结论和线上教练一致。
 *
 * send_command 是同步的：一条 go 会一直算到结束，输出通过 read_stdout 逐行回调。
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

export interface NodeEngine {
  /** 发一条命令，返回这条命令期间引擎输出的所有行 */
  send(cmd: string): string[];
}

export async function startPikafish(hash = 64): Promise<NodeEngine> {
  const dir = path.resolve('vendor/pikafish');
  // 仓库是 "type": "module"，引擎胶水是 CommonJS：拷成 .cjs 再 require，文件本身不动
  const cjs = path.resolve('node_modules/.cache/pikafish.cjs');
  fs.mkdirSync(path.dirname(cjs), { recursive: true });
  fs.copyFileSync(path.join(dir, 'pikafish.js'), cjs);
  const factory = require(cjs);
  const wasmBinary = fs.readFileSync(path.join(dir, 'pikafish.wasm'));
  const data = fs.readFileSync(path.join(dir, 'pikafish.data'));
  let sink: string[] = [];
  const m = await factory({
    wasmBinary,
    getPreloadedPackage: () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    locateFile: (f: string) => path.join(dir, f),
    read_stdout: (s: string) => sink.push(s),
    print: () => {},
    printErr: () => {},
  });
  m.read_stdout = (s: string) => sink.push(s);
  const send = (cmd: string) => {
    sink = [];
    m.send_command(cmd);
    return sink;
  };
  send('uci');
  send(`setoption name Hash value ${hash}`);
  send('isready');
  return { send };
}
