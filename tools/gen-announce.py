"""
报着法：每走一步，念出这一步的记谱——"炮二平五""马八进七""前车退三"。

用户原话："模仿一下天天象棋……他们花钱要会员才能买的那种动画语音。"——这些软件的语音包，核心就是报棋：
你走一步、对手走一步，都念一声着法，再配"将军""吃车"这些喊声。

为什么整句整句地念，不拼：试过把"炮二"和"平五"分开念、放的时候拼起来（一个嗓子一百多段，几百 KB），
每一半都是单独一个词的收尾语调，拼出来一顿一顿，像查字典。所以把所有说得出来的着法（按每种子能怎么走算，
八百多句）各念一整句，拼成一个长音频（一个嗓子两 MB 出头，用到才下载），旁边一份 json 记每句从第几秒起、多长。

读音：象棋里"车"念 jū、"将"（黑将）念 jiàng、"相"念 xiàng——合成用的注音器按日常读法会念成 chē、jiāng、xiāng，
所以送进去之前换成同音字（居、匠、象），再查一遍注音器出来的音标，确实是这几个音才收。
语音识别在这种"炮二平五"的句子上听不准（它会听成"炮耳屏幕"——它没学过象棋），所以只当参考分，不卡。

运行（和 gen-voice.py 同一套环境）：
  ./venv/bin/python tools/gen-announce.py <模型所在目录> [m,f]
"""
import importlib.util
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('gen_voice', os.path.join(HERE, 'gen-voice.py'))
gv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gv)
SR = gv.SR
OUT = gv.OUT
WHICH = sys.argv[2].split(',') if len(sys.argv) > 2 else ['m', 'f']

NUMS = '一二三四五六七八九'
# 送进注音器之前换成同音字：象棋里的读法
SAY = {'车': '居', '将': '匠', '相': '象'}
# 注音器出来必须是这个音（音标前缀；声调符号 → 一声 ↗ 二声 ↓ 三声 ↘ 四声）
MUST = {'车': 'ʨy→', '将': 'ʨja↘ŋ', '相': 'ɕja↘ŋ', '象': 'ɕja↘ŋ', '帅': 'ʂwai↘', '卒': 'ʦu↗', '炮': 'pʰau↘'}


def phrases():
    """所有说得出来的着法（红黑两边念法一样：数字都念成一二三）。按每种子怎么走列，宁多勿漏"""
    out = set()
    n = lambda k: NUMS[k - 1]
    files = range(1, 10)
    # 车炮：纵走 1~9 步、横走到别的路
    for p in '车炮':
        for f in files:
            for k in range(1, 10):
                out.add(f'{p}{n(f)}进{n(k)}')
                out.add(f'{p}{n(f)}退{n(k)}')
            for t in files:
                if t != f:
                    out.add(f'{p}{n(f)}平{n(t)}')
        for pre in '前后':
            for k in range(1, 10):
                out.add(f'{pre}{p}进{n(k)}')
                out.add(f'{pre}{p}退{n(k)}')
            for t in files:
                out.add(f'{pre}{p}平{n(t)}')
    # 马：到隔一路、隔两路
    for f in files:
        for d in (-2, -1, 1, 2):
            t = f + d
            if 1 <= t <= 9:
                out.add(f'马{n(f)}进{n(t)}')
                out.add(f'马{n(f)}退{n(t)}')
    for pre in '前后':
        for t in files:
            out.add(f'{pre}马进{n(t)}')
            out.add(f'{pre}马退{n(t)}')
    # 兵卒：进一步；过了河能横走一路；同一路几个兵用前中后、一二三四五
    for p in '兵卒':
        for f in files:
            out.add(f'{p}{n(f)}进一')
            for t in (f - 1, f + 1):
                if 1 <= t <= 9:
                    out.add(f'{p}{n(f)}平{n(t)}')
        # 同一路两个兵（前兵、后兵）残局里常见；三个以上（中兵、一兵……）几乎碰不到，不念（省下一百多句）
        for pre in ['前', '后']:
            out.add(f'{pre}{p}进一')
            for t in files:
                out.add(f'{pre}{p}平{n(t)}')
    # 相象：一三五七九路，飞到隔两路
    for p in '相象':
        for f in (1, 3, 5, 7, 9):
            for t in (f - 2, f + 2):
                if 1 <= t <= 9:
                    out.add(f'{p}{n(f)}进{n(t)}')
                    out.add(f'{p}{n(f)}退{n(t)}')
        for pre in '前后':
            for t in (1, 3, 5, 7, 9):
                out.add(f'{pre}{p}进{n(t)}')
                out.add(f'{pre}{p}退{n(t)}')
    # 仕士：四五六路斜走
    for p in '仕士':
        for f, ts in ((4, (5,)), (5, (4, 6)), (6, (5,))):
            for t in ts:
                out.add(f'{p}{n(f)}进{n(t)}')
                out.add(f'{p}{n(f)}退{n(t)}')
        for pre in '前后':
            out.add(f'{pre}{p}进五')
            out.add(f'{pre}{p}退五')
    # 帅将：进一退一、横走一路
    for p in '帅将':
        for f in (4, 5, 6):
            out.add(f'{p}{n(f)}进一')
            out.add(f'{p}{n(f)}退一')
            for t in (f - 1, f + 1):
                if 4 <= t <= 6:
                    out.add(f'{p}{n(f)}平{n(t)}')
    return sorted(out)


