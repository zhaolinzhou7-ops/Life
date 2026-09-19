/**
 * 能力诊断
 *
 * 第一次进来的人不该直接被扔进课程里（第 3 节）。先花六到八分钟，
 * 搞清楚他到底卡在哪——然后**必须把结论说清楚**，而不是甩一个 "B1"。
 *
 * 两个容易做错的地方，这里特意避开：
 *
 * 1. **不要让人觉得在考试。** 所以不显示分数、不显示对错统计、
 *    答错了也不红一片。每题答完直接进下一题，解释留到报告里。
 *
 * 2. **开放题放最后。** 一上来就让人 "Introduce yourself" 会劝退一半的人。
 *    先做几道选择题热身，等他已经投入了七八分钟，再要求他开口。
 */

import type { AssessAnswer, Assessment, ChoiceItem, OpenItem } from '../types';
import { ASSESSMENT_ORDER, isChoice } from '../data/assessment';
import { SPEED_RATE } from '../data/listening';
import { scoreAssessment } from '../engine/assess';
import {
  FAILURE_TEXT,
  asrSupported,
  speak,
  startAsr,
  stopSpeaking,
  ttsSupported,
  type AsrHandle,
} from '../engine/speech';
import { button, card, el, esc, page, progressBar, section, textArea, topbar, mountTopbar} from './ui';
import { currentUserId } from '../store';

export interface AssessHandlers {
  back: () => void;
  done: (a: Assessment) => void;
}

