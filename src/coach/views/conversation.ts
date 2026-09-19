/**
 * 情景对话 + 复盘
 *
 * 两个关键设计，都来自需求里说得最重的两节：
 *
 * 第 7 节：**对话过程中 AI 不跳出来讲语法。** 用户只说 "Hello." 的时候，
 * 前台继续当前台。纠错会被记下来，但要等任务办完之后在复盘里一起讲。
 * 中途打断纠错会把"练习用英语办事"变成"练习被纠错"，那是两回事。
 *
 * 第 6 节：**卡住时不让用户退出。** 四级提示常驻在输入框上方，
 * 一级一级点开。用了第几级会被记下来——复盘里"自己说出来的轮数"
 * 必须是真的，否则进步是假的。
 */

import type { Conversation, Debrief, Scenario } from '../types';
import { ERROR_KIND_LABEL } from '../types';
import { buildDebrief } from '../engine/debrief';
import { currentStage, progress, startConversation, submitTurn } from '../engine/scenario';
import { analyze } from '../engine/analyze';
import { recordErrors } from '../engine/errors';
import { debriefNarrative, npcLine } from '../ai/providers';
import { remoteAvailable } from '../ai/config';
import {
  FAILURE_TEXT,
  asrSupported,
  speak,
  startAsr,
  stopSpeaking,
  ttsSupported,
  type AsrHandle,
} from '../engine/speech';
import {
  currentUserId,
  getErrorProfile,
  getProfile,
  saveConversation,
  saveErrorProfile,
} from '../store';
import {
  button,
  card,
  collapsible,
  correctionCard,
  el,
  engineNote,
  esc,
  hintLadder,
  metricGrid,
  page,
  progressBar,
  section,
  textArea,
  mountTopbar,
  topbar,
} from './ui';

export interface ConversationHandlers {
  back: () => void;
  /** 复盘看完之后 */
  onFinish: (conv: Conversation) => void;
  /** 再来一局 */
  onRetry: () => void;
}

