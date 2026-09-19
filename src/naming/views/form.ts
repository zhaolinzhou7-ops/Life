/**
 * 输入页
 *
 * 核心原则：**第一次用的人只需要填四个东西**。
 *
 * 大表单是取名产品最常见的劝退点——用户还没看到一个名字，就被要求填出生
 * 时辰、五行偏好、辈分字。所以这里的流程是：
 *
 *   基础信息 → 直接生成 → 觉得不够准，再去高级设置
 *
 * 高级设置永远是可选的，并且从结果页也能进。
 */

import type { Gender, NamingRequest, StyleTag, Target } from '../types';
import { ALL_STYLES } from '../types';
import { HOT_SURNAMES, getSurname } from '../data/surnames';
import { getChar } from '../data/chars';
import { button, chipGroup, el, esc, field, textInput, topbar } from './ui';

const GENDERS: { v: Gender; t: string }[] = [
  { v: 'boy', t: '男孩' },
  { v: 'girl', t: '女孩' },
  { v: 'any', t: '暂不确定' },
];

const TARGETS: { v: Target; t: string }[] = [
  { v: 'baby', t: '给宝宝取名' },
  { v: 'rename', t: '成年人改名' },
  { v: 'penname', t: '笔名 / 艺名' },
];

const LENGTHS: { v: 0 | 1 | 2; t: string }[] = [
  { v: 2, t: '双字名' },
  { v: 1, t: '单字名' },
  { v: 0, t: '都可以' },
];

export interface FormActions {
  back: () => void;
  submit: (req: NamingRequest) => void;
  advanced: () => void;
}

/** 把「王、李 小明」这类输入拆成单字数组，顺手去掉不是汉字的东西 */
function parseChars(s: string): string[] {
  return [...s].filter((c) => /[一-龥]/.test(c)).slice(0, 6);
}

export function renderForm(req: NamingRequest, a: FormActions): HTMLElement {
  const page = el('div', 'nm-page');
  page.appendChild(topbar('基础信息', a.back));

  const prog = el('div', 'nm-progress', '<i class="on"></i><i></i>');
  page.appendChild(prog);
  page.appendChild(el('div', 'nm-stepnote', '先填这四项就能生成。想更贴合你的想法，生成完再去调高级设置。'));

  // —— 姓氏 ——
  const surInput = textInput('输入姓氏，复姓也可以', req.surname);
  surInput.maxLength = 4;
  const surWrap = el('div');
  surWrap.appendChild(surInput);
  const surTip = el('div', 'nm-hint');
  surTip.style.marginTop = '8px';
  // 常用姓走单行横滑：34 个姓平铺开会占满一屏，把「只要填四项」这句话变成空话
  const hotWrap = el('div', 'nm-chips nm-chips-row');
  hotWrap.style.marginTop = '10px';
  for (const s of HOT_SURNAMES) {
    const c = el('button', 'nm-chip', esc(s));
    c.addEventListener('click', () => {
      surInput.value = s;
      req.surname = s;
      checkSurname();
    });
    hotWrap.appendChild(c);
  }
  const checkSurname = () => {
    const v = surInput.value.trim();
    req.surname = v;
    if (!v) {
      surTip.textContent = '';
      return;
    }
    const info = getSurname(v);
    if (info) {
      surTip.style.color = '';
      surTip.textContent = `读音 ${info.py.replace(/\d/, '')}${info.second ? ' ' + info.second.py.replace(/\d/, '') : ''}，音律分析会连姓一起算。`;
    } else {
      surTip.style.color = 'var(--warn)';
      surTip.textContent =
        '这个姓不在内置读音表里。名字照样能生成，但音律分析只能针对名字部分——结果页会再提醒你一次。';
    }
  };
  surInput.addEventListener('input', checkSurname);
  checkSurname();
  surWrap.appendChild(surTip);
  surWrap.appendChild(hotWrap);
  page.appendChild(field('姓氏', '', surWrap));

  // —— 性别 ——
  const gSel = new Set<string>([GENDERS.find((g) => g.v === req.gender)!.t]);
  page.appendChild(
    field(
      '性别',
      '不确定时会自动避开明显偏男或偏女的用字',
      chipGroup(
        GENDERS.map((g) => g.t),
        gSel,
        (s) => {
          const t = [...s][0];
          req.gender = GENDERS.find((g) => g.t === t)!.v;
        },
        { single: true },
      ),
    ),
  );

  // —— 命名对象 ——
  const tSel = new Set<string>([TARGETS.find((t) => t.v === req.target)!.t]);
  page.appendChild(
    field(
      '给谁取名',
      '',
      chipGroup(
        TARGETS.map((t) => t.t),
        tSel,
        (s) => {
          const t = [...s][0];
          req.target = TARGETS.find((x) => x.t === t)!.v;
        },
        { single: true },
      ),
    ),
  );

  // —— 字数 ——
  const lSel = new Set<string>([LENGTHS.find((l) => l.v === req.nameLength)!.t]);
  page.appendChild(
    field(
      '名字字数',
      '',
      chipGroup(
        LENGTHS.map((l) => l.t),
        lSel,
        (s) => {
          const t = [...s][0];
          req.nameLength = LENGTHS.find((x) => x.t === t)!.v;
        },
        { single: true },
      ),
    ),
  );

  // —— 基本要求 ——
  const brief = el('textarea', 'nm-input');
  brief.placeholder = '例如：希望文雅一点，别太常见；或者：大气好记，将来能沉下心做事。';
  brief.value = req.brief;
  brief.rows = 3;
  brief.addEventListener('input', () => (req.brief = brief.value));
  page.appendChild(
    field(
      '你想要什么样的名字',
      '用大白话写就行。写得越具体，筛出来的越准。不写也能生成。',
      brief,
    ),
  );

  // —— 底部 ——
  const foot = el('div', 'nm-formfoot');
  const go = button('生成名字', 'primary', () => {
    req.surname = surInput.value.trim();
    req.brief = brief.value.trim();
    if (!req.surname) {
      surInput.focus();
      surTip.style.color = 'var(--zhu)';
      surTip.textContent = '姓氏是必填的——名字好不好听，一定要连着姓一起判断。';
      return;
    }
    a.submit(req);
  });
  foot.appendChild(go);
  foot.appendChild(button('高级设置', 'ghost', () => {
    req.surname = surInput.value.trim();
    req.brief = brief.value.trim();
    a.advanced();
  }));
  page.appendChild(foot);

  return page;
}

