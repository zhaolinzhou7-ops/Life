/*
 * Pikafish 的 Web Worker 胶水层（本项目自写，MIT，不属于 Pikafish）。
 *
 * 引擎是单线程构建：send_command('go …') 会一直占着这个线程直到算完，中途发来的 'stop' 根本收不到。
 *
 * **怎么叫停：拨快它的表。** 每条 go 都带 movetime，引擎每搜几百个节点就看一次表，
 * 到时间了就停下、交出 bestmove。主线程和这里共享一个整数（SharedArrayBuffer）：
 * 主线程把它置 1，引擎下一次看表时我们报给它"已经过去了十几天"，它就立刻收手——
 * 和正常算完一模一样：交出已经算完的那一层，Worker 还活着，下一条命令接着用。
 *
 * 以前是直接 terminate 掉 Worker 再起一个新的。每个引擎实例开 256MB 内存，
 * 手机浏览器回收被掐掉的 Worker 很慢，下到二三十手就再也起不来新的了——
 * 教练"刚开始还能算，后面就不算了"就是这么来的。
 *
 * 没有 SharedArrayBuffer（页面没做跨源隔离）时 flag 为空，看表一切照常，
 * 主线程改用分段研究（每段几秒），见 pikafish.ts。
 *
 * 协议：
 *   主线程 → {init: {module, data, flag?}}   初始化；flag 是 SharedArrayBuffer（可选）
 *   主线程 → {cmd: 'go movetime 1000'}       一条 UCI 命令
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
/** 叫停标志：非 0 = 主线程要它停 */
var flag = null;
/** 拨快这么多毫秒：远超任何 movetime */
var SKIP = 1e9;

function fail(err) {
  self.postMessage({ error: String((err && err.message) || err) });
}

/** 引擎看表的两个口子都接管：标志置位时把表拨快 */
function patchClock(env) {
  var mono = env.emscripten_get_now;
  var wall = env._emscripten_date_now;
  if (typeof mono === 'function') {
    env.emscripten_get_now = function () {
      return flag && Atomics.load(flag, 0) ? mono() + SKIP : mono();
    };
  }
  if (typeof wall === 'function') {
    env._emscripten_date_now = function () {
      return flag && Atomics.load(flag, 0) ? wall() + SKIP : wall();
    };
  }
}

self.onmessage = function (e) {
  var d = e.data || {};
  if (d.init) {
    if (d.init.flag) flag = new Int32Array(d.init.flag);
    try {
      factory({
        instantiateWasm: function (imports, ok) {
          if (imports && imports.env) patchClock(imports.env);
          // 实例化要开 256MB 内存。内存不够时这里会失败——一定要报回去，
          // 不然主线程只能干等到超时，教练在这段时间里什么都算不了
          WebAssembly.instantiate(d.init.module, imports).then(function (inst) {
            ok(inst, d.init.module);
          }, fail);
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
      }).then(function (m) {
        engine = m;
        engine.read_stdout = function (s) {
          self.postMessage({ line: s });
        };
        self.postMessage({ ready: true });
      }, fail);
    } catch (err) {
      fail(err);
    }
    return;
  }
  if (d.cmd && engine) {
    try {
      engine.send_command(d.cmd);
    } catch (err) {
      // 引擎内部出错（比如内存涨不上去）：这个实例不能再用了，让主线程换一个
      self.postMessage({ crashed: String((err && err.message) || err) });
    }
  }
};