export function renderConversation(scenario: Scenario, h: ConversationHandlers): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(
    root,
    topbar(scenario.title, () => {
      stopSpeaking();
      inflight?.abort();
      h.back();
    }),
  );

  let conv = startConversation(scenario, currentUserId(), remoteAvailable().ok ? 'remote' : 'local');
  let hintLevel = 0;
  let busy = false;
  let inflight: AbortController | null = null;
  let fallbackNote: string | undefined;
  let micHandle: AsrHandle | null = null;

  const chat = el('div', 'ec-chat');
  const goal = el('div', 'ec-goal');
  const bar = el('div', '');

  // ——— 开场白：背景交代清楚，用户才知道自己在演谁 ———
  const brief = card('flat');
  brief.innerHTML = `
    <div class="ec-row-sub">场景</div>
    <div style="margin-bottom:6px">${esc(scenario.setting)}</div>
    <div class="ec-row-sub">你要办成的事</div>
    <div><b>${esc(scenario.mission)}</b></div>`;

  const paintGoal = () => {
    const st = currentStage(conv, scenario);
    const p = progress(conv, scenario);
    bar.innerHTML = '';
    bar.appendChild(progressBar(p.done, p.total, `${p.done} / ${p.total} 步`));
    goal.innerHTML = st ? `<b>这一步：</b>${esc(st.goal)}` : '<b>任务完成。</b>';
    goal.style.display = st ? '' : 'none';
  };

  const bubble = (role: 'coach' | 'user', text: string, flag?: string) => {
    const m = el('div', `ec-msg ${role}`, esc(text));
    if (flag) m.appendChild(el('span', 'ec-msg-flag', esc(flag)));
    chat.appendChild(m);
    // 新消息滚到可见处。**用瞬时滚动**：平滑滚动是一段会持续几百毫秒的动画，
    // 而任务完成时紧接着就要切到复盘页并把容器归位——那个动画会在归位之后
    // 继续跑完，把页面又拖回聊天的位置，复盘页一打开就停在半中间
    requestAnimationFrame(() => m.scrollIntoView({ block: 'nearest' }));
    return m;
  };

  const sayAloud = (text: string) => {
    if (ttsSupported()) speak(text, { rate: 0.92 });
  };

  // 开场 NPC 台词
  bubble('coach', conv.messages[0].text);
  sayAloud(conv.messages[0].text);

  // ——— 输入区 ———
  const composer = el('div', '');
  const ta = textArea('说点什么…（也可以点麦克风）', '', 2);
  const status = el('div', 'ec-listening');

  const mic = el('button', 'ec-mic', '🎤');
  mic.type = 'button';
  mic.setAttribute('aria-label', '说话');
  if (!asrSupported()) {
    mic.disabled = true;
    status.textContent = '这个浏览器不支持语音识别，打字一样能练——场景对话练的是"能不能办成事"。';
  }
  mic.addEventListener('click', () => {
    if (micHandle) {
      micHandle.stop();
      micHandle = null;
      mic.classList.remove('recording');
      return;
    }
    status.textContent = '正在听…';
    mic.classList.add('recording');
    micHandle = startAsr({
      onInterim: (t) => (ta.value = t),
      onResult: (r) => {
        micHandle = null;
        mic.classList.remove('recording');
        ta.value = r.transcript;
        status.textContent = '识别完成。可以直接改，也可以直接发。';
        spokenPending = true;
      },
      onError: (f) => {
        micHandle = null;
        mic.classList.remove('recording');
        const info = FAILURE_TEXT[f];
        status.textContent = info.detail ? `${info.title}。${info.detail}` : info.title;
      },
    });
  });

  let spokenPending = false;
  ta.addEventListener('input', () => {
    spokenPending = false;
  });

  const send = button('说这句', 'primary block');

  const row = el('div', 'ec-composer');
  row.appendChild(ta);
  row.appendChild(mic);

  // ——— 四级提示：常驻，但默认折叠 ———
  const hintSlot = el('div', '');
  const paintHint = () => {
    hintSlot.innerHTML = '';
    const st = currentStage(conv, scenario);
    if (!st) return;
    hintSlot.appendChild(
      hintLadder({
        ...st.hint,
        onReveal: (lv) => {
          hintLevel = Math.max(hintLevel, lv);
        },
      }),
    );
  };

  const doSend = async () => {
    const text = ta.value.trim();
    if (!text || busy) return;
    busy = true;
    send.disabled = true;
    if (micHandle) {
      micHandle.stop();
      micHandle = null;
      mic.classList.remove('recording');
    }

    const usedHint = hintLevel;
    const via = spokenPending ? 'spoken' : 'typed';
    bubble('user', text, usedHint ? `用了第 ${usedHint} 级提示` : undefined);
    ta.value = '';
    spokenPending = false;

    const before = conv;
    const result = submitTurn(conv, scenario, text, { via, hintLevel: usedHint });
    conv = result.conversation;
    hintLevel = 0;

    // 这一轮的纠错记进档案，但**不在对话里打断用户**
    const lastUser = conv.messages.filter((m) => m.role === 'user').slice(-1)[0];
    if (lastUser?.corrections?.length) {
      saveErrorProfile(recordErrors(getErrorProfile(), lastUser.corrections));
    }

    const stage = currentStage(before, scenario);
    const attempts = before.messages.filter((m) => m.role === 'user' && m.stageId === stage?.id).length;

    // NPC 台词：能用模型就用模型演，用不了就用写好的台词。推进与否已经本地定好了
    const thinking = bubble('coach', '…');
    inflight = new AbortController();
    let line = result.reply;
    try {
      const out = await npcLine(
        {
          scenario,
          stage: stage ?? scenario.stages[0],
          userText: text,
          advanced: result.advanced,
          attempts,
          history: before.messages.map((m) => ({ role: m.role, text: m.text })),
        },
        getProfile(),
        getErrorProfile().records,
        result.reply,
        inflight.signal,
      );
      line = out.value;
      if (out.note) fallbackNote = out.note;
    } catch {
      line = result.reply;
    }
    inflight = null;
    thinking.textContent = line;
    // 模型改写过台词，对话记录里也要存改写后的，否则复盘对不上
    const lastCoach = [...conv.messages].reverse().find((m) => m.role === 'coach');
    if (lastCoach) lastCoach.text = line;
    sayAloud(line);

    if (result.advanced && !result.complete) {
      const marker = el('div', 'ec-stage', '✓ 这一步完成');
      chat.insertBefore(marker, thinking);
    }

    paintGoal();
    paintHint();
    busy = false;
    send.disabled = false;

    if (result.complete) {
      conv.endedAt = Date.now();
      saveConversation(conv);
      showDebrief();
    }
  };

  send.addEventListener('click', () => void doSend());
  ta.addEventListener('keydown', (e) => {
    // 桌面上 Enter 直接发，Shift+Enter 换行。手机上不拦
    if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 720px)').matches) {
      e.preventDefault();
      void doSend();
    }
  });

  composer.appendChild(hintSlot);
  composer.appendChild(row);
  composer.appendChild(status);
  composer.appendChild(send);

  const giveUp = button('这一局先到这里', 'ghost block');
  giveUp.addEventListener('click', () => {
    stopSpeaking();
    inflight?.abort();
    conv.endedAt = Date.now();
    saveConversation(conv);
    showDebrief();
  });

  // ——— 复盘 ———
  const showDebrief = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    // 对话过程中容器已经被滚到底部了。复盘是换了一整页内容，不归位的话
    // 用户打开看到的是页面中间——第一眼就漏掉"任务完成"和"你做得好的地方"。
    // 再用一帧兜底：上一条消息的滚动可能还排在这一帧后面
    const scroller = root.parentElement;
    const toTop = () => {
      if (scroller) scroller.scrollTop = 0;
      root.scrollTop = 0;
    };
    toTop();
    requestAnimationFrame(toTop);
    const d = buildDebrief(conv, scenario);
    conv.debrief = d;
    saveConversation(conv);
    body.appendChild(renderDebrief(conv, scenario, d, fallbackNote));
    foot.appendChild(button('再来一局', 'block', h.onRetry));
    foot.appendChild(button('完成', 'primary block', () => h.onFinish(conv)));
  };

  body.appendChild(brief);
  body.appendChild(bar);
  body.appendChild(goal);
  body.appendChild(chat);
  foot.appendChild(composer);
  foot.appendChild(giveUp);
  paintGoal();
  paintHint();
  return root;
}

