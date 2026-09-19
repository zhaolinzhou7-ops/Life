/**
 * 姓氏读音表
 *
 * 音律分析必须从姓氏开始算——「名字好听」说的从来是姓名整体好听。所以这里
 * 存的是读音和笔画，以及那些一读出来就会出事的谐音姓。
 *
 * 表里没有的姓不会被拒绝：引擎会降级成「只分析名字部分」，并在结果里如实
 * 告诉用户这一点，而不是瞎猜一个读音继续算。
 *
 * 行格式：姓|拼音|笔画|谐音读法(可空)|是否否定式|备注
 */

import type { SurnameInfo } from '../types';
import { parsePinyin, splitSyllable } from './chars';

const SINGLE = `
李|li3|7|||
王|wang2|4|||
张|zhang1|7|||
刘|liu2|6|||
陈|chen2|7|||
杨|yang2|7|羊,阳|0|「杨伟」类谐音需留意
黄|huang2|11|||
赵|zhao4|9|||
吴|wu2|7|无|1|与「无」同音，名字第一个字若是褒义词会被否定掉
周|zhou1|8|粥,洲|0|
徐|xu2|10|||
孙|sun1|6|||
马|ma3|3|||
朱|zhu1|6|猪|0|与「猪」同音，用字要避开动物、食物联想
胡|hu2|9|狐,糊|0|
郭|guo1|10|||
何|he2|7|||
高|gao1|10|||
林|lin2|8|||
罗|luo2|8|||
郑|zheng4|8|||
梁|liang2|11|||
谢|xie4|12|||
宋|song4|7|||
唐|tang2|10|||
许|xu3|6|||
韩|han2|12|||
冯|feng2|5|||
邓|deng4|4|||
曹|cao2|11|||
彭|peng2|12|||
曾|zeng1|12|||姓时读 zēng，不读 céng
肖|xiao1|7|||
田|tian2|5|||
董|dong3|12|||
袁|yuan2|10|||
潘|pan1|15|||
于|yu2|3|||
蒋|jiang3|12|||
蔡|cai4|14|菜|0|与「菜」同音，避开「菜X」式组合
余|yu2|7|||
杜|du4|7|肚,堵|0|「杜子腾」式谐音的来源
叶|ye4|5|||
程|cheng2|12|||
苏|su1|7|||
魏|wei4|17|||
吕|lv3|6|||
丁|ding1|2|||
任|ren2|6|||姓时读 rén，不读 rèn
沈|shen3|7|||姓时读 shěn
姚|yao2|9|||
卢|lu2|5|||
姜|jiang1|9|||
崔|cui1|11|||
钟|zhong1|9|||
谭|tan2|14|||
陆|lu4|7|||
汪|wang1|7|||
范|fan4|8|饭,犯|0|「范统」式谐音的来源
金|jin1|8|||
石|shi2|5|||
廖|liao4|14|||
贾|jia3|10|假|0|姓时读 jiǎ，与「假」同音
夏|xia4|10|||
韦|wei2|4|||
付|fu4|5|父,负|0|
方|fang1|4|||
白|bai2|5|||
邹|zou1|9|||
孟|meng4|8|||
熊|xiong2|14|||
秦|qin2|10|禽,擒|0|
邱|qiu1|7|||
江|jiang1|6|||
尹|yin3|4|||
薛|xue1|16|||
闫|yan2|6|||
段|duan4|9|断|0|
雷|lei2|13|||
侯|hou2|9|猴|0|
龙|long2|5|||
史|shi3|5|死,屎,屎|1|与「死」同音，名字要特别谨慎
陶|tao2|10|||
黎|li2|15|||
贺|he4|9|||
顾|gu4|10|||
毛|mao2|4|||
郝|hao3|9|||
龚|gong1|11|||
邵|shao4|7|||
万|wan4|3|||
钱|qian2|10|||
严|yan2|7|||
覃|qin2|12|||姓时多读 qín，也有读 tán 的支系
武|wu3|8|||
戴|dai4|17|||
莫|mo4|10|||
孔|kong3|4|||
向|xiang4|6|||
汤|tang1|6|||
常|chang2|11|||
温|wen1|12|||
康|kang1|11|||
施|shi1|9|||
文|wen2|4|||
牛|niu2|4|||
樊|fan2|15|||
葛|ge3|12|||姓时读 gě
邢|xing2|6|||
安|an1|6|||
齐|qi2|6|||
易|yi4|8|||
乔|qiao2|6|||
伍|wu3|6|||
庞|pang2|8|||
颜|yan2|15|||
倪|ni2|10|||
庄|zhuang1|6|||
聂|nie4|10|||
章|zhang1|11|||
鲁|lu3|12|||
岳|yue4|8|||
翟|zhai2|14|||姓时读 zhái
殷|yin1|10|||
詹|zhan1|13|||
申|shen1|5|||
欧|ou1|8|||
柏|bai3|9|||姓时多读 bǎi
卜|bu3|2|不|1|与「不」同音，名字第一个字若是褒义词会被否定掉
苟|gou3|8|狗|0|与「狗」同音，用字须格外小心
裴|pei2|14|赔|0|
毕|bi4|11|毙|0|
焦|jiao1|12|||
柳|liu3|9|||
边|bian1|5|||
盛|sheng4|11|||
温|wen1|12|||
路|lu4|13|||
关|guan1|6|||
甘|gan1|5|干|0|
`;

