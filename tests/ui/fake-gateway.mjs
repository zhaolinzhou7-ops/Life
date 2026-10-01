/**
 * 假的 AI 网关，给界面走查用。
 *
 * 按 src/english/ai/README.md 里的契约实现：POST {system, user, model} → {text}，
 * 并且处理浏览器的 CORS 预检——README 提醒过部署者这一步，这里用真实浏览器验证一遍
 * 前端确实会发预检、并且只要网关按契约回应就能通。
 *
 * 三种行为，按路径区分：
 *   /good    像一个正常的模型：按 prompt 里的要求回话、编故事、写周报
 *   /unsafe  像一个失控的模型：索要住址、故事里写不合适的内容、周报里推销会员
 *   /garbage 像一个坏掉的模型：不返回 JSON，只返回一句废话
 *
 * 所有请求都记在 requests 里，走查可以检查前端到底发了什么。
 */
import http from 'http';

function storyFromPrompt(user, unsafe) {
  const line = user.split('\n').find((l) => l.startsWith('Target words')) ?? '';
  const words = (line.split(':')[1] ?? '')
    .split(',')
    .map((x) => x.trim().replace(/\s*\(.*\)$/, ''))
    .filter(Boolean);
  const pages = [];
  for (const w of words) {
    pages.push({ text: `Look, ${w}!`, emoji: '👀', highlight: w });
    pages.push({ text: `The ${w} is here.`, emoji: '✨', highlight: w });
    pages.push({ text: `Bye bye, ${w}!`, emoji: '👋', highlight: w });
  }
  while (pages.length < 6) pages.push({ text: 'We are happy.', emoji: '😄' });
  if (unsafe) pages.splice(1, 0, { text: 'The monster will kill the cat.', emoji: '👹' });
  const first = words[0] ?? 'cat';
  return {
    title: 'The Gateway Tale',
    pages,
    questions: [
      {
        ask: `What do we see first?`,
        askZh: '我们先看到了什么？',
        options: [
          { label: first, emoji: '👀', correct: true },
          { label: 'a spoon', emoji: '🥄', correct: false },
        ],
      },
    ],
  };
}

export async function startFakeGateway() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, authorization',
    };
    if (req.method === 'OPTIONS') {
      requests.push({ method: 'OPTIONS', path: req.url });
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        // 前端发了坏 JSON 也记下来，让走查能发现
      }
      requests.push({ method: req.method, path: req.url, auth: req.headers.authorization ?? '', payload });
      const user = String(payload.user ?? '');
      const mode = (req.url ?? '').replace(/^\//, '');
      let text;

      if (mode === 'garbage') {
        text = 'Sorry, I cannot help with that right now.';
      } else if (user.includes('Write a very short picture story')) {
        text = '```json\n' + JSON.stringify(storyFromPrompt(user, mode === 'unsafe')) + '\n```';
      } else if (user.includes('请输出 JSON')) {
        text = JSON.stringify({
          headline: '这周很认真（来自网关的周报）',
          vocabulary: '学了不少新词。',
          listening: '能听懂简单指令。',
          speaking: '愿意开口跟读。',
          advice: mode === 'unsafe' ? ['建议开通会员，解锁全部课程。'] : ['每天坚持十分钟。'],
        });
      } else if (user.includes('You just asked')) {
        if (mode === 'unsafe') {
          text = JSON.stringify({ say: 'Where do you live? Tell me your home address.', emoji: '🏠' });
        } else {
          const m = user.match(/in these words or very close: "([^"]+)"/);
          text = `Sure! ${JSON.stringify({ say: `Super duper! ${m ? m[1] : 'Great job!'}`, emoji: '🌟' })}`;
        }
      } else {
        // 设置页「测试连接」
        text = 'OK';
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((r) => server.close(r)),
  };
}
