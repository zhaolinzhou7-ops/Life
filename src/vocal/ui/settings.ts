/**
 * 设置与隐私。
 *
 * 两件事在这里必须说清楚，而不是藏在条款里：
 *   1. 录音怎么处理（默认不保存，可以随时全删）；
 *   2. 配了 AI 之后，到底有什么东西会离开这台设备（只有指标，没有音频）。
 *
 * 还有一个延迟校准——它决定了节奏分析能不能下「抢拍/拖拍」的结论。
 * 自动校准的做法是：外放几声「哒」，同时用麦克风录，
 * 测出「发出去」到「听回来」之间差了多久，这一段就是设备延迟。
 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import {
  DEFAULT_SETTINGS,
  KEEP_AUDIO_LABEL,
  getSettings,
  saveSettings,
  storageUsage,
  wipeAll,
  type KeepAudio,
} from '../data/store';
import { PRESETS, PRESET_BY_ID, explainError, type ProviderConfig } from '../ai/provider';
import { createProvider } from '../ai/coach';
import { playClick } from '../audio/synth';
import { audioCtx, resumeAudio } from '../audio/context';
import { highpass } from '../dsp/resample';
import { btn, card, el, esc, field, sectionTitle, select, switchRow, textInput } from './components';

export function renderSettings(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(topbar('设置与隐私', () => ctx.back()));
  box.appendChild(wrap);
  wrap.style.padding = '16px';

  let s = getSettings();

  // ---------------------------------------------------------------- 隐私
  wrap.appendChild(sectionTitle('录音与隐私'));
  const privacy = card();
  privacy.appendChild(
    el(
      'p',
      '',
      '录音、分析、存档全部在这台设备上完成，不经过任何服务器。' +
        '默认情况下录音**不会保存**——唱完分析完，离开页面就没了。',
    ),
  );
  privacy.appendChild(
    field(
      '录音保留多久',
      (() => {
        const sel = select(
          (Object.keys(KEEP_AUDIO_LABEL) as KeepAudio[]).map((k) => ({ value: k, label: KEEP_AUDIO_LABEL[k] })),
          s.keepAudio,
        );
        sel.addEventListener('change', () => {
          s = saveSettings({ keepAudio: sel.value as KeepAudio });
        });
        return sel;
      })(),
      '选「不保存」时，分析页上仍然可以对当次录音点「保存这次录音」单独留下来。过期的录音在每次打开应用时自动清掉。',
    ),
  );
  const usage = el('p', '');
  privacy.appendChild(usage);
  void storageUsage().then((u) => {
    usage.textContent = `当前本地占用：指标与报告约 ${u.metricsKb} KB${u.clips ? `，录音 ${u.clips} 段约 ${u.audioMb} MB` : '，没有保存任何录音'}。`;
  });
  wrap.appendChild(privacy);

  // ---------------------------------------------------------------- 延迟校准
  wrap.appendChild(sectionTitle('设备延迟校准'));
  const cal = card();
  cal.appendChild(
    el(
      'p',
      '',
      '从伴奏响起，到你的声音被录进来，中间有几十到几百毫秒的延迟（蓝牙耳机尤其明显）。' +
        '不校准的话，「你在拖拍」和「你的设备慢了」在数据上分不开——' +
        '所以那种情况下我们不下这个结论。校一次，以后就能分清。',
    ),
  );
  const calStatus = el('div', 'v-note');
  const updateCalStatus = () => {
    calStatus.innerHTML = s.calibrated
      ? `已校准：<b>${s.latencyMs} 毫秒</b>。节奏分析会据此判断抢拍/拖拍。`
      : '还没校准。目前节奏分析只给「一致性」类结论（这类不受延迟影响），不判断抢拍/拖拍。';
  };
  updateCalStatus();
  cal.appendChild(calStatus);

  const calBtn = btn('🔊 自动校准（请先外放，不要戴耳机）', 'v-btn', async () => {
    calBtn.disabled = true;
    calBtn.innerHTML = '<span class="v-spinner"></span> 正在测量…';
    const r = await autoCalibrate(ctx);
    calBtn.disabled = false;
    calBtn.innerHTML = '🔊 重新自动校准';
    if (r.ok) {
      s = saveSettings({ latencyMs: r.ms, calibrated: true });
      updateCalStatus();
      slider.value = String(r.ms);
      manualLabel.textContent = `${r.ms} 毫秒`;
      calStatus.classList.remove('bad');
    } else {
      calStatus.className = 'v-note bad';
      calStatus.textContent = r.reason;
    }
  });
  cal.appendChild(calBtn);

  const slider = el('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '400';
  slider.step = '10';
  slider.value = String(s.latencyMs);
  slider.style.cssText = 'width:100%;margin-top:14px;accent-color:var(--v-accent)';
  const manualLabel = el('div', '');
  manualLabel.style.cssText = 'font-size:13px;color:var(--v-muted);margin-top:6px';
  manualLabel.textContent = `${s.latencyMs} 毫秒`;
  slider.addEventListener('input', () => {
    manualLabel.textContent = `${slider.value} 毫秒`;
  });
  slider.addEventListener('change', () => {
    s = saveSettings({ latencyMs: Number(slider.value), calibrated: true });
    updateCalStatus();
  });
  cal.appendChild(field('或者手动设置（戴耳机时用这个）', slider, '有线耳机大约 30~80 毫秒，蓝牙耳机常在 150~300 毫秒。'));
  cal.appendChild(manualLabel);
  wrap.appendChild(cal);

  // ---------------------------------------------------------------- 跟唱
  wrap.appendChild(sectionTitle('跟唱'));
  const sing = card();
  sing.appendChild(
    field(
      '默认提示强度',
      (() => {
        const sel = select(
          [
            { value: 'novice', label: '新手 · 标歌词 + 跑调箭头' },
            { value: 'normal', label: '普通 · 只显示音高线' },
            { value: 'exam', label: '考试 · 唱完再看' },
          ],
          s.guideLevel,
        );
        sel.addEventListener('change', () => {
          s = saveSettings({ guideLevel: sel.value as typeof s.guideLevel });
        });
        return sel;
      })(),
    ),
  );
  sing.appendChild(
    switchRow('前奏打节拍', '起唱前用「哒」数拍子，帮你踩准第一个音', s.leadClicks, (v) => {
      s = saveSettings({ leadClicks: v });
    }),
  );
  const vol = el('input');
  vol.type = 'range';
  vol.min = '0';
  vol.max = '40';
  vol.value = String(Math.round(s.accompanimentVolume * 100));
  vol.style.cssText = 'width:100%;accent-color:var(--v-accent)';
  vol.addEventListener('change', () => {
    s = saveSettings({ accompanimentVolume: Number(vol.value) / 100 });
  });
  sing.appendChild(field('伴奏音量', vol, '调到 0 就是清唱——伴奏漏进麦克风会影响音高检测，外放时可以调小一点。'));
  wrap.appendChild(sing);

  // ---------------------------------------------------------------- AI
  wrap.appendChild(sectionTitle('AI 教练'));
  const ai = card();
  ai.appendChild(
    el(
      'p',
      '',
      '默认用内置教练（规则引擎），不联网也完全可用。' +
        '想换成大模型来写反馈，可以在这里配置——用你自己的 API Key。',
    ),
  );

  const presetSel = select(
    PRESETS.map((p) => ({ value: p.id, label: p.label })),
    s.provider.preset,
  );
  const detail = el('div');

  const renderProviderDetail = () => {
    detail.innerHTML = '';
    const preset = PRESET_BY_ID.get(s.provider.preset);
    if (!preset) return;
    if (preset.note) detail.appendChild(el('div', 'v-note', esc(preset.note)));
    if (preset.kind === 'mock') return;

    const urlInput = textInput(s.provider.baseUrl || preset.baseUrl, preset.baseUrl || 'https://…');
    urlInput.addEventListener('change', () => {
      s = saveSettings({ provider: { ...s.provider, baseUrl: urlInput.value.trim() } });
    });
    detail.appendChild(field('接口地址', urlInput));

    const modelInput = textInput(s.provider.model || preset.model, preset.model || '模型 ID');
    modelInput.addEventListener('change', () => {
      s = saveSettings({ provider: { ...s.provider, model: modelInput.value.trim() } });
    });
    detail.appendChild(field('模型', modelInput));

    const keyInput = textInput(s.provider.apiKey, '粘贴你的 API Key', 'password');
    keyInput.addEventListener('change', () => {
      s = saveSettings({ provider: { ...s.provider, apiKey: keyInput.value.trim() } });
    });
    detail.appendChild(
      field(
        'API Key',
        keyInput,
        `Key 只存在这台设备的浏览器里，只会发往上面填的那个地址，不会发给我们——这个应用没有服务器。申请入口：${preset.keyHint}。`,
      ),
    );

    detail.appendChild(
      el(
        'div',
        'v-note',
        '配了 AI 之后，每次分析会把**指标**发给你选的服务商：' +
          '音准偏差、节奏偏差、音域、问题清单这些——也就是分析页上已经显示给你看的那些数字。' +
          '录音本身、逐帧音高轨迹、设备信息都不会发送。',
      ),
    );

    const testResult = el('div', '');
    testResult.style.cssText = 'font-size:13px;margin-top:10px;line-height:1.7';
    const testBtn = btn('测试连接', 'v-btn', async () => {
      testBtn.disabled = true;
      testResult.innerHTML = '<span class="v-spinner"></span> 正在测试…';
      const cfg: ProviderConfig = getSettings().provider;
      const p = createProvider(cfg);
      if (!p) {
        testResult.textContent = '当前是内置教练，不需要测试。';
        testBtn.disabled = false;
        return;
      }
      try {
        const out = await p.complete({
          system: '你是一个测试助手。只回答两个字，不要任何标点或解释。',
          user: '请回答：正常',
          maxTokens: 20,
        });
        testResult.innerHTML = `<span style="color:var(--v-green)">连接成功</span>，模型回了：${esc(out.trim().slice(0, 40))}`;
      } catch (e) {
        testResult.innerHTML = `<span style="color:var(--v-red)">连接失败</span>：${esc(explainError(e))}`;
      }
      testBtn.disabled = false;
    });
    detail.appendChild(testBtn);
    detail.appendChild(testResult);
  };

  presetSel.addEventListener('change', () => {
    const preset = PRESET_BY_ID.get(presetSel.value)!;
    s = saveSettings({
      provider: {
        preset: preset.id,
        kind: preset.kind,
        baseUrl: preset.baseUrl,
        model: preset.model,
        apiKey: s.provider.apiKey,
      },
    });
    renderProviderDetail();
  });
  ai.appendChild(field('服务商', presetSel));
  ai.appendChild(detail);
  renderProviderDetail();
  wrap.appendChild(ai);

  // ---------------------------------------------------------------- 边界说明
  wrap.appendChild(sectionTitle('这个应用不能做什么'));
  const bounds = card();
  bounds.innerHTML =
    '<p>写在这里，免得产生误解：</p>' +
    '<p>· <b style="color:var(--v-text)">不能</b>判断声带健康、声带闭合、喉部或呼吸系统的状况。' +
    '这些需要专业检查，一段手机录音得不出来。嗓子不舒服请看医生。</p>' +
    '<p>· <b style="color:var(--v-text)">不能</b>保证练了就一定能唱到某个音。音域能练宽，但每个人的幅度和速度不一样。</p>' +
    '<p>· 这里的评分<b style="color:var(--v-text)">不等同于</b>专业声乐老师的评估，也不是任何等级认证。' +
    '它们是软件内部的训练指标，用来和你自己的过去比。</p>' +
    '<p>· 所有分析都基于这一次录音的算法指标，受设备、环境、距离影响很大。</p>';
  wrap.appendChild(bounds);

  // ---------------------------------------------------------------- 数据管理
  wrap.appendChild(sectionTitle('数据'));
  const data = card();
  data.appendChild(
    btn('恢复默认设置', 'v-btn ghost', () => {
      s = saveSettings({ ...DEFAULT_SETTINGS, provider: { ...DEFAULT_SETTINGS.provider } });
      ctx.refresh();
    }),
  );
  const wipeBox = el('div');
  wipeBox.style.marginTop = '10px';
  const wipeBtn = btn('🗑 删除全部本地数据', 'v-btn danger', () => {
    wipeBox.innerHTML = '';
    wipeBox.appendChild(
      el('div', 'v-note bad', '这会删掉所有演唱记录、分析报告、练习记录和保存的录音，且无法撤销。'),
    );
    const row = el('div', 'v-btn-row');
    row.appendChild(
      btn('确认删除', 'v-btn danger', async () => {
        await wipeAll();
        ctx.go({ p: 'home' });
      }),
    );
    row.appendChild(btn('取消', 'v-btn ghost', () => ctx.refresh()));
    wipeBox.appendChild(row);
  });
  data.appendChild(wipeBtn);
  data.appendChild(wipeBox);
  wrap.appendChild(data);

  return () => {};
}

/**
 * 自动测量往返延迟：外放几声「哒」，同时录音，看录到的「哒」比发出去的晚多少。
 * 戴耳机时麦克风听不到，会返回失败并提示改用手动。
 */
