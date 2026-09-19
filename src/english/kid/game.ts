/**
 * 学习游戏
 *
 * 四个游戏，每个绑一个明确的学习目标（§15、§21）。
 * 游戏结束页必须说清楚「今天你练了哪些英语」——
 * 不能让孩子玩完只记得自己得了几颗星。
 *
 *   findit      听 Find the cat → 点猫        治「听不懂」
 *   match       看 cat 这个词 → 点猫的图       治「认不出」
 *   listen-jump 听到指令才能让角色动           治「反应不过来」
 *   echo        听一句 → 说一句                治「不敢开口」
 *
 * listen-jump 是唯一带即时压力的：屏幕上是一只要过河的青蛙，
 * 听对了才跳一格，听错了退回起点前一格（不是回到起点——那太挫败）。
 */

import type { DailyMission, MissionStep, Outcome, SessionRecord, Word } from '../types';
import { getWord, distractors, findPrompt } from '../data/vocab';
import { getGame } from '../data/games';
import { PRAISE, TRY_AGAIN, pick } from '../data/phrases';
import { rng, shuffle } from '../engine/util';
import { cancelSpeech } from '../speech/tts';
import { commitActivity, type ActivityDraft } from '../session';
import type { Ctx } from '../ui';
import { btn, dots, el, page, topbar } from '../ui';
import { micControl, optionGrid, say, speaker, type MicHandle } from './parts';

export interface GameOptions {
  step: MissionStep;
  mission: DailyMission;
  session: SessionRecord;
  onDone: (s: SessionRecord) => void;
  onBack: () => void;
}

