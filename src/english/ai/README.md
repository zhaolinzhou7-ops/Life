# 接真实模型：网关契约

这个应用是纯静态站点，没有后端。**API Key 绝不能放进前端**——构建产物是公开的，
任何人打开 DevTools 都能拿走。儿童产品尤其不该在这件事上含糊。

所以接模型的方式是：你自己部署一个极小的网关，密钥留在网关那边。
家长在「家长中心 → AI 设置」里填网关地址，地址只存在这台设备的 localStorage 里。

## 请求

```
POST <你的网关地址>
Content-Type: application/json
Authorization: Bearer <可选，家长在设置里填的 token>

{
  "system": "…",
  "user": "…",
  "model": "…"   // 可选，家长填了才有，网关可以忽略
}
```

## 响应

```json
{ "text": "模型返回的原始文本" }
```

也接受 `{ "content": "…" }`。非 200、超时、空 `text` 都会被当作失败，
前端立刻降级回内置引擎，孩子那边不会看到任何异常。

## 一个 Cloudflare Workers 的例子

```js
export default {
  async fetch(req, env) {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });

    // 建议在这里加上你自己的鉴权，否则谁都能拿你的额度去跑
    const auth = req.headers.get('Authorization');
    if (env.GATEWAY_TOKEN && auth !== `Bearer ${env.GATEWAY_TOKEN}`) {
      return new Response('unauthorized', { status: 401 });
    }

    const { system, user, model } = await req.json();

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,   // 密钥只存在这里
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-5',
        max_tokens: 800,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });

    const data = await r.json();
    const text = data?.content?.[0]?.text ?? '';
    return new Response(JSON.stringify({ text }), {
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    });
  },
};
```

记得处理 `OPTIONS` 预检，否则浏览器跨域会被挡下来。

## 模型拿不到什么

有意为之，不是遗漏：

- **孩子的昵称以外的任何个人信息。** 敏感信息在进 prompt 之前就被
  `safety.scrubChildInput()` 抹掉了。
- **音频。** 语音识别在浏览器本地做，只有转写文本会进入判定，而且默认不落盘。
- **教学决策权。** 现在该问什么、孩子答得对不对、下一步做什么，
  全部由本地引擎算好写进 prompt。模型只负责把话说得自然。

这三条决定了：模型挂掉、跑偏、或者被换成另一家，产品行为都不会崩。

## 模型返回之后还会被检查什么

1. `safety.checkOutbound()` —— 索取个人信息、引导线下见面、引导消费、
   不适合年龄的内容、恐吓式措辞，命中任意一条就换成安全回复，并在家长端留记录。
2. 故事额外过 `validateStory()` —— 句子长度超上限、目标词没出现、页数不对，
   整个丢掉降级回内置故事。不做局部修补：一个句子太长的故事对孩子是负收益。
