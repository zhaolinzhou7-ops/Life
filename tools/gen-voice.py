"""
象棋配音：吃车、将军、绝杀（困毙）的喊声、终局一句，九位出场人物的开场白。

用户原话："出场、开局，以及吃子、将军、绝杀等关键节点，都要有浑厚的人声配音（男声或女声）……不要只有电子打击音。"
"这个里面是居不是车啊"——象棋里"车"念 jū，喊的是"吃居"。
上一版（调到最大力度：削波、嘶吼的毛刺、叠三个人一起吼、压得很密）之后，用户说：
"声音没有灵魂、没感觉，而且还有点吵，再试试其他办法，看看能不能提升一下声音的质感和层次感。"
——吵就是那一套失真、削波、叠人、狠压缩带来的：毛刺和削波是噪声，叠人的相位互相抵消、听着发虚，压到又密又响就没了起伏。

这一版换了路子：
  1. 嗓子：换成 Kokoro v1.1-zh（Apache-2.0）。v1.0 只有八个普通话嗓子，念得平；v1.1 是专门拿普通话数据再训练的，
     一百个嗓子。先让每个嗓子念同样几句，量**抑扬**（基频起伏几个半音）、**力度起伏**、两个识别器听得准不准，
     按人物挑（关公要最沉的、哪吒要少年的……），每一句再在几个嗓子、几种语速里挑：听得准的里面，抑扬最大的那一条——
     有起伏、有轻重才有"感情"；
  2. 人声本身只做干净的处理：去掉超低频、胸腔加一点暖、400Hz 的闷收一点、3k 左右的字头往前提、齿音收一点、
     9k 以上加一点"空气"；并联一路很轻的饱和（添谐波，不是失真）；慢起音的温和压缩（只压三五 dB，字头留着）。
     不削波、不叠人、不加毛刺；
  3. 层次靠"空间"：人声在正中、干净，后面是立体声的空间——左右不同的早期反射（房间的大小）、预延迟之后的混响尾
     （左右两路不相关，所以是"宽"的；只送中高频进去，不糊），有的人物再加一记左右来回的山谷回声。
     每个人物一个空间：关公、少帅在大殿，刀客在山谷，墨客、素衣在竹林，玄衣、紫衣在夜里……
  4. 响度：有声段拉到同一个响度（-17 dBFS 左右，约 -16 LUFS），峰值留 1.5 dB 余量。上一版是 -6 LUFS、峰值 +3.7 dB
     （压成 MP3 以后已经过了满刻度，一放就削波）——比现在响十来 dB，又全是削波的毛刺；
  5. 压成立体声 MP3，放进 src/xiangqi/voice/；
  6. 听不见声音，就让机器听：两个开源普通话识别（paraformer、SenseVoice）任一个听出的拼音对得上才收（按成品听）。

又一轮，用户原话："声音感觉不像真正的中国人说普通话，像外国人说中国话一样，比如'开局'、'吃车'、'将军'这些发音都不太对。"
——是上一轮换的 Kokoro v1.1 带来的：量了它全部 46 个男声，念"将军"第二个字都往下掉（一声该是平的），
v1.0 的云健、云扬念得平；用中国播音员录音训练的标贝（Matcha）也平。上一轮还把抑扬放大了一成、专挑起伏最大的念法、
在字中间加停顿（"吃，居""绝，杀"），都会把声调带歪。现在：
  - 男声回到 Kokoro v1.0 的云健（喊声）、云扬、云夏（人物）——前几轮用的就是它们，没人说过像外国人；
    云希这次量出来"将军"也往下掉，不用；
  - 女声换成标贝：sherpa-onnx 的 matcha-icefall-zh-baker（标贝中文标准女声音库训练，中国专业播音员录的）；
  - 不再动抑扬（只按人物整体抬或压一两个半音，声调形状不变）、不在字中间加停顿、"将军"照常写；
  - 每句几种语速里挑：机器听得准的里面，声调形状对得多的（tone_shape：按字切开看音高走向——一声平、二声升、三声低、四声降）；
  - 处理链（干净的人声 + 立体声空间）照旧。

准备（一次）：
  python3 -m venv venv && ./venv/bin/pip install kokoro-onnx "misaki[zh]" soundfile scipy sherpa-onnx praat-parselmouth pypinyin jieba
  男声（报着法 gen-announce.py 也用）：github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/{kokoro-v1.0.onnx,voices-v1.0.bin}
  女声：github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-zh-baker.tar.bz2（解压到模型目录），
        声码器 github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx（放在模型目录）
  识别：github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/ 下的
        sherpa-onnx-paraformer-zh-2023-09-14、sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17（解压到模型目录）
运行：
  ./venv/bin/python tools/gen-voice.py <模型所在目录> [只生成哪几句，逗号分开，如 m-win,hero-ziyi-1]
"""
import json
import os
import subprocess
import sys
from math import gcd

