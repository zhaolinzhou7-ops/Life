/**
 * 各类练习界面
 *
 * 统一约定：每个 render 函数返回一个页面元素，并在练完时调用 ctx.onDone()。
 * 这样上层的训练编排器只需要按顺序把它们串起来，不用关心每种练习的内部流程。
 *
 * 几个贯穿所有练习的设计决定：
 *
 * · **每一步都计时。** 反应时间是这个产品少数几个能真实测量的指标之一，
 *   而它恰恰直指成年人最大的问题——"在心里翻译"。不计时就丢掉了它。
 *
 * · **录音永远有打字这条退路。** 麦克风不可用的原因有五六种，每一种都不该
 *   让用户卡在这一步。口语练习的核心价值是组织句子，打字虽然少了发音，
 *   但组织句子那一环还在。
 *
 * · **答错不翻篇。** 答错之后一定要给一次改正的机会，并且要求用户自己
 *   重新说/写一遍，而不是点"下一题"。第 5 节的"再练一次"。
 */

import type { ActivityKind, Correction, ListeningClip, ReadingPiece, VocabItem } from '../types';
import { ERROR_KIND_LABEL, MASTERY_LABEL } from '../types';
import { VOCAB, getWord } from '../data/vocab';
import { SPEED_LABEL, SPEED_RATE, getClip } from '../data/listening';
import { getPiece } from '../data/reading';
import { RULE_BY_ID } from '../data/patterns';
import { analyze, correct as runCorrect } from '../engine/analyze';
import { freshVocab, review, spontaneousHits } from '../engine/srs';
import { asrSupported, compareShadow, freeSpeechMetrics, speak, startAsr, stopSpeaking, ttsSupported, FAILURE_TEXT, type AsrFailure, type AsrHandle } from '../engine/speech';
import { recordCleared, recordErrors } from '../engine/errors';
import {
  getErrorProfile,
  getVocab,
  newId,
  saveErrorProfile,
  saveListening,
  saveSpeaking,
  saveVocab,
  saveWriting,
  currentUserId,
} from '../store';
import {
  button,
  card,
  caveat,
  collapsible,
  correctionCard,
  el,
  esc,
  metricGrid,
  page,
  progressBar,
  section,
  textArea,
  mountTopbar,
  topbar,
} from './ui';

export interface ActivityCtx {
  title: string;
  onDone: () => void;
  onExit: () => void;
}

