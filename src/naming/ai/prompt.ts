/**
 * AI 命名 Prompt · 独立模块
 *
 * 这一层单独成文件，不散落在页面代码里，原因很实际：Prompt 是要反复调的，
 * 它和 UI 的生命周期完全不同。
 *
 * 链路和本地引擎保持一致，模型只负责其中的一环：
 *
 *   命名规则(SYSTEM) → 用户需求(renderRequest) → 候选生成(模型) → 筛选/分析(本地)
 *
 * 注意最后一步：**模型不负责打分和写风险提示**。那些必须由本地引擎算，
 * 因为模型没法稳定地做到不编、不漏、不自相矛盾。模型给名字，引擎做把关。
 */

import type { NamingRequest, NeedProfile } from '../types';

/** 命名规则。每一条都对应一个模型真实会犯的错 */
export const SYSTEM_PROMPT = `你是一位中文取名顾问，服务的是普通家长，不是命理从业者。

你只做一件事：根据用户的要求，提出一批值得认真考虑的候选名字。

【必须遵守】
1. 不要编造典籍出处。你只有在确切知道某句原文、并且名字的两个字都出现在那一句里时，才可以提出处；否则就说没有出处。宁可不写，也不要写一个看起来很像的来历。
2. 不要编造重名数据。任何人都拿不到全国重名人数，不许说"全国仅 3 人叫这个名字"之类的话。
3. 不要把传统命理当成科学事实。五行、八字、周易只能作为传统文化层面的参考，不许出现"改变命运""保证健康""一定聪明""旺财"这类说法。
4. 不要为了补五行而牺牲名字本身。一个读起来别扭、写起来费劲的名字，不会因为补上了某个五行就变好。
5. 不要为了显得高级而用生僻字。用户和他的孩子要用这个名字几十年，认不出、打不出的字是长期负担。
6. 不要输出模板化名字。子涵、梓轩、浩然、一诺这类近年高频组合，除非用户明确要求，否则不要出现。
7. 不要重复。同一批里不要出现只换一个字的近亲（清远/清和/清源 只能留一个）。
8. 不要说空话。"寓意美好""前程似锦""大气上档次"这类话对用户的决定没有任何帮助，一句都不要写。
9. 名字要成话。中文名的骨架是"性状+名物"(清风)、"名物+性状"(志远)、"动作+名物"(怀瑾)。两个不相干的名物硬凑（荷野、茗泓）念出来不是话。
10. 连着姓一起读三遍，再决定要不要提交这个名字。谐音、拗口都是连姓才暴露出来的。

【输出格式】
只输出 JSON，不要任何解释性文字，不要 markdown 代码块：
{"understanding":"用一句话复述你理解的用户需求","names":[{"given":"名字（不含姓）","why":"为什么提这个名字，一句话，必须具体到字"}]}
given 只写名，不写姓。`;

const GENDER_TEXT: Record<string, string> = {
  boy: '男孩',
  girl: '女孩',
  any: '暂不指定性别（请避开明显偏男或偏女的用字）',
};

const TARGET_TEXT: Record<string, string> = {
  baby: '新生儿取名',
  rename: '成年人改名',
  penname: '取笔名／艺名',
};

/** 把用户需求渲染成给模型看的文本 */
export function renderRequest(req: NamingRequest, count: number): string {
  const L: string[] = [];
  L.push(`场景：${TARGET_TEXT[req.target]}`);
  L.push(`姓氏：${req.surname}`);
  L.push(`性别：${GENDER_TEXT[req.gender]}`);
  L.push(`字数：${req.nameLength === 1 ? '单字名' : req.nameLength === 2 ? '双字名' : '单字双字都可以'}`);
  if (req.brief) L.push(`基本要求：${req.brief}`);
  if (req.likeStyles.length) L.push(`偏好风格：${req.likeStyles.join('、')}`);
  if (req.avoidStyles.length) L.push(`想避开的风格：${req.avoidStyles.join('、')}`);
  if (req.temperament.length) L.push(`希望名字体现的气质：${req.temperament.join('、')}`);
  if (req.familyWish) L.push(`家庭期望：${req.familyWish}`);
  if (req.mustChars.length) L.push(`必须用到的字：${req.mustChars.join('、')}（每个名字至少含其中一个）`);
  if (req.banChars.length) L.push(`绝对不能出现的字：${req.banChars.join('、')}`);
  if (req.genChar) {
    L.push(`辈分字：「${req.genChar.c}」，必须放在名字的${req.genChar.pos === 'first' ? '第一个字' : '第二个字'}`);
  }
  if (req.useClassics) L.push('用户希望参考经典文学。有确切出处才写，没有就明说没有。');
  if (req.useWuxing) {
    L.push(
      '用户勾选了参考五行。请把它当作文化层面的加分项，不要作为硬性条件，更不要因此使用难听或生僻的字。',
    );
  }
  if (req.birthDate) L.push(`出生日期：${req.birthDate}${req.birthTime ? ' ' + req.birthTime : '（未填时间）'}`);
  if (req.birthPlace) L.push(`出生地：${req.birthPlace}`);

  L.push('');
  L.push(`请提出 ${count} 个候选名字。宁可少而准，不要多而杂——重复的、凑数的一个都不要。`);
  return L.join('\n');
}

/** 把本地的需求理解也告诉模型，让两边对齐 */
export function renderProfileHint(p: NeedProfile): string {
  const top = Object.entries(p.styleWeight)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  if (!top.length) return '';
  return `\n（本地引擎从需求里读出的风格倾向是：${top.join('、')}。仅供参考，以用户原话为准。）`;
}

export function buildMessages(req: NamingRequest, p: NeedProfile, count: number) {
  return {
    system: SYSTEM_PROMPT,
    user: renderRequest(req, count) + renderProfileHint(p),
  };
}

/**
 * 解析模型返回。模型经常会包一层 markdown 代码块、或者在 JSON 前后加话，
 * 所以这里不假设它一定守规矩。
 */
export function parseResponse(text: string): { names: { given: string; why?: string }[]; understanding?: string } {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);

  const data = JSON.parse(t) as { names?: unknown; understanding?: unknown };
  const names: { given: string; why?: string }[] = [];
  if (Array.isArray(data.names)) {
    for (const n of data.names) {
      if (typeof n === 'string') names.push({ given: n });
      else if (n && typeof n === 'object') {
        const o = n as { given?: unknown; name?: unknown; why?: unknown };
        const given = typeof o.given === 'string' ? o.given : typeof o.name === 'string' ? o.name : '';
        if (given) names.push({ given: given.trim(), why: typeof o.why === 'string' ? o.why : undefined });
      }
    }
  }
  return {
    names,
    understanding: typeof data.understanding === 'string' ? data.understanding : undefined,
  };
}
