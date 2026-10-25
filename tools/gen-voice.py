"""
象棋配音：吃车、将军、绝杀的喊声，出场人物的开场白。

用户原话："出场、开局，以及吃子、将军、绝杀等关键节点，都要有浑厚的人声配音（男声或女声），比如喊出'将军'这种，
不要只有电子打击音。"——之前用浏览器自带的念字，用户嫌"傻"（机械、平、没有气势）。这里换成离线生成好的录音：

  1. 用 Kokoro（开源语音合成模型，Apache-2.0，权重 82M，自带普通话男声女声）把每一句念出来；
  2. 处理成"浑厚"的喊声：降一点音高（声音更沉）、低频加厚、两层叠出饱满、轻微饱和、大殿混响加一记回声；
  3. 压成 MP3（单声道 24kHz，每句十来 KB），放进 src/xiangqi/voice/；
  4. 听不见声音，就让机器听：用开源普通话语音识别（sherpa-onnx paraformer）把每一句转回文字，对不上就报错；
     同时量基频，确认男声确实是低沉的。

准备（一次）：
  python3 -m venv venv && ./venv/bin/pip install kokoro-onnx "misaki[zh]" soundfile scipy sherpa-onnx
  模型：github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{kokoro-v1.0.onnx,voices-v1.0.bin}
  识别：github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-small-2024-03-09.tar.bz2
运行：
  ./venv/bin/python tools/gen-voice.py <模型所在目录> [只生成哪几句，逗号分开，如 m-win,f-win]
"""
import json
import os
import subprocess
import sys
from math import gcd

import numpy as np
import soundfile as sf
from scipy.signal import lfilter, resample_poly

MODEL_DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
ONLY = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'xiangqi', 'voice')
os.makedirs(OUT, exist_ok=True)
SR = 24000

# 对局里的喊声：男声、女声各一套。每一句列几种念法（字、语速），按顺序试，**机器听得对**的第一种收下。
# 试下来 Kokoro 正常语速（1.0 上下）念得最清楚，放慢反而含糊（"吃"会念成"失"）——
# 所以语速不压，"沉"靠后面降调和处理。
# 只喊关键的几步（用户原话："不是每一步都要说话，就是关键的那几步，比如说吃车、将军、绝杀……开局也不用说开局"）
SHOUTS = {
    'jiangjun': [('将军！', 1.0), ('将军！', 0.95)],
    'jiesha': [('绝杀！', 1.0), ('绝杀！', 0.95), ('绝杀！', 1.05), ('绝杀！', 0.9), ('绝杀！', 1.1), ('绝，杀！', 0.95), ('绝，杀！', 1.0)],
    'kunbi': [('困毙！', 1.0), ('困毙！', 0.95)],
    'chiche': [('吃车！', 1.0), ('吃车！', 1.05), ('吃掉车！', 0.95), ('吃掉车！', 1.0)],
    # 终局：赢了、输了、和了，说一句有江湖气的话（输了宽慰一句，"胜败乃兵家常事"）
    'win': [('大获全胜！', 1.0), ('大获全胜！', 0.95)],
    'lose': [('胜败乃兵家常事！', 1.0), ('胜败乃兵家常事！', 0.95), ('胜败乃兵家常事。', 1.0)],
    'draw': [('握手言和！', 1.0), ('握手言和！', 0.95), ('和棋！', 1.0)],
}
# 男声：云健（几个男声里最低沉，基频约 105Hz）再降 1.5 个半音；女声：晓晓（试的几个女声里偏低、每句都念得清楚）
VOICES = {'m': ('zm_yunjian', -1.5), 'f': ('zf_xiaoxiao', 0.0)}
# 某一句主嗓子怎么念机器都听不对，再换同一性别的备用嗓子（只在主嗓子不行时用，听着差别不大）
BACKUP = {'zm_yunjian': ['zm_yunyang'], 'zf_xiaoxiao': ['zf_xiaoyi', 'zf_xiaobei', 'zf_xiaoni']}
# 出场人物的开场白：每个人物自己的嗓子（关公最沉、哪吒是少年音）
HEROES = {
    'daoke': ('zm_yunjian', [('刀在鞘中，棋在心中。请！', 0.92), ('刀在鞘中，棋在心中。请！', 1.0)], -2.0),
    'guangong': ('zm_yunyang', [('关某在此，请赐教！', 0.92), ('关某在此，请赐教！', 1.0)], -3.0),
    'nezha': ('zm_yunxia', [('哪吒在此，风火轮来也！', 0.95), ('哪吒在此，风火轮来也！', 1.0)], 0.0),
    'nvxia': ('zf_xiaoxiao', [('白衣仗剑，请赐教！', 0.95), ('白衣仗剑，请赐教！', 1.0), ('一剑一棋，请赐教！', 0.95), ('一剑一棋，请赐教！', 1.0)], 0.0),
    'dasheng': ('zm_yunxi', [('俺老孙来也！', 0.95), ('俺老孙来也！', 1.0)], -1.0),
}