/** 把纠错渲染成"原句 → 问题 → 修改 → 为什么" */
export function renderCorrections(list: Correction[]): HTMLElement {
  const wrap = el('div', 'ec-corr-list');
  for (const c of list) {
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
  return wrap;
}

/** 把这一批纠错记进错误档案。所有练习产生的错都要经过这里，档案才是全的 */
function archive(corrections: Correction[]): void {
  if (!corrections.length) return;
  saveErrorProfile(recordErrors(getErrorProfile(), corrections));
}

/** 朗读按钮。TTS 不可用时按钮变成一句说明，而不是一个点了没反应的按钮 */
function speakButton(text: string, rate = 0.95, label = '🔊 听'): HTMLElement {
  if (!ttsSupported()) {
    return el('span', 'ec-muted', '（这个浏览器不支持朗读，下面是文字）');
  }
  const b = button(label, 'small');
  b.addEventListener('click', () => {
    speak(text, { rate, onError: () => (b.textContent = '朗读失败') });
  });
  return b;
}

/**
 * 录音 / 打字的组合输入。
 *
 * 这是整个产品里最容易出问题的组件，因为它依赖麦克风权限、浏览器支持、
 * 网络，任意一个出问题都很常见。所以它的默认状态是**打字框永远在**，
 * 麦克风只是一个可选的加速方式。
 */
function voiceInput(opts: {
  placeholder: string;
  onSubmit: (text: string, via: 'typed' | 'spoken', asrDurationMs?: number) => void;
  submitLabel?: string;
}): HTMLElement {
  const wrap = el('div', 'ec-voiceinput');
  const status = el('div', 'ec-listening');
  const ta = textArea(opts.placeholder, '', 2);
  const row = el('div', 'ec-composer');

  let handle: AsrHandle | null = null;
  let lastDuration: number | undefined;
  let via: 'typed' | 'spoken' = 'typed';

  const mic = el('button', 'ec-mic', '🎤');
  mic.type = 'button';
  mic.setAttribute('aria-label', '按住说话');
  if (!asrSupported()) {
    mic.disabled = true;
    mic.title = '这个浏览器不支持语音识别';
    status.textContent = '这个浏览器不支持语音识别，直接打字就行——练的是组织句子，这一环不受影响。';
  }

  const stopRec = () => {
    mic.classList.remove('recording');
    handle?.stop();
    handle = null;
  };

  mic.addEventListener('click', () => {
    if (handle) {
      stopRec();
      return;
    }
    status.textContent = '正在听…（说完再点一次，或者停顿几秒自动结束）';
    mic.classList.add('recording');
    handle = startAsr({
      onInterim: (t) => {
        ta.value = t;
      },
      onResult: (r) => {
        mic.classList.remove('recording');
        handle = null;
        ta.value = r.transcript;
        lastDuration = r.durationMs;
        via = 'spoken';
        status.textContent = '识别完成，可以直接改，也可以直接提交。';
      },
      onError: (f: AsrFailure) => {
        mic.classList.remove('recording');
        handle = null;
        const info = FAILURE_TEXT[f];
        status.textContent = info.detail ? `${info.title}。${info.detail}` : info.title;
      },
    });
  });

  ta.addEventListener('input', () => {
    // 手动改过就不能再算"说出来的"——这两件事在统计里必须分开
    if (via === 'spoken') via = 'typed';
  });

  const submit = button(opts.submitLabel ?? '提交', 'primary');
  submit.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) {
      status.textContent = '还没有内容。说一句或者打一句，说错也没关系。';
      return;
    }
    stopRec();
    opts.onSubmit(text, via, via === 'spoken' ? lastDuration : undefined);
  });

  row.appendChild(ta);
  row.appendChild(mic);
  wrap.appendChild(row);
  wrap.appendChild(status);
  wrap.appendChild(submit);
  submit.classList.add('block');
  return wrap;
}

// ══════════════════════════════════════════════════════════
//  词汇
// ══════════════════════════════════════════════════════════

/** 给一个词造三个干扰项。取词库里其它词的释义，不编造 */
function distractors(word: string, n = 3): string[] {
  const idx = VOCAB.findIndex((v) => v.word === word);
  const out: string[] = [];
  for (let step = 1; out.length < n && step < VOCAB.length; step++) {
    const cand = VOCAB[(idx + step * 7) % VOCAB.length];
    if (cand.word !== word && !out.includes(cand.meaning)) out.push(cand.meaning);
  }
  return out;
}

