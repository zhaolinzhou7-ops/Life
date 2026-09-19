/**
 * 和 Coco 对话
 *
 * 行为模式按 §10：Ask → Wait → Listen → Understand → Respond → Encourage → Continue。
 *
 * 两个细节决定了这个功能能不能用：
 *
 * 1. **答不上来时不公布答案。** 先给音头（"It's b..."），再给首字母和范围，
 *    两次之后才给答案，而且要求跟读一次再往下走。逻辑在 ai/mock.ts 的 chat 里。
 *
 * 2. **没有麦克风也要能对话。** 这时给三个备选答案让孩子点——
 *    点选依然是在做「理解问题 + 选出合适回答」，只是少了发音练习。
 *    比起「请开启麦克风」的死胡同，这是能让学习继续的路。
 */

import type { CoachTurn, DailyMission, MissionStep, Outcome, SessionRecord } from '../types';
import { aiChat } from '../ai';
import { recognizerAvailable } from '../speech/recognizer';
import { cancelSpeech } from '../speech/tts';
import { commitActivity, type ActivityDraft } from '../session';
import { getNode } from '../data/dialog';
import type { Ctx } from '../ui';
import { btn, el, page, topbar } from '../ui';
import { micControl, say, speaker, type MicHandle } from './parts';

export interface TalkOptions {
  step: MissionStep;
  mission: DailyMission;
  session: SessionRecord;
  onDone: (s: SessionRecord) => void;
  onBack: () => void;
}

/** 没有麦克风时给的备选答案。按节点的期望回答生成，实在没有就给通用的 */
function suggestions(expect: string[] | undefined, hint: string): string[] {
  if (expect && expect.length >= 2) return expect.slice(0, 3);
  if (expect && expect.length === 1) return [expect[0], "I don't know"];
  // 开放式问题：给几个这个年龄的孩子真会说的答案
  const m = hint.match(/Say:\s*(.+?)[.。]?$/i);
  const sample = m?.[1]?.replace(/\.\.\.$/, '').trim();
  return sample ? [sample, "I don't know"] : ['Yes', 'No', "I don't know"];
}

