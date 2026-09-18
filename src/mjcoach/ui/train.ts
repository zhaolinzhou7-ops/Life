/**
 * 训练页：今日训练 / 专项训练 / 错题本。
 *
 * 做题界面的两个讲究：
 *   1. **答错要看见对比**，而不是只说「错了」。错了就把正确答案标在牌上。
 *   2. **提示分三级**。直接给答案等于没练，所以先给思路，再给方向，最后才给答案。
 */

import { getVariant } from '../rules/config';
import { SUIT_NAMES, suitOf, tilesName, type TileId } from '../rules/tiles';
import { ERROR_INFO, type ErrorType } from '../replay/analyze';
import {
  addSrsCard, dueSrsCards, lessonProgress, loadProfile, recordTraining, reviewSrsCard, summary,
} from '../profile/store';
import { COURSES, judge, similarPuzzle, type Puzzle } from '../training/bank';
import { buildDaily, buildLessonSet, loadDailyDone, markDailyDone } from '../training/daily';
import { clear, el, richText, tileEl, topbar } from './common';
import { openGlossary } from './glossary';

export interface TrainOptions {
  host: HTMLElement;
  onBack: () => void;
  /** 切换页面时通知外层刷新（做完题「我的」页面数据会变） */
  onChanged?: () => void;
}

