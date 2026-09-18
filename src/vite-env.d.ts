/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * AI 讲解后端的地址。
   *
   * 不配就用离线模板讲解——那是默认方案，不是降级方案：没有任何 API
   * 也必须能完整下棋、复盘、训练（产品规格第十九条）。
   *
   * 配的是**你自己后端的 URL**，模型密钥留在后端。前端只往这个地址发
   * 结构化事实、收一段文本，从头到尾碰不到密钥。
   */
  readonly VITE_COACH_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