export function renderGame(ctx: Ctx, opt: GameOptions): HTMLElement {
  const profile = ctx.data.profile;
  const def = getGame(opt.step.gameId ?? 'findit');
  const rnd = rng(opt.mission.seed + 97);
  const pool = opt.step.wordIds.map(getWord).filter((w): w is Word => !!w);
  const rounds = Math.min(def.rounds, Math.max(3, pool.length));
  const queue = shuffle(pool, rnd).slice(0, rounds);

  const outcomes: Outcome[] = [];
  const draft: ActivityDraft = {
    kind: 'game',
    refId: opt.step.id,
    title: def.titleZh,
    learningOutcome: opt.step.learningOutcome,
    outcomes,
    startedAt: Date.now(),
  };

  let i = 0;
  let correct = 0;
  let frog = 0; // listen-jump 的位置
  let mic: MicHandle | null = null;
  let finished = false;

  const root = page('kid');
  const bar = topbar(def.titleZh, back);
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
    if (o.result === 'right' || o.result === 'close') correct += 1;
  }

  function paintBar() {
    bar.replaceChildren();
    const b = btn('‹', 'en-back', back);
    b.setAttribute('aria-label', '返回');
    bar.appendChild(b);
    bar.appendChild(el('div', 'en-bar-title', `${def.emoji} ${def.titleZh}`));
    bar.appendChild(dots(queue.length, i));
  }

  function advance() {
    cleanup();
    i += 1;
    if (i >= queue.length) finish();
    else render();
  }

  function finish() {
    // 同 words.ts：排队中的推进不能把同一个活动提交两遍
    if (finished) return;
    finished = true;
    cleanup();
    const s = commitActivity(ctx.data, opt.session, draft, opt.mission);
    ctx.save();
    renderResult(s);
  }

  function renderIntro() {
    paintBar();
    stage.replaceChildren();
    stage.appendChild(el('div', 'en-pic', def.emoji));
    stage.appendChild(el('div', 'en-ask', def.title));
    stage.appendChild(el('div', 'en-ask-zh', def.introZh));
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('GO!', 'en-btn', render));
    say(def.intro);
  }

  function render() {
    const w = queue[i];
    if (!w) return finish();
    paintBar();
    stage.replaceChildren();
    if (def.id === 'findit') renderFindIt(w);
    else if (def.id === 'match') renderMatch(w);
    else if (def.id === 'listen-jump') renderJump(w);
    else renderEcho(w);
  }

  // ——— 听声音找图 ———
  function renderFindIt(w: Word) {
    const others = distractors(w, 2, rnd);
    const opts = shuffle(
      [w, ...others].map((x) => ({ key: x.id, emoji: x.emoji, label: x.en, correct: x.id === w.id })),
      rnd,
    );
    const q = findPrompt(w);
    stage.appendChild(el('div', 'en-pic', '👂'));
    stage.appendChild(el('div', 'en-ask', q));

    const fb = el('div', 'en-feedback');
    stage.appendChild(
      optionGrid(opts, (o, firstTry) => {
        if (o.correct) {
          record({ wordId: w.id, skill: 'listening', result: firstTry ? 'right' : 'wrong', hinted: !firstTry, stage: 'listen' });
          fb.textContent = pick(PRAISE, i);
          fb.className = 'en-feedback good';
          say(`${pick(PRAISE, i)} ${w.en}!`);
          setTimeout(advance, 850);
        } else {
          fb.textContent = 'Almost! Listen again.';
          fb.className = 'en-feedback almost';
          say(`Listen. ${w.en}.`);
        }
      }),
    );
    stage.appendChild(fb);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(q));
    stage.appendChild(row);
    say(q);
  }

  // ——— 单词配对：看词选图 ———
  function renderMatch(w: Word) {
    const others = distractors(w, 2, rnd);
    const opts = shuffle(
      [w, ...others].map((x) => ({ key: x.id, emoji: x.emoji, label: '', correct: x.id === w.id })),
      rnd,
    );
    stage.appendChild(el('div', 'en-word-en', w.en));
    stage.appendChild(el('div', 'en-ask-zh', '这个单词是哪张图？'));

    const fb = el('div', 'en-feedback');
    stage.appendChild(
      optionGrid(opts, (o, firstTry) => {
        if (o.correct) {
          record({ wordId: w.id, skill: 'reading', result: firstTry ? 'right' : 'wrong', hinted: !firstTry, stage: 'recognize' });
          fb.textContent = pick(PRAISE, i);
          fb.className = 'en-feedback good';
          say(`${w.en}! ${pick(PRAISE, i)}`);
          setTimeout(advance, 850);
        } else {
          fb.textContent = pick(TRY_AGAIN, i);
          fb.className = 'en-feedback almost';
        }
      }),
    );
    stage.appendChild(fb);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(w.en));
    stage.appendChild(row);
  }

  // ——— 听力打怪：听对才能跳 ———
  function renderJump(w: Word) {
    const others = distractors(w, 1, rnd);
    const opts = shuffle(
      [w, ...others].map((x) => ({ key: x.id, emoji: x.emoji, label: x.en, correct: x.id === w.id })),
      rnd,
    );

    const lane = el('div', 'en-pic');
    const paintLane = () => {
      const cells = queue.length;
      lane.textContent = '🌊'.repeat(Math.max(0, frog)) + '🐸' + '🪨'.repeat(Math.max(0, cells - frog));
      lane.style.fontSize = cells > 6 ? '30px' : '38px';
      lane.style.wordBreak = 'break-all';
    };
    paintLane();
    stage.appendChild(lane);

    const q = `${findPrompt(w)} Jump!`;
    stage.appendChild(el('div', 'en-ask', q));

    const fb = el('div', 'en-feedback');
    stage.appendChild(
      optionGrid(opts, (o, firstTry) => {
        if (o.correct) {
          frog += 1;
          paintLane();
          record({ wordId: w.id, skill: 'comprehension', result: firstTry ? 'right' : 'wrong', hinted: !firstTry, stage: 'listen' });
          fb.textContent = 'Jump! 🐸';
          fb.className = 'en-feedback good';
          say(`${w.en}! Jump!`);
          setTimeout(advance, 800);
        } else {
          // 退一格，但永远不退到水里。挫败感要有边界
          frog = Math.max(0, frog - 1);
          paintLane();
          fb.textContent = 'Almost! Listen again.';
          fb.className = 'en-feedback almost';
          say(`Listen. ${w.en}.`);
        }
      }),
    );
    stage.appendChild(fb);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(q));
    stage.appendChild(row);
    say(q);
  }

  // ——— 跟读挑战 ———
  function renderEcho(w: Word) {
    const sentence = w.sentences[0].text;
    stage.appendChild(el('div', 'en-pic', w.emoji));
    stage.appendChild(el('div', 'en-sentence', sentence));
    stage.appendChild(el('div', 'en-ask-zh', '听一句，说一句'));

    const fb = el('div', 'en-feedback');
    stage.appendChild(fb);

    mic = micControl({
      target: sentence,
      accept: [w.en],
      allowVoice: profile.settings.allowVoice,
      seed: opt.mission.seed + i,
      attempt: 1,
      onResult: (j, usedMic) => {
        fb.textContent = j.feedback;
        fb.className = `en-feedback ${j.tag === 'right' ? 'good' : j.tag === 'close' ? 'almost' : 'retry'}`;
        say(j.feedback);
        record({
          wordId: w.id,
          skill: 'pronunciation',
          result: j.tag === 'wrong' ? 'wrong' : j.tag,
          hinted: !usedMic,
          stage: 'speak',
        });
        setTimeout(advance, 1000);
      },
      onSkip: () => {
        record({ wordId: w.id, skill: 'pronunciation', result: 'skip', hinted: false, stage: 'speak' });
        advance();
      },
    });
    stage.appendChild(mic.node);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(sentence));
    stage.appendChild(row);
    say(sentence);
  }

  /**
   * 游戏结束页。
   *
   * §21 的落点：这里必须回答「你刚才练了什么英语」，并且把词列出来。
   * 只显示星星的结束页，玩完就等于没玩。
   */
  function renderResult(s: SessionRecord) {
    bar.replaceChildren();
    bar.appendChild(el('div', 'en-bar-title', `${def.emoji} ${def.titleZh}`));
    stage.replaceChildren();

    const stars = Math.max(1, Math.min(3, Math.round((correct / Math.max(1, queue.length)) * 3)));
    stage.appendChild(el('div', 'en-done-stars', '⭐'.repeat(stars)));
    stage.appendChild(el('div', 'en-ask', correct >= queue.length * 0.7 ? 'Great job!' : 'Good try!'));

    const box = el('div', 'en-learned');
    box.appendChild(el('h3', undefined, '你刚才练了这些英语'));
    const chips = el('div', 'en-chips');
    for (const w of queue) chips.appendChild(el('span', 'en-chip', `${w.emoji} ${w.en}`));
    box.appendChild(chips);
    const outcome = el('div', 'en-tip', opt.step.learningOutcome);
    outcome.style.textAlign = 'left';
    outcome.style.marginTop = '10px';
    box.appendChild(outcome);
    stage.appendChild(box);

    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('继续 →', 'en-btn', () => opt.onDone(s)));
    say(correct >= queue.length * 0.7 ? 'Great job!' : 'Good try! You did it!');
  }

  if (!queue.length) {
    stage.appendChild(el('div', 'en-pic', '🎈'));
    stage.appendChild(el('div', 'en-ask', 'All done!'));
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('继续', 'en-btn', finish));
  } else {
    renderIntro();
  }

  return root;
}
