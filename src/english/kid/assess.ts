/**
 * 初次测评
 *
 * 对孩子来说这不是考试，是和 Coco 玩的第一个游戏。所以：
 *  · 不出现「测试」「评分」「第几题」这类字眼
 *  · 每一题都先听声音，屏幕上只有图
 *  · 答错不打叉、不出声音提示错误，直接进下一题
 *  · 连错两题就提前结束（shouldStop），让他带着「我会」的感觉走
 *
 * 结果页也是给孩子看的那一版：只有「你真棒」和一颗星。
 * 真正的定级说明在家长端，孩子不需要知道自己被分到了哪一档。
 */

import type { AssessAnswer, AssessItem } from '../types';
import { buildAssessment, scoreAssessment, shouldStop } from '../engine/level';
import { getWord } from '../data/vocab';
import { PRAISE, TRANSITION, pick } from '../data/phrases';
import { cancelSpeech } from '../speech/tts';
import type { Ctx } from '../ui';
import { btn, dots, el, page, topbar } from '../ui';
import { micControl, optionGrid, say, speaker, type MicHandle } from './parts';

export function renderAssess(ctx: Ctx, onDone: () => void): HTMLElement {
  const profile = ctx.data.profile;
  const items = buildAssessment(profile.age, (Date.now() & 0xffff) || 7);
  const answers: AssessAnswer[] = [];
  let idx = 0;
  let mic: MicHandle | null = null;
  let startedAt = Date.now();

  const root = page('kid');
  const bar = topbar('Let\'s play!', () => {
    cleanup();
    ctx.pop();
  });
  root.appendChild(bar);
  const stage = el('div', 'en-stage');
  root.appendChild(stage);

  function cleanup() {
    mic?.dispose();
    mic = null;
    cancelSpeech();
  }

  function next(result: AssessAnswer['result'], hinted = false) {
    // 推进都排在 setTimeout 里（要留出念反馈的时间），所以这里必须防越界：
    // 一个已经排队的推进可能在测评结束之后才执行。
    const item = items[idx];
    if (!item) return;
    answers.push({
      itemId: item.id,
      result,
      hinted,
      ms: Date.now() - startedAt,
    });
    cleanup();
    idx += 1;
    if (idx >= items.length || shouldStop(answers)) {
      renderFinish();
    } else {
      renderItem();
    }
  }

  function paintBar() {
    bar.replaceChildren();
    const b = btn('‹', 'en-back', () => {
      cleanup();
      ctx.pop();
    });
    b.setAttribute('aria-label', '返回');
    bar.appendChild(b);
    bar.appendChild(el('div', 'en-bar-title', 'Play with Coco'));
    bar.appendChild(dots(items.length, idx));
  }

  function renderIntro() {
    paintBar();
    stage.replaceChildren();
    stage.appendChild(el('div', 'en-pic', '🦜'));
    stage.appendChild(el('div', 'en-ask', 'Let\'s play a little game!'));
    stage.appendChild(el('div', 'en-ask-zh', '先和 Coco 玩几个小游戏，它就知道给你安排什么内容啦'));
    const go = btn('START', 'en-btn', () => {
      startedAt = Date.now();
      renderItem();
    });
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(go);
    say('Let\'s play a little game!');
  }

  function renderItem() {
    paintBar();
    startedAt = Date.now();
    const it = items[idx];
    stage.replaceChildren();

    if (it.kind === 'say') {
      renderSay(it);
      return;
    }

    // 听音点图 / 看词选图
    if (it.kind === 'pick-word') {
      const w = getWord(it.wordId);
      stage.appendChild(el('div', 'en-word-en', w?.en ?? ''));
    } else {
      stage.appendChild(el('div', 'en-pic', '👂'));
    }

    const ask = el('div', 'en-ask', it.prompt);
    stage.appendChild(ask);
    stage.appendChild(el('div', 'en-ask-zh', it.promptZh));

    const grid = optionGrid(
      it.options.map((o) => ({
        key: o.wordId,
        emoji: o.emoji,
        label: it.kind === 'pick-word' ? '' : o.label,
        correct: o.wordId === it.wordId,
      })),
      (o, firstTry) => {
        if (o.correct) {
          say(pick(PRAISE, idx));
          setTimeout(() => next(firstTry ? 'right' : 'close'), 700);
        }
        // 点错不作处理：选项自己变暗了，孩子会继续找
      },
    );
    stage.appendChild(grid);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(it.prompt));
    const skip = btn('不知道', 'en-said', () => next('skip'));
    skip.style.opacity = '0.75';
    row.appendChild(skip);
    stage.appendChild(row);

    say(it.prompt);
  }

  function renderSay(it: AssessItem) {
    const w = getWord(it.wordId);
    stage.appendChild(el('div', 'en-pic', w?.emoji ?? '🔊'));
    stage.appendChild(el('div', 'en-word-en', w?.en ?? ''));
    stage.appendChild(el('div', 'en-ask', `Say: ${w?.en ?? ''}`));

    const fb = el('div', 'en-feedback');
    stage.appendChild(fb);

    mic = micControl({
      target: w?.en ?? '',
      allowVoice: profile.settings.allowVoice,
      seed: idx * 7 + 3,
      attempt: 1,
      onResult: (j) => {
        fb.textContent = j.feedback;
        fb.className = `en-feedback ${j.tag === 'right' ? 'good' : j.tag === 'close' ? 'almost' : 'retry'}`;
        say(j.feedback);
        setTimeout(() => next(j.tag === 'wrong' ? 'wrong' : j.tag), 900);
      },
      onSkip: () => next('skip'),
    });
    stage.appendChild(mic.node);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(w?.en ?? ''));
    stage.appendChild(row);

    say(`Say: ${w?.en ?? ''}`);
  }

  function renderFinish() {
    paintBar();
    const out = scoreAssessment(profile.age, items, answers);
    ctx.data.profile = {
      ...profile,
      english: { ...out.profile, participation: { ...profile.english.participation } },
      level: out.level,
      assessedAt: Date.now(),
    };
    // 测评里的参与行为要并进去，不能被初始化覆盖掉
    const sig = ctx.data.profile.english.participation;
    sig.attempts += out.profile.participation.attempts;
    sig.skips += out.profile.participation.skips;
    sig.voluntarySpeak += out.profile.participation.voluntarySpeak;
    ctx.save();

    stage.replaceChildren();
    stage.appendChild(el('div', 'en-pic', '🎉'));
    stage.appendChild(el('div', 'en-ask', pick(PRAISE, answers.length)));
    stage.appendChild(el('div', 'en-done-stars', '⭐'));
    stage.appendChild(el('div', 'en-ask-zh', 'Coco 已经知道该怎么陪你学啦'));
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(
      btn('看看今天学什么', 'en-btn', () => {
        cleanup();
        onDone();
      }),
    );
    say(`${pick(PRAISE, answers.length)} ${pick(TRANSITION, idx)}`);
  }

  renderIntro();
  return root;
}