export function renderVocab(words: string[], kind: 'review' | 'vocab', ctx: ActivityCtx): HTMLElement {
  const items = words.map(getWord).filter((v): v is VocabItem => !!v);
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));

  if (!items.length) {
    body.appendChild(el('div', 'ec-empty', '<div class="ec-empty-title">没有需要练的词</div>'));
    foot.appendChild(button('继续', 'primary block', ctx.onDone));
    return root;
  }

  let i = 0;
  let startedAt = Date.now();

  const paint = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(progressBar(i, items.length, `${i + 1} / ${items.length}`));

    if (i >= items.length) {
      body.appendChild(
        el('div', 'ec-empty', `<div class="ec-empty-title">这一组练完了</div><div class="ec-empty-desc">${items.length} 个词都过了一遍。</div>`),
      );
      foot.appendChild(button('继续', 'primary block', ctx.onDone));
      return;
    }

    const item = items[i];
    const stored = getVocab(item.word);
    const isNew = !stored || stored.mastery <= 1;
    startedAt = Date.now();

    // ——— 新词：先教，再考 ———
    if (isNew && kind === 'vocab') {
      const c = card('ec-word');
      c.innerHTML = `
        <div class="ec-word-w">${esc(item.word)}</div>
        <div class="ec-word-ph">${esc(item.phonetic)} · <span class="ec-word-pos">${esc(item.pos)}</span></div>
        <div class="ec-word-mean">${esc(item.meaning)}</div>
        <div class="ec-word-ex">${esc(item.example)}<div class="cn">${esc(item.exampleCn)}</div></div>`;
      if (item.trap) c.appendChild(el('div', 'ec-word-trap', `⚠️ ${esc(item.trap)}`));
      const tools = el('div', 'ec-btn-row');
      tools.appendChild(speakButton(item.example, 0.9, '🔊 听例句'));
      c.appendChild(tools);
      body.appendChild(c);
      foot.appendChild(
        button('记住了，考我一下', 'primary block', () => {
          quiz(item);
        }),
      );
      return;
    }

    quiz(item);
  };

  /** 第一关：认得出意思。能证明的最高掌握度是"熟悉" */
  const quiz = (item: VocabItem) => {
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(progressBar(i, items.length, `${i + 1} / ${items.length}`));
    startedAt = Date.now();

    const head = card();
    head.innerHTML = `<div class="ec-word-w" style="font-size:26px">${esc(item.word)}</div>
      <div class="ec-word-ph">${esc(item.phonetic)}</div>`;
    head.appendChild(speakButton(item.word, 0.85, '🔊'));
    body.appendChild(head);
    body.appendChild(section('它是什么意思？'));

    const options = [item.meaning, ...distractors(item.word)];
    // 用词本身做种子打散，保证同一个词每次的选项顺序一致（不会让人靠位置记）
    const seed = item.word.length % options.length;
    const order = options.map((_, k) => options[(k + seed) % options.length]);

    for (const opt of order) {
      const b = el('button', 'ec-opt', esc(opt));
      b.type = 'button';
      b.addEventListener('click', () => {
        const ok = opt === item.meaning;
        const elapsed = Date.now() - startedAt;
        for (const other of body.querySelectorAll('.ec-opt')) {
          const o = other as HTMLButtonElement;
          o.disabled = true;
          if (o.textContent === item.meaning) o.classList.add('right');
          else if (o === b) o.classList.add('wrong');
        }
        const prev = getVocab(item.word) ?? freshVocab(item.word);
        const out = review(prev, 'recognize', ok, elapsed, Date.now(), 'vocab');
        saveVocab(out.vocab);

        const fb = el('div', 'ec-explain');
        fb.innerHTML = ok
          ? `对了。${esc(item.example)}<br><span class="ec-muted">${esc(item.exampleCn)}</span>`
          : `正确答案是「${esc(item.meaning)}」。${esc(item.example)}<br><span class="ec-muted">${esc(item.exampleCn)}</span>`;
        body.appendChild(fb);
        body.appendChild(masteryBar(out.vocab.mastery));

        // 已经会理解的词，再往上推一级：让他造个句
        if (ok && out.vocab.mastery >= 3) {
          foot.appendChild(button('试着用它造个句', 'primary block', () => produce(item)));
          foot.appendChild(button('跳过，下一个', 'ghost block', nextWord));
        } else {
          foot.appendChild(button(i + 1 >= items.length ? '完成' : '下一个', 'primary block', nextWord));
        }
      });
      body.appendChild(b);
    }
  };

  /** 第二关：用得出来。这是掌握度 4 级唯一的证据 */
  const produce = (item: VocabItem) => {
    body.innerHTML = '';
    foot.innerHTML = '';
    startedAt = Date.now();
    body.appendChild(section(`用「${item.word}」说一句话`, '说错没关系，重点是把它用出来。'));
    const ref = card('flat');
    ref.innerHTML = `<div class="ec-muted">${esc(item.meaning)}</div>
      <div class="ec-word-ex" style="margin-top:8px">${esc(item.example)}<div class="cn">${esc(item.exampleCn)}</div></div>`;
    body.appendChild(ref);

    body.appendChild(
      voiceInput({
        placeholder: `写一句包含 ${item.word} 的话…`,
        submitLabel: '提交',
        onSubmit: (text, via) => {
          const elapsed = Date.now() - startedAt;
          const used = spontaneousHits(text, [item.word]).length > 0;
          const a = analyze(text);
          archive(a.corrections);

          const prev = getVocab(item.word) ?? freshVocab(item.word);
          const out = review(prev, used ? 'produce' : 'recognize', used, elapsed, Date.now(), 'sentence');
          saveVocab(out.vocab);
          saveSpeaking({
            id: newId('sp'),
            userId: currentUserId(),
            at: Date.now(),
            target: item.word,
            transcript: text,
            via,
            metrics: a.metrics,
            corrections: a.corrections,
          });

          body.innerHTML = '';
          foot.innerHTML = '';
          if (!used) {
            body.appendChild(
              el('div', 'ec-explain', `这句话里没有用到 <b>${esc(item.word)}</b>。再试一次——把它塞进去，哪怕句子简单一点。`),
            );
            body.appendChild(el('div', 'ec-word-ex', `${esc(item.example)}<div class="cn">${esc(item.exampleCn)}</div>`));
            foot.appendChild(button('再试一次', 'primary block', () => produce(item)));
            foot.appendChild(button('跳过', 'ghost block', nextWord));
            return;
          }

          body.appendChild(section('你写的'));
          body.appendChild(el('div', 'ec-passage', esc(text)));
          if (a.corrections.length) {
            body.appendChild(section('可以改进的地方'));
            body.appendChild(renderCorrections(a.corrections.slice(0, 2)));
          } else {
            body.appendChild(el('div', 'ec-explain', '没有发现问题，这句话可以直接用。'));
          }
          body.appendChild(masteryBar(out.vocab.mastery));
          foot.appendChild(button(i + 1 >= items.length ? '完成' : '下一个', 'primary block', nextWord));
        },
      }),
    );
  };

  const nextWord = () => {
    stopSpeaking();
    i++;
    paint();
  };

  paint();
  return root;
}

