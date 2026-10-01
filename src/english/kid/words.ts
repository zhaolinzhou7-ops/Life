/**
 * 单词学习
 *
 * 实现 §8 那条链，一个词走完整圈再换下一个：
 *
 *   See → Hear → Repeat → Recognize → Choose → Use → （进复习队列）
 *
 * 为什么不是「apple = 苹果，念十遍」：孩子记住的不是读音，是**意义和场景的连接**。
 * 所以每个词都要经历：看见图、听见音、自己说一次、从干扰项里认出来、
 * 放进一个句子里用一次。最后由复习引擎安排它在后面几天里再出现。
 *
 * 复习模式（mode='review'）只走 Choose + Repeat 两步。复习的目的是唤起，
 * 不是重新教一遍——把整圈再走一次，孩子会觉得「这个我都会了还来」。
 */

import type { DailyMission, MissionStep, Outcome, SessionRecord, Word } from '../types';
import { getWord, distractors, pointPrompt, withArticle } from '../data/vocab';
import { INVITE_SPEAK, PRAISE, hintFor, pick } from '../data/phrases';
import { LEVEL_INFO } from '../engine/profile';
import { rng, shuffle } from '../engine/util';
import { cancelSpeech } from '../speech/tts';
import { commitActivity, type ActivityDraft } from '../session';
import type { Ctx } from '../ui';
import { btn, dots, el, page, topbar } from '../ui';
import { micControl, optionGrid, say, speaker, type MicHandle } from './parts';

export interface WordsOptions {
  step: MissionStep;
  mission: DailyMission;
  session: SessionRecord;
  mode: 'learn' | 'review';
  onDone: (s: SessionRecord) => void;
  onBack: () => void;
}

type Phase = 'show' | 'repeat' | 'choose' | 'use';