import numpy as np
import sherpa_onnx
import soundfile as sf
from scipy.signal import fftconvolve, lfilter, resample_poly

MODEL_DIR = sys.argv[1] if len(sys.argv) > 1 else '.'
ONLY = set(sys.argv[2].split(',')) if len(sys.argv) > 2 else None
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'xiangqi', 'voice')
os.makedirs(OUT, exist_ok=True)
SR = 24000

# 对局里的喊声：男声、女声各一套。每一句列几种语速，都试一遍。
# 只喊关键的几步（用户原话："不是每一步都要说话，就是关键的那几步，比如说吃车、将军、绝杀……开局也不用说开局"）。
# 念的字和屏幕上写的只差同音字：车念 jū，送进去的是"吃居"。别的照常写（上一轮的"将君""吃，居"这类改字、加停顿都去掉了）
SHOUTS = {
    'jiangjun': [('将军！', 1.0), ('将军！', 1.08), ('将军！', 0.94)],
    'jiesha': [('绝杀！', 1.0), ('绝杀！', 1.08), ('绝杀！', 0.94)],
    'kunbi': [('困毙！', 1.0), ('困毙！', 1.08), ('困毙！', 0.94)],
    'chiche': [('吃居！', 1.0), ('吃居！', 1.08), ('吃居！', 0.94)],
    # 终局：赢了、输了、和了，说一句有江湖气的话（输了宽慰一句，"胜败乃兵家常事"）
    'win': [('大获全胜！', 1.0), ('大获全胜！', 0.94)],
    'lose': [('胜败乃兵家常事！', 1.0), ('胜败乃兵家常事！', 0.94)],
    'draw': [('握手言和！', 1.0), ('握手言和！', 0.94)],
    # 终局每样再多两句，结果页随机挑一句（xqvoice 按"-2""-3"找）
    'win-2': [('胜负已分！', 1.0), ('胜负已分！', 0.94)],
    'win-3': [('痛快！再来！', 1.0), ('痛快！再来！', 0.94)],
    'lose-2': [('卷土重来，再战！', 1.0), ('卷土重来，再战！', 0.94)],
    'lose-3': [('这一盘，我记下了！', 1.0), ('这一盘，我记下了！', 0.94)],
    'draw-2': [('平分秋色！', 1.0), ('平分秋色！', 0.94)],
    'draw-3': [('棋逢对手！', 1.0), ('棋逢对手！', 0.94)],
}

# 嗓子：'baker' 是标贝女声，别的是 Kokoro v1.0 的嗓子名。头一个是主嗓子，一整套喊声都用它（同一个人喊）；
# 它哪一句怎么念机器都听不对，才换后面的
CAST = {'m': ['zm_yunjian', 'zm_yunyang'], 'f': ['baker', 'zf_xiaoyi']}

# 人声怎么修（都是轻的）：body 胸腔那一段（160Hz）加几 dB、mud 380Hz 收几 dB、pres / pres_f 字头往前提几 dB、在哪、
# air 9k 以上的空气、sat 并联饱和混多少（添一点谐波，听着"实"，不是失真）、
# semis 整句抬（压）几个半音（人物之间听得出不同；只挪高低，声调的形状不动——不再放大抑扬）
TONE = {
    'm': dict(body=2.0, mud=-2.0, pres=2.5, pres_f=2800, air=1.5, sat=0.22, semis=0.0),
    'f': dict(body=0.5, mud=-1.5, pres=2.0, pres_f=3400, air=2.0, sat=0.15, semis=0.0),
}