function masteryBar(mastery: number): HTMLElement {
  const wrap = el('div', '');
  const bar = el('div', 'ec-mastery');
  for (let k = 1; k <= 5; k++) bar.appendChild(el('i', k <= mastery ? 'on' : ''));
  wrap.appendChild(bar);
  wrap.appendChild(el('div', 'ec-mastery-label', `掌握度：${MASTERY_LABEL[mastery as 1 | 2 | 3 | 4 | 5]}`));
  return wrap;
}

// ══════════════════════════════════════════════════════════
//  听力
// ══════════════════════════════════════════════════════════

export function renderListening(clipId: string | undefined, ctx: ActivityCtx): HTMLElement {
  const clip = (clipId ? getClip(clipId) : undefined) ?? getClip('cl-standup')!;
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));

  const fullText = clip.lines.map((l) => l.text).join(' ');
  let replays = 0;
  let speed: 'slow' | 'normal' | 'fast' = 'normal';
  let qIndex = 0;
  let allCorrect = true;

  const step1 = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(section('先整体听一遍', '不用听懂每个词。抓住"谁在说、说的是什么事"就够了。'));

    if (!ttsSupported()) {
      body.appendChild(
        caveat('这个浏览器不支持语音合成，所以这一段没法播放。下面直接给出文字，先按阅读练；换 Chrome 或 Edge 可以听。'),
      );
      body.appendChild(transcriptBlock(clip, true));
      foot.appendChild(button('开始答题', 'primary block', step2));
      return;
    }

    const c = card();
    c.appendChild(el('div', 'ec-label', clip.title));
    c.appendChild(el('div', 'ec-hint', '这是浏览器合成的语音，不是真人录音——语速和语调会比真实对话平一些。'));
    const speeds = el('div', 'ec-chips');
    for (const s of ['slow', 'normal', 'fast'] as const) {
      const chip = el('button', `ec-chip${s === speed ? ' on' : ''}`, SPEED_LABEL[s]);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        speed = s;
        for (const o of speeds.children) o.classList.remove('on');
        chip.classList.add('on');
      });
      speeds.appendChild(chip);
    }
    c.appendChild(speeds);
    const play = button('▶︎ 播放', 'primary block');
    play.addEventListener('click', () => {
      replays++;
      play.textContent = '播放中…';
      speak(fullText, {
        rate: SPEED_RATE[speed],
        onEnd: () => (play.textContent = `▶︎ 再听一遍（已听 ${replays} 遍）`),
        onError: () => (play.textContent = '播放失败，试试换个浏览器'),
      });
    });
    c.appendChild(play);
    body.appendChild(c);

    foot.appendChild(button('听完了，答题', 'primary block', step2));
  };

  const step2 = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    const q = clip.questions[qIndex];
    body.appendChild(progressBar(qIndex, clip.questions.length, `第 ${qIndex + 1} 题 / 共 ${clip.questions.length} 题`));
    body.appendChild(section(q.prompt));

    q.options.forEach((opt, k) => {
      const b = el('button', 'ec-opt', esc(opt));
      b.type = 'button';
      b.addEventListener('click', () => {
        const ok = k === q.answer;
        if (!ok) allCorrect = false;
        for (const other of body.querySelectorAll('.ec-opt')) {
          const o = other as HTMLButtonElement;
          o.disabled = true;
        }
        (body.querySelectorAll('.ec-opt')[q.answer] as HTMLElement).classList.add('right');
        if (!ok) b.classList.add('wrong');
        const replay = button(`🔊 再听一遍（已听 ${replays} 遍）`, 'small');
        replay.addEventListener('click', () => {
          replays++;
          speak(fullText, { rate: SPEED_RATE[speed] });
          replay.textContent = `🔊 再听一遍（已听 ${replays} 遍）`;
        });
        if (ttsSupported()) body.appendChild(replay);
        foot.appendChild(
          button(qIndex + 1 >= clip.questions.length ? '看原文精听' : '下一题', 'primary block', () => {
            qIndex++;
            if (qIndex >= clip.questions.length) step3();
            else step2();
          }),
        );
      });
      body.appendChild(b);
    });
  };

  const step3 = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    saveListening({
      id: newId('li'),
      userId: currentUserId(),
      at: Date.now(),
      clipId: clip.id,
      speed,
      replays,
      correct: allCorrect,
    });

    body.appendChild(section('精听：逐句对照', '点每一句可以单独重听。先不看中文，听不出来再展开。'));
    body.appendChild(transcriptBlock(clip, false));

    if (clip.focusWords.length) {
      body.appendChild(section('这段里值得记住的说法'));
      const list = el('div', '');
      for (const w of clip.focusWords) {
        const item = getWord(w);
        const row = el('div', 'ec-row');
        row.innerHTML = `<div class="ec-row-main"><div class="ec-row-title">${esc(w)}</div>
          <div class="ec-row-sub">${esc(item?.meaning ?? '这一段里的关键表达')}</div></div>`;
        row.appendChild(speakButton(w, 0.85, '🔊'));
        list.appendChild(row);
      }
      body.appendChild(list);
    }

    foot.appendChild(button('练完了', 'primary block', ctx.onDone));
  };

  step1();
  return root;
}

