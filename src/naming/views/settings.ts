/**
 * 设置页
 *
 * 只有一件正经事：让想接真实模型的人能接上，同时把「密钥不该放在浏览器里」
 * 这件事说清楚，而不是假装它没风险。
 */

import { button, chipGroup, el, field, textInput, toast, topbar } from './ui';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../ai/config';
import { CHARS } from '../data/chars';
import { COMBOS } from '../data/combos';
import { SOURCES } from '../data/sources';

export interface SettingsActions {
  back: () => void;
}

export function renderSettings(a: SettingsActions): HTMLElement {
  const page = el('div', 'nm-page');
  page.appendChild(topbar('设置', a.back));

  const cfg = loadConfig();

  const modeSel = new Set<string>([cfg.mode === 'remote' ? '接入 AI 模型' : '本地引擎']);
  const remoteBox = el('div');

  const syncMode = () => {
    remoteBox.style.display = cfg.mode === 'remote' ? '' : 'none';
  };

  page.appendChild(
    field(
      '取名引擎',
      '本地引擎离线可用，内置字库、典籍库和六维筛选。接入模型后，候选名由模型提供，筛选和分析仍然由本地引擎做。',
      chipGroup(
        ['本地引擎', '接入 AI 模型'],
        modeSel,
        (s) => {
          cfg.mode = s.has('接入 AI 模型') ? 'remote' : 'local';
          syncMode();
        },
        { single: true },
      ),
    ),
  );

  const ep = textInput('https://your-gateway.example.com/naming', cfg.endpoint);
  ep.addEventListener('input', () => (cfg.endpoint = ep.value.trim()));
  remoteBox.appendChild(field('网关地址', '你自己部署的中转服务地址。契约见仓库 src/naming/ai/README.md。', ep));

  const model = textInput('留空则由网关决定', cfg.model);
  model.addEventListener('input', () => (cfg.model = model.value.trim()));
  remoteBox.appendChild(field('模型名', '会原样透传给网关', model));

  const token = textInput('留空则不发送', cfg.token);
  token.type = 'password';
  token.addEventListener('input', () => (cfg.token = token.value.trim()));
  remoteBox.appendChild(
    field('访问令牌（可选）', '会以 Authorization: Bearer 头发给你的网关。', token),
  );

  remoteBox.appendChild(
    el(
      'div',
      'nm-disclaimer',
      '⚠️ 这里填的内容只存在这台设备的浏览器里，不会上传到任何服务器。但也请注意：' +
        '浏览器里存的东西，装了扩展的浏览器就有可能读到。' +
        '真正的模型 API Key 请放在你自己的网关上，不要填进任何前端页面——包括这一页。',
    ),
  );
  page.appendChild(remoteBox);
  syncMode();

  const foot = el('div', 'nm-formfoot');
  foot.appendChild(
    button('保存设置', 'primary', () => {
      if (cfg.mode === 'remote' && !cfg.endpoint) {
        toast('选了接入模型，就得填网关地址');
        return;
      }
      if (cfg.endpoint && !/^https?:\/\//i.test(cfg.endpoint)) {
        toast('网关地址要以 http:// 或 https:// 开头');
        return;
      }
      saveConfig(cfg);
      toast('已保存');
    }),
  );
  foot.appendChild(
    button('恢复默认', 'ghost', () => {
      saveConfig({ ...DEFAULT_CONFIG });
      toast('已恢复为本地引擎');
      a.back();
    }),
  );
  page.appendChild(foot);

  const about = el('div');
  about.style.marginTop = '30px';
  about.innerHTML = `
    <h3 style="font-size:13px;font-weight:600;color:var(--ink-3);letter-spacing:2px;margin:0 0 10px">关于数据</h3>
    <p class="nm-prose" style="font-size:13.5px">
      内置 <strong>${CHARS.length}</strong> 个取名用字（含读音、笔画、结构、字义、词性、传统五行），
      <strong>${COMBOS.length}</strong> 条人工筛过的名字搭配，
      <strong>${SOURCES.length}</strong> 条典籍出处。
    </p>
    <p class="nm-prose" style="font-size:13.5px">
      出处只标注真实原句：每个名字的每个字都必须出现在所引的那一句里，这一条由自动化测试强制校验。
      查不到出处的名字会明确写成「现代组合名」，不会给它编一个来历。
    </p>
    <p class="nm-prose" style="font-size:13.5px">
      重名只给「低 / 中 / 高」的风险档位，并且标明这是基于近年取名用字趋势的估计。
      任何产品都拿不到公安户籍数据，凡是告诉你「全国仅 3 人同名」的，那个数字是编的。
    </p>`;
  page.appendChild(about);

  return page;
}
