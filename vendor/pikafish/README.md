# Pikafish（皮卡鱼）WebAssembly 版

象棋教练用的分析引擎。原样使用，不做修改。

| 文件 | 说明 |
| --- | --- |
| `pikafish.js` | Emscripten 生成的加载器（原样，未改动） |
| `pikafish.wasm` | 引擎本体，版本 `Pikafish dev-20240226-98b20a33`（单线程，不需要 SIMD） |
| `pikafish.data` | 打包好的 NNUE 评估网络 `pikafish.nnue` |
| `pika-worker.js` | 本项目自己写的 Web Worker 胶水层，不属于 Pikafish |
| `COPYING` | GPL-3.0 许可证全文 |

- 上游：<https://github.com/official-pikafish/Pikafish>（源码，对应提交 `98b20a33`）
  和 <https://github.com/official-pikafish/Networks>（评估网络）。
- 这份 WASM 构建取自 npm 包 `koishi-plugin-cchess@2.3.0` 的 `lib/assets/wasm/`。
  从那里取是因为当前环境拿不到 GitHub 的发布文件；引擎自报版本见上表。
- 许可：Pikafish 是 **GPL-3.0**（见 `COPYING`）。页面和引擎之间只通过 UCI 文本消息通信。
- 安全：引擎只导入内存文件系统、时间和内存管理这几类函数（`WebAssembly.Module.imports` 可查），
  没有任何网络能力；加载器只按同目录的相对路径读取上面几个文件。

校验和（sha256）：

```
625dbdd6cb7717204ec25fa0fc5e4ba9f6278ab901a52294ff29b975302cd9f6  pikafish.wasm
d19746bb9eccbb8d65b5f7eaf9f5a9622a1ddde5847c12a0ef18afe864296ee2  pikafish.data
bca5f20f4623bbd5ccdda1ed5295998618995511aa88671941918b7e695eef7a  pikafish.js
```
