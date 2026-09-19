/**
 * 英语词形小工具
 *
 * 纠错时经常要把 go 变成 goes、went、going。规则派生能覆盖绝大多数动词，
 * 但英语的高频动词恰恰几乎全是不规则的——而学习者用的又主要是高频动词。
 * 所以这里是"不规则表优先 + 规则派生兜底"。
 *
 * 表里只放真实存在的形式。**宁可不改，也不要造一个不存在的词形**：
 * 给学习者一个编出来的 "goed" 比不纠错伤害大得多，所以派生不出把握时
 * 返回 null，调用方据此跳过这条纠错。
 */

/** 不规则动词：原形 → [过去式, 过去分词] */
const IRREGULAR: Record<string, [string, string]> = {
  be: ['was', 'been'],
  become: ['became', 'become'],
  begin: ['began', 'begun'],
  break: ['broke', 'broken'],
  bring: ['brought', 'brought'],
  build: ['built', 'built'],
  buy: ['bought', 'bought'],
  catch: ['caught', 'caught'],
  choose: ['chose', 'chosen'],
  come: ['came', 'come'],
  cost: ['cost', 'cost'],
  cut: ['cut', 'cut'],
  do: ['did', 'done'],
  draw: ['drew', 'drawn'],
  drink: ['drank', 'drunk'],
  drive: ['drove', 'driven'],
  eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'],
  feel: ['felt', 'felt'],
  find: ['found', 'found'],
  fly: ['flew', 'flown'],
  forget: ['forgot', 'forgotten'],
  get: ['got', 'gotten'],
  give: ['gave', 'given'],
  go: ['went', 'gone'],
  grow: ['grew', 'grown'],
  have: ['had', 'had'],
  hear: ['heard', 'heard'],
  hold: ['held', 'held'],
  keep: ['kept', 'kept'],
  know: ['knew', 'known'],
  leave: ['left', 'left'],
  lend: ['lent', 'lent'],
  let: ['let', 'let'],
  lose: ['lost', 'lost'],
  make: ['made', 'made'],
  mean: ['meant', 'meant'],
  meet: ['met', 'met'],
  pay: ['paid', 'paid'],
  put: ['put', 'put'],
  read: ['read', 'read'],
  ride: ['rode', 'ridden'],
  run: ['ran', 'run'],
  say: ['said', 'said'],
  see: ['saw', 'seen'],
  sell: ['sold', 'sold'],
  send: ['sent', 'sent'],
  set: ['set', 'set'],
  sit: ['sat', 'sat'],
  sleep: ['slept', 'slept'],
  speak: ['spoke', 'spoken'],
  spend: ['spent', 'spent'],
  stand: ['stood', 'stood'],
  take: ['took', 'taken'],
  teach: ['taught', 'taught'],
  tell: ['told', 'told'],
  think: ['thought', 'thought'],
  understand: ['understood', 'understood'],
  wake: ['woke', 'woken'],
  wear: ['wore', 'worn'],
  win: ['won', 'won'],
  write: ['wrote', 'written'],
};

/** 第三人称单数形式特殊的动词 */
const IRREGULAR_3SG: Record<string, string> = { be: 'is', have: 'has', do: 'does', go: 'goes' };

const VOWELS = 'aeiou';
const endsWithConsonantY = (w: string) => /[^aeiou]y$/.test(w);

/** 第三人称单数 -s */
export function third(verb: string): string {
  const v = verb.toLowerCase();
  if (IRREGULAR_3SG[v]) return IRREGULAR_3SG[v];
  if (/(s|x|z|ch|sh|o)$/.test(v)) return v + 'es';
  if (endsWithConsonantY(v)) return v.slice(0, -1) + 'ies';
  return v + 's';
}

/**
 * 过去式。不规则表里有就用表；规则动词按拼写规则派生；
 * 两者都不适用（比如根本不是动词）时返回 null。
 */
export function past(verb: string): string | null {
  const v = verb.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v][0];
  if (!/^[a-z]+$/.test(v) || v.length < 2) return null;
  if (v.endsWith('e')) return v + 'd';
  if (endsWithConsonantY(v)) return v.slice(0, -1) + 'ied';
  // 单音节 + 辅元辅 结尾要双写：stop → stopped。w/x/y 不双写
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v)) return v + v.slice(-1) + 'ed';
  return v + 'ed';
}

export function participle(verb: string): string | null {
  const v = verb.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v][1];
  return past(v);
}

/** 现在分词 -ing */
export function ing(verb: string): string {
  const v = verb.toLowerCase();
  if (v.endsWith('ie')) return v.slice(0, -2) + 'ying'; // lie → lying
  if (v.endsWith('ee')) return v + 'ing'; // see → seeing
  if (v.endsWith('e')) return v.slice(0, -1) + 'ing';
  if (/^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v)) return v + v.slice(-1) + 'ing';
  return v + 'ing';
}

/** 名词复数 */
export function plural(noun: string): string {
  const n = noun.toLowerCase();
  const irr: Record<string, string> = {
    person: 'people', child: 'children', man: 'men', woman: 'women', foot: 'feet',
    tooth: 'teeth', mouse: 'mice', life: 'lives', wife: 'wives', knife: 'knives', leaf: 'leaves',
  };
  if (irr[n]) return irr[n];
  if (/(s|x|z|ch|sh)$/.test(n)) return n + 'es';
  if (endsWithConsonantY(n)) return n.slice(0, -1) + 'ies';
  return n + 's';
}

/** a 还是 an。按发音而不是拼写：an hour、a university */
export function article(word: string): 'a' | 'an' {
  const w = word.toLowerCase();
  if (/^(hour|honest|honou?r|heir)/.test(w)) return 'an';
  if (/^(uni|use|user|usual|euro|one|once)/.test(w)) return 'a';
  return VOWELS.includes(w[0]) ? 'an' : 'a';
}

/** 保持原来的大小写：把 fixed 套上 original 的首字母大小写 */
export function matchCase(original: string, fixed: string): string {
  if (!original || !fixed) return fixed;
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return fixed[0].toUpperCase() + fixed.slice(1);
  }
  return fixed;
}

/**
 * 分句。缩写（Mr. Dr. etc.）不当句号。
 *
 * 刻意不用后行断言 `(?<=[.!?])`：Safari 16.4 之前不支持，正则一构造就抛
 * SyntaxError，整个模块加载不起来。用"取出每一段"代替"按分隔符切"，
 * 效果一样而且到处都能跑。
 */
export function sentences(text: string): string[] {
  const guarded = text.replace(/\b(Mr|Mrs|Ms|Dr|St|vs|etc|e\.g|i\.e)\./gi, (m) => m.replace('.', ''));
  return (guarded.match(/[^.!?\n]+[.!?]*/g) ?? [])
    .map((s) => s.replace(//g, '.').trim())
    .filter(Boolean);
}

/** 取词。撇号算词内字符，don't 是一个词 */
export function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? []);
}