const COMPOUND = `
欧阳|ou1,yang2|8,7
司马|si1,ma3|5,3
上官|shang4,guan1|3,8
诸葛|zhu1,ge3|10,12
夏侯|xia4,hou2|10,9
皇甫|huang2,fu3|9,7
尉迟|yu4,chi2|11,7|姓时读 yù chí，不读 wèi
公孙|gong1,sun1|4,6
慕容|mu4,rong2|14,10
东方|dong1,fang1|5,4
南宫|nan2,gong1|9,9
长孙|zhang3,sun1|4,6|姓时读 zhǎng sūn
宇文|yu3,wen2|6,4
司徒|si1,tu2|5,10
独孤|du2,gu1|9,8
端木|duan1,mu4|14,4
令狐|ling2,hu2|5,8|姓时读 líng hú
澹台|tan2,tai2|16,5|姓时读 tán tái
`;

function build(c: string, py: string, bh: number, puns?: string[], negates?: boolean, note?: string): SurnameInfo {
  const { syl, tone } = parsePinyin(py);
  const { sm, ym } = splitSyllable(syl);
  return { c, py, syl, sm, ym, tone, bh, puns, negates, note };
}

const map = new Map<string, SurnameInfo>();

for (const row of SINGLE.split('\n')) {
  const t = row.trim();
  if (!t) continue;
  const [c, py, bh, puns, neg, note] = t.split('|');
  if (map.has(c)) continue;
  map.set(
    c,
    build(
      c,
      py,
      Number(bh),
      puns ? puns.split(',').filter(Boolean) : undefined,
      neg === '1',
      note || undefined,
    ),
  );
}

for (const row of COMPOUND.split('\n')) {
  const t = row.trim();
  if (!t) continue;
  const [c, pys, bhs, note] = t.split('|');
  const [p1, p2] = pys.split(',');
  const [b1, b2] = bhs.split(',').map(Number);
  const first = build(c[0], p1, b1, undefined, false, note || undefined);
  const second = build(c[1], p2, b2);
  map.set(c, { ...first, c, second, note: note || undefined });
}

export const SURNAMES = map;

/** 查姓氏。复姓优先；查不到返回 undefined，调用方必须处理这种情况 */
export function getSurname(s: string): SurnameInfo | undefined {
  return SURNAMES.get(s);
}

/** 常见姓氏，按使用人数大致排序，用于输入页的快捷选择 */
export const HOT_SURNAMES = [
  '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周',
  '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
  '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
  '欧阳', '司马', '上官', '诸葛',
];

export const ALL_SURNAME_LIST = [...map.keys()];