export function renderTrain(o: TrainOptions): void {
  const { host } = o;
  const page = el('div.mc-page');
  const wrap = el('div.mc-page-wide');
  page.appendChild(wrap);
  host.appendChild(page);

  const p = loadProfile();
  const s = summary(p);
  const daily = buildDaily(p);
  const done = loadDailyDone();

  wrap.appendChild(
    el('div.mc-row', { style: 'padding:6px 0 2px' },
      el('span.mc-muted', { text: '教练说的词看不懂？' }),
      el('button.mc-btn.sm.ghost', { text: '📖 术语表', onclick: () => openGlossary(host) }),
    ),
  );

  // ---------- 今日训练 ----------
  wrap.appendChild(el('div.mc-section', { text: '今日训练' }));
  const todayCard = el('div.mc-card');
  const left = daily.puzzles.filter((x) => !done.done.includes(x.id)).length;
  todayCard.append(
    el('h3', { text: `${daily.theme}专项 · ${daily.puzzles.length} 道题` }),
    el('p', { text: daily.themeDesc }),
    el('p', {
      class: 'mc-muted',
      text: left === 0 ? '今天的已经做完了，可以再做专项训练。' : `还剩 ${left} 道没做`,
    }),
  );
  const reasons = el('div', { style: 'margin:8px 0' });
  daily.reasons.slice(0, 3).forEach((r) => reasons.appendChild(el('div.mc-muted', { text: `· ${r}` })));
  todayCard.appendChild(reasons);
  todayCard.appendChild(
    el('button.mc-btn.primary', {
      text: left === 0 ? '再做一遍' : '开始今日训练',
      onclick: () => runSet(daily.puzzles, '今日训练'),
    }),
  );
  wrap.appendChild(todayCard);

  // ---------- 错题本 ----------
  const due = dueSrsCards(p);
  if (p.srs.length) {
    wrap.appendChild(el('div.mc-section', { text: '错题本' }));
    const card = el('div.mc-card');
    card.append(
      el('h3', { text: `${p.srs.length} 道错题，今天该复习 ${due.length} 道` }),
      el('p', { class: 'mc-muted', text: '按遗忘曲线安排：做对一次隔久一点再出现，做错就重来。' }),
    );
    if (due.length) {
      card.appendChild(
        el('button.mc-btn', {
          text: '开始复习',
          onclick: () => {
            const list: Puzzle[] = [];
            for (const c of due.slice(0, 8)) {
              const pz = rebuildFromCard(c.payload as Record<string, unknown>);
              if (pz) list.push(pz);
            }
            if (!list.length) {
              card.appendChild(el('p', { text: '这些错题暂时重建不出来，换个专项练吧。' }));
              return;
            }
            runSet(list, '错题复习', true);
          },
        }),
      );
    }
    wrap.appendChild(card);
  }

  // ---------- 专项训练 ----------
  wrap.appendChild(el('div.mc-section', { text: '专项训练' }));
  for (const course of COURSES) {
    const card = el('div.mc-card');
    card.append(
      el('h3', { text: `${course.emoji} ${course.name}` }),
      el('p', { class: 'mc-muted', text: course.desc }),
    );
    const grid = el('div.mc-grid');
    for (const lesson of course.lessons) {
      const prog = lessonProgress(p, lesson.id, lesson.difficulty);
      const btn = el('button.mc-btn', {
        style: 'text-align:left;padding:11px 12px',
        onclick: () => {
          const set = buildLessonSet(lesson.id);
          if (!set || !set.puzzles.length) {
            alert('这一课的题目生成失败了，请稍后再试。');
            return;
          }
          runSet(set.puzzles, lesson.title);
        },
      });
      btn.append(
        el('div', { style: 'font-size:14px', text: lesson.title }),
        el('div', { style: 'font-size:11.5px;color:var(--mc-muted);margin-top:2px', text: lesson.desc }),
      );
      if (prog.done) {
        btn.appendChild(
          el('div', {
            style: 'font-size:11px;color:var(--mc-accent);margin-top:3px',
            text:
              `已练 ${prog.done} 题 · 正确率 ${Math.round(prog.accuracy * 100)}%` +
              (prog.calibrated ? ` · 当前难度「${prog.levelName}」` : ''),
          }),
        );
      }
      grid.appendChild(btn);
    }
    card.appendChild(grid);
    wrap.appendChild(card);
  }

  wrap.appendChild(
    el('div.mc-card', {},
      el('p', { class: 'mc-muted', text: `累计做题 ${s.trainingDone} 道 · 正确率 ${s.trainingAccuracy}% · 连续练习 ${s.streakDays} 天` }),
      el('p', {
        class: 'mc-muted',
        text: '题目难度会自己校准：做对了往难里出，做错了往回退，长期稳定在正确率 60% 出头——' +
          '全对说明题太简单学不到东西，错太多又只会打击人。',
      }),
    ),
  );

  host.insertBefore(topbar('训练', `今日主题：${daily.theme}`, o.onBack), page);

  /** 从错题卡还原题目 */
  function rebuildFromCard(payload: Record<string, unknown>): Puzzle | null {
    const lessonId = payload.lessonId as string | undefined;
    const seed = payload.seed as number | undefined;
    if (!lessonId || seed === undefined) return null;
    const set = buildLessonSet(lessonId, seed);
    return set?.puzzles[0] ?? null;
  }

  // ---------- 做题界面 ----------
  function runSet(puzzles: Puzzle[], title: string, isReview = false) {
    let idx = 0;
    let right = 0;
    const overlay = el('div.mc-overlay');
    host.appendChild(overlay);

    const close = () => {
      overlay.remove();
      o.onChanged?.();
    };

    const showOne = () => {
      clear(overlay);
      if (idx >= puzzles.length) {
        overlay.append(
          el('div.mc-result-title', { text: `${right} / ${puzzles.length}` }),
          el('div', { style: 'text-align:center;color:var(--mc-muted)', text: right === puzzles.length ? '全对，这一项可以升难度了。' : right >= puzzles.length * 0.6 ? '大部分都对，错的那几道记得回头看。' : '错得有点多——把解释读一遍比多做十道题有用。' }),
          el('div.mc-row', { style: 'margin-top:16px;justify-content:center' },
            el('button.mc-btn.primary', { text: '完成', onclick: close }),
          ),
        );
        return;
      }

      const pz = puzzles[idx];
      const bar = el('div.mc-progress', {}, el('i', { style: `width:${(idx / puzzles.length) * 100}%` }));
      const head = el('div.mc-row');
      head.append(
        el('div', {}, el('b', { text: title }), el('div.mc-muted', { text: `第 ${idx + 1} / ${puzzles.length} 题 · ${ERROR_INFO[pz.type].name}` })),
        el('div.mc-spacer'),
        el('button.mc-btn.sm.ghost', { text: '退出', onclick: close }),
      );
      overlay.append(head, bar);
      overlay.appendChild(el('div.mc-quiz-prompt', { text: pz.prompt }));

      // ---- 局面 ----
      let answered = false;
      const pickedIdx: number[] = [];
      /** 点手牌时干什么，由题型决定；选择题为 null（手牌只是给你看的） */
      let onTapTile: ((tile: TileId, index: number) => void) | null = null;
      /** 答完之后用来标记正确答案 */
      let markBest: TileId[] = [];
      let markBad: TileId[] = [];

      const handBox = el('div.mc-tiles', { style: 'margin-bottom:14px' });

      function renderHand() {
        clear(handBox);
        pz.hand.forEach((t, i) => {
          const isBest = answered && markBest.includes(t);
          const isBad = answered && !isBest && markBad.includes(t);
          handBox.appendChild(
            tileEl(t, {
              size: 'big',
              picked: pickedIdx.includes(i),
              mark: isBest ? 'best' : isBad ? 'bad' : undefined,
              onClick: !answered && onTapTile ? () => onTapTile!(t, i) : undefined,
            }),
          );
        });
        for (const m of pz.melds) {
          const n = m.kind === 'peng' ? 3 : 4;
          for (let i = 0; i < n; i++) handBox.appendChild(tileEl(m.tile, { size: 'small' }));
        }
      }

      if (pz.hand.length) {
        if (pz.lack >= 0) {
          overlay.appendChild(
            el('div', { style: 'margin-bottom:6px' }, el('span.mc-lackbadge', { text: `缺${SUIT_NAMES[pz.lack]}` })),
          );
        }
        overlay.appendChild(handBox);
        renderHand(); // 选择题也要把牌摆出来，不然「这手牌该缺哪门」没法答
      }

      // ---- 作答方式 ----
      let choiceBox: HTMLElement | null = null;
      let chosenBtn: HTMLElement | null = null;

      if (pz.choices) {
        choiceBox = el('div.mc-choices');
        for (const c of pz.choices) {
          const btn = el('button.mc-choice', {
            text: c.text,
            onclick: () => {
              if (answered) return;
              chosenBtn = btn;
              finish(pz.kind === 'lack' ? Number(c.key) : c.key);
            },
          });
          choiceBox.appendChild(btn);
        }
        overlay.appendChild(choiceBox);
      } else if (pz.kind === 'swap') {
        const tip = el('div.mc-muted', { text: '选 3 张同花色的牌' });
        const confirm = el('button.mc-btn.primary', { style: 'margin-top:10px', text: '确定' });
        confirm.setAttribute('disabled', 'true');
        onTapTile = (tile, i) => {
          const at = pickedIdx.indexOf(i);
          if (at >= 0) pickedIdx.splice(at, 1);
          else if (pickedIdx.length >= 3) {
            tip.textContent = '最多选 3 张';
            return;
          } else if (pickedIdx.length && suitOf(pz.hand[pickedIdx[0]]) !== suitOf(tile)) {
            tip.textContent = '换三张必须是同一种花色';
            return;
          } else pickedIdx.push(i);
          const tiles = pickedIdx.map((k) => pz.hand[k]);
          tip.textContent = pickedIdx.length === 3 ? `已选 ${tilesName(tiles)}` : `还要选 ${3 - pickedIdx.length} 张`;
          if (pickedIdx.length === 3) confirm.removeAttribute('disabled');
          else confirm.setAttribute('disabled', 'true');
          renderHand();
        };
        confirm.addEventListener('click', () => {
          if (answered || pickedIdx.length !== 3) return;
          finish(pickedIdx.map((k) => pz.hand[k]));
        });
        overlay.append(tip, confirm);
        renderHand();
      } else {
        overlay.appendChild(el('div.mc-muted', { text: '点一张牌作答' }));
        onTapTile = (tile) => finish(tile);
        renderHand();
      }

      // ---- 分级提示 ----
      let hintLevel = 0;
      const hintBox = el('div', { style: 'margin-top:12px' });
      const hintBtn = el('button.mc-btn.sm.ghost', {
        style: 'align-self:flex-start',
        text: '💡 给点提示',
        onclick: () => {
          if (hintLevel >= pz.hints.length) return;
          hintBox.appendChild(
            el('div.mc-muted', { style: 'margin-top:5px', text: `提示 ${hintLevel + 1}：${pz.hints[hintLevel]}` }),
          );
          hintLevel++;
          if (hintLevel >= pz.hints.length) hintBtn.setAttribute('disabled', 'true');
        },
      });
      overlay.append(hintBtn, hintBox);

      function finish(given: number | number[] | string) {
        if (answered) return;
        answered = true;
        const { correct } = judge(pz, given);
        if (correct) right++;
        recordTraining(pz.type, correct, { id: pz.lessonId, baseDifficulty: pz.difficulty });
        markDailyDone(pz.id);
        if (isReview) reviewSrsCard(pz.id, correct);
        else if (!correct) addSrsCard({ id: pz.id, type: pz.type, payload: { lessonId: pz.lessonId, seed: pz.seed } });

        // 选择题：把对的标绿、选错的标红
        if (choiceBox) {
          chosenBtn?.classList.add(correct ? 'right' : 'wrong');
          if (!correct) {
            const rightKey = String(pz.answer);
            pz.choices?.forEach((c, i) => {
              if (String(c.key) === rightKey) choiceBox!.children[i]?.classList.add('right');
            });
          }
        } else {
          // 牌型题：正确答案标绿点，选错的标红点
          markBest = Array.isArray(pz.answer) ? (pz.answer as TileId[]) : [pz.answer as TileId];
          markBad = Array.isArray(given) ? (given as TileId[]) : typeof given === 'number' ? [given] : [];
          renderHand();
        }

        const verdict = el(`div.mc-verdict.${correct ? 'right' : 'wrong'}`);
        verdict.appendChild(
          el('div', { style: 'font-weight:600;margin-bottom:6px', text: correct ? '✓ 答对了' : '✗ 再想想' }),
        );
        verdict.appendChild(richText(pz.explain));
        overlay.appendChild(verdict);

        const row = el('div.mc-row', { style: 'margin-top:14px;flex-wrap:wrap' });
        row.append(
          el('button.mc-btn.primary', {
            text: idx === puzzles.length - 1 ? '看结果' : '下一题',
            onclick: () => { idx++; showOne(); },
          }),
          el('button.mc-btn.ghost', {
            text: '再来一道类似的',
            onclick: () => {
              const nx = similarPuzzle(pz, getVariant(pz.configId));
              if (nx) {
                puzzles.splice(idx + 1, 0, nx);
                idx++;
                showOne();
              }
            },
          }),
        );
        overlay.appendChild(row);
        overlay.scrollTop = overlay.scrollHeight;
      }
    };

    showOne();
  }

}

export type { ErrorType };