export function renderAssessment(h: AssessHandlers): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(
    root,
    topbar('能力诊断', () => {
      stopSpeaking();
      mic?.cancel();
      h.back();
    }),
  );

  const answers: AssessAnswer[] = [];
  let i = 0;
  let shownAt = Date.now();
  let mic: AsrHandle | null = null;

  const next = () => {
    stopSpeaking();
    mic?.cancel();
    mic = null;
    i++;
    paint();
  };

  const paint = () => {
    body.innerHTML = '';
    foot.innerHTML = '';
    body.scrollTop = 0;

    if (i >= ASSESSMENT_ORDER.length) {
      finish();
      return;
    }

    const item = ASSESSMENT_ORDER[i];
    shownAt = Date.now();
    body.appendChild(progressBar(i, ASSESSMENT_ORDER.length, `${i + 1} / ${ASSESSMENT_ORDER.length}`));

    if (isChoice(item)) paintChoice(item);
    else paintOpen(item);
  };

  // ─────────── 选择题 ───────────

  const paintChoice = (item: ChoiceItem) => {
    if (item.kind === 'listening' && item.passage) {
      const c = card();
      c.appendChild(el('div', 'ec-label', '听一段，然后回答'));
      c.appendChild(
        el(
          'div',
          'ec-hint',
          ttsSupported()
            ? '可以重复播放。这是浏览器合成的语音，语调会比真人平一些。'
            : '这个浏览器不支持语音合成，下面直接给出文字——这一题会按阅读来算。',
        ),
      );
      if (ttsSupported()) {
        let plays = 0;
        const play = button('▶︎ 播放', 'primary block');
        play.addEventListener('click', () => {
          plays++;
          play.textContent = '播放中…';
          speak(item.passage!, {
            rate: SPEED_RATE[item.speed ?? 'normal'],
            onEnd: () => (play.textContent = `▶︎ 再听一遍（第 ${plays} 遍）`),
            onError: () => (play.textContent = '播放失败'),
          });
        });
        c.appendChild(play);
      } else {
        c.appendChild(el('div', 'ec-passage', esc(item.passage)));
      }
      body.appendChild(c);
    } else if (item.passage) {
      body.appendChild(el('div', 'ec-passage', esc(item.passage)));
    }

    body.appendChild(section(item.prompt));

    item.options.forEach((opt, k) => {
      const b = el('button', 'ec-opt', esc(opt));
      b.type = 'button';
      b.addEventListener('click', () => {
        answers.push({
          itemId: item.id,
          kind: item.kind,
          choice: k,
          text: '',
          elapsedMs: Date.now() - shownAt,
        });
        // 诊断阶段不当场判对错：这是测评不是练习，让人一路答完再看结论
        b.classList.add('picked');
        for (const o of body.querySelectorAll('.ec-opt')) (o as HTMLButtonElement).disabled = true;
        window.setTimeout(next, 180);
      });
      body.appendChild(b);
    });

    const skip = button('不会，跳过', 'ghost block');
    skip.addEventListener('click', () => {
      answers.push({ itemId: item.id, kind: item.kind, choice: -1, text: '', elapsedMs: Date.now() - shownAt });
      next();
    });
    foot.appendChild(skip);
  };

  // ─────────── 开放题 ───────────

  const paintOpen = (item: OpenItem) => {
    const c = card();
    c.appendChild(el('div', 'ec-label', item.kind === 'translate' ? '用英语说出这句话' : 'Your turn'));
    c.appendChild(el('div', 'ec-passage', esc(item.prompt)));
    c.appendChild(el('div', 'ec-hint', item.hint));
    body.appendChild(c);

    const ta = textArea(item.kind === 'speak' ? '点麦克风说，或者直接打字…' : '在这里写…', '', 4);
    const status = el('div', 'ec-listening');
    let via: 'typed' | 'spoken' = 'typed';

    if (item.kind === 'speak') {
      const row = el('div', 'ec-composer');
      const micBtn = el('button', 'ec-mic', '🎤');
      micBtn.type = 'button';
      if (!asrSupported()) {
        micBtn.disabled = true;
        status.textContent = '这个浏览器不支持语音识别，打字作答即可——这一题主要看你能组织出多少内容。';
      }
      micBtn.addEventListener('click', () => {
        if (mic) {
          mic.stop();
          mic = null;
          micBtn.classList.remove('recording');
          return;
        }
        status.textContent = '正在听…说完再点一次';
        micBtn.classList.add('recording');
        mic = startAsr({
          onInterim: (t) => (ta.value = t),
          onResult: (r) => {
            mic = null;
            micBtn.classList.remove('recording');
            ta.value = r.transcript;
            via = 'spoken';
            status.textContent = '识别完成。';
          },
          onError: (f) => {
            mic = null;
            micBtn.classList.remove('recording');
            const info = FAILURE_TEXT[f];
            status.textContent = info.detail ? `${info.title}。${info.detail}` : info.title;
          },
        });
      });
      row.appendChild(ta);
      row.appendChild(micBtn);
      body.appendChild(row);
      body.appendChild(status);
    } else {
      body.appendChild(ta);
    }

    ta.addEventListener('input', () => {
      if (via === 'spoken') via = 'typed';
    });

    const submit = button('提交', 'primary block');
    submit.addEventListener('click', () => {
      answers.push({
        itemId: item.id,
        kind: item.kind,
        choice: -1,
        text: ta.value.trim(),
        elapsedMs: Date.now() - shownAt,
        via,
      });
      next();
    });
    const skip = button('这题先跳过', 'ghost block');
    skip.addEventListener('click', () => {
      answers.push({ itemId: item.id, kind: item.kind, choice: -1, text: '', elapsedMs: Date.now() - shownAt });
      next();
    });
    foot.appendChild(submit);
    foot.appendChild(skip);
  };

  const finish = () => {
    stopSpeaking();
    body.innerHTML = '';
    foot.innerHTML = '';
    body.appendChild(
      el(
        'div',
        'ec-empty',
        '<div class="ec-empty-title">正在分析</div><div class="ec-empty-desc">在比对你的输入能力和输出能力…</div>',
      ),
    );
    // 评分是纯本地计算，很快。给一点点延时是为了让上面这句话能被看见，
    // 而不是闪一下就过去——用户需要知道刚才那些题被认真处理了
    window.setTimeout(() => {
      const a = scoreAssessment({ userId: currentUserId(), answers });
      h.done(a);
    }, 420);
  };

  paint();
  return root;
}