# 空间：rv 混响尾多长（秒）、pre 预延迟（人声先到，混响晚一点才来——人声清楚、空间又大）、wet 混响多响、
# lp 混响尾的高频截到哪（越低越暗、越远）、er 早期反射多响（房间感）、echo 左右来回的回声（晚几秒，多响）
SPACES = {
    'court': dict(rv=1.1, pre=0.03, wet=0.17, lp=5200, er=0.2, echo=None),  # 对局的喊声：一间敞亮的厅
    'hall': dict(rv=2.1, pre=0.045, wet=0.22, lp=4300, er=0.22, echo=None),  # 大殿
    'valley': dict(rv=1.5, pre=0.04, wet=0.15, lp=3800, er=0.12, echo=(0.34, 0.22)),  # 山谷
    'night': dict(rv=1.7, pre=0.05, wet=0.2, lp=3300, er=0.14, echo=None),  # 夜里，暗
    'sky': dict(rv=1.3, pre=0.025, wet=0.16, lp=6500, er=0.2, echo=(0.2, 0.12)),  # 天上，亮
    'garden': dict(rv=0.9, pre=0.02, wet=0.14, lp=6000, er=0.2, echo=None),  # 院子
    'forest': dict(rv=1.3, pre=0.035, wet=0.17, lp=5200, er=0.15, echo=(0.27, 0.12)),  # 竹林
}

# 出场人物的开场白：(男/女, 嗓子, [念的字（五句，出场时随机挑一句）], 人声的修法（在男/女的基础上改几项）, 空间)。
# 屏幕上的字幕在 intro.ts，和这里只差同音字——
# 注音器按日常读法念错的几个字：车念 jū（居），斩将、是将的将念 jiàng（匠），落子念 luò zǐ（落梓；"落下"念成 là，换"洛"），
# 降者免死的降念 xiáng（翔），墨未干的干念 gān（甘），隔子打子的子带上声调（梓）。
# 用户原话："要有杀气，女的呢也要有特色……真正的是征战杀伐的那种感觉"；"出场动画和人物台词再多一些，随机台词"
HEROES = {
    # 关公：最沉最稳，大殿
    'guangong': ('m', ['zm_yunyang', 'zm_yunjian'], ['关某在此！鼠辈，谁敢与我一战！', '青龙偃月刀下，从无活口！', '过五关，斩六匠，岂惧你一盘棋！', '吾观你，不过插标卖首之辈！', '赤兔追风，取你帅首，易如反掌！'],
                 dict(body=3.0, semis=-1.0), 'hall'),
    # 哪吒：少年音，亮、冲，天上
    'nezha': ('m', ['zm_yunxia', 'zm_yunyang'], ['哪吒在此！火尖枪下，片甲不留！', '风火轮起，烧你个满盘皆空！', '小爷来也！谁敢接我三枪！', '乾坤圈出，管你是帅是匠，统统砸烂！', '混天绫一卷，你的帅，跑不掉！'],
              dict(body=1.0, air=2.5, semis=1.0), 'sky'),
    # 刀客：一人一刀，山谷回声
    'daoke': ('m', ['zm_yunjian', 'zm_yunyang'], ['刀已出鞘，不见血，不回鞘！', '一人一刀，斩尽这一局！', '江湖路远，你的帅，今日留下！', '我的刀，只问输赢，不问生死！', '落梓如刀，一步，便是一命！'],
              dict(body=2.5, sat=0.3), 'valley'),
    # 少帅：点兵，大殿
    'shaoshuai': ('m', ['zm_yunxia', 'zm_yunjian'], ['三军听令！过河，斩匠，夺帅旗！', '擂鼓！列阵！今日踏平你的九宫！', '居马炮齐出，一个不留！', '兵临城下，翔者免死！', '我的兵，只进不退！'],
                  dict(body=2.0, pres=3.0, semis=-0.5), 'hall'),
    # 红妆：脆、辣，带着笑，院子
    'hongzhuang': ('f', ['baker', 'zf_xiaoyi'], ['步步为营，步步见血！你的帅，本姑娘要定了！', '红妆上阵，不让须眉！接招！', '别眨眼！我红妆出手，绝不留情！', '哭也没用，这一盘，你输定了！', '胭脂是红的，血也是红的！'],
                   dict(pres=2.5, semis=1.0), 'garden'),
    # 紫衣：冷，像炮口，夜里
    'ziyi': ('f', ['baker', 'zf_xiaoyi'], ['炮已架好！隔山，也取你帅首！', '一炮定乾坤，你躲不过！', '炮声一响，寸草不生！', '隔梓打梓，专打你的心窝！', '点火！送你的帅，上路！'],
             dict(body=1.0, air=1.5, semis=-1.5), 'night'),
    # 玄衣：沉、冷，夜里
    'xuanyi': ('m', ['zm_yunjian', 'zm_yunyang'], ['落梓无悔！这一局，我要你满盘皆输！', '一梓洛下，生死已定！', '你走的每一步，都在我算中！', '黑云压城，这一局，没有活路！', '算你十步，杀你一步！'],
               dict(body=2.5, air=1.0, semis=-1.0), 'night'),
    # 素衣：笑着说的狠话，竹林
    'suyi': ('f', ['baker', 'zf_xiaoyi'], ['莫看我笑！取你性命，只需一手！', '花开一季，你的帅，撑不过一盘！', '别怕，很快就结束了！', '我笑一次，就有人输一次！', '梨花落尽，胜负已分！'],
             dict(), 'forest'),
    # 墨客：书生的冷，竹林里远远的回声
    'moke': ('m', ['zm_yunyang', 'zm_yunjian'], ['行云流水，杀人不见血。请落梓！', '一笔一画，皆是杀机！', '胜负？我早已写好了！', '墨未甘，你已败！', '风雪千里，只为斩你一局！'],
             dict(body=1.5, semis=0.5), 'forest'),
}
# 念的字里换过的同音字：查注音（Kokoro 是 misaki 的音标，标贝是分词以后查它的词典）这个字确实是这个音才念
# （"斩匠"的匠 jiàng、"吃居"的居 jū、"落梓"的落 luò——标贝词典里"落子"是 lào zǐ）
MUST_K10 = {'居': 'ʨy→', '匠': 'ʨja↘ŋ', '鞘': 'ʨʰjau↘', '帅': 'ʂwai↘', '落': 'lwo↘', '梓': 'ʦɨ↓', '洛': 'lwo↘', '翔': 'ɕja↗ŋ', '甘': 'ka→n'}
MUST_BAKER = {'居': 'ju1', '匠': 'jiang4', '鞘': 'qiao4', '帅': 'shuai4', '落': 'luo4', '梓': 'zi3', '洛': 'luo4', '翔': 'xiang2', '甘': 'gan1'}


