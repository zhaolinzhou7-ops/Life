# AI 教练后端（示例）

前端**不接真模型也能完整使用**——默认的本地教练用规则引擎算好的事实 + 模板生成解说，
数字全对，只是话说得规整。接上真模型的收益是：对话更自然、能回答开放问题。

这个目录就是那个「真模型」的接法。它只有一个职责：

> **把 API Key 挡在前端之外。**

前端代码是公开的，密钥打包进去等于贴在网上。所以前端只发「算好的事实」，
由这个服务带着密钥去调模型。前端代码里没有任何地方接受 `apiKey` 参数，这是故意的。

## 跑起来

```bash
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...     # 或者事先 ant auth login
node coach-server.mjs
```

然后启动前端，把后端地址告诉它：

```bash
cd ..
VITE_MJ_COACH_API=http://localhost:8787 npm run dev
```

牌桌上教练面板的标签会从「本地」变成「在线」。

## 它做什么

两个接口，都收 JSON、回 JSON：

| 接口 | 前端什么时候调 | 收什么 | 回什么 |
| --- | --- | --- | --- |
| `POST /explain` | 用户点「帮我看看 / 该打哪张 / 该缺哪门」 | `toExplainPayload()` 的输出 | `{ headline, body, simple }` |
| `POST /chat` | 用户在教练面板里提问 | `toChatPayload()` 的输出 | 同上 |

请求体长这样（节选）：

```json
{
  "topic": "discard",
  "rule": "成都血战到底",
  "situation": {
    "myHand": "2万 3万 4万 …", "myLack": "筒",
    "shanten": 1, "shantenText": "还差 1 张就听牌（一向听）",
    "opponents": [{ "who": "下家", "discards": "…", "maybeTing": true }]
  },
  "options": [
    { "tile": "7万", "shanten": 1, "ukeire": 12, "danger": 0.21, "role": "坎张搭子的一张" }
  ],
  "guardrails": ["所有数字必须来自 situation/options/decision，不得自行推算或虚构", "…"]
}
```

注意里面**没有任何人的手牌明细，也没有密钥**——即使这台服务器的日志被人看到，
也推不出别人在打什么牌。

## 关键实现点

- **模型**：`claude-opus-5`。思考默认开启（adaptive），这活儿是「把算好的数字组织成话」，
  所以 `effort: 'low'` 就够，也便宜。
- **返回格式锁死**：用 `client.messages.parse()` + Zod schema 约束成
  `{headline, body, simple}`，前端拿到的一定是这三个字段，不用做容错解析。
- **系统提示缓存**：教练的人设与纪律是固定的几百 token，打了
  `cache_control: {type:'ephemeral'}`，重复请求不重复付费。
- **纪律写进 system**：不许编数字、看不到别人手牌、没有的信息要说「当前信息不足」。
  前端发过去的 `guardrails` 字段是同一套约束的再次提醒。
- **出错自动退回**：任何非 200，前端都会自动退回本地教练。
  网络挂了不会让教学功能整个消失。

## 部署时要改的三件事

1. **`ALLOW_ORIGIN`** 默认是 `*`，方便本地调试。上线前改成你自己的域名：
   ```bash
   ALLOW_ORIGIN=https://zhaolinzhou7-ops.github.io node coach-server.mjs
   ```
2. **限流**。示例里是「同 IP 每分钟 30 次」的内存计数，重启即清零，多实例也不共享。
   真要上线，换成 Redis 或者你的网关自带的限流。
3. **加一层身份**。这个接口现在是公开的，谁拿到地址都能用你的额度。
   最简单的做法是前端带一个短期 token，服务端校验。

## 想开启拒答回退（可选）

模型偶尔会因为安全策略拒答（麻将教学基本不会触发，但如果你把这个服务改作他用就可能）。
可以让 API 在拒答时自动换一个模型重跑同一个请求：

```js
const response = await client.beta.messages.create({
  model: 'claude-opus-5',
  max_tokens: 2000,
  betas: ['server-side-fallback-2026-06-01'],
  fallbacks: [{ model: 'claude-opus-4-8' }],
  system: [...],
  messages: [...],
});
```

注意这条路走的是 `client.beta.messages.create`，拿不到 `parse()` 的 schema 校验，
需要自己解析返回内容。示例默认没开——麻将解说触发拒答的概率极低，
为它牺牲「返回格式一定正确」不划算。

## 换个模型

把 `coach-server.mjs` 里的 `model` 改掉即可：

| 模型 | 输入 $/1M | 输出 $/1M | 什么时候用 |
| --- | --- | --- | --- |
| `claude-opus-5` | $5 | $25 | 默认，解说质量最好 |
| `claude-sonnet-5` | $2 | $10 | 量大、想省钱 |
| `claude-haiku-4-5` | $1 | $5 | 只要把数字串成句子 |

一次解说大约 1500 输入 + 300 输出 token，系统提示缓存命中后输入还会再降。