function transcriptBlock(clip: ListeningClip, showCn: boolean): HTMLElement {
  const wrap = el('div', '');
  for (const line of clip.lines) {
    const c = card('flat');
    const head = el('div', 'ec-row');
    head.innerHTML = `<div class="ec-row-main"><div class="ec-row-sub">${esc(line.speaker)}</div>
      <div style="font-size:15px;line-height:1.6">${esc(line.text)}</div></div>`;
    head.appendChild(speakButton(line.text, 0.85, '🔊'));
    c.appendChild(head);
    const cn = el('div', 'ec-muted', esc(line.cn));
    if (!showCn) {
      cn.style.display = 'none';
      const t = button('看中文', 'small ghost');
      t.addEventListener('click', () => {
        cn.style.display = cn.style.display === 'none' ? '' : 'none';
        t.textContent = cn.style.display === 'none' ? '看中文' : '收起';
      });
      c.appendChild(t);
    }
    c.appendChild(cn);
    wrap.appendChild(c);
  }
  return wrap;
}

// ══════════════════════════════════════════════════════════
//  口语：跟读 + 自由表达
// ══════════════════════════════════════════════════════════

export function renderSpeaking(ctx: ActivityCtx, targetSentence?: string, freePrompt?: string): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));

  const target =
    targetSentence ?? "I've been working on this for about a week, and I should have it ready by Friday.";
  const prompt = freePrompt ?? 'What did you do yesterday? Say three or four sentences.';

  const shadowStep = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(section('第一步：跟读', '先听一遍，再照着说。说不顺就多听两遍，不用一次到位。'));

    const c = card();
    c.appendChild(el('div', 'ec-passage', esc(target)));
    const tools = el('div', 'ec-btn-row');
    tools.appendChild(speakButton(target, 0.75, '🔊 慢速'));
    tools.appendChild(speakButton(target, 0.95, '🔊 正常'));
    c.appendChild(tools);
    body.appendChild(c);

    if (!asrSupported()) {
      body.appendChild(
        caveat('这个浏览器不支持语音识别，跟读这一步没法比对。可以先跟着念几遍，然后直接进入下一步的自由表达（打字也能练组织句子）。'),
      );
      foot.appendChild(button('进入自由表达', 'primary block', freeStep));
      return;
    }

    body.appendChild(
      voiceInput({
        placeholder: '点麦克风跟读，或者直接把这句话打出来',
        submitLabel: '对比一下',
        onSubmit: (text, via, dur) => {
          const cmp = compareShadow(target, text, dur);
          body.innerHTML = '';
          foot.innerHTML = '';
          body.appendChild(section('对比结果'));
          const line = el('div', 'ec-shadow');
          line.innerHTML = cmp.words
            .map((w) => `<span class="${w.hit ? 'hit' : 'miss'}">${esc(w.word)}</span>`)
            .join(' ');
          body.appendChild(card()).appendChild(line);
          body.appendChild(el('div', 'ec-muted', `识别到：${esc(text)}`));
          body.appendChild(metricGrid(Object.entries(cmp.metrics)));
          body.appendChild(caveat(cmp.caveat.replace(/\*\*/g, '')));
          void via;

          foot.appendChild(button('再跟读一次', 'block', shadowStep));
          foot.appendChild(button('进入自由表达', 'primary block', freeStep));
        },
      }),
    );
    foot.appendChild(button('跳过跟读', 'ghost block', freeStep));
  };

  const freeStep = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(section('第二步：自由表达', '不求完美。先说出来，句子短一点没关系。'));
    body.appendChild(el('div', 'ec-passage', esc(prompt)));
    const startedAt = Date.now();

    body.appendChild(
      voiceInput({
        placeholder: '说或者写三到四句…',
        submitLabel: '让教练看看',
        onSubmit: (text, via, dur) => {
          const a = analyze(text);
          archive(a.corrections);
          const metrics = { ...a.metrics };
          if (via === 'spoken' && dur) {
            Object.assign(
              metrics,
              freeSpeechMetrics({ transcript: text, durationMs: dur }),
            );
          }
          saveSpeaking({
            id: newId('sp'),
            userId: currentUserId(),
            at: Date.now(),
            transcript: text,
            via,
            metrics,
            corrections: a.corrections,
          });
          void startedAt;

          body.innerHTML = '';
          foot.innerHTML = '';
          body.appendChild(section('你说的'));
          body.appendChild(el('div', 'ec-passage', esc(text)));
          body.appendChild(feedbackBlock(a));
          foot.appendChild(button('再说一次', 'block', freeStep));
          foot.appendChild(button('练完了', 'primary block', ctx.onDone));
        },
      }),
    );
  };

  shadowStep();
  return root;
}