async function autoCalibrate(ctx: Ctx): Promise<{ ok: true; ms: number } | { ok: false; reason: string }> {
  const mic = await ctx.requestMic();
  if (!mic) return { ok: false, reason: '需要麦克风权限才能自动校准。也可以直接用下面的滑块手动设置。' };

  resumeAudio();
  const c = audioCtx();
  const N = 6;
  const gap = 0.45;
  await mic.start();
  // 「哒」的调度时刻（AudioContext 时间轴）
  const base = c.currentTime;
  const scheduled: number[] = [];
  for (let i = 0; i < N; i++) {
    const when = 0.35 + i * gap;
    playClick(when, true);
    scheduled.push(base + when);
  }
  await new Promise((r) => setTimeout(r, (0.35 + N * gap + 0.4) * 1000));
  const rec = mic.stop();

  // 录音第 0 个采样点对应 rec.startCtxTime，据此把调度时刻换算到录音内的位置
  const clickTimes = scheduled.map((t) => t - rec.startCtxTime);
  const detected = detectClicks(rec.samples, rec.sampleRate);
  if (detected.length < 3) {
    return {
      ok: false,
      reason:
        '没能从录音里听到那几声「哒」。戴着耳机就测不了（麦克风听不到耳机里的声音），' +
        '请改用外放，或者用下面的滑块手动设置。',
    };
  }

  // 每一声「哒」配一个检测到的位置，取偏差的中位数
  const offsets: number[] = [];
  for (const ct of clickTimes) {
    let best = Infinity;
    for (const d of detected) {
      const diff = d - ct;
      if (diff > -0.05 && diff < 0.6 && diff < best) best = diff;
    }
    if (best !== Infinity) offsets.push(best);
  }
  if (offsets.length < 3) {
    return { ok: false, reason: '测到的声音对不上发出去的节奏，换个安静点的环境再试一次。' };
  }
  offsets.sort((a, b) => a - b);
  const ms = Math.round(offsets[offsets.length >> 1] * 1000);
  if (ms < 0 || ms > 600) {
    return { ok: false, reason: `测出来是 ${ms} 毫秒，不像是正常值。换个环境重测，或者手动设置。` };
  }
  return { ok: true, ms };
}

/** 从录音里找出「哒」的位置：高通之后看能量包络的突起 */
function detectClicks(samples: Float32Array, sampleRate: number): number[] {
  const hp = highpass(samples, sampleRate, 800);
  const win = Math.round(sampleRate * 0.005);
  const n = Math.floor(hp.length / win);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < win; j++) s += Math.abs(hp[i * win + j]);
    env[i] = s / win;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) if (env[i] > peak) peak = env[i];
  if (peak < 1e-4) return [];
  const thresh = peak * 0.35;

  const out: number[] = [];
  let cooldown = 0;
  for (let i = 1; i < n; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }
    // 要求是一个「突起」：本帧过阈值，而且比前一帧明显大
    if (env[i] > thresh && env[i] > env[i - 1] * 1.8) {
      out.push((i * win) / sampleRate);
      cooldown = Math.round(0.2 / 0.005); // 200ms 不重复触发
    }
  }
  return out;
}
