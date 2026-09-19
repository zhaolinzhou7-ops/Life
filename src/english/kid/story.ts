/**
 * 故事播放器
 *
 * 一页一张图一句话，AI 朗读，目标词高亮。读完有互动问题。
 *
 * 几个刻意的选择：
 *  · **不自动翻页。** 孩子需要自己控制节奏，看懂了再翻。自动翻页会让
 *    没跟上的孩子直接放弃。
 *  · **点图能重听这一句。** 低龄孩子反复听同一句是正常的学习行为，
 *    不该让他去找一个小喇叭图标。
 *  · **问题的答案一定在故事里。** 不考推理、不考常识，只考「你听懂了吗」。
 *  · 「Coco 讲一个新的」会用 AI 现编一个用今天的词的故事。
 *    没接模型时由内置引擎按模板生成，一样能出——这是 Mock 模式要撑住的场景。
 */

import type { DailyMission, MissionStep, Outcome, SessionRecord, Story } from '../types';
import { getStory } from '../data/stories';
import { getWord } from '../data/vocab';
import { PRAISE, pick } from '../data/phrases';
import { LEVEL_INFO } from '../engine/profile';
import { cancelSpeech } from '../speech/tts';
import { aiStory } from '../ai';
import { commitActivity, type ActivityDraft } from '../session';
import type { Ctx } from '../ui';
import { btn, dots, el, highlight, page, topbar } from '../ui';
import { micControl, optionGrid, say, speaker, type MicHandle } from './parts';

export interface StoryOptions {
  step: MissionStep;
  mission: DailyMission;
  session: SessionRecord;
  onDone: (s: SessionRecord) => void;
  onBack: () => void;
}