/** 教练式反馈：先说好的，再讲最多 3 个问题，最后给更自然的说法 */
function feedbackBlock(a: ReturnType<typeof analyze>): HTMLElement {
  const wrap = el('div', '');
  if (a.strengths.length) {
    const s = section('做得好的地方');
    wrap.appendChild(s);
    const c = card('flat');
    for (const st of a.strengths) {
      c.appendChild(el('div', 'ec-row-title', `· ${esc(st.text)}`));
      c.appendChild(el('div', 'ec-row-sub', esc(st.evidence)));
    }
    wrap.appendChild(c);
  }

  const top = a.corrections.slice(0, 3);
  if (top.length) {
    wrap.appendChild(section('这次重点改这几处', '一次只讲最重要的，其它的记在档案里，以后再练。'));
    wrap.appendChild(renderCorrections(top));
    if (a.corrected && a.corrected !== a.text) {
      wrap.appendChild(
        collapsible('改完之后整段长什么样', el('div', 'ec-passage', esc(a.corrected))),
      );
    }
  } else {
    wrap.appendChild(el('div', 'ec-explain', '没有发现需要纠正的地方。'));
  }

  if (a.upgrades.length) {
    wrap.appendChild(section('说得对，但可以更地道'));
    const c = card('flat');
    for (const u of a.upgrades) {
      c.appendChild(el('div', 'ec-row-title', `${esc(u.yours)} → ${esc(u.better)}`));
      c.appendChild(el('div', 'ec-row-sub', esc(u.note)));
    }
    wrap.appendChild(c);
  }

  wrap.appendChild(collapsible('这一段的客观数据', metricGrid(Object.entries(a.metrics))));
  return wrap;
}