# ───────── 合成 ─────────
from kokoro_onnx import Kokoro  # noqa: E402
from misaki import zh  # noqa: E402

kokoro = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))
g2p = zh.ZHG2P()


def say(text, voice, speed):
    x, sr = kokoro.create(g2p(text), voice=voice, speed=speed, is_phonemes=True)
    assert sr == SR
    return np.asarray(x, dtype=np.float64)


# ───────── 处理 ─────────
def biquad(kind, f0, gain_db=0.0, q=0.707):
    """RBJ 均衡器系数"""
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f0 / SR
    cw, sw = np.cos(w), np.sin(w)
    alpha = sw / (2 * q)
    if kind == 'lowshelf':
        b = [A * ((A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha), 2 * A * ((A - 1) - (A + 1) * cw), A * ((A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha)]
        a = [(A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha, -2 * ((A - 1) + (A + 1) * cw), (A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha]
    elif kind == 'peak':
        b = [1 + alpha * A, -2 * cw, 1 - alpha * A]
        a = [1 + alpha / A, -2 * cw, 1 - alpha / A]
    elif kind == 'highpass':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    elif kind == 'lowpass':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + alpha, -2 * cw, 1 - alpha]
    else:
        raise ValueError(kind)
    return np.array(b) / a[0], np.array(a) / a[0]


def eq(x, kind, f0, g=0.0, q=0.707):
    b, a = biquad(kind, f0, g, q)
    return lfilter(b, a, x)


def repitch(x, semis):
    """降音高（同时稍微放慢——喊得更沉、更有分量）"""
    if abs(semis) < 0.01:
        return x
    ratio = 2 ** (-semis / 12)  # >1：变长、变低
    up, down = int(round(ratio * 1000)), 1000
    g = gcd(up, down)
    return resample_poly(x, up // g, down // g)


def hall_ir(seconds, seed=7):
    """大殿混响：几道早期反射 + 指数衰减的噪声尾，高频衰减得快"""
    rng = np.random.default_rng(seed)
    n = int(SR * seconds)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 6.9 / seconds)
    ir = eq(ir, 'lowpass', 5200)
    for d, a in [(0.011, 0.6), (0.019, 0.45), (0.029, 0.35), (0.041, 0.28), (0.063, 0.2)]:
        ir[int(d * SR)] += a
    ir[0] = 0
    return ir / np.sqrt(np.sum(ir ** 2))


def process(x, semis, reverb_s, wet, echo=True, double=True):
    x = x / (np.abs(x).max() + 1e-9)
    # 去掉头尾的静音
    idx = np.where(np.abs(x) > 0.02)[0]
    x = x[max(0, idx[0] - int(0.01 * SR)): idx[-1] + int(0.04 * SR)]
    x = repitch(x, semis)
    # 浑厚：去掉超低频的轰、低频加厚、胸腔那一段鼓一点、齿音收一点
    x = eq(x, 'highpass', 70)
    x = eq(x, 'lowshelf', 180, 4.5)
    x = eq(x, 'peak', 320, 2.0, 0.9)
    x = eq(x, 'peak', 2800, 2.5, 1.0)
    x = eq(x, 'peak', 7000, -3.0, 1.2)
    # 叠一层：稍微变调、晚 21 毫秒——一个人喊出了两个人的厚度
    dbl = repitch(x, 0.09)
    d = int(0.021 * SR)
    y = np.zeros(max(len(x), len(dbl) + d))
    y[: len(x)] += x
    if double:
        y[d: d + len(dbl)] += dbl * 0.34
    # 轻微饱和：有劲，但不破
    y = np.tanh(1.7 * y / (np.abs(y).max() + 1e-9)) / np.tanh(1.7)
    # 混响 + 一记回声（对局喊声）
    ir = hall_ir(reverb_s)
    tail = int(reverb_s * SR * 0.8)
    out = np.zeros(len(y) + tail + int(0.3 * SR))
    out[: len(y)] += y
    wetsig = np.convolve(y, ir)[: len(out)] * wet
    out[: len(wetsig)] += wetsig
    if echo:
        e = int(0.15 * SR)
        out[e: e + len(y)] += y * 0.16
    # 收尾淡出、峰值 -1.5 dB
    n = len(out)
    fade = int(0.25 * SR)
    out[n - fade:] *= np.linspace(1, 0, fade) ** 2
    out = out / (np.abs(out).max() + 1e-9) * 10 ** (-1.5 / 20)
    return out


def write_mp3(name, x):
    wav = os.path.join(OUT, f'{name}.wav')
    mp3 = os.path.join(OUT, f'{name}.mp3')
    sf.write(wav, x, SR)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(SR), '-codec:a', 'libmp3lame', '-b:a', '64k', mp3], check=True)
    os.remove(wav)
    return mp3


# ───────── 验收：机器听一遍 ─────────
import sherpa_onnx  # noqa: E402

# 用大一点的识别模型当裁判（小模型对一两个字的短句听得太不准）
ASR = os.path.join(MODEL_DIR, 'sherpa-onnx-paraformer-zh-2023-09-14')
rec = sherpa_onnx.OfflineRecognizer.from_paraformer(paraformer=f'{ASR}/model.int8.onnx', tokens=f'{ASR}/tokens.txt', num_threads=2, sample_rate=16000, feature_dim=80, decoding_method='greedy_search')


def heard(path):
    x, sr = sf.read(path)
    g = gcd(16000, sr)
    x = resample_poly(x, 16000 // g, sr // g)
    s = rec.create_stream()
    s.accept_waveform(16000, x.astype(np.float32))
    rec.decode_stream(s)
    return s.result.text


def pitch(path):
    x, sr = sf.read(path)
    fr = int(sr * 0.04)
    vals = []
    for i in range(0, len(x) - fr, fr // 2):
        w = x[i: i + fr] * np.hanning(fr)
        if np.sqrt(np.mean(w ** 2)) < 0.03:
            continue
        ac = np.correlate(w, w, 'full')[fr - 1:]
        lo, hi = int(sr / 400), int(sr / 55)
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.35 * ac[0]:
            vals.append(sr / k)
    return float(np.median(vals)) if vals else 0.0


def han(s):
    return ''.join(ch for ch in s if '一' <= ch <= '鿿')


def score(got, text):
    """听得多准：3 字都对；2 拼音连声调都对（同音字，棋/旗）；1 只是不带声调的拼音对（声调可能念歪了）；0 不对"""
    from pypinyin import Style, lazy_pinyin

    a, b = han(got), han(text)
    if a == b:
        return 3
    if lazy_pinyin(a, style=Style.TONE3) == lazy_pinyin(b, style=Style.TONE3):
        return 2
    if lazy_pinyin(a) == lazy_pinyin(b):
        return 1
    return 0


# 处理的几档：混响先重后轻——听得一样准的里头选最有气势（混响最足）的那一档；最后一档几乎是干声
# （混响长、湿声、回声、叠一层）
SHOUT_FX = [(1.3, 0.2, True, True), (1.2, 0.12, True, True), (1.2, 0.14, True, False), (1.0, 0.07, False, False), (0.8, 0.03, False, False)]
HERO_FX = [(2.0, 0.24, False, True), (1.8, 0.14, False, True), (1.8, 0.16, False, False), (1.4, 0.07, False, False)]


def main():
    report = {}
    bad = []
    run_jobs(report, bad)
    with open(os.path.join(OUT, 'report.json'), 'w') as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    if bad:
        print('识别对不上：', bad)
        sys.exit(1)


def run_jobs(report, bad):
    jobs = [(f'{g}-{k}', VOICES[g][0], cands, VOICES[g][1], SHOUT_FX) for g in VOICES for k, cands in SHOUTS.items()]
    jobs += [(f'hero-{k}', v, cands, semis, HERO_FX) for k, (v, cands, semis) in HEROES.items()]
    if ONLY:
        # 只补几句：别的录音不动，报告里原来的记录留着
        jobs = [j for j in jobs if j[0] in ONLY]
        with open(os.path.join(OUT, 'report.json')) as fh:
            report.update(json.load(fh))
    for name, voice, cands, semis, fxs in jobs:
        # 每种念法、每档处理都试一遍，留听得最准的（同样准，留排在前面的：念法靠前、混响足）
        best = None
        tries = [(voice, t, sp) for t, sp in cands] + ([(b, t, sp) for b in BACKUP[voice] for t, sp in cands] if name[0] in 'mf' and voice in BACKUP else [])
        for who, text, speed in tries:
            if best and best[0] >= 2 and who != voice:
                break  # 主嗓子已经念得准了，不用备用的
            raw = say(text, who, speed)
            for rv, wet, echo, dbl in fxs:
                x = process(raw, semis, rv, wet, echo, dbl)
                path = write_mp3(name, x)
                got = heard(path)
                sc = score(got, text)
                if sc and (best is None or sc > best[0]):
                    best = (sc, text, speed, wet, got, x, who)
                if sc == 3:
                    break
            if best and best[0] == 3:
                break
        if not best:
            print(f'✗ {name:16s} 试过 {len(cands)} 种念法都听不对（最后一次听成「{got}」）')
            bad.append(name)
            continue
        sc, text, speed, wet, got, x, who = best
        path = write_mp3(name, x)
        f = pitch(path)
        size = os.path.getsize(path)
        report[name] = {'text': text, 'voice': who, 'speed': speed, 'reverb': wet, 'heard': got, 'score': sc, 'f0': round(f), 'bytes': size}
        print(f'{"✓✓✓"[:sc]:3s} {name:16s} {text:14s} {who:12s} 语速 {speed} 混响 {wet:.2f} 听成「{got}」 基频 {f:4.0f}Hz {size // 1024}KB')


if __name__ == '__main__':
    main()
