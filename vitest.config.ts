import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 规则/教学/画像是纯函数，跑 node 最快；需要 DOM 的测试单独标注环境
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 引擎搜索测试会跑真实的 alpha-beta，给足时间
    testTimeout: 30000,
    // 存档层要测 localStorage 的行为，node 环境里给一个内存替身
    setupFiles: ['tests/setup-dom.ts'],
  },
});
