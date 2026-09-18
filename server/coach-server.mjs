/**
 * AI 教练后端示例（约 120 行，可直接运行）。
 *
 * 它存在的唯一理由：**把 API Key 挡在前端之外**。
 * 前端代码是公开的，密钥打包进去等于贴在网上。所以前端只把
 * 「算好的事实」发过来，由这个服务带着密钥去调模型，再把解说发回去。
 *
 * 它不碰规则、不碰算牌。向听数、进张数、危险度全部是前端的规则引擎算好的，
 * 模型只负责把这些数字说成人话。这条边界很重要：
 * 模型算错牌是灾难，模型把话说得啰嗦只是不好看。
 *
 * 跑起来：
 *   cd server && npm install
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   node coach-server.mjs
 * 然后前端：
 *   VITE_MJ_COACH_API=http://localhost:8787 npm run dev
 */

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const PORT = Number(process.env.PORT ?? 8787);
/** 允许哪些前端来源访问。生产环境务必改成你自己的域名，别留 * */
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? '*';
/** 请求体上限：结构化事实很小，正常不到 8KB，给 64KB 足够 */
const MAX_BODY = 64 * 1024;

// 不传 apiKey，SDK 自己从 ANTHROPIC_API_KEY 环境变量读——
// 密钥不出现在代码里，也就不会被不小心提交进仓库
const client = new Anthropic();

/**
 * 教练的人设与纪律。这段是固定的，所以打上缓存标记：
 * 每次请求都重发一遍同样的几百 token，不缓存就是白花钱。
 */
const SYSTEM = `你是一位四川麻将教练，正在教一个想把牌打好的普通人。

你会收到一份**已经算好的事实**（向听数、进张数、各种打法的对比、对手的公开信息）。
这些数字来自规则引擎，是准确的。你的工作是把它们讲成人话。

纪律（违反任何一条都是严重错误）：
1. 所有数字必须来自给你的事实。不许自己推算，不许估计，不许举例时编造牌。
2. 你看不到别人的手牌。涉及对手的判断一律说清楚这是「推测」。
3. 事实里没有的信息，直接说「当前信息不足，无法确定」。宁可说不知道，也不要猜。

风格：
- 先说结论，再说原因。原因要带具体数字（「进张从 12 张掉到 4 张」），
  不要说「效率更高」这种听了等于没听的话。
- 用牌桌上的说法，别用学术腔。
- headline 一句话，不超过 20 字。
- body 两到四句话，讲清楚为什么。
- simple 一句大白话，说给完全不懂术语的人听。`;

/** 返回格式由 schema 锁死，前端拿到的一定是这三个字段 */
const CoachReply = z.object({
  headline: z.string(),
  body: z.string(),
  simple: z.string(),
});

async function askClaude(userText) {
  const response = await client.messages.parse({
    model: 'claude-opus-5',
    // 解说只有几百字，不需要留 16000 的余量
    max_tokens: 2000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
    output_config: {
      format: zodOutputFormat(CoachReply),
      // 这活儿是「把算好的数字组织成话」，不是难题，低 effort 就够，也便宜
      effort: 'low',
    },
  });
  // 解析失败会是 null，必须兜住——不能让前端拿到 undefined
  if (!response.parsed_output) throw new Error('模型返回的格式不对');
  return response.parsed_output;
}

/** 把前端发来的事实包装成一句人话请求 */
function buildPrompt(kind, payload) {
  const facts = JSON.stringify(payload, null, 1);
  if (kind === 'chat') {
    return `玩家问：${payload.question}\n\n当前牌局的事实如下（JSON）：\n${facts}\n\n请回答他的问题。`;
  }
  const topicText = {
    discard: '这一步该打哪张牌',
    lack: '该定缺哪一门',
    swap: '换三张该换哪三张',
    situation: '当前局面怎么样',
    result: '这一局的总结',
  }[payload.topic] ?? '当前局面';
  return `请就「${topicText}」给玩家讲解。\n\n事实如下（JSON）：\n${facts}`;
}

// ---------- HTTP ----------

/** 简易限流：同一个 IP 每分钟 30 次，防止示例被人当免费 API 刷 */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now - rec.since > 60_000) {
    hits.set(ip, { since: now, n: 1 });
    return false;
  }
  rec.n += 1;
  return rec.n > 30;
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const kind = req.url === '/explain' ? 'explain' : req.url === '/chat' ? 'chat' : null;
  if (req.method !== 'POST' || !kind) return send(res, 404, { error: '只支持 POST /explain 和 POST /chat' });

  const ip = req.socket.remoteAddress ?? 'unknown';
  if (rateLimited(ip)) return send(res, 429, { error: '请求太频繁，等一分钟再来' });

  let raw = '';
  let tooBig = false;
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY && !tooBig) {
      tooBig = true;
      send(res, 413, { error: '请求体太大' });
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (tooBig) return;
    try {
      const payload = JSON.parse(raw);
      const reply = await askClaude(buildPrompt(kind, payload));
      send(res, 200, reply);
    } catch (err) {
      // 分类型处理，不要把所有错误都当成一种
      if (err instanceof Anthropic.RateLimitError) {
        send(res, 429, { error: '模型侧限流了，稍后再试' });
      } else if (err instanceof Anthropic.AuthenticationError) {
        console.error('API Key 无效或没设置');
        send(res, 500, { error: '服务端配置有问题' });
      } else if (err instanceof Anthropic.APIError) {
        console.error(`模型返回 ${err.status}:`, err.message);
        send(res, 502, { error: '模型暂时不可用' });
      } else {
        console.error(err);
        send(res, 400, { error: '请求内容有问题' });
      }
      // 前端收到任何非 200 都会自动退回本地教练，用户不会卡住
    }
  });
});

server.listen(PORT, () => {
  console.log(`麻将教练后端已启动：http://localhost:${PORT}`);
  console.log(`  POST /explain  讲解某一步`);
  console.log(`  POST /chat     回答玩家提问`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('\n⚠ 没有检测到 ANTHROPIC_API_KEY。');
    console.warn('  如果你用 `ant auth login` 登录过，SDK 会自动读取那份配置，可以忽略这条。');
    console.warn('  否则请先 export ANTHROPIC_API_KEY=sk-ant-...');
  }
});