// ══════════════════════════════════════════════════════════
//  写作
// ══════════════════════════════════════════════════════════

const WRITING_PROMPTS = [
  { en: 'Write 3–4 sentences about something that annoyed you this week.', cn: '写三到四句话，说说这周有什么让你不爽的事。' },
  { en: 'Write a short message to a colleague asking to move a meeting.', cn: '给同事写几句话，请他把会议改期。' },
  { en: 'Describe your typical working day in 4 sentences.', cn: '用四句话描述你平常的一天。' },
  { en: 'Write 3 sentences explaining why you are learning English.', cn: '写三句话说明你为什么在学英语。' },
];

export function renderWriting(ctx: ActivityCtx): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));
  const prompt = WRITING_PROMPTS[new Date().getDate() % WRITING_PROMPTS.length];

  body.appendChild(section('写几句话', '写比说慢，所以更容易把结构想清楚。写完会逐句给你看问题在哪。'));
  const p = card();
  p.appendChild(el('div', 'ec-row-title', prompt.en));
  p.appendChild(el('div', 'ec-row-sub', prompt.cn));
  body.appendChild(p);

  const ta = textArea('在这里写…', '', 6);
  body.appendChild(ta);

  const submit = button('让教练看看', 'primary block');
  submit.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    const a = analyze(text);
    archive(a.corrections);
    saveWriting({
      id: newId('wr'),
      userId: currentUserId(),
      at: Date.now(),
      prompt: prompt.en,
      text,
      corrections: a.corrections,
      metrics: a.metrics,
    });

    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(section('你写的'));
    body.appendChild(el('div', 'ec-passage', esc(text)));
    body.appendChild(feedbackBlock(a));
    foot.appendChild(button('再写一次', 'block', () => ctx.onExit()));
    foot.appendChild(button('练完了', 'primary block', ctx.onDone));
  });
  foot.appendChild(submit);
  return root;
}

// ══════════════════════════════════════════════════════════
//  阅读
// ══════════════════════════════════════════════════════════

