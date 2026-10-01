/**
 * 儿童端公用部件：喇叭按钮、麦克风控件、选项网格
 *
 * 麦克风控件是这里最要紧的一块。它必须保证一件事：
 * **无论语音识别是否可用，孩子都能把这一步走完。**
 *
 * 所以「我说啦」这个按钮不是降级提示，它永远都在。麦克风能用时它是
 * 「我说过了，继续」；不能用时它就是唯一的路径。孩子不会看到任何
 * 报错或者灰掉的按钮——四岁的孩子看到一个点不动的按钮只会反复点它。
 */

import type { SpeechJudgement } from '../types';
import { ZH } from '../data/phrases';
import { judgeSpeech } from '../engine/speech';
import { listenOnce, recognizerAvailable, stopListening } from '../speech/recognizer';
import { speak, speakAsync } from '../speech/tts';
import { btn, el } from '../ui';

/** 喇叭按钮：再听一遍 */
export function speaker(text: string, label = '🔊'): HTMLButtonElement {
  const b = btn(label, 'en-btn ghost small', () => speak(text));
  b.style.width = 'auto';
  b.style.minWidth = '62px';
  b.setAttribute('aria-label', '再听一遍');
  return b;
}

export interface MicOptions {
  target: string;
  accept?: string[];
  /** 家长是否允许用麦克风 */
  allowVoice: boolean;
  seed: number;
  /** 第几次尝试 */
  attempt: number;
  /** 判定完成。usedMic=false 表示这次是孩子自己点的「我说啦」，没有录音 */
  onResult: (j: SpeechJudgement, usedMic: boolean) => void;
  /** 跳过 */
  onSkip?: () => void;
}

export interface MicHandle {
  node: HTMLElement;
  /** 离开页面时必须调，否则麦克风指示灯会一直亮 */
  dispose(): void;
}

/**
 * 麦克风控件。
 *
 * 没有录音时的判定结果是 'close'——这是刻意的诚实处理：
 * 我们不知道他说得对不对，所以既不算对（会污染能力画像），
 * 也不算错（孩子明明说了）。close 的含义正是「试过了，还要再练」。
 */
export function micControl(opt: MicOptions): MicHandle {
  const wrap = el('div', 'en-mic-wrap');
  const canUse = opt.allowVoice && recognizerAvailable();
  let listening = false;
  let disposed = false;
  /**
   * 一个控件只交一次结果。
   *
   * 调用方拿到结果后通常会 setTimeout 半秒到一秒再推进（要留出念反馈的时间），
   * 在那之前按钮还在屏幕上——而五岁孩子对着一个大按钮连点三下是常态。
   * 没有这个标志位就会排队推进好几步，把后面的题跳过去，
   * 甚至在最后一题上推过头去读一个不存在的题目。
   */
  let sent = false;

  const hint = el('div', 'en-mic-hint', canUse ? ZH.sayIt : ZH.micDenied);

  const done = (j: SpeechJudgement, usedMic: boolean) => {
    if (disposed || sent) return;
    sent = true;
    opt.onResult(j, usedMic);
  };

  if (canUse) {
    const mic = btn('🎤', 'en-mic');
    mic.setAttribute('aria-label', '点一下说话');
    mic.addEventListener('click', () => {
      if (listening || disposed) return;
      listening = true;
      mic.classList.add('listening');
      hint.textContent = '我在听…';
      void listenOnce({ timeoutMs: 6000 }).then((r) => {
        listening = false;
        mic.classList.remove('listening');
        if (disposed) return;

        /**
         * 识别失败分两种，必须区别对待，否则会往画像里写假数据。
         *
         *   「服务用不了」—— 没授权、断网（Chrome 的识别在云端做）、浏览器不支持。
         *     孩子可能说得好好的，我们只是没听见。**绝不能记成答错**——
         *     那等于因为自己的技术问题去判一个五岁孩子不会。
         *     这一次按「说过了」计入，并把麦克风收起来，后面走点按路径。
         *
         *   「确实没听到声音」—— 麦克风是通的，就是没出声或者太小。
         *     这才是真实的学习信号，照常交给判定。
         */
        const serviceDown = !r.ok && (r.error === 'denied' || r.error === 'network' || r.error === 'not-supported' || r.error === 'unknown');
        if (serviceDown) {
          hint.textContent = ZH.micDenied;
          mic.style.display = 'none';
          done(
            {
              tag: 'close',
              similarity: 0,
              feedback: "Good try! Let's keep going.",
              retry: false,
              note: `语音识别这次用不了（${r.error}），按"说过了"计入，没有记成答错`,
            },
            false,
          );
          return;
        }

        hint.textContent = ZH.sayIt;
        const j = judgeSpeech({
          target: opt.target,
          heard: r.transcript,
          accept: opt.accept,
          seed: opt.seed,
          attempt: opt.attempt,
        });
        done(j, true);
      });
    });
    wrap.appendChild(mic);
  }

  wrap.appendChild(hint);

  const row = el('div', 'en-btn-row');
  row.style.justifyContent = 'center';

  const said = btn(canUse ? '我说啦 ✓' : '我说啦 ✓', 'en-said', () => {
    if (disposed) return;
    done(
      {
        tag: 'close',
        similarity: 0,
        feedback: 'Nice! Let\'s go on.',
        retry: false,
        note: canUse ? '孩子自己点了"我说啦"，没有录音' : '没有可用的麦克风，按"说过了"计入',
      },
      false,
    );
  });
  row.appendChild(said);

  if (opt.onSkip) {
    const skip = btn('跳过', 'en-said', () => {
      if (disposed || sent) return;
      sent = true;
      opt.onSkip?.();
    });
    skip.style.opacity = '0.7';
    row.appendChild(skip);
  }
  wrap.appendChild(row);

  return {
    node: wrap,
    dispose() {
      disposed = true;
      stopListening();
    },
  };
}

export interface OptionSpec {
  key: string;
  emoji: string;
  label: string;
  correct: boolean;
}

/**
 * 选项网格。
 *
 * 点错之后不锁死：错的那个变暗，孩子还能继续点，直到点对为止。
 * 一次点错就判死刑对这个年龄段太重了，而且我们要的是他最终认出来。
 * 第一次点错会被如实记进 outcome，所以数据不会因此失真。
 */
export function optionGrid(
  opts: OptionSpec[],
  onPick: (o: OptionSpec, firstTry: boolean, node: HTMLButtonElement) => void,
): HTMLElement {
  const grid = el('div', opts.length <= 2 ? 'en-opts two' : 'en-opts');
  let tries = 0;
  for (const o of opts) {
    const b = el('button', 'en-opt');
    b.type = 'button';
    b.appendChild(el('div', 'emo', o.emoji));
    b.appendChild(el('div', 'lab', o.label));
    b.addEventListener('click', () => {
      if (b.classList.contains('wrong') || grid.dataset.locked === '1') return;
      const first = tries === 0;
      tries += 1;
      if (o.correct) {
        b.classList.add('right');
        grid.dataset.locked = '1';
      } else {
        b.classList.add('wrong');
      }
      onPick(o, first, b);
    });
    grid.appendChild(b);
  }
  return grid;
}

/** 朗读一段话，读完调 then。读不出来（不支持 TTS）也会照常往下走 */
export function say(text: string, then?: () => void): void {
  void speakAsync(text).then(() => then?.());
}
