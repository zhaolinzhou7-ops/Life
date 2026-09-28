// 跑 tools/ 下的 TypeScript 工具：esbuild 打包成一个 .mjs 再用 node 跑（引擎要关掉 Node 自带的 fetch）
import { execFileSync } from 'child_process';
const [name, ...args] = process.argv.slice(2);
const out = `node_modules/.cache/tool-${name}.mjs`;
execFileSync('node_modules/.bin/esbuild', [`tools/${name}.ts`, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`, '--log-level=warning', '--define:import.meta.env={"BASE_URL":"/"}'], { stdio: 'inherit' });
execFileSync('node', ['--no-experimental-fetch', out, ...args], { stdio: 'inherit' });