/**
 * 复盘页。
 *
 * 顺序刻意是：先说做成了什么 → 再说问题 → 再说更自然的说法 → 最后给下一步。
 * 把问题放在最前面的版本试过，读起来像一份批评报告，
 * 而成年人已经有足够多的东西在批评他们了。
 */
export function renderDebrief(
  conv: Conversation,
  scenario: Scenario,
  d: Debrief,
  note?: string,
): HTMLElement {
  const wrap = el('div', '');

  const head = card();
  head.innerHTML = `
    <div class="ec-row-sub">${esc(scenario.title)} · 复盘</div>
    <h2 style="margin:4px 0 2px">${conv.missionComplete ? '任务完成' : '这一局没走完'}</h2>
    <div class="ec-muted">${esc(scenario.mission)}</div>`;
  head.appendChild(progressBar(conv.clearedStages.length, scenario.stages.length, `${conv.clearedStages.length} / ${scenario.stages.length} 步`));
  wrap.appendChild(head);

  if (note) wrap.appendChild(engineNote(note, 'warn'));

  if (d.strengths.length) {
    wrap.appendChild(section('你做得好的地方'));
    const c = card('flat');
    for (const s of d.strengths) c.appendChild(el('div', 'ec-row-title', `· ${esc(s)}`));
    wrap.appendChild(c);
  }

  if (d.issues.length) {
    wrap.appendChild(section(`最值得改的 ${d.issues.length} 处`, '不是你说错的全部——一次改太多等于一个也记不住。'));
    for (const c of d.issues) {
      wrap.appendChild(
        correctionCard({
          kind: c.kind,
          kindLabel: ERROR_KIND_LABEL[c.kind],
          severity: c.severity,
          original: c.original,
          fixed: c.fixed,
          problem: c.problem,
          why: c.why,
        }),
      );
    }
  } else {
    wrap.appendChild(section('这一局没有明显的错误'));
  }

  if (d.naturalSwaps.length) {
    wrap.appendChild(section('更自然的说法'));
    const c = card('flat');
    for (const s of d.naturalSwaps) {
      c.appendChild(el('div', 'ec-row-title', `${esc(s.yours)} → ${esc(s.better)}`));
    }
    wrap.appendChild(c);
  }

  if (d.newWords.length) {
    wrap.appendChild(section('这一局你用出来的词'));
    const c = card('flat');
    c.innerHTML = d.newWords.map((w) => `<span class="ec-tag ok">${esc(w)}</span>`).join('');
    wrap.appendChild(c);
  }

  if (d.redoLine) {
    const unchanged = d.redoLine.yours.trim() === d.redoLine.target.trim();
    wrap.appendChild(section(unchanged ? '最值得再说一遍的一句' : '最值得重说一遍的一句'));
    const c = card();
    // 没什么可改的时候只摆一句话。划掉一句再原样写一遍，会让人以为产品坏了
    c.innerHTML = unchanged
      ? `<div class="ec-corr-row to"><i>再说一遍</i><span>${esc(d.redoLine.target)}</span></div>
         <div class="ec-corr-why">${esc(d.redoLine.why)}</div>`
      : `<div class="ec-corr-row from"><i>你说的</i><span>${esc(d.redoLine.yours)}</span></div>
         <div class="ec-corr-row to"><i>改成</i><span>${esc(d.redoLine.target)}</span></div>
         <div class="ec-corr-why">${esc(d.redoLine.why)}</div>`;
    if (ttsSupported()) {
      const play = button('🔊 听一遍标准说法', 'small');
      play.addEventListener('click', () => speak(d.redoLine!.target, { rate: 0.85 }));
      c.appendChild(play);
    }
    wrap.appendChild(c);
  }

  wrap.appendChild(section('下一次练什么'));
  wrap.appendChild(el('div', 'ec-explain', esc(d.nextFocus)));

  wrap.appendChild(collapsible('这一局的客观数据', metricGrid(Object.entries(d.metrics))));

  return wrap;
}

