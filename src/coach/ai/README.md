# AI 接口层

## 先说结论：不接 AI，这个产品也是完整的

打开就能用，**不联网也能跑**。测评、纠错、错误档案、间隔复习、场景对话、
复盘，全部在本地完成。接一个远端模型是为了让两件事更好：

1. NPC 演得更像人（本地台词是写死的，硬一点）
2. 解释更贴合这个用户（本地解释是通用的，正确但不个性化）

**它不是前提，是加分项。** 这一点写在这里是因为它决定了整个分层方式。

## 谁做什么

| 环节 | 谁做 | 为什么 |
|---|---|---|
| 判断句子对不对 | **只有本地** | 要可复现。今天说你错、明天说你对，用户第二次就不来了 |
| 改成什么 | **只有本地** | 规则库里的改法是人校对过的；模型会编出 `goed` 这种词形 |
| 任务有没有办成 | **只有本地** | 复盘里"你完成了入住"必须是真的，不能是模型的自由发挥 |
| 等级、分数、百分比 | **只有本地** | 模型最容易在这里编数字 |
| 间隔复习排期 | **只有本地** | 纯算法，和模型无关 |
| 发音评分 | **谁都不做** | 浏览器给不了声学数据，没人能诚实地算出这个分，所以产品里没有这个数字 |
| NPC 说什么 | 模型（可选） | 模型擅长这个 |
| 解释怎么写 | 模型（可选） | 能照顾到"你这是第四次犯了" |

模型填不了的字段，它就编不了——这是这套分层唯一的目的。

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
  "system": "…教练人设与当前学习状态…",
  "user":   "…这一轮的具体输入…",
  "model":  "…可选，设置页里填的模型名…"
}
```

期望返回：

```json
{ "text": "模型输出的原始文本" }
```

就这么简单。**没有任何结构化字段需要模型填**——因为所有需要结构的东西
（对错、分数、推进与否）都由本地算。模型只需要吐出一段自然语言，
前端会做清洗（去引号、去角色名前缀、去掉跑出角色的内容）。

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
        max_tokens: 400,          // 教练要说人话，不要长篇大论
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

网关超时、报错、返回空、返回跑出角色的内容，前端都会自动回退到本地引擎，
并在界面上如实写明这一轮用的是本地引擎。

降级时用户损失的是**贴合度**，不是**正确性**——纠错本来就是本地算的。

## Mock 模式怎么测

设置页把模式切回"只用本地引擎"，或者把网关地址填成一个不存在的地址
（例如 `http://127.0.0.1:59999/dead`）。两种情况下所有流程都应该能走完。
自动化测试里覆盖了后者。
