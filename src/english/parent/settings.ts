/**
 * 家长设置
 *
 * 分三块：孩子信息、学习安排、AI 与隐私。
 *
 * 隐私那一块写得很直白，包括我们做不到的部分（§24 最后一条）：
 * 不自称「已完全合规」——合规取决于实际部署的国家和地区，
 * 一个静态页面没资格替部署者下这个结论。能说的只有「我们实际做了什么」。
 */

import type { ChildSettings } from '../types';
import { DEFAULT_CONFIG, loadConfig, saveConfig, type AiConfig } from '../ai/config';
import { engineStatus } from '../ai';
import { ERROR_TEXT, micPermission, recognizerAvailable } from '../speech/recognizer';
import { ttsAvailable } from '../speech/tts';
import { eraseEverything, saveChild, setParentPin, getParentPin, storageSize } from '../store';
import type { Ctx } from '../ui';
import { btn, card, el, page, toast, topbar } from '../ui';

export function renderSettings(ctx: Ctx, onBack: () => void, onErased: () => void): HTMLElement {
  const data = ctx.data;
  const p = data.profile;
  const s: ChildSettings = { ...p.settings };
  let cfg: AiConfig = loadConfig();

  const root = page('parent');
  root.appendChild(topbar('设置', onBack));

  const commit = () => {
    p.settings = { ...s };
    data.profile = p;
    // 设置变了，今天的任务要按新设置重算（plan.ensureMission 会检测到）
    saveChild(data);
    ctx.save();
  };

  // ———————————————— 孩子信息 ————————————————
  const c1 = card('孩子信息');

  const nameField = el('div', 'en-field');
  nameField.appendChild(el('label', undefined, '昵称'));
  const nameInput = el('input', 'en-input');
  nameInput.type = 'text';
  nameInput.value = p.name;
  nameInput.maxLength = 12;
  nameInput.addEventListener('change', () => {
    p.name = nameInput.value.trim() || p.name;
    commit();
    toast('已保存');
  });
  nameField.appendChild(nameInput);
  nameField.appendChild(el('div', 'note', '建议用小名。这个名字只存在本机，也会在对话里被 Coco 叫到。'));
  c1.appendChild(nameField);

  const ageField = el('div', 'en-field');
  ageField.appendChild(el('label', undefined, '年龄'));
  const ageSeg = el('div', 'en-seg');
  const ageBtns: HTMLButtonElement[] = [];
  for (let a = 4; a <= 12; a++) {
    const b = el('button', a === p.age ? 'on' : '');
    b.type = 'button';
    b.textContent = String(a);
    b.addEventListener('click', () => {
      p.age = a;
      ageBtns.forEach((x, i) => x.classList.toggle('on', i + 4 === a));
      commit();
    });
    ageBtns.push(b);
    ageSeg.appendChild(b);
  }
  ageField.appendChild(ageSeg);
  ageField.appendChild(
    el('div', 'note', '年龄只影响出题的形式（比如 7 岁以下不出认字题）。真正的难度由测评结果和平时表现决定。'),
  );
  c1.appendChild(ageField);

  const assessRow = el('div', 'en-field');
  assessRow.appendChild(el('label', undefined, '英语基础'));
  assessRow.appendChild(
    el(
      'div',
      'note',
      p.assessedAt
        ? `已在 ${new Date(p.assessedAt).toLocaleDateString()} 做过测评。如果孩子进步很快或者觉得内容偏难，可以重新测一次。`
        : '还没有做过测评。做一次（约 3 分钟）之后，内容会贴合很多。',
    ),
  );
  const reassess = el('div', 'en-pbtn-row');
  reassess.appendChild(
    btn(p.assessedAt ? '重新测评' : '去测评', 'en-pbtn', () => {
      p.assessedAt = undefined;
      commit();
      toast('下次进入儿童端会重新测评');
      onBack();
    }),
  );
  assessRow.appendChild(reassess);
  c1.appendChild(assessRow);

  root.appendChild(c1);

  // ———————————————— 学习安排 ————————————————
  const c2 = card('学习安排');

  const seg = (
    label: string,
    note: string,
    options: { v: string; l: string }[],
    get: () => string,
    set: (v: string) => void,
  ) => {
    const f = el('div', 'en-field');
    f.appendChild(el('label', undefined, label));
    const g = el('div', 'en-seg');
    const bs: HTMLButtonElement[] = [];
    for (const o of options) {
      const b = el('button', get() === o.v ? 'on' : '');
      b.type = 'button';
      b.textContent = o.l;
      b.addEventListener('click', () => {
        set(o.v);
        bs.forEach((x, i) => x.classList.toggle('on', options[i].v === o.v));
        commit();
      });
      bs.push(b);
      g.appendChild(b);
    }
    f.appendChild(g);
    f.appendChild(el('div', 'note', note));
    return f;
  };

  c2.appendChild(
    seg(
      '每天学习时长',
      '任务生成器会按这个时长裁剪活动，超时的部分直接不安排，而不是让孩子做一半被打断。低龄孩子 10 分钟就够。',
      [
        { v: '10', l: '10 分钟' },
        { v: '15', l: '15 分钟' },
        { v: '20', l: '20 分钟' },
      ],
      () => String(s.dailyMinutes),
      (v) => (s.dailyMinutes = Number(v)),
    ),
  );

  c2.appendChild(
    seg(
      '内容难度',
      '默认交给系统。孩子连续答对很多会自动变难，连续出错会自动变简单。只有在你觉得系统判断明显不对时才手动调。',
      [
        { v: 'auto', l: '自动' },
        { v: 'easier', l: '简单一点' },
        { v: 'harder', l: '难一点' },
      ],
      () => s.difficulty,
      (v) => (s.difficulty = v as ChildSettings['difficulty']),
    ),
  );

  c2.appendChild(
    seg(
      '学习重点',
      '会影响游戏和活动的配比。没有特别想法就选「均衡」。',
      [
        { v: 'balanced', l: '均衡' },
        { v: 'listening', l: '听力' },
        { v: 'speaking', l: '口语' },
        { v: 'vocabulary', l: '词汇' },
      ],
      () => s.goal,
      (v) => (s.goal = v as ChildSettings['goal']),
    ),
  );

  root.appendChild(c2);

  // ———————————————— 语音 ————————————————
  const c3 = card('语音');

  const toggleRow = (
    title: string,
    desc: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ) => {
    const row = el('div', 'en-switch');
    const txt = el('div', 'en-switch-txt');
    txt.appendChild(el('b', undefined, title));
    txt.appendChild(el('span', undefined, desc));
    row.appendChild(txt);
    const t = el('div', `en-toggle${get() ? ' on' : ''}`);
    t.setAttribute('role', 'switch');
    t.addEventListener('click', () => {
      const v = !get();
      set(v);
      t.classList.toggle('on', v);
      commit();
    });
    row.appendChild(t);
    return row;
  };

  c3.appendChild(
    toggleRow(
      '允许使用麦克风',
      '关掉之后，跟读环节会变成「点一下表示我说了」，其它内容不受影响。',
      () => s.allowVoice,
      (v) => (s.allowVoice = v),
    ),
  );

  c3.appendChild(
    toggleRow(
      '保存对话文字记录',
      '默认关闭。打开后可以在这里回看孩子说过什么。无论开关如何，录音本身永远不会被保存。',
      () => s.keepTranscripts,
      (v) => (s.keepTranscripts = v),
    ),
  );

  const status = el('div', 'en-notice');
  const bits: string[] = [];
  bits.push(ttsAvailable() ? '朗读：可用（用的是系统自带音色）' : '朗读：这个浏览器不支持，界面会改成只看不听');
  bits.push(recognizerAvailable() ? '语音识别：可用' : `语音识别：${ERROR_TEXT['not-supported']}`);
  status.textContent = bits.join('；');
  c3.appendChild(status);

  void micPermission().then((st) => {
    if (st === 'denied') {
      const warn = el('div', 'en-notice warn', ERROR_TEXT.denied);
      c3.appendChild(warn);
    }
  });

  root.appendChild(c3);

  // ———————————————— AI ————————————————
  const c4 = card('AI 设置');
  const st = engineStatus();
  const stNote = el('div', 'en-notice', `${st.label}。${st.detail}`);
  c4.appendChild(stNote);

  const modeField = el('div', 'en-field');
  modeField.appendChild(el('label', undefined, 'AI 来源'));
  const modeSeg = el('div', 'en-seg');
  const modeBtns: HTMLButtonElement[] = [];
  const modes: { v: AiConfig['mode']; l: string }[] = [
    { v: 'mock', l: '内置引擎（离线）' },
    { v: 'remote', l: '接入 AI 网关' },
  ];
  for (const m of modes) {
    const b = el('button', cfg.mode === m.v ? 'on' : '');
    b.type = 'button';
    b.textContent = m.l;
    b.addEventListener('click', () => {
      cfg = { ...cfg, mode: m.v };
      saveConfig(cfg);
      modeBtns.forEach((x, i) => x.classList.toggle('on', modes[i].v === m.v));
      gw.style.display = m.v === 'remote' ? '' : 'none';
      const now = engineStatus();
      stNote.textContent = `${now.label}。${now.detail}`;
    });
    modeBtns.push(b);
    modeSeg.appendChild(b);
  }
  modeField.appendChild(modeSeg);
  modeField.appendChild(
    el(
      'div',
      'note',
      '内置引擎完全离线，学习、游戏、故事、对话、报告都能正常用。接入网关之后，Coco 说话会更自然，故事能按孩子的薄弱点现编。',
    ),
  );
  c4.appendChild(modeField);

  const gw = el('div');
  gw.style.display = cfg.mode === 'remote' ? '' : 'none';

  const mkInput = (label: string, note: string, key: 'endpoint' | 'token' | 'model', ph: string, pwd = false) => {
    const f = el('div', 'en-field');
    f.appendChild(el('label', undefined, label));
    const i = el('input', 'en-input');
    i.type = pwd ? 'password' : 'text';
    i.placeholder = ph;
    i.value = cfg[key];
    i.autocomplete = 'off';
    i.addEventListener('change', () => {
      cfg = { ...cfg, [key]: i.value.trim() };
      saveConfig(cfg);
      const now = engineStatus();
      stNote.textContent = `${now.label}。${now.detail}`;
    });
    f.appendChild(i);
    f.appendChild(el('div', 'note', note));
    return f;
  };

  gw.appendChild(
    mkInput(
      '网关地址',
      '你自己部署的中转地址，API Key 留在那一端。契约见仓库里 src/english/ai/README.md，有一个 Cloudflare Workers 的完整例子。',
      'endpoint',
      'https://your-worker.example.com/english',
    ),
  );
  gw.appendChild(
    mkInput('网关密码（可选）', '填了会作为 Authorization 头发给你的网关。留空则不发。', 'token', '留空则不发送', true),
  );
  gw.appendChild(mkInput('模型名（可选）', '原样透传给网关，由网关决定怎么用。', 'model', '例如 claude-sonnet-5'));

  const warn = el('div', 'en-notice warn');
  warn.textContent =
    '别把模型厂商的 API Key 直接填在这里。这是一个纯前端页面，填进浏览器的东西，装了扩展的浏览器就能读到。正确做法是部署一个网关，把密钥放在那一端。';
  gw.appendChild(warn);

  const testRow = el('div', 'en-pbtn-row');
  testRow.appendChild(
    btn('测试连接', 'en-pbtn', () => {
      const c = loadConfig();
      if (!c.endpoint) {
        toast('先填网关地址');
        return;
      }
      toast('正在测试…');
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), c.timeoutMs);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (c.token) headers.Authorization = `Bearer ${c.token}`;
      fetch(c.endpoint, {
        method: 'POST',
        headers,
        signal: ctl.signal,
        body: JSON.stringify({ system: 'reply with the word OK', user: 'ping', model: c.model || undefined }),
      })
        .then(async (r) => {
          clearTimeout(timer);
          if (!r.ok) throw new Error(`返回 ${r.status}`);
          const d = (await r.json()) as { text?: string; content?: string };
          if (!(d.text ?? d.content)) throw new Error('返回内容是空的');
          stNote.textContent = '网关连接正常。';
          toast('连接成功');
        })
        .catch((e: unknown) => {
          clearTimeout(timer);
          const msg = e instanceof Error ? e.message : String(e);
          stNote.textContent = `网关连不上：${msg}。学习不受影响，会一直用内置引擎。`;
          toast('连接失败');
        });
    }),
  );
  testRow.appendChild(
    btn('恢复默认', 'en-pbtn', () => {
      cfg = { ...DEFAULT_CONFIG };
      saveConfig(cfg);
      onBack();
    }),
  );
  gw.appendChild(testRow);
  c4.appendChild(gw);
  root.appendChild(c4);

  // ———————————————— 隐私 ————————————————
  const c5 = card('数据与隐私');
  const facts = el('ul');
  facts.style.paddingLeft = '18px';
  facts.style.color = 'var(--ink-2)';
  facts.style.lineHeight = '1.75';
  for (const line of [
    '所有学习数据只存在这台设备的浏览器里，没有账号，不上传服务器。',
    '录音永远不保存。语音识别在浏览器本地发起，只有识别出来的文字进入判定，用完即弃。',
    '对话文字默认不保存。上面的开关打开后才会留，且最多留最近 120 条。',
    '接入 AI 网关时，发给模型的只有孩子的昵称、年龄、当前问题和这一轮说的话；住址、电话、学校这类信息在发送前会被自动抹掉。',
    '换设备、清浏览器数据、用无痕窗口，记录都不会跟着走——这是纯本地存储的代价。',
  ]) {
    const li = el('li', undefined, line);
    facts.appendChild(li);
  }
  c5.appendChild(facts);

  const disclaimer = el('p');
  disclaimer.style.fontSize = '12.5px';
  disclaimer.style.color = 'var(--ink-3)';
  disclaimer.textContent =
    '关于法律合规：上面写的是这个程序实际做了什么。儿童数据在不同国家和地区有不同的具体要求（例如 COPPA、GDPR-K、中国的个人信息保护法），如果你打算把它公开部署给别人用，请按实际落地的地区再做确认。我们不声称"已经完全合规"。';
  c5.appendChild(disclaimer);

  const sizeP = el('p');
  sizeP.style.fontSize = '12.5px';
  sizeP.style.color = 'var(--ink-3)';
  sizeP.textContent = `当前占用约 ${Math.round(storageSize() / 1024)} KB。学习记录只保留最近 90 天。`;
  c5.appendChild(sizeP);

  // 家长密码
  const pinField = el('div', 'en-field');
  pinField.appendChild(el('label', undefined, '家长密码（可选）'));
  const pinInput = el('input', 'en-input');
  pinInput.type = 'text';
  pinInput.placeholder = getParentPin() ? '已设置，输入新密码可替换' : '留空则用算术题验证';
  pinInput.autocomplete = 'off';
  pinField.appendChild(pinInput);
  const pinRow = el('div', 'en-pbtn-row');
  pinRow.appendChild(
    btn('保存密码', 'en-pbtn', () => {
      const v = pinInput.value.trim();
      setParentPin(v || undefined);
      pinInput.value = '';
      toast(v ? '密码已设置' : '已改回算术题验证');
    }),
  );
  pinField.appendChild(pinRow);
  pinField.appendChild(
    el(
      'div',
      'note',
      '这道门挡的是孩子误入，不是安全措施——密码存在浏览器里，明文。不要用你在别处用过的密码。',
    ),
  );
  c5.appendChild(pinField);

  const danger = el('div', 'en-pbtn-row');
  danger.appendChild(
    btn('删除全部数据', 'en-pbtn danger', () => {
      const ok = confirm(
        '会删除这台设备上的全部学习数据：孩子档案、学习记录、掌握的词、对话记录。删掉之后无法恢复。确定吗？',
      );
      if (!ok) return;
      eraseEverything();
      onErased();
    }),
  );
  c5.appendChild(danger);

  root.appendChild(c5);
  return root;
}