# ───────── 合成（报着法 gen-announce.py 还用 v1.0：say、g2p） ─────────
from kokoro_onnx import Kokoro  # noqa: E402
from misaki import zh  # noqa: E402

kokoro = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))
g2p = zh.ZHG2P()


def say(text, voice, speed):
    x, sr = kokoro.create(g2p(text), voice=voice, speed=speed, is_phonemes=True)
    assert sr == SR
    return np.asarray(x, dtype=np.float64)


BAKER = os.path.join(MODEL_DIR, 'matcha-icefall-zh-baker')
_baker = None


def say_baker(text, speed):
    """标贝女声（Matcha + vocos 声码器，22.05kHz）念一句，换成 24kHz"""
    global _baker
    if _baker is None:
        D = BAKER
        m = sherpa_onnx.OfflineTtsMatchaModelConfig(acoustic_model=f'{D}/model-steps-3.onnx', vocoder=os.path.join(MODEL_DIR, 'vocos-22khz-univ.onnx'),
                                                   lexicon=f'{D}/lexicon.txt', tokens=f'{D}/tokens.txt', dict_dir=f'{D}/dict')
        rules = ','.join(f'{D}/{f}' for f in ('date.fst', 'phone.fst', 'number.fst') if os.path.exists(f'{D}/{f}'))
        _baker = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(matcha=m, num_threads=2), rule_fsts=rules, max_num_sentences=1))
    a = _baker.generate(text, sid=0, speed=speed)
    x = np.asarray(a.samples, dtype=np.float64)
    g = gcd(SR, a.sample_rate)
    return resample_poly(x, SR // g, a.sample_rate // g)


def speak(voice, text, speed):
    """按嗓子名念：'baker' 是标贝，别的是 Kokoro v1.0"""
    return say_baker(text, speed) if voice == 'baker' else say(text, voice, speed)


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


def look_limit(x, ceiling, look=0.003, rel=0.08):
    """立体声压峰：两路一起压（左右的最大值），先看 3 毫秒，峰来之前就压好；只用在超了余量的那几下"""
    pk = np.abs(x).max(axis=1)
    n = int(look * SR)
    ahead = np.maximum.reduce([np.concatenate([pk[i:], np.zeros(i)]) for i in range(n + 1)])
    want = np.minimum(1.0, ceiling / np.maximum(ahead, 1e-9))
    a_r = np.exp(-1 / (rel * SR))
    g = np.empty_like(pk)
    cur = 1.0
    for i, w in enumerate(want):
        cur = w if w < cur else a_r * cur + (1 - a_r) * w
        g[i] = cur
    return x * g[:, None]


def room(seconds, lp, seed=11):
    """立体声的空间：左右各自的早期反射（错开几毫秒，房间的大小）+ 指数衰减的噪声尾。
    两路尾巴用不同的噪声，互不相关——听着是"宽"的，人声还在正中"""
    taps = ([(0.009, 0.5), (0.017, 0.36), (0.031, 0.28), (0.047, 0.2), (0.071, 0.14)],
            [(0.012, 0.46), (0.023, 0.34), (0.037, 0.25), (0.055, 0.18), (0.083, 0.12)])
    out = []
    for ch in range(2):
        rng = np.random.default_rng(seed + ch * 101)
        n = int(SR * seconds)
        t = np.arange(n) / SR
        tail = rng.standard_normal(n) * np.exp(-t * 6.9 / seconds)
        # 越往后越暗：前半截和低通过的混，后面只剩低通过的
        dark = eq(tail, 'lowpass', lp * 0.55)
        k = np.clip(t / (seconds * 0.5), 0, 1)
        tail = eq(tail, 'lowpass', lp) * (1 - k) + dark * k
        # 尾巴慢慢起来（20 毫秒），先让早期反射过去
        tail *= np.clip(t / 0.02, 0, 1)
        out.append((tail / np.sqrt(np.sum(tail ** 2)), taps[ch]))
    return out


def loudness(x):
    """有声段的响度（dBFS）：20 毫秒一帧，比最响一帧低 30 dB 以内的帧取平均功率"""
    m = x if x.ndim == 1 else x.mean(axis=1)
    fr = int(0.02 * SR)
    e = np.array([np.mean(m[i: i + fr] ** 2) for i in range(0, len(m) - fr, fr)]) + 1e-12
    db = 10 * np.log10(e)
    return float(10 * np.log10(np.mean(e[db > db.max() - 30])))


def voice_fx(raw, tone, space, target=-17.0):
    """干净的人声 + 立体声的空间（见文件头）。返回（成品 N×2，干声）"""
    x = trim(raw)
    # 人物之间整句抬或压一两个半音（Praat：抑扬、共振峰、语速都不动，声调的形状不变）
    if abs(tone.get('semis', 0.0)) > 0.05:
        x = trim(effort(x, tone['semis'], 1.0, 1.0, 1.0))
    x = eq(x, 'highpass', 75)
    x = eq(x, 'lowshelf', 160, tone['body'])
    x = eq(x, 'peak', 380, tone['mud'], 1.0)
    x = eq(x, 'peak', tone['pres_f'], tone['pres'], 0.9)
    x = eq(x, 'peak', 6800, -2.0, 2.0)
    x = eq(x, 'highshelf', 9000, tone['air'])
    x = x / (np.abs(x).max() + 1e-9)
    s = tone['sat']
    x = (1 - s) * x + s * np.tanh(1.8 * x) / np.tanh(1.8)
    # 温和压缩：起音 12 毫秒（字头先过去再压）、2.5 比 1，只压三五 dB
    x = compress(x / (np.abs(x).max() + 1e-9), -18.0, 2.5, 0.012, 0.15)
    dry = x / (np.abs(x).max() + 1e-9)

    sp = SPACES[space]
    echo = sp['echo']
    n = len(dry) + int((sp['rv'] + sp['pre'] + 0.25 + (echo[0] * 2 if echo else 0)) * SR)
    out = np.zeros((n, 2))
    out[: len(dry), 0] += dry
    out[: len(dry), 1] += dry
    # 只送中高频进空间：低频进混响就糊了
    send = eq(eq(dry, 'highpass', 300), 'lowpass', 7000)
    pre = int(sp['pre'] * SR)
    for ch, (tail, taps) in enumerate(room(sp['rv'], sp['lp'])):
        for d, a in taps:
            k = int(d * SR)
            out[k: k + len(send), ch] += send * a * sp['er']
        w = fftconvolve(send, tail)[: n - pre] * sp['wet']
        out[pre: pre + len(w), ch] += w
    if echo:
        # 山谷回声：先从左边回来，再从右边（更远、更暗、更轻）
        d, g = echo
        e = eq(eq(dry, 'highpass', 250), 'lowpass', 3200)
        k1, k2 = int(d * SR), int(2 * d * SR)
        out[k1: k1 + len(e), 0] += e * g
        out[k2: k2 + len(e), 1] += eq(e, 'lowpass', 2200) * g * 0.6
    fade = int(0.3 * SR)
    out[-fade:] *= (np.linspace(1, 0, fade) ** 2)[:, None]
    # 响度拉齐；峰值留 1.5 dB（超了只压那几下，不削波）
    out *= 10 ** ((target - loudness(out)) / 20)
    ceiling = 10 ** (-1.5 / 20)
    if np.abs(out).max() > ceiling:
        out = look_limit(out, ceiling)
    return out, dry


def tone_shape(x, text):
    """声调的形状对不对：按字切开（强度曲线上找和字数一样多的峰，峰之间最低处当边界），每个字看有声部分中间七成的音高走向：
    一声平（起止差不到 2.5 个半音、不低于整句）、二声升 1.5 个半音以上、三声低（或先降后升）、四声降 2.5 个半音以上、轻声不管。
    回对上的比例。外国人说中文最明显的就是这个走样（上一轮 Kokoro v1.1 的"将军"，第二个字一路往下掉）"""
    from pypinyin import Style, lazy_pinyin

    tones = [int(p[-1]) if p[-1].isdigit() else 5 for p in lazy_pinyin(han(text), style=Style.TONE3, neutral_tone_with_five=True, tone_sandhi=True)]
    n = len(tones)
    snd = parselmouth.Sound(x, SR)
    it = snd.to_intensity(time_step=0.01, minimum_pitch=80)
    iv = it.values[0]
    pitch = snd.to_pitch(time_step=0.01, pitch_floor=60, pitch_ceiling=600)
    f0 = np.nan_to_num(np.array([pitch.get_value_at_time(t) or 0 for t in it.xs()]))
    loud = iv > iv.max() - 25
    sm = np.convolve(iv, np.ones(5) / 5, mode='same')
    peaks = sorted((i for i in range(1, len(sm) - 1) if sm[i] >= sm[i - 1] and sm[i] > sm[i + 1] and loud[i]), key=lambda i: -sm[i])
    chosen = []
    for pk in peaks:
        if all(abs(pk - q) >= 8 for q in chosen):
            chosen.append(pk)
        if len(chosen) == n:
            break
    chosen.sort()
    on = np.where(loud)[0]
    if len(on) < n or (v := f0[f0 > 0]).size < 5:
        return 0.0
    if len(chosen) < n:
        bounds = list(np.linspace(on[0], on[-1], n + 1).astype(int))
    else:
        bounds = [on[0]] + [a + int(np.argmin(sm[a:b + 1])) for a, b in zip(chosen, chosen[1:])] + [on[-1]]
    st = np.where(f0 > 0, 12 * np.log2(np.maximum(f0, 1) / np.median(v)), np.nan)
    good = 0
    for k, tone in enumerate(tones):
        seg = st[bounds[k]:bounds[k + 1]]
        seg = seg[~np.isnan(seg)]
        if tone == 5:
            good += 1
            continue
        if len(seg) < 4:
            continue
        core = seg[int(len(seg) * 0.15):max(int(len(seg) * 0.85), int(len(seg) * 0.15) + 3)]
        q = max(1, len(core) // 4)
        start, end, level = float(np.mean(core[:q])), float(np.mean(core[-q:])), float(np.mean(core))
        slope, dip = end - start, float(np.min(core)) - max(start, end)
        good += {1: abs(slope) <= 2.5 and level >= -1.5, 2: slope >= 1.5, 3: level <= 0.5 or dip <= -1.5, 4: slope <= -2.5}[tone]
    return good / n


def write_mp3(name, x):
    wav = os.path.join(OUT, f'{name}.wav')
    mp3 = os.path.join(OUT, f'{name}.mp3')
    sf.write(wav, x, SR)
    ch = '2' if x.ndim == 2 else '1'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', ch, '-ar', str(SR), '-codec:a', 'libmp3lame', '-b:a', '80k' if ch == '2' else '64k', mp3], check=True)
    os.remove(wav)
    return mp3


# ───────── 验收：机器听一遍 ─────────

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
    if x.ndim == 2:
        x = x.mean(axis=1)
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


_lex = None


def check_reading(text, voice):
    """换过同音字的地方真是那个音（回念错了的字）。Kokoro：misaki 注出来的音标里有；标贝：按它自己的分词查它的词典"""
    global _lex
    if voice != 'baker':
        ph = g2p(text)
        return [f'{ch} 念成 {ph}' for ch, want in MUST_K10.items() if ch in text and want not in ph]
    import jieba

    if _lex is None:
        _lex = {}
        with open(os.path.join(BAKER, 'lexicon.txt'), encoding='utf8') as fh:
            for line in fh:
                w, *ph = line.split()
                _lex.setdefault(w, ph)
        jieba.set_dictionary(os.path.join(BAKER, 'dict', 'jieba.dict.utf8'))
    bad = []
    for w in jieba.cut(han(text), HMM=False):
        # 词典里有这个词就按词注音（每个字一个带声调的拼音），没有就一个字一个字查
        parts = _lex.get(w) or [(_lex.get(ch) or [''])[0] for ch in w]
        for ch, p in zip(w, parts):
            if ch in MUST_BAKER and p != MUST_BAKER[ch]:
                bad.append(f'{ch}（{w}）念成 {p}')
    return bad


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
    # 每句喊声再加一个句号收尾的念法：标贝念"吃居！"时"吃"的送气弱了，两个识别器都听成"诗句"；"吃居。"就听得准
    plain = lambda cands: cands + [(t.replace('！', '。'), sp) for t, sp in cands if t.endswith('！')][:1]
    jobs = [(f'{g}-{k}', CAST[g], plain(cands), TONE[g], 'court', 1.0) for g in CAST for k, cands in SHOUTS.items()]
    # 开场白长：十几个音节里错一两个（识别器没学过"鼠辈""帅首"这种词）也算听得出
    jobs += [(f'hero-{k}-{n}', sids, [(line, 1.0), (line, 0.92)], {**TONE[sex], **tw}, space, 0.85)
             for k, (sex, sids, lines, tw, space) in HEROES.items() for n, line in enumerate(lines, 1)]
    if ONLY:
        # 只补几句：别的录音不动，报告里原来的记录留着
        jobs = [j for j in jobs if j[0] in ONLY]
        with open(os.path.join(OUT, 'report.json')) as fh:
            report.update(json.load(fh))
    for name, sids, cands, tone, space, need in jobs:
        for text, _ in cands:
            for v in sids:
                wrong = check_reading(text, v)
                if wrong:
                    print(f'✗ {name} {text}（{v}）：{"、".join(wrong)}')
                    bad.append(name)
        # 主嗓子的每种语速都做一遍，按成品让机器听。够准的里面：声调形状对得多的优先（tone_shape，按干声量），
        # 再看识别出来的字声调对不对，同样好就要正常语速的。主嗓子哪种都不够准，先多试两种语速，还不行才换下一个嗓子
        best = None
        slower = [(cands[0][0], 0.88), (cands[0][0], 1.12)]
        for sid in sids:
            for tries in (cands, slower):
                if best is not None and best[0][0]:
                    break
                for text, speed in tries:
                    x, dry = voice_fx(speak(sid, text, speed), tone, space)
                    got = hear2(x.mean(axis=1))
                    acc = max(accuracy(gg, text) for gg in got)
                    tone_ok = max(tones(gg, text) for gg in got)
                    ex = tone_shape(dry, text)
                    key = (acc >= need, round(ex, 2), min(tone_ok, 0.8), -abs(speed - 1))
                    if best is None or key > best[0]:
                        best = (key, sid, text, speed, got, acc, tone_ok, ex, x)
        key, sid, text, speed, got, acc, tone_ok, ex, x = best
        path = write_mp3(name, x)
        f = pitch(path)
        size = os.path.getsize(path)
        dur = round(len(x) / SR, 2)
        report[name] = {'text': text, 'voice': sid, 'speed': speed, 'space': space, 'heard': got, 'acc': round(acc, 2), 'tone': round(tone_ok, 2), 'shape': round(ex, 2), 'f0': round(f), 'sec': dur, 'bytes': size}
        ok = key[0]
        if not ok:
            bad.append(name)
        print(f'{"✓" if ok else "✗"} {name:16s} {text:22s} {sid:11s} 语速 {speed} 听成「{"／".join(got)}」 准 {acc:.2f} 声调形状 {ex:.2f} 识别声调 {tone_ok:.2f} 基频 {f:4.0f}Hz {dur}s {size // 1024}KB', flush=True)


if __name__ == '__main__':
    main()
