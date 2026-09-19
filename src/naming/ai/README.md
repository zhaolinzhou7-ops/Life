# AI 接口层

## 为什么是这个结构

这个小程序默认**不需要任何后端**：本地引擎（`src/naming/engine/`）自带字库、
典籍库和六维评分，离线也能跑出完整结果。加一个远端模型是为了让"理解用户的
自由描述"和"想出人想不到的组合"这两件事做得更好，不是为了让产品能跑起来。

所以分工是：

| 环节 | 谁做 | 为什么 |
|---|---|---|
| 需求理解 | 两边都做 | 模型读自由文本更准，本地理解作为对照 |
| 候选生成 | 模型（可选）+ 本地 | 模型有创意，本地保底 |
| 硬过滤 | **只有本地** | 模型无法稳定遵守"绝对不用某个字"这类约束 |
| 六维评分 | **只有本地** | 分数要可复现、可解释 |
| 出处标注 | **只有本地** | 模型最容易在这里编造 |
| 常见度判断 | **只有本地** | 不能让模型编重名数据 |

模型返回的名字会和本地生成的候选**走同一条流水线**，不开后门。

## API Key 怎么办

**不要把 Key 写进这个仓库，也不要写进前端代码。** 构建产物是公开的静态文件，
任何人都能看到里面的字符串。

正确做法是自己起一个薄网关，Key 只存在网关那边：

```
浏览器 ──POST──> 你的网关（持有 Key） ──> 模型 API
```

设置页里填的是**网关地址**，它只存在用户自己设备的 localStorage 里。

## 网关契约

前端会往你填的地址发这样一个请求：

```http
POST <endpoint>
Content-Type: application/json
Authorization: Bearer <可选，设置页里填的 token>

{
  "system": "…命名规则…",
  "user":   "…用户需求…",
  "model":  "…可选，设置页里填的模型名…"
}
```

期望返回：

```json
{ "text": "模型输出的原始文本" }
```

`text` 里应当是一段 JSON（前端能容忍它被 markdown 代码块包着）：

```json
{
  "understanding": "复述一遍理解到的需求",
  "names": [ { "given": "怀月", "why": "为什么提这个名字" } ]
}
```

`given` 只写名、不写姓。前端会丢弃本地字库里查不到的字——不是嫌弃它们，
而是查不到就做不了音律和字形分析，给用户一个分析不了的名字没有意义。

## 一个最小网关示例（Cloudflare Workers）

```js
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

    const { system, user, model } = await request.json();

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,   // Key 只存在这里
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    const data = await r.json();
    const text = (data.content || []).map((b) => b.text || '').join('');

    return new Response(JSON.stringify({ text }), {
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',   // 生产环境请收紧到你自己的域名
      },
    });
  },
};
```

换成任何其他模型服务，只要最后吐出 `{ "text": "…" }` 就能接上，前端不用改。

## 降级

网关超时、报错、返回垃圾，前端都会自动回退到本地引擎，并在结果页顶部如实
写明"这一轮用的是本地引擎"。用户永远不会因为模型挂了而看到一个空白页面。