def spoken(t):
    return ''.join(SAY.get(ch, ch) for ch in t)


def check_reading(t):
    """注音器把这句念成什么音标；该念 jū 的念成了 chē 之类就返回问题"""
    ph = gv.g2p(spoken(t))
    for ch, want in MUST.items():
        if ch in t and want not in ph:
            return f'{t}「{ch}」念错了：{ph}'
    return None


def trim(x, th=0.015):
    idx = np.where(np.abs(x) > th)[0]
    if not len(idx):
        return x
    return x[max(0, idx[0] - int(0.01 * SR)): idx[-1] + int(0.06 * SR)]


VOICES = {'m': ('zm_yunjian', -1.5), 'f': ('zf_xiaoxiao', 0.0)}
SPEED = 1.12
GAP = 0.1  # 句与句之间留的静音（秒）：放的时候按 json 里的时间切，两头各让出一点
# 报着法的音频：16kHz、24kbps（说话够清楚；八百多句一个嗓子两 MB 出头）
OUT_SR = 16000
KBPS = '24k'


def main():
    ps = phrases()
    bad = [r for r in (check_reading(t) for t in ps) if r]
    print(f'{len(ps)} 句；读音检查：{"全对" if not bad else f"{len(bad)} 句不对"}')
    if bad:
        for b in bad[:20]:
            print('  ✗', b)
        sys.exit(1)
    index_path = os.path.join(OUT, 'announce.json')
    index = {'phrases': ps}
    if os.path.exists(index_path):
        with open(index_path) as fh:
            old = json.load(fh)
        if old.get('phrases') == ps:
            index = old
    for g in WHICH:
        voice, semis = VOICES[g]
        pieces = []
        offs = []
        t = GAP
        for k, ph in enumerate(ps):
            raw = gv.say(spoken(ph) + '！', voice, SPEED)
            x = trim(gv.process(raw, semis, 0.6, 0.05, echo=False, double=False))
            # 每句响度拉齐（按 RMS），峰值不超过 -1.5 dB
            rms = np.sqrt(np.mean(x ** 2)) + 1e-9
            x = x * min(0.16 / rms, 10 ** (-1.5 / 20) / (np.abs(x).max() + 1e-9))
            pieces.append(np.zeros(int(GAP * SR)))
            pieces.append(x)
            offs.append([round(t, 3), round(len(x) / SR, 3)])
            t += len(x) / SR + GAP
            if k % 100 == 0:
                print(f'  {g} {k}/{len(ps)}', flush=True)
        y = np.concatenate(pieces + [np.zeros(int(GAP * SR))])
        wav = os.path.join(OUT, f'announce-{g}.wav')
        mp3 = os.path.join(OUT, f'announce-{g}.mp3')
        sf.write(wav, y, SR)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-ac', '1', '-ar', str(OUT_SR), '-codec:a', 'libmp3lame', '-b:a', KBPS, mp3], check=True)
        index[g] = offs
        # 机器抽听几句（参考分：识别模型没学过象棋，听不准是常事）
        sample = ps[:: max(1, len(ps) // 40)]
        scores = []
        for ph in sample:
            k = ps.index(ph)
            s0, d = offs[k]
            clip = y[int(s0 * SR): int((s0 + d) * SR)]
            p = os.path.join(OUT, '_probe.wav')
            sf.write(p, np.concatenate([clip, np.zeros(int(0.2 * SR))]), SR)
            got = gv.heard(p)
            scores.append(max(gv.score(got, ph), gv.score(got, spoken(ph))))
        os.remove(os.path.join(OUT, '_probe.wav'))
        os.remove(wav)
        dur = len(y) / SR
        print(f'{g}：{len(ps)} 句，共 {dur:.0f} 秒，{os.path.getsize(mp3) // 1024} KB；抽听 {len(sample)} 句，平均识别分 {np.mean(scores):.2f}（满分 3）')
        index[f'{g}-probe'] = round(float(np.mean(scores)), 2)
    with open(index_path, 'w') as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