export function renderWords(ctx: Ctx, opt: WordsOptions): HTMLElement {
  const profile = ctx.data.profile;
  const words = opt.step.wordIds.map(getWord).filter((w): w is Word => !!w);
  const rnd = rng(opt.mission.seed + opt.step.id.length);
  const sentenceLevel = Math.min(3, Math.max(1, LEVEL_INFO[profile.level].storyLevel)) as 1 | 2 | 3;

  // 每个词要走的步骤。复习只唤起，不重教
  const phases: Phase[] = opt.mode === 'review' ? ['choose', 'repeat'] : ['show', 'repeat', 'choose', 'use'];

  const outcomes: Outcome[] = [];
  const draft: ActivityDraft = {
    kind: opt.step.kind,
    refId: opt.step.id,
    title: opt.step.titleZh,
    learningOutcome: opt.step.learningOutcome,
    outcomes,
    startedAt: Date.now(),
  };

  let wi = 0;
  let pi = 0;
  let attempt = 1;
  let hinted = false;
  let mic: MicHandle | null = null;
  let finished = false;

  const root = page('kid');
  const bar = topbar('', back);
  root.appendChild(bar);
  const stage = el('div', 'en-stage');
  root.appendChild(stage);

  function cleanup() {
    mic?.dispose();
    mic = null;
    cancelSpeech();
  }

  function back() {
    cleanup();
    opt.onBack();
  }

  function record(o: Omit<Outcome, 'at'>) {
    outcomes.push({ ...o, at: Date.now() });
  }

  function advance() {
    cleanup();
    attempt = 1;
    hinted = false;
    pi += 1;
    if (pi >= phases.length) {
      pi = 0;
      wi += 1;
    }
    if (wi >= words.length) finish();
    else render();
  }

  function finish() {
    // 排队中的推进可能在活动已经结束之后才执行，提交两遍会把这次作答算两次
    if (finished) return;
    finished = true;
    cleanup();
    const s = commitActivity(ctx.data, opt.session, draft, opt.mission);
    ctx.save();
    opt.onDone(s);
  }

  function paintBar(w: Word) {
    bar.replaceChildren();
    const b = btn('‹', 'en-back', back);
    b.setAttribute('aria-label', '返回');
    bar.appendChild(b);
    bar.appendChild(el('div', 'en-bar-title', opt.mode === 'review' ? `🔁 ${w.en}` : w.en));
    bar.appendChild(dots(words.length, wi));
  }

  function render() {
    const w = words[wi];
    if (!w) return finish();
    paintBar(w);
    stage.replaceChildren();
    const phase = phases[pi];
    if (phase === 'show') renderShow(w);
    else if (phase === 'repeat') renderRepeat(w);
    else if (phase === 'choose') renderChoose(w);
    else renderUse(w);
  }

  // ——— See + Hear ———
  function renderShow(w: Word) {
    const picture = el('div', 'en-pic tap', w.emoji);
    picture.addEventListener('click', () => say(w.en));
    stage.appendChild(picture);
    stage.appendChild(el('div', 'en-word-en', w.en));
    stage.appendChild(el('div', 'en-word-zh', w.zh));

    const sentence = w.sentences.find((s) => s.level === sentenceLevel) ?? w.sentences[0];
    const sn = el('div', 'en-sentence');
    sn.textContent = sentence.text;
    stage.appendChild(sn);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(`${w.en}. ${sentence.text}`));
    stage.appendChild(row);

    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('NEXT →', 'en-btn', advance));

    say(`${w.en}. ${w.en}. ${sentence.text}`);
  }

  // ——— Repeat ———
  function renderRepeat(w: Word) {
    stage.appendChild(el('div', 'en-pic', w.emoji));
    stage.appendChild(el('div', 'en-word-en', w.en));
    stage.appendChild(el('div', 'en-ask', `Say: ${w.en}`));

    const fb = el('div', 'en-feedback');
    stage.appendChild(fb);

    const mount = () => {
      mic?.dispose();
      mic = micControl({
        target: w.en,
        allowVoice: profile.settings.allowVoice,
        seed: opt.mission.seed + wi * 13 + attempt,
        attempt,
        onResult: (j, usedMic) => {
          fb.textContent = j.feedback;
          fb.className = `en-feedback ${j.tag === 'right' ? 'good' : j.tag === 'close' ? 'almost' : 'retry'}`;
          say(j.feedback);
          record({
            wordId: w.id,
            skill: 'speaking',
            result: j.tag === 'wrong' ? 'wrong' : j.tag,
            hinted: hinted || !usedMic,
            stage: 'speak',
          });
          if (j.retry && attempt < 2 && usedMic) {
            // 只再给一次机会。反复卡在同一个词上会让孩子失去兴趣，
            // 而且这个词已经进了复习队列，明天还会见到。
            attempt += 1;
            hinted = true;
            setTimeout(() => {
              fb.textContent = '';
              fb.className = 'en-feedback';
              say(`${hintFor(w.en, 1)} ${pick(INVITE_SPEAK, wi)}`);
              mount();
            }, 1100);
          } else {
            setTimeout(advance, 1000);
          }
        },
        onSkip: () => {
          record({ wordId: w.id, skill: 'speaking', result: 'skip', hinted: false, stage: 'speak' });
          advance();
        },
      });
      // 替换掉旧的麦克风控件
      const old = stage.querySelector('.en-mic-wrap');
      if (old) old.replaceWith(mic.node);
      else stage.appendChild(mic.node);
    };
    mount();

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(w.en));
    stage.appendChild(row);

    say(`${pick(INVITE_SPEAK, wi)} ${w.en}`);
  }

  // ——— Recognize + Choose ———
  function renderChoose(w: Word) {
    const others = distractors(w, 2, rnd);
    const opts = shuffle(
      [w, ...others].map((x) => ({ key: x.id, emoji: x.emoji, label: x.en, correct: x.id === w.id })),
      rnd,
    );

    stage.appendChild(el('div', 'en-pic', '👂'));
    const q = pointPrompt(w);
    stage.appendChild(el('div', 'en-ask', q));
    stage.appendChild(el('div', 'en-ask-zh', '听一听，点出对的那张图'));

    const fb = el('div', 'en-feedback');

    stage.appendChild(
      optionGrid(opts, (o, firstTry) => {
        if (o.correct) {
          record({
            wordId: w.id,
            skill: 'listening',
            result: firstTry ? 'right' : 'wrong',
            hinted: !firstTry,
            stage: 'listen',
          });
          fb.textContent = pick(PRAISE, wi + pi);
          fb.className = 'en-feedback good';
          say(`${pick(PRAISE, wi + pi)} ${w.en}!`);
          setTimeout(advance, 950);
        } else {
          fb.textContent = 'Almost! Listen again.';
          fb.className = 'en-feedback almost';
          say(`Almost! ${w.en}.`);
        }
      }),
    );
    stage.appendChild(fb);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(q));
    const skip = btn('不知道', 'en-said', () => {
      record({ wordId: w.id, skill: 'listening', result: 'skip', hinted: false, stage: 'listen' });
      advance();
    });
    skip.style.opacity = '0.75';
    row.appendChild(skip);
    stage.appendChild(row);

    say(q);
  }

  // ——— Use ———
  function renderUse(w: Word) {
    const sentence = w.sentences.find((s) => s.level === sentenceLevel) ?? w.sentences[0];
    stage.appendChild(el('div', 'en-pic', w.emoji));
    const sn = el('div', 'en-sentence');
    sn.textContent = sentence.text;
    stage.appendChild(sn);
    stage.appendChild(el('div', 'en-ask', w.ask));

    const fb = el('div', 'en-feedback');
    stage.appendChild(fb);

    // 起步阶段不要求开口说整句：给选项，把压力降下来
    if (profile.level === 'starter' || !profile.settings.allowVoice) {
      const others = distractors(w, 2, rnd);
      const opts = shuffle(
        [w, ...others].map((x) => ({ key: x.id, emoji: x.emoji, label: x.en, correct: x.id === w.id })),
        rnd,
      );
      stage.appendChild(
        optionGrid(opts, (o, firstTry) => {
          if (o.correct) {
            record({
              wordId: w.id,
              skill: 'vocabulary',
              result: firstTry ? 'right' : 'wrong',
              hinted: !firstTry,
              stage: 'use',
            });
            fb.textContent = pick(PRAISE, wi);
            fb.className = 'en-feedback good';
            say(`${pick(PRAISE, wi)} ${sentence.text}`);
            setTimeout(advance, 950);
          } else {
            fb.textContent = 'Good try!';
            fb.className = 'en-feedback almost';
          }
        }),
      );
    } else {
      mic = micControl({
        target: w.en,
        accept: [sentence.text, `it is ${withArticle(w)}`, withArticle(w)],
        allowVoice: profile.settings.allowVoice,
        seed: opt.mission.seed + wi * 5,
        attempt: 1,
        onResult: (j, usedMic) => {
          fb.textContent = j.feedback;
          fb.className = `en-feedback ${j.tag === 'right' ? 'good' : j.tag === 'close' ? 'almost' : 'retry'}`;
          say(j.tag === 'right' ? `${j.feedback} ${sentence.text}` : `${j.feedback} ${w.en}.`);
          record({
            wordId: w.id,
            skill: 'sentence',
            result: j.tag === 'wrong' ? 'wrong' : j.tag,
            hinted: !usedMic,
            stage: 'use',
          });
          setTimeout(advance, 1050);
        },
        onSkip: () => {
          record({ wordId: w.id, skill: 'sentence', result: 'skip', hinted: false, stage: 'use' });
          advance();
        },
      });
      stage.appendChild(mic.node);
    }

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(`${sentence.text} ${w.ask}`));
    stage.appendChild(row);

    say(`${sentence.text} ${w.ask}`);
  }

  if (!words.length) {
    stage.appendChild(el('div', 'en-pic', '🎈'));
    stage.appendChild(el('div', 'en-ask', 'All done!'));
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('继续', 'en-btn', finish));
  } else {
    render();
  }

  return root;
}
