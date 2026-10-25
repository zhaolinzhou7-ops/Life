"""
象棋配音：吃车、将军、绝杀（困毙）的喊声、终局一句，九位出场人物的开场白。

用户原话："出场、开局，以及吃子、将军、绝杀等关键节点，都要有浑厚的人声配音（男声或女声）……不要只有电子打击音。"
后来又说："声音呢，可以更加豪放一点，就是有那种杀气，不要软绵绵的，不管是男生还是女生……真正的是征战杀伐的那种感觉。"
还有："这个里面是居不是车啊"——象棋里"车"念 jū，喊的是"吃居"。

  1. 用 Kokoro（开源语音合成，Apache-2.0，自带普通话男声女声）念出来。"车"念 jū、"将"（斩将的将）念 jiàng：
     送进去之前换成同音字（居、匠），再查一遍注音器出来的音标；
  2. 处理成有杀气的喊（fierce）：
     - 嗓子"使劲"：整体抬高一两个半音（喊的时候音高本来就会往上走；原来往下压，听着沉，可是软），声调起伏不动
       （试过把起伏放大，"绝杀"的"杀"会被听成"上"）；共振峰可以压低一点，嗓子大一号；
     - 吼出来的粗：按基频的一半调幅，出次谐波（嘶吼的那种毛刺）；并联一路狠狠削波的失真混一点进来；
     - "顶"在前面：去掉低频的软、450Hz 的闷收一点、2.5~4k 的咬字推上去，齿音收一点；
     - 千军万马：再叠两三个人一起吼（错开十来二十毫秒、音高差十几二十音分）；
     - 压得密：快压缩把声音压实，再压一道峰（最响的几下压下去 10 dB），最后一道软削波——峰均比小、听着又密又响；
     - 短而硬的混响 + 一记山谷回声（原来一秒多的大殿混响，把人推远了）；
  3. 压成 MP3（单声道 24kHz），放进 src/xiangqi/voice/；
  4. 听不见声音，就让机器听：两个开源普通话识别（paraformer、SenseVoice）任一个听出的拼音对得上才收。
     混响、回声、叠声的尾巴会让识别器把"杀"听成"上"、"毙"听成"病"（人耳不会），所以按"干声"（嗓子处理完、
     还没加叠声和混响）判，成品的识别结果也记在 report.json 里。几档处理从狠到轻试，留最狠、还听得出的那一档。

准备（一次）：
  python3 -m venv venv && ./venv/bin/pip install kokoro-onnx "misaki[zh]" soundfile scipy sherpa-onnx praat-parselmouth pypinyin
  模型：github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{kokoro-v1.0.onnx,voices-v1.0.bin}
  识别：github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/ 下的
        sherpa-onnx-paraformer-zh-2023-09-14、sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17（解压到模型目录）
运行：
  ./venv/bin/python tools/gen-voice.py <模型所在目录> [只生成哪几句，逗号分开，如 m-win,hero-ziyi]
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

# 对局里的喊声：男声、女声各一套。每一句列几种念法（念的字、语速），都试一遍，留机器听得最准的。
# 只喊关键的几步（用户原话："不是每一步都要说话，就是关键的那几步，比如说吃车、将军、绝杀……开局也不用说开局"）。
# 念的字和屏幕上写的只差同音字：车念 jū，送进去的是"吃居"
# 语速快一点的排在前面：发怒的时候字是往外砸的，不拖
SHOUTS = {
    'jiangjun': [('将军！', 1.12), ('将军！', 1.05), ('将军！', 1.0)],
    'jiesha': [('绝杀！', 1.1), ('绝，杀！', 1.1), ('绝杀！', 1.0), ('绝，杀！', 1.0), ('绝杀！', 0.95)],
    'kunbi': [('困毙！', 1.1), ('困毙！', 1.0), ('困毙！', 0.95)],
    'chiche': [('吃居！', 1.12), ('吃，居！', 1.1), ('吃居！', 1.05), ('吃，居！', 1.0), ('吃居！', 1.0)],
    # 终局：赢了、输了、和了，说一句有江湖气的话（输了宽慰一句，"胜败乃兵家常事"）
    'win': [('大获全胜！', 1.1), ('大获全胜！', 1.0)],
    'lose': [('胜败乃兵家常事！', 1.08), ('胜败乃兵家常事！', 1.0)],
    'draw': [('握手言和！', 1.08), ('握手言和！', 1.0), ('握手，言和！', 1.0)],
}
# 男声：云健（几个男声里最低沉）；女声：晓晓（试的几个女声里每句都念得清楚）
VOICES = {'m': 'zm_yunjian', 'f': 'zf_xiaoxiao'}
# 某一句主嗓子怎么念机器都听不对，再换同一性别的备用嗓子
# （晓妮不用：声调跑得厉害，"炮已架好"机器听成"抛一家浩"）
BACKUP = {'zm_yunjian': ['zm_yunyang', 'zm_yunxia'], 'zf_xiaoxiao': ['zf_xiaoyi', 'zf_xiaobei']}

# 喊声怎么处理（fierce）：semis 抬几个半音、formant 共振峰乘几（小于 1 嗓子大一号、大于 1 更尖）、rng 声调起伏放大几倍、
# dur 时长乘几（小于 1 字更短更冲）、growl 次谐波调幅多深（吼的毛刺）、roar 压低一个八度的怒吼垫多响、
# dirt 削波的那一路混进来多少、drive 削得多狠、bite / bite_f 咬字那一段推几 dB、在哪、edge 6.5k 以上的锐（dB）、
# body 低频留几 dB、punch 字头砸多实、army 再叠几个人一起吼（晚几毫秒、差几音分、多响）、
# rv / wet 混响多长、多湿，echo 回声（晚几秒、多响）、limit 最后压峰压几 dB（越多越密越响）、clip 最后软削波多狠
# （男声削得最狠；女声的锐靠咬字和高频，削狠了"绝杀"会听不出来）。
# 用户原话："还是不够有力……所有的都需要增加力度，调到最大的力度……男生的那个铿锵的感觉，女生的那个尖锐的感觉，
# 男生的那种杀气、怒气"——男声：音高抬、胸腔大、字头砸实、怒吼的底、削得狠；女声：音高抬得更多、共振峰往上、4k 和 6.5k 以上推亮
SHOUT_PROF = {
    'm': dict(semis=3.5, formant=0.92, rng=1.25, dur=0.92, growl=0.45, roar=0.22, dirt=0.45, drive=8.0, bite=8.0, bite_f=2600, edge=-1.0, body=3.0,
              punch=0.8, army=[(11, 18, 0.45), (19, -22, 0.4), (27, 10, 0.3)], rv=0.6, wet=0.04, echo=(0.11, 0.07), limit=10.0, thr=-24.0, ratio=6.0, clip=4.0),
    'f': dict(semis=3.0, formant=1.02, rng=1.3, dur=0.92, growl=0.18, dirt=0.32, drive=7.0, bite=9.0, bite_f=3800, edge=4.0, body=-1.0,
              punch=0.8, army=[(10, 15, 0.35), (18, -18, 0.3)], rv=0.5, wet=0.04, echo=(0.1, 0.06), limit=10.0, thr=-24.0, ratio=6.0, clip=2.6),
}

# 个别喊声单独调（按"男/女-哪一句"）：绝杀不叠人、不加混响回声——一个人干脆利落地砸下去（叠人加混响的尾巴会把"杀"拖成"上"，
# 最狠那一档就听不出来了）；女声的绝杀再不放大起伏、不动共振峰（不然"绝"成了"介""缺"），别的照样拉满
SHOUT_OVERRIDE = {
    'm-jiesha': dict(army=[], wet=0.0, echo=(0.1, 0.0)),
    'f-jiesha': dict(army=[], wet=0.0, echo=(0.1, 0.0), rng=1.0, formant=1.0),
}


def max_force(prof, female):
    """出场人物的开场白也调到最大力度：在各自的嗓子上，统一再加一层（音高、起伏、语速、毛刺、削波、字头、压峰）"""
    p = dict(prof)
    p['semis'] = prof['semis'] + (2.0 if female else 1.5)
    p['formant'] = prof['formant'] * (1.02 if female else 0.97)
    p['rng'], p['dur'] = 1.2, 0.93
    p['growl'] = prof['growl'] * 1.4
    p['dirt'] = min(0.5, prof['dirt'] * 1.4)
    p['drive'] = 8.0
    p['bite'] = prof['bite'] + 2.5
    p['bite_f'] = 3800 if female else 2700
    p['edge'] = 3.0 if female else -1.0
    p['punch'] = 0.7
    p['roar'] = prof.get('roar', 0.0 if female else 0.15)
    p['limit'], p['thr'], p['ratio'], p['clip'] = 10.0, -24.0, 6.0, 3.2
    return p

# 几档：从狠到轻（音高、共振峰、起伏、毛刺、削波、咬字、字头、叠的人都往回收），留最狠、机器还听得出的那一档
LEVELS = [1.0, 0.85, 0.7, 0.55, 0.4]

# 出场人物的开场白：(嗓子, [(念的字, 语速)...], 处理)。屏幕上的字幕在 intro.ts，和这里只差同音字：
# 斩将的"将"念 jiàng（斩匠），落子念 luò zǐ（注音器按"落枕"的 lào 念，换成"落梓"）
# 用户原话："要有杀气，女的呢也要有特色……真正的是征战杀伐的那种感觉"
HEROES = {
    # 关公：最沉最大的嗓子，吼得最粗，身后叠两个亲兵
    'guangong': ('zm_yunyang', [('关某在此！鼠辈，谁敢与我一战！', 1.0), ('关某在此！鼠辈，谁敢与我一战！', 0.95)],
                 dict(semis=0.0, formant=0.9, growl=0.38, dirt=0.34, bite=5.5, body=3.0, roar=0.25, army=[(12, 16, 0.38), (21, -20, 0.3)], rv=0.9, wet=0.1, echo=(0.14, 0.12))),
    # 哪吒：少年音，亮、冲
    'nezha': ('zm_yunxia', [('哪吒在此！火尖枪下，片甲不留！', 1.0), ('哪吒在此！火尖枪下，片甲不留！', 1.05)],
              dict(semis=1.5, formant=1.0, growl=0.14, dirt=0.24, bite=5.0, body=1.0, army=[(10, 15, 0.3)], rv=0.6, wet=0.07, echo=(0.11, 0.08))),
    # 刀客：一人一刀，不叠人；嗓子哑、带刀口的毛刺，山谷回声
    'daoke': ('zm_yunjian', [('刀已出鞘，不见血，不回鞘！', 1.0), ('刀已出鞘，不见血，不回鞘！', 0.95)],
              dict(semis=0.5, formant=0.95, growl=0.3, dirt=0.3, bite=5.5, body=2.0, army=[], rv=0.8, wet=0.08, echo=(0.16, 0.12))),
    # 少帅：点兵——叠得最多（三军一起应）
    'shaoshuai': ('zm_yunxi', [('三军听令！过河，斩匠，夺帅旗！', 1.0), ('三军听令！过河，斩匠，夺帅旗！', 1.05)],
                  dict(semis=1.5, formant=0.95, growl=0.26, dirt=0.3, bite=6.0, body=2.0, army=[(11, 18, 0.42), (19, -22, 0.36), (27, 10, 0.3), (35, -12, 0.24)], rv=0.9, wet=0.1, echo=(0.15, 0.12))),
    # 红妆：脆、辣，带着笑
    'hongzhuang': ('zf_xiaobei', [('步步为营，步步见血！你的帅，本姑娘要定了！', 1.0), ('步步为营，步步见血！你的帅，本姑娘要定了！', 1.05)],
                   dict(semis=1.0, formant=1.0, growl=0.1, dirt=0.22, bite=5.5, body=0.5, army=[(10, 14, 0.26)], rv=0.6, wet=0.07, echo=(0.1, 0.08))),
    # 紫衣：和喊声同一副嗓子，压低一个半音、共振峰压一点——冷，像炮口
    'ziyi': ('zf_xiaoxiao', [('炮已架好！隔山，也取你帅首！', 1.0), ('炮已架好！隔山，也取你帅首！', 0.95)],
             dict(semis=-1.5, formant=0.95, growl=0.16, dirt=0.26, bite=5.0, body=1.0, army=[(10, 14, 0.26)], rv=0.7, wet=0.08, echo=(0.13, 0.1))),
    # 玄衣：沉、冷，一个人
    'xuanyi': ('zm_yunjian', [('落梓无悔！这一局，我要你满盘皆输！', 1.0), ('落梓无悔！这一局，我要你满盘皆输！', 0.95)],
               dict(semis=-0.5, formant=0.92, growl=0.24, dirt=0.26, bite=5.0, body=2.5, army=[], rv=0.9, wet=0.09, echo=(0.18, 0.1))),
    # 素衣：笑着说的狠话——毛刺最少，咬字最清楚
    'suyi': ('zf_xiaoyi', [('莫看我笑！取你性命，只需一手！', 1.0), ('莫看我笑！取你性命，只需一手！', 0.95)],
             dict(semis=0.0, formant=1.0, growl=0.06, dirt=0.18, bite=4.5, body=0.5, army=[], rv=0.7, wet=0.08, echo=(0.14, 0.08))),
    # 墨客：书生的冷，远山的回声长一点
    'moke': ('zm_yunyang', [('行云流水，杀人不见血。请落梓！', 1.0), ('行云流水，杀人不见血。请落梓！', 0.95)],
             dict(semis=1.0, formant=1.0, growl=0.12, dirt=0.2, bite=4.5, body=1.5, army=[], rv=1.0, wet=0.1, echo=(0.2, 0.1))),
}
# 念的字里换过的同音字：查注音器出来的音标，确实是这个音才念（"斩匠"的匠 jiàng、"吃居"的居 jū）
MUST = {'居': 'ʨy→', '匠': 'ʨja↘ŋ', '鞘': 'ʨʰjau↘', '帅': 'ʂwai↘', '落': 'lwo↘', '梓': 'ʦɨ↓'}


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
    elif kind == 'highshelf':
        b = [A * ((A + 1) + (A - 1) * cw + 2 * np.sqrt(A) * alpha), -2 * A * ((A - 1) + (A + 1) * cw), A * ((A + 1) + (A - 1) * cw - 2 * np.sqrt(A) * alpha)]
        a = [(A + 1) - (A - 1) * cw + 2 * np.sqrt(A) * alpha, 2 * ((A - 1) - (A + 1) * cw), (A + 1) - (A - 1) * cw - 2 * np.sqrt(A) * alpha]
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
    """平平地念（报着法用，gen-announce.py）：降一点音高、低频加厚、可选叠一层、混响"""
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


import parselmouth  # noqa: E402
from parselmouth.praat import call  # noqa: E402


def trim(x, th=0.01):
    """去掉头尾的静音。开头多留 40 毫秒："吃"的送气（ch）开头很轻，切狠了就成了“诗”"""
    x = x / (np.abs(x).max() + 1e-9)
    idx = np.where(np.abs(x) > th)[0]
    return x[max(0, idx[0] - int(0.04 * SR)): idx[-1] + int(0.05 * SR)]


def median_f0(s):
    f = s.to_pitch(time_step=0.01, pitch_floor=70, pitch_ceiling=500).selected_array['frequency']
    f = f[f > 0]
    return float(np.median(f)) if len(f) else 150.0


def effort(x, semis, formant, rng=1.0, dur=1.0):
    """嗓子使劲：抬 semis 个半音、声调起伏放大 rng 倍、共振峰乘 formant、时长乘 dur（Praat 的 Change gender）"""
    s = parselmouth.Sound(x, SR)
    return call(s, 'Change gender', 70, 500, formant, median_f0(s) * 2 ** (semis / 12), rng, dur).values[0].astype(np.float64)


def onepole(x, tau):
    a = np.exp(-1 / (tau * SR))
    return lfilter([1 - a], [1, -a], x)


def punch(x, amount):
    """字头砸实（铿锵）：每个字一起头那二三十毫秒，快包络比慢包络高出来的那一截放大"""
    if amount <= 0:
        return x
    a = np.abs(x)
    g = np.clip((onepole(a, 0.001) / (onepole(a, 0.04) + 1e-6)) ** amount, 1.0, 3.0)
    return x * onepole(g, 0.003)


def roar(x, gain):
    """怒吼的底：同一句压低一个八度（共振峰不动）垫在下面"""
    if gain <= 0:
        return x
    s = parselmouth.Sound(x, SR)
    low = call(s, 'Change gender', 70, 500, 1.0, median_f0(s) * 0.5, 1.0, 1.0).values[0].astype(np.float64)
    out = x.copy()
    n = min(len(x), len(low))
    out[:n] += low[:n] * gain
    return out


def growl(x, depth):
    """吼出来的粗：按基频的一半调幅，出次谐波"""
    if depth <= 0:
        return x
    p = parselmouth.Sound(x, SR).to_pitch(time_step=0.005, pitch_floor=70, pitch_ceiling=500)
    t = np.arange(len(x)) / SR
    fv = p.selected_array['frequency']
    f = np.interp(t, p.xs(), fv)
    voiced = np.interp(t, p.xs(), (fv > 0).astype(float))
    return x * (1 + depth * voiced * np.cos(np.cumsum(f / 2 / SR) * 2 * np.pi))


def compress(x, thr_db=-20.0, ratio=5.0, att=0.002, rel=0.08):
    """快压缩：把声音压实（峰均比小、听着响）"""
    thr = 10 ** (thr_db / 20)
    a_a, a_r = np.exp(-1 / (att * SR)), np.exp(-1 / (rel * SR))
    env = 0.0
    g = np.empty_like(x)
    for i, v in enumerate(np.abs(x)):
        env = a_a * env + (1 - a_a) * v if v > env else a_r * env + (1 - a_r) * v
        g[i] = 1.0 if env <= thr else (thr * (env / thr) ** (1 / ratio)) / env
    return x * g


def limit(x, cut_db=6.0, look=0.002, rel=0.06):
    """压峰：把最响的那几下压下去 cut_db（先看 2 毫秒，峰来之前就压好），整体就能再推响一截——喊声又密又响"""
    thr = 10 ** (-cut_db / 20) * np.abs(x).max()
    n = int(look * SR)
    pk = np.abs(x)
    # 往前看 n 个样本里的最大值
    ahead = np.maximum.reduce([np.concatenate([pk[i:], np.zeros(i)]) for i in range(n + 1)])
    want = np.minimum(1.0, thr / np.maximum(ahead, 1e-9))
    a_r = np.exp(-1 / (rel * SR))
    g = np.empty_like(x)
    cur = 1.0
    for i, w in enumerate(want):
        cur = w if w < cur else a_r * cur + (1 - a_r) * w
        g[i] = cur
    return x * g


def fierce(raw, prof, level=1.0):
    """喊出杀气（见文件头）。返回（成品，干声）：干声是嗓子处理完、还没叠人、没加混响回声的那一版，给机器听。
    level 从 1 往下退时，起伏、毛刺、削波、咬字、字头、怒吼的底、叠的人一起往回收"""
    rng = 1 + (prof.get('rng', 1.0) - 1) * level
    formant = 1 + (prof['formant'] - 1) * level
    semis = prof['semis'] * (0.6 + 0.4 * level)
    x = trim(effort(trim(raw), semis, formant, rng, prof.get('dur', 1.0)))
    x = growl(x, prof['growl'] * level)
    x = roar(x, prof.get('roar', 0.0) * level)
    x = eq(x, 'highpass', 95)
    x = eq(x, 'lowshelf', 160, prof['body'])
    x = eq(x, 'peak', 450, -2.5, 1.0)
    x = eq(x, 'peak', prof.get('bite_f', 3000), prof['bite'] * (0.4 + 0.6 * level), 0.8)
    x = eq(x, 'highshelf', 6500, prof.get('edge', -3.0))
    x = x / (np.abs(x).max() + 1e-9)
    drive = prof.get('drive', 5.0)
    hard = eq(np.tanh(drive * x) / np.tanh(drive), 'lowpass', 7000)
    dirt = prof['dirt'] * level
    x = (1 - dirt) * x + dirt * hard
    x = punch(x, prof.get('punch', 0.0) * level)
    dry = x / (np.abs(x).max() + 1e-9)
    y = np.zeros(len(x) + int(0.06 * SR))
    y[: len(x)] += x
    for d_ms, cents, gain in prof['army']:
        v = repitch(x, -cents / 100)
        d = int(d_ms / 1000 * SR)
        n = min(len(v), len(y) - d)
        y[d: d + n] += v[:n] * gain * level
    y = compress(y / (np.abs(y).max() + 1e-9), prof.get('thr', -20.0), prof.get('ratio', 5.0))
    y = y / (np.abs(y).max() + 1e-9)
    # 短而硬的混响（干声在前、晚 25 毫秒才进来）+ 一记回声
    ir = hall_ir(prof['rv'])
    pre = int(0.025 * SR)
    out = np.zeros(len(y) + int(prof['rv'] * SR) + int(0.35 * SR))
    out[: len(y)] += y
    wet = np.convolve(y, ir)[: len(out) - pre] * prof['wet']
    out[pre: pre + len(wet)] += wet
    e = int(prof['echo'][0] * SR)
    out[e: e + len(y)] += y * prof['echo'][1]
    n = len(out)
    fade = int(0.2 * SR)
    out[n - fade:] *= np.linspace(1, 0, fade) ** 2
    out = limit(out, prof.get('limit', 6.0))
    # 最后一道软削波：峰再削掉一截、整体推到最响，顺带一点砂砾感
    clip = 1 + (prof.get('clip', 1.0) - 1) * level
    if clip > 1.01:
        out = out / (np.abs(out).max() + 1e-9)
        out = np.tanh(clip * out) / np.tanh(clip)
    return out / (np.abs(out).max() + 1e-9) * 10 ** (-0.5 / 20), dry


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


SV = os.path.join(MODEL_DIR, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')
rec2 = sherpa_onnx.OfflineRecognizer.from_sense_voice(model=f'{SV}/model.int8.onnx', tokens=f'{SV}/tokens.txt', num_threads=2, use_itn=False, language='zh')


def hear2(x):
    """两个识别器各听一遍（前后垫一点静音、音量拉齐）"""
    g = gcd(16000, SR)
    y = resample_poly(x, 16000 // g, SR // g)
    y = np.concatenate([np.zeros(3200), y / (np.abs(y).max() + 1e-9) * 0.7, np.zeros(4800)]).astype(np.float32)
    got = []
    for r in (rec, rec2):
        st = r.create_stream()
        st.accept_waveform(16000, y)
        r.decode_stream(st)
        got.append(han(st.result.text))
    return got


def accuracy(got, text):
    """听出来的拼音（不带声调）和原句的拼音对上几成：1 - 编辑距离 / 原句音节数"""
    from pypinyin import lazy_pinyin

    a, b = lazy_pinyin(got), lazy_pinyin(han(text))
    dp = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, len(b) + 1):
            cur = dp[j]
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return max(0.0, 1 - dp[len(b)] / max(1, len(b)))


def tones(got, text):
    """声调也对上几成（逐个音节比，带声调）"""
    from pypinyin import Style, lazy_pinyin

    a, b = lazy_pinyin(got, style=Style.TONE3), lazy_pinyin(han(text), style=Style.TONE3)
    return sum(x == y for x, y in zip(a, b)) / max(1, len(b))


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


def check_reading(text):
    """换过同音字的地方，注音器真念成了那个音"""
    ph = g2p(text)
    return [ch for ch, want in MUST.items() if ch in text and want not in ph]


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
    jobs = [(f'{g}-{k}', VOICES[g], cands, {**SHOUT_PROF[g], **SHOUT_OVERRIDE.get(f'{g}-{k}', {})}, 1.0) for g in VOICES for k, cands in SHOUTS.items()]
    # 开场白长：十几个音节里错一两个（识别器没学过"鼠辈""帅首"这种词）也算听得出
    jobs += [(f'hero-{k}', v, cands, max_force(prof, v.startswith('zf')), 0.85) for k, (v, cands, prof) in HEROES.items()]
    if ONLY:
        # 只补几句：别的录音不动，报告里原来的记录留着
        jobs = [j for j in jobs if j[0] in ONLY]
        with open(os.path.join(OUT, 'report.json')) as fh:
            report.update(json.load(fh))
    for name, voice, cands, prof, need in jobs:
        for text, _ in cands:
            wrong = check_reading(text)
            if wrong:
                print(f'✗ {name} {text}：{"、".join(wrong)}念错了：{g2p(text)}')
                bad.append(name)
        # 主嗓子先试；每一档从狠到轻，这一档所有念法里挑听得最准的，够准就收（不再往轻里退）。
        # 够准：干声的拼音对上 need 成，成品（叠了人、加了混响）也至少对上一半；同样准，声调对得多的优先
        voices = [voice] + (BACKUP.get(voice, []) if name[0] in 'mf' else [])
        best = None
        raws = {}
        for who in voices:
            for level in LEVELS:
                for text, speed in cands:
                    raw = raws.setdefault((who, text, speed), say(text, who, speed))
                    x, dry = fierce(raw, prof, level)
                    got, fin = hear2(dry), hear2(x)
                    acc = max(accuracy(gg, text) for gg in got)
                    acc_f = max(accuracy(gg, text) for gg in fin)
                    tone = max(tones(gg, text) for gg in got + fin)
                    good = acc >= need and acc_f >= min(need, 0.5)
                    key = (good, acc + 0.5 * acc_f, tone)
                    if best is None or key > best[0]:
                        best = (key, acc, who, text, speed, level, got, fin, x, tone)
                if best[0][0]:
                    break
            if best[0][0]:
                break
        _, acc, who, text, speed, level, got, final, x, tone = best
        path = write_mp3(name, x)
        f = pitch(path)
        size = os.path.getsize(path)
        dur = round(len(x) / SR, 2)
        report[name] = {'text': text, 'voice': who, 'speed': speed, 'level': level, 'heard_dry': got, 'heard_final': final, 'acc': round(acc, 2), 'tone': round(tone, 2), 'f0': round(f), 'sec': dur, 'bytes': size}
        ok = best[0][0]
        mark = '✓' if ok else '✗'
        if not ok:
            bad.append(name)
        print(f'{mark} {name:16s} {text:22s} {who:12s} 语速 {speed} 第 {LEVELS.index(level) + 1} 档 干声听成「{"／".join(got)}」成品「{"／".join(final)}」 准 {acc:.2f} 声调 {tone:.2f} 基频 {f:4.0f}Hz {dur}s {size // 1024}KB', flush=True)


if __name__ == '__main__':
    main()
