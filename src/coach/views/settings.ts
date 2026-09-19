/**
 * 设置
 *
 * 三块：学习偏好、AI 网关、数据。
 *
 * AI 那一块的措辞特别重要——用户需要在填之前就明白两件事：
 *   1. 不填也能用，而且不是"阉割版"
 *   2. Key 不要填在这里，要填在自己的网关上
 * 说不清这两件事，要么用户以为产品残废了，要么有人把 API Key 贴进浏览器。
 */

import type { AiConfig } from '../ai/config';
import type { GoalKey } from '../types';
import { GOAL_LABEL } from '../types';
import { DEFAULT_CONFIG, loadConfig, remoteAvailable, saveConfig } from '../ai/config';
import { asrSupported, ttsSupported } from '../engine/speech';
import { exportData, getUser, resetCurrentUser, saveUser } from '../store';
import {
  button,
  card,
  chips,
  collapsible,
  el,
  engineNote,
  esc,
  field,
  page,
  section,
  textInput,
  toast,
  mountTopbar,
  topbar,
} from './ui';

export function renderSettings(h: { back: () => void; onReset: () => void }): HTMLElement {
  const { root, body } = page();
  mountTopbar(root, topbar('设置', h.back));

  // ─────────── 学习偏好 ───────────
  body.appendChild(section('学习偏好'));
  const user = getUser();

  const nameInput = textInput('怎么称呼你', user.name);
  nameInput.addEventListener('change', () => {
    saveUser({ name: nameInput.value.trim() });
    toast('已保存');
  });
  body.appendChild(field('称呼', '', nameInput));

  const goals = new Set<string>(user.goals);
  body.appendChild(
    field(
      '学英语的目标',
      '决定你学到的词和练到的场景。改了之后，明天的计划就会跟着变。',
      chips(
        (Object.keys(GOAL_LABEL) as GoalKey[]).map((k) => ({ key: k, label: GOAL_LABEL[k] })),
        goals,
        (s) => {
          saveUser({ goals: [...s] as GoalKey[] });
          toast('已保存');
        },
      ),
    ),
  );

  const mins = new Set<string>([String(user.dailyMinutes)]);
  body.appendChild(
    field(
      '每天学多久',
      '这个数直接决定计划排多满。排不满比排太满好。',
      chips(
        [
          { key: '10', label: '10 分钟' },
          { key: '20', label: '20 分钟' },
          { key: '30', label: '30 分钟' },
          { key: '45', label: '45 分钟' },
        ],
        mins,
        (s) => {
          saveUser({ dailyMinutes: Number([...s][0]) || 20 });
          toast('已保存，明天的计划会按新时长排');
        },
        { single: true },
      ),
    ),
  );

  // ─────────── AI ───────────
  body.appendChild(section('AI 网关（可选）'));
  const cfg: AiConfig = loadConfig();

  const status = remoteAvailable(cfg);
  body.appendChild(
    engineNote(
      status.ok
        ? '已配置网关。NPC 台词和纠错解释会交给模型；纠错本身、评分、任务判定仍然由本地完成。'
        : `当前用本地引擎（${status.reason}）。所有功能都可用——纠错、测评、间隔复习、场景对话、复盘全在本地，接模型只是让对话更像人。`,
      status.ok ? 'remote' : 'local',
    ),
  );

  const modeSet = new Set<string>([cfg.mode]);
  body.appendChild(
    field(
      '模式',
      '',
      chips(
        [
          { key: 'local', label: '只用本地引擎' },
          { key: 'remote', label: '接入 AI 网关' },
        ],
        modeSet,
        (s) => {
          cfg.mode = ([...s][0] as AiConfig['mode']) ?? 'local';
          saveConfig(cfg);
          remoteFields.style.display = cfg.mode === 'remote' ? '' : 'none';
          toast('已保存');
        },
        { single: true },
      ),
    ),
  );

  const remoteFields = el('div', '');
  remoteFields.style.display = cfg.mode === 'remote' ? '' : 'none';

  const endpoint = textInput('https://your-worker.example.com/coach', cfg.endpoint);
  endpoint.addEventListener('change', () => {
    cfg.endpoint = endpoint.value.trim();
    saveConfig(cfg);
    toast('已保存');
  });
  remoteFields.appendChild(
    field('网关地址', '你自己搭的薄代理。契约见仓库里 src/coach/ai/README.md。', endpoint),
  );

  const token = textInput('可选', cfg.token);
  token.type = 'password';
  token.addEventListener('change', () => {
    cfg.token = token.value.trim();
    saveConfig(cfg);
    toast('已保存');
  });
  remoteFields.appendChild(field('网关 token（可选）', '发给你自己的网关做鉴权用。', token));

  const model = textInput('留空由网关决定', cfg.model);
  model.addEventListener('change', () => {
    cfg.model = model.value.trim();
    saveConfig(cfg);
    toast('已保存');
  });
  remoteFields.appendChild(field('模型名（可选）', '原样透传给网关。', model));

  const timeout = textInput('20000', String(cfg.timeoutMs));
  timeout.addEventListener('change', () => {
    const n = Number(timeout.value);
    cfg.timeoutMs = Number.isFinite(n) && n >= 1000 ? n : DEFAULT_CONFIG.timeoutMs;
    timeout.value = String(cfg.timeoutMs);
    saveConfig(cfg);
    toast('已保存');
  });
  remoteFields.appendChild(field('超时（毫秒）', '超时后自动降级回本地，不会卡住。', timeout));

  const test = button('测试连接', 'block');
  const testResult = el('div', 'ec-explain');
  testResult.style.display = 'none';
  test.addEventListener('click', async () => {
    testResult.style.display = '';
    testResult.textContent = '正在请求网关…';
    test.disabled = true;
    try {
      const { callGateway } = await import('../ai/providers');
      const out = await callGateway({
        system: 'You are a test endpoint. Reply with exactly: OK',
        user: 'Say OK.',
      });
      testResult.textContent = `网关通了。返回内容：${out.slice(0, 80)}`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      testResult.textContent = `连不上：${msg}。不影响使用——产品会继续用本地引擎。`;
    } finally {
      test.disabled = false;
    }
  });
  remoteFields.appendChild(test);
  remoteFields.appendChild(testResult);

  body.appendChild(remoteFields);

  // 这条警告**不放进 remoteFields**：它默认是折叠的，而最需要看到这句话的人
  // 恰恰是还没开始配、正准备找地方填 Key 的人。安全提示藏在开关后面等于没有。
  body.appendChild(
    el(
      'div',
      'ec-caveat',
      '不要把模型的 API Key 填在这里。这是纯前端页面，填进来的东西任何浏览器扩展都能读到。Key 应该只存在你自己的网关上——设置页里填的是网关地址，不是 Key。',
    ),
  );

  // ─────────── 本机能力 ───────────
  body.appendChild(section('这台设备的语音能力'));
  const cap = card('flat');
  cap.innerHTML = `
    <div class="ec-row"><div class="ec-row-main"><div class="ec-row-title">语音识别（说话转文字）</div>
      <div class="ec-row-sub">${asrSupported() ? '可用' : '不可用。桌面版 Chrome / Edge 支持最好。不可用时全部改成打字，练习内容不变。'}</div></div>
      <span class="ec-tag ${asrSupported() ? 'ok' : 'warn'}">${asrSupported() ? '支持' : '不支持'}</span></div>
    <div class="ec-row"><div class="ec-row-main"><div class="ec-row-title">语音合成（朗读）</div>
      <div class="ec-row-sub">${ttsSupported() ? '可用。合成音不是真人录音，语调会平一些。' : '不可用。听力材料会直接显示文字。'}</div></div>
      <span class="ec-tag ${ttsSupported() ? 'ok' : 'warn'}">${ttsSupported() ? '支持' : '不支持'}</span></div>`;
  body.appendChild(cap);

  body.appendChild(
    el(
      'div',
      'ec-caveat',
      '这个产品不提供发音评分。浏览器只能给出语音识别的文字结果，拿不到音素和音高数据——凭这些算不出可信的发音分，所以宁可不给。跟读页做的是"识别出来的词和目标句对不对得上"，并且会写明这一点。',
    ),
  );

  // ─────────── 数据 ───────────
  body.appendChild(section('数据'));
  body.appendChild(
    el('div', 'ec-muted', '所有学习记录只存在这台设备的浏览器里，不上传。换设备或清理浏览器数据会丢失。'),
  );

  const exportBtn = button('导出我的数据（JSON）', 'block');
  exportBtn.addEventListener('click', () => {
    try {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `english-coach-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已导出');
    } catch {
      toast('导出失败，这个浏览器可能不支持下载');
    }
  });
  body.appendChild(exportBtn);

  body.appendChild(
    collapsible(
      '清空全部学习数据',
      (() => {
        const c = el('div', '');
        c.appendChild(
          el('div', 'ec-muted', '会删掉测评结果、能力画像、错误档案、词汇进度和对话记录。这个操作没法撤销。'),
        );
        const confirmInput = textInput('输入"清空"确认');
        c.appendChild(confirmInput);
        const del = button('确认清空', 'block');
        del.addEventListener('click', () => {
          if (confirmInput.value.trim() !== '清空') {
            toast('请输入"清空"两个字确认');
            return;
          }
          resetCurrentUser();
          toast('已清空');
          h.onReset();
        });
        c.appendChild(del);
        return c;
      })(),
    ),
  );

  body.appendChild(
    el(
      'div',
      'ec-muted',
      `本地词库 · 场景库 · 中式英语规则库都随页面一起下载，离线可用。`,
    ),
  );
  void esc;
  return root;
}