// ————————————————————— 高级设置 —————————————————————

export interface AdvActions {
  back: () => void;
  submit: (req: NamingRequest) => void;
}

export function renderAdvanced(req: NamingRequest, a: AdvActions): HTMLElement {
  const page = el('div', 'nm-page');
  page.appendChild(topbar('高级设置', a.back));
  page.appendChild(el('div', 'nm-progress', '<i class="on"></i><i class="on"></i>'));
  page.appendChild(el('div', 'nm-stepnote', '全部可选。填的越多筛得越准，一项不填也完全能用。'));

  // 喜欢的风格
  const like = new Set<string>(req.likeStyles);
  page.appendChild(
    field(
      '喜欢的风格',
      '可多选',
      chipGroup(ALL_STYLES, like, (s) => (req.likeStyles = [...s] as StyleTag[])),
    ),
  );

  // 想避开的风格
  const avoid = new Set<string>(req.avoidStyles);
  page.appendChild(
    field(
      '想避开的风格',
      '选了之后，带这些气质的用字会被压到后面',
      chipGroup(ALL_STYLES, avoid, (s) => (req.avoidStyles = [...s] as StyleTag[])),
    ),
  );

  // 指定 / 禁用字
  const must = textInput('例如：宁 安', req.mustChars.join(' '));
  must.addEventListener('input', () => (req.mustChars = parseChars(must.value)));
  page.appendChild(field('指定用字', '希望名字里一定出现的字。生成的每个名字至少含其中一个。', must));

  const ban = textInput('例如：涵 轩 梓', req.banChars.join(' '));
  ban.addEventListener('input', () => (req.banChars = parseChars(ban.value)));
  page.appendChild(field('禁用字', '长辈名讳、不喜欢的字都可以填。这是硬性的，绝不会出现。', ban));

  // 辈分字
  const genWrap = el('div');
  const genInput = textInput('填一个字，不用就留空', req.genChar?.c ?? '');
  genInput.maxLength = 1;
  const posSel = new Set<string>([req.genChar?.pos === 'second' ? '放在第二个字' : '放在第一个字']);
  const posGroup = chipGroup(
    ['放在第一个字', '放在第二个字'],
    posSel,
    (s) => {
      const pos = [...s][0] === '放在第二个字' ? 'second' : 'first';
      if (req.genChar) req.genChar.pos = pos;
      else if (genInput.value.trim()) req.genChar = { c: genInput.value.trim(), pos };
    },
    { single: true },
  );
  posGroup.style.marginTop = '10px';
  const genTip = el('div', 'nm-hint');
  genTip.style.marginTop = '8px';
  const syncGen = () => {
    const c = genInput.value.trim();
    if (!c) {
      req.genChar = undefined;
      genTip.textContent = '';
      return;
    }
    const pos = [...posSel][0] === '放在第二个字' ? 'second' : 'first';
    req.genChar = { c, pos };
    if (!getChar(c)) {
      genTip.style.color = 'var(--warn)';
      genTip.textContent = `「${c}」不在内置字库里，它的读音笔画无法分析。这一项会被跳过，结果页会说明。`;
    } else {
      genTip.style.color = '';
      genTip.textContent = `所有名字都会把「${c}」放在${pos === 'first' ? '第一个' : '第二个'}字。`;
    }
  };
  genInput.addEventListener('input', syncGen);
  posGroup.addEventListener('click', () => setTimeout(syncGen, 0));
  genWrap.appendChild(genInput);
  genWrap.appendChild(posGroup);
  genWrap.appendChild(genTip);
  syncGen();
  page.appendChild(field('辈分字', '家族排辈用字。填了之后位置是定死的，另一个字才有得挑。', genWrap));

  // 气质与家庭期望
  const temper = textInput('例如：沉稳 有担当 不张扬', req.temperament.join(' '));
  temper.addEventListener('input', () => (req.temperament = temper.value.split(/[\s,，、]+/).filter(Boolean)));
  page.appendChild(field('希望名字体现的气质', '几个词就行，空格隔开', temper));

  const wish = el('textarea', 'nm-input');
  wish.placeholder = '例如：希望她一辈子心里敞亮，遇事不钻牛角尖。';
  wish.value = req.familyWish ?? '';
  wish.rows = 2;
  wish.addEventListener('input', () => (req.familyWish = wish.value));
  page.appendChild(field('家庭期望', '写给自己看的一段话，引擎会从里面找风格倾向', wish));

  // 出生信息
  const bWrap = el('div');
  const row = el('div', 'nm-row');
  const date = el('input', 'nm-input');
  date.type = 'date';
  date.value = req.birthDate ?? '';
  date.addEventListener('input', () => (req.birthDate = date.value));
  const time = el('input', 'nm-input');
  time.type = 'time';
  time.value = req.birthTime ?? '';
  time.addEventListener('input', () => (req.birthTime = time.value));
  row.appendChild(date);
  row.appendChild(time);
  bWrap.appendChild(row);
  const place = textInput('出生地（选填）', req.birthPlace ?? '');
  place.style.marginTop = '10px';
  place.addEventListener('input', () => (req.birthPlace = place.value));
  bWrap.appendChild(place);
  page.appendChild(field('出生信息', '只有勾选了「参考五行」才会用到。不填也不影响生成。', bWrap));

  // 传统文化
  const cult = new Set<string>();
  if (req.useClassics) cult.add('参考经典文学出处');
  if (req.useWuxing) cult.add('参考传统五行');
  const cultGroup = chipGroup(['参考经典文学出处', '参考传统五行'], cult, (s) => {
    req.useClassics = s.has('参考经典文学出处');
    req.useWuxing = s.has('参考传统五行');
  });
  page.appendChild(field('传统文化', '', cultGroup));

  page.appendChild(
    el(
      'div',
      'nm-disclaimer',
      '关于五行：这是传统文化体系中的命名参考方法，不属于现代科学验证的因果预测。它在这里只做很小的加权，' +
        '不会为了补某个五行，把一个读起来别扭、写起来费劲的名字排到前面。',
    ),
  );

  const foot = el('div', 'nm-formfoot');
  foot.appendChild(button('用这些设置生成', 'primary', () => a.submit(req)));
  page.appendChild(foot);
  return page;
}