export function renderReading(pieceId: string | undefined, ctx: ActivityCtx): HTMLElement {
  const piece: ReadingPiece = (pieceId ? getPiece(pieceId) : undefined) ?? getPiece('rd-habit')!;
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));

  let qi = 0;

  const readStep = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(section(piece.title, '先通读一遍，不查词。读不懂的地方跳过去，读完再看生词表。'));
    const c = el('div', 'ec-passage');
    c.innerHTML = piece.paragraphs.map((p) => `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
    body.appendChild(c);
    body.appendChild(
      collapsible(
        '生词表',
        (() => {
          const g = el('div', '');
          for (const w of piece.glossary) {
            const row = el('div', 'ec-row');
            row.innerHTML = `<div class="ec-row-main"><div class="ec-row-title">${esc(w.word)}</div><div class="ec-row-sub">${esc(w.meaning)}</div></div>`;
            row.appendChild(speakButton(w.word, 0.85, '🔊'));
            g.appendChild(row);
          }
          return g;
        })(),
      ),
    );
    foot.appendChild(button('读完了，做题', 'primary block', quizStep));
  };

  const quizStep = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    const q = piece.questions[qi];
    body.appendChild(progressBar(qi, piece.questions.length, `第 ${qi + 1} / ${piece.questions.length} 题`));
    body.appendChild(section(q.prompt));
    q.options.forEach((opt, k) => {
      const b = el('button', 'ec-opt', esc(opt));
      b.type = 'button';
      b.addEventListener('click', () => {
        for (const o of body.querySelectorAll('.ec-opt')) (o as HTMLButtonElement).disabled = true;
        (body.querySelectorAll('.ec-opt')[q.answer] as HTMLElement).classList.add('right');
        if (k !== q.answer) b.classList.add('wrong');
        body.appendChild(el('div', 'ec-explain', esc(q.explain)));
        foot.appendChild(
          button(qi + 1 >= piece.questions.length ? '练完了' : '下一题', 'primary block', () => {
            qi++;
            if (qi >= piece.questions.length) ctx.onDone();
            else quizStep();
          }),
        );
      });
      body.appendChild(b);
    });
  };

  readStep();
  return root;
}

// ══════════════════════════════════════════════════════════
//  专项纠错：拿用户自己说错的句子来练
// ══════════════════════════════════════════════════════════

export function renderDrill(ruleIds: string[] | undefined, ctx: ActivityCtx): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(root, topbar(ctx.title, ctx.onExit));

  const profile = getErrorProfile();
  const targets = profile.records
    .filter((r) => (ruleIds?.length ? ruleIds.includes(r.ruleId) : true))
    .filter((r) => r.samples.length)
    .slice(0, 4);

  if (!targets.length) {
    body.appendChild(
      el(
        'div',
        'ec-empty',
        '<div class="ec-empty-title">还没有攒下可以练的错句</div><div class="ec-empty-desc">多说几次、多写几次之后，这里会用你自己说错的句子出题——那比教材例句有用得多。</div>',
      ),
    );
    foot.appendChild(button('继续', 'primary block', ctx.onDone));
    return root;
  }

  let i = 0;
  const cleared: string[] = [];

  const paint = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    if (i >= targets.length) {
      if (cleared.length) saveErrorProfile(recordCleared(getErrorProfile(), cleared));
      body.appendChild(
        el(
          'div',
          'ec-empty',
          `<div class="ec-empty-title">这一组练完了</div><div class="ec-empty-desc">${cleared.length ? `有 ${cleared.length} 个毛病这次改对了。连续改对 3 次就会从重点名单里毕业。` : '这次还没完全改过来，下次继续。'}</div>`,
        ),
      );
      foot.appendChild(button('继续', 'primary block', ctx.onDone));
      return;
    }

    const rec = targets[i];
    const sample = rec.samples[0];
    const rule = RULE_BY_ID[rec.ruleId];
    body.appendChild(progressBar(i, targets.length, `${i + 1} / ${targets.length}`));
    body.appendChild(section(rec.label, `这个毛病你一共犯过 ${rec.count} 次。`));

    const c = card();
    c.innerHTML = `<div class="ec-row-sub">你之前说过</div>
      <div class="ec-passage" style="margin:6px 0 0">${esc(sample.original)}</div>`;
    body.appendChild(c);
    if (rule) body.appendChild(el('div', 'ec-explain', esc(rule.why)));

    body.appendChild(section('改对它', '把上面那句改成正确的说法，写出来。'));
    const ta = textArea('改好的句子…', '', 2);
    body.appendChild(ta);

    const check = button('检查', 'primary block');
    check.addEventListener('click', () => {
      const text = ta.value.trim();
      if (!text) return;
      // 真判定：改完之后这条规则还报不报
      const stillWrong = runCorrect(text).some((c2) => c2.ruleId === rec.ruleId);
      const result = el('div', 'ec-explain');
      if (stillWrong) {
        result.innerHTML = `还是同一个问题。参考改法：<b>${esc(sample.fixed)}</b>`;
      } else {
        result.innerHTML = `对了。<b>${esc(text)}</b> 里没有再出现这个毛病。`;
        if (!cleared.includes(rec.ruleId)) cleared.push(rec.ruleId);
      }
      body.appendChild(result);
      check.disabled = true;
      foot.appendChild(
        button(i + 1 >= targets.length ? '完成' : '下一个', 'primary block', () => {
          i++;
          paint();
        }),
      );
    });
    foot.appendChild(check);
  };

  paint();
  return root;
}

/** 供编排器按活动类型分发 */
export const ACTIVITY_RENDERER: Record<
  ActivityKind,
  (payload: { words?: string[]; scenarioId?: string; clipId?: string; ruleIds?: string[] } | undefined, ctx: ActivityCtx) => HTMLElement
> = {
  review: (p, ctx) => renderVocab(p?.words ?? [], 'review', ctx),
  vocab: (p, ctx) => renderVocab(p?.words ?? [], 'vocab', ctx),
  listening: (p, ctx) => renderListening(p?.clipId, ctx),
  speaking: (_p, ctx) => renderSpeaking(ctx),
  writing: (_p, ctx) => renderWriting(ctx),
  reading: (_p, ctx) => renderReading(undefined, ctx),
  drill: (p, ctx) => renderDrill(p?.ruleIds, ctx),
  // 情景对话由上层单独处理（它有自己的复盘流程），这里给一个兜底
  scenario: (_p, ctx) => renderSpeaking(ctx),
};
