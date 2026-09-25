/*
 * Pikafish 的 Web Worker 胶水层（本项目自写，MIT，不属于 Pikafish）。
 *
 * 引擎是单线程构建：send_command('go …') 会一直占着这个线程直到算完，
 * 所以它必须跑在 Worker 里；想中途叫停只能由主线程 terminate 掉这个 Worker 再起一个新的。
 * 起一个新的很便宜：主线程把编译好的 WebAssembly.Module 和评估网络直接传进来，不重新下载、不重新编译。
 *
 * 协议：
 *   主线程 → {init: {module, data}}   初始化
 *   主线程 → {cmd: 'go movetime 1000'} 一条 UCI 命令
 *   Worker → {ready: true} / {error: '…'} / {line: '…'}（引擎的每一行输出）
 */
/* global Pikafish */
// pikafish.js 是给 Node 打过补丁的版本：开头 require('fs')、用 __dirname、结尾 module.exports。
// 在浏览器里给它这三样的空壳，文件本身一个字节都不用改。评估网络走 getPreloadedPackage 传进去，用不到 fs。
self.require = function () {
  return {};
};
self.__dirname = '';
self.module = { exports: {} };
importScripts('pikafish.js');
var factory = self.module.exports;
var engine = null;

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.init) {
    factory({
      instantiateWasm: function (imports, ok) {
        WebAssembly.instantiate(d.init.module, imports).then(function (inst) {
          ok(inst, d.init.module);
        });
        return {};
      },
      getPreloadedPackage: function () {
        return d.init.data;
      },
      locateFile: function (f) {
        return f;
      },
      read_stdout: function (s) {
        self.postMessage({ line: s });
      },
      print: function () {},
      printErr: function () {},
    }).then(
      function (m) {
        engine = m;
        engine.read_stdout = function (s) {
          self.postMessage({ line: s });
        };
        self.postMessage({ ready: true });
      },
      function (err) {
        self.postMessage({ error: String(err) });
      },
    );
    return;
  }
  if (d.cmd && engine) engine.send_command(d.cmd);
};