export function renderTalk(ctx: Ctx, opt: TalkOptions): HTMLElement {
  const profile = ctx.data.profile;
  const level = (opt.step.talkLevel ?? 1) as 1 | 2 | 3;
  const history: CoachTurn[] = [];
  const outcomes: Outcome[] = [];
  const draft: ActivityDraft = {
    kind: 'talk',
    refId: opt.step.id,
    title: opt.step.titleZh,
    learningOutcome: opt.step.learningOutcome,
    outcomes,
    startedAt: Date.now(),
  };

  let hintCount = 0;
  let turns = 0;
  let mic: MicHandle | null = null;
  let busy = false;
  let ended = false;

  const root = page('kid');
  const bar = topbar('🦜 Coco', back);
  root.appendChild(bar);

  const chat = el('div', 'en-chat');
  root.appendChild(chat);

  const controls = el('div', 'en-mic-wrap');
  root.appendChild(controls);

  function cleanup() {
    mic?.dispose();
    mic = null;
    cancelSpeech();
  }

  function back() {
    cleanup();
    opt.onBack();
  }

  function bubble(role: 'coach' | 'child', text: string, emoji?: string) {
    const turn = el('div', `en-turn${role === 'child' ? ' me' : ''}`);
    turn.appendChild(el('div', 'en-coach-av', role === 'coach' ? (emoji || '🦜') : profile.avatar));
    turn.appendChild(el('div', `en-bubble${role === 'child' ? ' me' : ''}`, text));
    chat.appendChild(turn);
    chat.scrollTop = chat.scrollHeight;
  }

  function finish() {
    if (ended) return;
    ended = true;
    cleanup();
    const s = commitActivity(ctx.data, opt.session, draft, opt.mission);
    ctx.save();
    controls.replaceChildren();
    controls.appendChild(btn('继续 →', 'en-btn', () => opt.onDone(s)));
  }

  /** 把孩子说的话交给 AI 层，拿到 Coco 的下一句 */
  function send(childSaid: string, silent: boolean) {
    if (busy || ended) return;
    busy = true;
    cleanup();
    controls.replaceChildren();
    const waiting = el('div', 'en-mic-hint', 'Coco 正在想…');
    controls.appendChild(waiting);

    if (childSaid) bubble('child', childSaid);

    void aiChat({
      profile,
      level,
      history,
      childSaid,
      silent,
      hintCount,
      seed: opt.mission.seed + turns * 17,
    })
      .then((r) => {
        busy = false;
        if (ended) return;
        const reply = r.data;

        // 记录这一轮的作答。open 类问题只要开口就算 right，
        // 因为那本来就没有标准答案，要的是「敢说」。
        if (childSaid || silent) {
          const wordIds = reply.wordIds ?? [];
          const result = reply.judged ?? 'close';
          if (wordIds.length) {
            for (const id of wordIds) {
              outcomes.push({
                wordId: id,
                skill: 'speaking',
                result,
                hinted: hintCount > 0,
                stage: 'use',
                at: Date.now(),
              });
            }
          } else {
            outcomes.push({
              skill: 'speaking',
              result,
              hinted: hintCount > 0,
              stage: 'use',
              at: Date.now(),
            });
          }
          // 家长开了「保存转写」才留文本，默认不留（§24）
          if (profile.settings.keepTranscripts && childSaid) {
            ctx.data.transcripts.push({ at: Date.now(), role: 'child', text: childSaid });
          }
        }

        // 换了节点说明这一轮过了，提示计数清零
        const lastNode = [...history].reverse().find((t) => t.role === 'coach')?.nodeId;
        hintCount = reply.nodeId && reply.nodeId !== lastNode ? 0 : hintCount + 1;

        history.push({ role: 'child', text: childSaid });
        history.push({
          role: 'coach',
          text: reply.say,
          emoji: reply.emoji,
          expect: reply.expect,
          hint: reply.hint,
          nodeId: reply.nodeId,
        });
        bubble('coach', reply.say, reply.emoji);
        say(reply.say);
        turns += 1;

        if (reply.end || turns >= 8) {
          setTimeout(finish, 900);
        } else {
          mountInput(reply.expect, reply.hint ?? '');
        }
      })
      .catch(() => {
        // aiChat 自己已经降级过，走到这里是彻底失败：结束对话而不是卡住
        busy = false;
        if (!ended) finish();
      });
  }

  /** 摆出这一轮的输入方式：有麦克风就用麦克风，没有就给备选答案 */
  function mountInput(expect: string[] | undefined, hint: string) {
    cleanup();
    controls.replaceChildren();

    const canUse = profile.settings.allowVoice && recognizerAvailable();

    if (canUse) {
      mic = micControl({
        target: expect?.[0] ?? '',
        accept: expect ?? [],
        allowVoice: true,
        seed: opt.mission.seed + turns,
        attempt: 1,
        onResult: (j, usedMic) => {
          // 对话里不做对错判定，判定交给 AI 层——
          // 这里只负责把听到的话传过去
          send(j.heard ?? '', !usedMic || !j.heard);
        },
        onSkip: () => send('', true),
      });
      controls.appendChild(mic.node);
    } else {
      controls.appendChild(el('div', 'en-mic-hint', '点一个你想说的'));
      const row = el('div', 'en-chips');
      row.style.justifyContent = 'center';
      row.style.gap = '8px';
      for (const s of suggestions(expect, hint)) {
        const b = el('button', 'en-said');
        b.type = 'button';
        b.textContent = s;
        b.style.marginTop = '4px';
        b.addEventListener('click', () => send(s, false));
        row.appendChild(b);
      }
      controls.appendChild(row);
    }

    const row2 = el('div', 'en-btn-row');
    row2.style.justifyContent = 'center';
    const last = [...history].reverse().find((t) => t.role === 'coach');
    if (last) row2.appendChild(speaker(last.text));
    const stop = btn('结束', 'en-said', finish);
    stop.style.opacity = '0.75';
    row2.appendChild(stop);
    controls.appendChild(row2);
  }

  // 开场：拿脚本树的第一个问题，不走模型——每次进来听到的都一样，有安全感
  send('', false);

  // 首屏先把第一个节点的问题铺上，避免 AI 返回前是一片空白
  const first = getNode(`t${level}-hello`);
  if (first) {
    const tip = el('div', 'en-mic-hint', '和 Coco 说说话吧');
    controls.appendChild(tip);
  }

  return root;
}