/** 把一次对话的文字记录渲染出来，历史页要用 */
export function renderTranscript(conv: Conversation, scenario: Scenario): HTMLElement {
  const chat = el('div', 'ec-chat');
  for (const m of conv.messages) {
    const flags: string[] = [];
    if (m.hintLevel) flags.push(`第 ${m.hintLevel} 级提示`);
    if (m.via === 'spoken') flags.push('说的');
    if (m.corrections?.length) flags.push(`${m.corrections.length} 处可改`);
    chat.appendChild((() => {
      const b = el('div', `ec-msg ${m.role}`, esc(m.text));
      if (flags.length) b.appendChild(el('span', 'ec-msg-flag', flags.join(' · ')));
      return b;
    })());
  }
  void scenario;
  return chat;
}

/** 复盘时顺带给出 AI 的一段话（有网关才有，没有就用本地那句） */
export async function fetchNarrative(
  conv: Conversation,
  scenario: Scenario,
  d: Debrief,
  signal?: AbortSignal,
): Promise<{ text: string; note?: string }> {
  const transcript = conv.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n');
  const local = d.nextFocus;
  const out = await debriefNarrative(
    scenario,
    transcript,
    conv.missionComplete,
    d.issues,
    getProfile(),
    getErrorProfile().records,
    local,
    signal,
  );
  return { text: out.value, note: out.note };
}

/** 供外部快速分析一段自由表达（练习页复用） */
export const quickAnalyze = analyze;