export function renderStory(ctx: Ctx, opt: StoryOptions): HTMLElement {
  const profile = ctx.data.profile;
  let story: Story | null = opt.step.storyId ? (getStory(opt.step.storyId) ?? null) : null;

  const outcomes: Outcome[] = [];
  const draft: ActivityDraft = {
    kind: 'story',
    refId: opt.step.id,
    title: opt.step.titleZh,
    learningOutcome: opt.step.learningOutcome,
    outcomes,
    startedAt: Date.now(),
  };

  let pi = 0;
  let qi = 0;
  let mic: MicHandle | null = null;
  let busy = false;
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

  function paintBar(title: string, total?: number, cur?: number) {
    bar.replaceChildren();
    const b = btn('‹', 'en-back', back);
    b.setAttribute('aria-label', '返回');
    bar.appendChild(b);
    bar.appendChild(el('div', 'en-bar-title', title));
    if (total) bar.appendChild(dots(total, cur ?? 0));
  }

  function renderCover() {
    paintBar('📖 Story');
    stage.replaceChildren();
    if (!story) {
      stage.appendChild(el('div', 'en-pic', '📖'));
      stage.appendChild(el('div', 'en-ask', 'Let Coco tell you a story!'));
      stage.appendChild(el('div', 'en-spacer'));
      stage.appendChild(btn('讲一个故事', 'en-btn', generate));
      return;
    }
    stage.appendChild(el('div', 'en-pic', story.coverEmoji));
    stage.appendChild(el('div', 'en-ask', story.title));
    const words = story.words.map((id) => getWord(id)).filter(Boolean);
    if (words.length) {
      const chips = el('div', 'en-chips');
      chips.style.justifyContent = 'center';
      for (const w of words) chips.appendChild(el('span', 'en-chip', `${w!.emoji} ${w!.en}`));
      stage.appendChild(chips);
    }
    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(
      btn('START', 'en-btn', () => {
        pi = 0;
        renderPage();
      }),
    );
    stage.appendChild(btn('🦜 Coco 讲一个新的', 'en-btn ghost', generate));
    say(story.title);
  }

  /** 用 AI 现编一个故事。没接模型时走内置模板，同样能出 */
  function generate() {
    if (busy) return;
    busy = true;
    cleanup();
    paintBar('📖 Story');
    stage.replaceChildren();
    stage.appendChild(el('div', 'en-pic', '🦜'));
    stage.appendChild(el('div', 'en-ask', 'Coco is thinking...'));
    stage.appendChild(el('div', 'en-ask-zh', '正在编一个用到今天学的词的故事'));

    const words = (opt.step.wordIds.length ? opt.step.wordIds : (story?.words ?? []))
      .map((id) => getWord(id))
      .filter((w): w is NonNullable<typeof w> => !!w)
      .slice(0, 3);

    void aiStory({
      level: LEVEL_INFO[profile.level].storyLevel,
      words,
      theme: words[0]?.theme ?? 'toy',
      seed: (Date.now() & 0xffff) || 11,
    })
      .then((r) => {
        busy = false;
        story = r.data;
        renderCover();
      })
      .catch(() => {
        // aiStory 内部已经降级过一次，走到这里说明连内置引擎都失败了，
        // 那就退回原来的故事，绝不把孩子留在一个转圈的页面上
        busy = false;
        renderCover();
      });
  }

  function renderPage() {
    if (!story) return renderCover();
    const pg = story.pages[pi];
    if (!pg) return renderQuestion();
    paintBar(story.title, story.pages.length, pi);
    stage.replaceChildren();

    const picture = el('div', 'en-story-pic tap', pg.emoji);
    picture.addEventListener('click', () => say(pg.text));
    stage.appendChild(picture);

    const txt = highlight(pg.text, pg.highlight);
    txt.className = 'en-story-text';
    stage.appendChild(txt);

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(pg.text));
    stage.appendChild(row);

    stage.appendChild(el('div', 'en-spacer'));
    const last = pi >= story.pages.length - 1;
    stage.appendChild(
      btn(last ? 'Questions →' : 'NEXT →', 'en-btn', () => {
        cancelSpeech();
        if (last) {
          qi = 0;
          renderQuestion();
        } else {
          pi += 1;
          renderPage();
        }
      }),
    );

    say(pg.text);
  }

  function renderQuestion() {
    if (!story) return renderCover();
    const q = story.questions[qi];
    if (!q) return finish();
    paintBar(story.title, story.questions.length, qi);
    stage.replaceChildren();
    cleanup();

    stage.appendChild(el('div', 'en-pic', '🦜'));
    stage.appendChild(el('div', 'en-ask', q.ask));
    if (q.askZh) stage.appendChild(el('div', 'en-ask-zh', q.askZh));

    const fb = el('div', 'en-feedback');

    if (q.kind === 'choice' && q.options?.length) {
      stage.appendChild(
        optionGrid(
          q.options.map((o, n) => ({ key: String(n), emoji: o.emoji, label: o.label, correct: o.correct })),
          (o, firstTry) => {
            if (o.correct) {
              record({
                wordId: q.wordId,
                skill: 'comprehension',
                result: firstTry ? 'right' : 'wrong',
                hinted: !firstTry,
                stage: 'use',
              });
              fb.textContent = pick(PRAISE, qi);
              fb.className = 'en-feedback good';
              say(pick(PRAISE, qi));
              setTimeout(() => {
                qi += 1;
                renderQuestion();
              }, 900);
            } else {
              fb.textContent = 'Almost! Listen again.';
              fb.className = 'en-feedback almost';
              say('Almost! Listen again.');
            }
          },
        ),
      );
      stage.appendChild(fb);
    } else {
      stage.appendChild(fb);
      mic = micControl({
        target: q.expect?.[0] ?? '',
        accept: q.expect ?? [],
        allowVoice: profile.settings.allowVoice,
        seed: opt.mission.seed + qi,
        attempt: 1,
        onResult: (j, usedMic) => {
          fb.textContent = j.feedback;
          fb.className = `en-feedback ${j.tag === 'right' ? 'good' : j.tag === 'close' ? 'almost' : 'retry'}`;
          say(j.feedback);
          record({
            wordId: q.wordId,
            skill: 'sentence',
            result: j.tag === 'wrong' ? 'close' : j.tag,
            hinted: !usedMic,
            stage: 'use',
          });
          setTimeout(() => {
            qi += 1;
            renderQuestion();
          }, 1000);
        },
        onSkip: () => {
          record({ wordId: q.wordId, skill: 'sentence', result: 'skip', hinted: false, stage: 'use' });
          qi += 1;
          renderQuestion();
        },
      });
      stage.appendChild(mic.node);
    }

    const row = el('div', 'en-btn-row');
    row.style.justifyContent = 'center';
    row.appendChild(speaker(q.ask));
    stage.appendChild(row);
    say(q.ask);
  }

  function finish() {
    // 同 words.ts：排队中的推进不能把同一个活动提交两遍
    if (finished) return;
    finished = true;
    cleanup();
    if (story && !ctx.data.readStories.includes(story.id)) ctx.data.readStories.push(story.id);
    const s = commitActivity(ctx.data, opt.session, draft, opt.mission);
    ctx.save();

    bar.replaceChildren();
    bar.appendChild(el('div', 'en-bar-title', story?.title ?? 'Story'));
    stage.replaceChildren();
    stage.appendChild(el('div', 'en-done-stars', '⭐⭐'));
    stage.appendChild(el('div', 'en-ask', 'The end!'));

    const box = el('div', 'en-learned');
    box.appendChild(el('h3', undefined, '这个故事里你学到了'));
    const chips = el('div', 'en-chips');
    for (const id of story?.words ?? []) {
      const w = getWord(id);
      if (w) chips.appendChild(el('span', 'en-chip', `${w.emoji} ${w.en}`));
    }
    box.appendChild(chips);
    const outcome = el('div', 'en-tip', story?.learningOutcome ?? opt.step.learningOutcome);
    outcome.style.textAlign = 'left';
    outcome.style.marginTop = '10px';
    box.appendChild(outcome);
    stage.appendChild(box);

    stage.appendChild(el('div', 'en-spacer'));
    stage.appendChild(btn('继续 →', 'en-btn', () => opt.onDone(s)));
    say('The end! Great listening!');
  }

  renderCover();
  return root;
}
