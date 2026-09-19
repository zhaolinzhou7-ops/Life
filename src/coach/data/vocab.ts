/**
 * 词库
 *
 * 选词标准不是"高考/四级高频词"，而是**成年人真的会用到的词**：
 * 上班、出差、点餐、寒暄、解释问题、表达不同意见。
 *
 * 每个词必须带三样东西，缺一个这个词就没有资格进来：
 *   - 一个真实的例句（不是 "This is a book." 这种）
 *   - 一个中文对照
 *   - 场景标签，这样"今天学什么"才能按用户的目标选词
 *
 * `trap` 是可选的第四样：中文母语者在这个词上常踩的坑。有坑的词要写清楚，
 * 因为认识 ≠ 会用，而大部分"会用错"都集中在这些坑上。
 *
 * 用竖线表格而不是对象数组：150 个词写成对象要一千多行，写成表格能一屏
 * 看到十几个词，校对时更容易发现"这个例句是编的"。解析在下面，
 * 格式不对直接抛错——数据文件的错必须吵闹，不能悄悄少一个词。
 */

import type { CEFR, VocabItem } from '../types';

/** word | phonetic | pos | meaning | example | exampleCn | level | tags | trap */
const RAW = `
schedule | ˈskedʒuːl | n./v. | 日程；安排时间 | Let me check my schedule and get back to you. | 我看一下日程再回复你。 | A2 | work,daily |
deadline | ˈdedlaɪn | n. | 截止时间 | The deadline is this Friday at noon. | 截止时间是这周五中午。 | A2 | work |
update | ʌpˈdeɪt | n./v. | 进展；更新 | Could you give me a quick update on the project? | 能简单说一下项目进展吗？ | A2 | work | 作名词时重音在前，作动词时重音在后
confirm | kənˈfɜːrm | v. | 确认 | I'll confirm the time with the client. | 我会和客户确认时间。 | A2 | work,travel |
available | əˈveɪləbl | adj. | 有空的；可获得的 | Are you available tomorrow afternoon? | 你明天下午有空吗？ | A2 | work,daily | 问别人有没有空最自然的说法，比 Do you have time 更礼貌
issue | ˈɪʃuː | n. | 问题 | We ran into an issue with the login page. | 我们在登录页遇到了一个问题。 | A2 | work | 工作中说"问题"多用 issue，problem 语气更重
handle | ˈhændl | v. | 处理 | Don't worry, I can handle it. | 别担心，我能处理。 | A2 | work,daily |
reschedule | riːˈskedʒuːl | v. | 改期 | Can we reschedule to next week? | 我们能改到下周吗？ | B1 | work,travel |
follow up | ˈfɑːloʊ ʌp | phr. | 跟进 | I'll follow up with them tomorrow. | 我明天跟他们跟进一下。 | B1 | work |
figure out | ˈfɪɡjər aʊt | phr. | 弄明白；想出办法 | We still need to figure out the budget. | 预算我们还得再想想办法。 | B1 | work,daily |
run into | rʌn ˈɪntuː | phr. | 碰到（问题/人） | I ran into an old colleague at the airport. | 我在机场碰到一个老同事。 | B1 | work,travel |
come up with | kʌm ʌp wɪð | phr. | 想出 | She came up with a really good idea. | 她想出了一个很好的主意。 | B1 | work |
touch base | tʌtʃ beɪs | phr. | 简单沟通一下 | Let's touch base on Monday. | 我们周一简单沟通一下。 | B2 | work |
heads-up | ˈhedz ʌp | n. | 提前告知 | Thanks for the heads-up. | 谢谢你提前告诉我。 | B2 | work |
workload | ˈwɜːrkloʊd | n. | 工作量 | My workload has been pretty heavy lately. | 我最近工作量挺大的。 | B1 | work |
overtime | ˈoʊvərtaɪm | n. | 加班 | I worked overtime three days last week. | 我上周加了三天班。 | B1 | work | 是名词/副词，不说 I overtimed
commute | kəˈmjuːt | n./v. | 通勤 | My commute takes about an hour each way. | 我单程通勤大概一小时。 | B1 | work,daily |
colleague | ˈkɑːliːɡ | n. | 同事 | I'm having lunch with a colleague. | 我和一个同事吃午饭。 | A2 | work | 比 workmate 常见得多
manager | ˈmænɪdʒər | n. | 主管 | I'll need to check with my manager. | 我需要和我主管确认一下。 | A1 | work |
client | ˈklaɪənt | n. | 客户 | The client wants to see it by Thursday. | 客户想在周四之前看到。 | A2 | work |
presentation | ˌpreznˈteɪʃn | n. | 汇报；演示 | I have a presentation on Wednesday. | 我周三有个汇报。 | A2 | work |
agenda | əˈdʒendə | n. | 议程 | Could you send the agenda before the meeting? | 能在会前把议程发我吗？ | B1 | work |
summarize | ˈsʌməraɪz | v. | 总结 | Let me summarize what we agreed on. | 我来总结一下我们达成的共识。 | B1 | work |
clarify | ˈklærəfaɪ | v. | 澄清；说清楚 | Sorry, could you clarify what you mean? | 抱歉，你的意思能再说清楚点吗？ | B1 | work | 听不懂时比 I don't understand 更专业
concern | kənˈsɜːrn | n. | 顾虑 | I have one concern about the timeline. | 我对时间安排有一个顾虑。 | B1 | work | 提反对意见时的缓冲说法
disagree | ˌdɪsəˈɡriː | v. | 不同意 | I respectfully disagree with that approach. | 我不太同意这个做法。 | B1 | work |
suggestion | səˈdʒestʃən | n. | 建议 | Do you have any suggestions? | 你有什么建议吗？ | A2 | work,daily |
priority | praɪˈɔːrəti | n. | 优先级 | What's the top priority this week? | 这周最优先的是什么？ | B1 | work |
approve | əˈpruːv | v. | 批准 | My leave request was approved. | 我的请假申请批了。 | B1 | work |
invoice | ˈɪnvɔɪs | n. | 发票；账单 | I'll send the invoice by the end of the month. | 我月底之前把账单发过去。 | B2 | work |
check in | tʃek ɪn | phr. | 办理入住；报到 | I'd like to check in, please. | 我想办理入住。 | A2 | travel |
check out | tʃek aʊt | phr. | 退房 | What time do I need to check out? | 我需要几点退房？ | A2 | travel |
reservation | ˌrezərˈveɪʃn | n. | 预订 | I have a reservation under Zhou. | 我有一个姓周的预订。 | A2 | travel |
boarding pass | ˈbɔːrdɪŋ pæs | n. | 登机牌 | Here's my passport and boarding pass. | 这是我的护照和登机牌。 | A2 | travel |
aisle | aɪl | n. | 过道 | Could I get an aisle seat? | 能给我一个靠过道的座位吗？ | B1 | travel | l 不发音，读作 /aɪl/，和 I'll 同音
layover | ˈleɪoʊvər | n. | 中转停留 | I have a four-hour layover in Tokyo. | 我在东京中转停留四小时。 | B1 | travel |
delayed | dɪˈleɪd | adj. | 延误的 | My flight was delayed by two hours. | 我的航班延误了两小时。 | A2 | travel |
luggage | ˈlʌɡɪdʒ | n. | 行李 | My luggage didn't arrive. | 我的行李没到。 | A2 | travel | 不可数，不说 luggages
receipt | rɪˈsiːt | n. | 收据 | Could I have a receipt, please? | 能给我一张收据吗？ | A2 | travel,daily | p 不发音
refund | ˈriːfʌnd | n. | 退款 | Can I get a refund for this? | 这个可以退款吗？ | B1 | travel,daily |
deposit | dɪˈpɑːzɪt | n. | 押金 | Is there a deposit for the room? | 房间需要押金吗？ | B1 | travel |
directions | dəˈrekʃnz | n. | 路线指引 | Could you give me directions to the station? | 能告诉我去车站怎么走吗？ | A2 | travel |
nearby | ˌnɪrˈbaɪ | adj./adv. | 附近的 | Is there a pharmacy nearby? | 附近有药店吗？ | A2 | travel,daily |
recommend | ˌrekəˈmend | v. | 推荐 | What would you recommend? | 你推荐什么？ | A2 | travel,daily | 点餐时最好用的一句
allergic | əˈlɜːrdʒɪk | adj. | 过敏的 | I'm allergic to peanuts. | 我对花生过敏。 | B1 | travel,daily |
takeaway | ˈteɪkəweɪ | n. | 外带的饭 | I'll grab a takeaway on the way home. | 我回家路上买个外带的。 | A2 | daily | 英式说法；美式点餐时说 I'd like it to go
bill | bɪl | n. | 账单 | Could we get the bill, please? | 能结账吗？ | A2 | daily,travel | 美式也说 check
split | splɪt | v. | 分摊 | Should we split the bill? | 我们 AA 吗？ | B1 | daily |
hang out | hæŋ aʊt | phr. | 一起玩；消磨时间 | We usually hang out on weekends. | 我们一般周末一起出去。 | B1 | daily | 成年人说"一起玩"用这个，不用 play
catch up | kætʃ ʌp | phr. | 叙旧；赶上进度 | Let's catch up over coffee sometime. | 有空一起喝咖啡聊聊。 | B1 | daily,work |
show up | ʃoʊ ʌp | phr. | 出现；到场 | He didn't show up for the meeting. | 他没来开会。 | B1 | daily,work |
run out of | rʌn aʊt əv | phr. | 用完 | We've run out of coffee. | 咖啡喝完了。 | B1 | daily |
get along | ɡet əˈlɔːŋ | phr. | 相处得好 | I get along well with my team. | 我和团队相处得不错。 | B1 | daily,work |
look after | lʊk ˈæftər | phr. | 照顾 | I look after my parents on weekends. | 我周末照顾父母。 | A2 | daily |
put off | pʊt ɔːf | phr. | 推迟 | Let's not put it off any longer. | 别再往后拖了。 | B1 | daily,work |
end up | end ʌp | phr. | 最终变成 | We ended up staying an extra night. | 我们最后多住了一晚。 | B1 | daily,travel |
exhausted | ɪɡˈzɔːstɪd | adj. | 筋疲力尽的 | I'm exhausted after that trip. | 那趟出差之后我累坏了。 | B1 | daily | 已经是"极度"，前面不加 very
stressed | strest | adj. | 有压力的 | I've been pretty stressed at work lately. | 我最近工作压力挺大。 | B1 | daily,work | 说自己有压力是 stressed，不是 stressful
annoying | əˈnɔɪɪŋ | adj. | 烦人的 | The noise outside is really annoying. | 外面的噪音真烦人。 | B1 | daily | 形容事；说自己觉得烦用 annoyed
convenient | kənˈviːniənt | adj. | 方便的 | Is Thursday convenient for you? | 周四你方便吗？ | A2 | daily,work | 主语是事不是人，不说 I am convenient
apologize | əˈpɑːlədʒaɪz | v. | 道歉 | I apologize for the delay. | 抱歉耽误了。 | B1 | work,daily |
appreciate | əˈpriːʃieɪt | v. | 感激 | I'd really appreciate your help. | 非常感谢你的帮助。 | B1 | work,daily | 比 thank you 正式一点，工作邮件常用
mind | maɪnd | v. | 介意 | Do you mind if I open the window? | 我开窗你介意吗？ | A2 | daily | 回答要注意：不介意是 No, not at all
prefer | prɪˈfɜːr | v. | 更喜欢 | I'd prefer to meet in the morning. | 我更想上午见面。 | A2 | daily,work | prefer A to B，不用 than
afford | əˈfɔːrd | v. | 负担得起 | I can't afford a place downtown. | 我住不起市中心。 | B1 | daily |
borrow | ˈbɑːroʊ | v. | 借入 | Can I borrow your charger? | 能借一下你的充电器吗？ | A2 | daily | 借进来用 borrow，借出去用 lend
lend | lend | v. | 借出 | Could you lend me a pen? | 能借我一支笔吗？ | A2 | daily |
remind | rɪˈmaɪnd | v. | 提醒 | Remind me to call her back. | 提醒我给她回电话。 | A2 | daily,work |
realize | ˈriːəlaɪz | v. | 意识到 | I didn't realize it was so late. | 我没意识到这么晚了。 | B1 | daily |
assume | əˈsuːm | v. | 假定 | I assumed you already knew. | 我以为你已经知道了。 | B1 | work,daily |
manage | ˈmænɪdʒ | v. | 设法做到 | We managed to finish on time. | 我们设法按时完成了。 | B1 | work |
struggle | ˈstrʌɡl | v. | 感到吃力 | I'm still struggling with pronunciation. | 我发音还是有困难。 | B1 | daily |
improve | ɪmˈpruːv | v. | 提高 | I want to improve my speaking. | 我想提高口语。 | A2 | daily |
practice | ˈpræktɪs | n./v. | 练习 | I practice speaking for ten minutes a day. | 我每天练十分钟口语。 | A1 | daily | 后面跟 -ing，不跟 to
mention | ˈmenʃn | v. | 提到 | You mentioned a new project last time. | 你上次提到一个新项目。 | B1 | work | 后面直接跟宾语，不加 about
explain | ɪkˈspleɪn | v. | 解释 | Let me explain what happened. | 我解释一下发生了什么。 | A2 | work,daily | explain something to someone，不说 explain me
attend | əˈtend | v. | 参加 | I'll attend the meeting remotely. | 我会远程参会。 | B1 | work | 及物动词，不加 to
discuss | dɪˈskʌs | v. | 讨论 | Let's discuss it tomorrow. | 我们明天讨论。 | B1 | work | 后面不加 about
consider | kənˈsɪdər | v. | 考虑 | We're considering two options. | 我们在考虑两个方案。 | B1 | work |
decide | dɪˈsaɪd | v. | 决定 | We decided to go with the first plan. | 我们决定用第一个方案。 | A2 | work,daily |
depend | dɪˈpend | v. | 取决于 | It depends on the weather. | 这要看天气。 | A2 | daily | 固定搭配 depend on，不能少 on
turn out | tɜːrn aʊt | phr. | 结果是 | It turned out to be much easier than I thought. | 结果比我想的容易多了。 | B1 | daily |
point out | pɔɪnt aʊt | phr. | 指出 | She pointed out a mistake in my report. | 她指出了我报告里的一个错误。 | B1 | work |
bring up | brɪŋ ʌp | phr. | 提出（话题） | I'll bring it up at the meeting. | 我会在会上提这件事。 | B1 | work |
sort out | sɔːrt aʊt | phr. | 解决；整理好 | I need to sort out my visa first. | 我得先把签证办好。 | B1 | work,travel |
deal with | diːl wɪð | phr. | 应对；处理 | I have to deal with a lot of emails. | 我要处理很多邮件。 | B1 | work |
keep up with | kiːp ʌp wɪð | phr. | 跟上 | It's hard to keep up with native speakers. | 跟上母语者的语速很难。 | B2 | daily |
get used to | ɡet juːst tuː | phr. | 习惯于 | I'm getting used to the new schedule. | 我在慢慢习惯新的作息。 | B1 | daily | 后面跟 -ing
look forward to | lʊk ˈfɔːrwərd tuː | phr. | 期待 | I'm looking forward to meeting you. | 期待见到你。 | B1 | work | to 是介词，后面跟 -ing
by the way | baɪ ðə weɪ | phr. | 顺便说 | By the way, are you free on Friday? | 顺便问一下，你周五有空吗？ | A2 | daily |
actually | ˈæktʃuəli | adv. | 其实 | Actually, I think there's a better way. | 其实我觉得有更好的办法。 | A2 | daily | 用来礼貌地纠正对方
probably | ˈprɑːbəbli | adv. | 很可能 | I'll probably be a few minutes late. | 我可能会晚几分钟。 | A2 | daily |
definitely | ˈdefɪnətli | adv. | 肯定 | I'll definitely be there. | 我一定到。 | B1 | daily |
hopefully | ˈhoʊpfəli | adv. | 但愿 | Hopefully the rain stops by then. | 但愿到时候雨停了。 | B1 | daily |
eventually | ɪˈventʃuəli | adv. | 最终 | We eventually found a solution. | 我们最终找到了办法。 | B1 | work | 不是"可能"，是"最后终于"
currently | ˈkɜːrəntli | adv. | 目前 | I'm currently working on two projects. | 我目前在做两个项目。 | B1 | work |
roughly | ˈrʌfli | adv. | 大约 | It'll take roughly two weeks. | 大概要两周。 | B1 | work |
instead | ɪnˈsted | adv. | 作为替代 | Let's meet on Friday instead. | 那我们改成周五见吧。 | A2 | daily |
anyway | ˈeniweɪ | adv. | 总之；不管怎样 | Anyway, let's move on. | 总之，我们继续吧。 | A2 | daily |
though | ðoʊ | adv. | 不过（句尾） | It's expensive. It's really good, though. | 挺贵的。不过确实好。 | B1 | daily | 放句尾表示转折，是很地道的口语用法
kind of | ˈkaɪnd əv | phr. | 有点 | It's kind of complicated. | 有点复杂。 | B1 | daily | 口语里读作 kinda
a bit | ə bɪt | phr. | 一点 | I'm a bit tired today. | 我今天有点累。 | A2 | daily |
so far | soʊ fɑːr | phr. | 到目前为止 | So far everything looks fine. | 到目前为止一切正常。 | B1 | work |
in charge of | ɪn tʃɑːrdʒ əv | phr. | 负责 | I'm in charge of the design team. | 我负责设计团队。 | B1 | work |
on my own | ɑːn maɪ oʊn | phr. | 独自 | I learned it on my own. | 我是自学的。 | B1 | daily |
make sense | meɪk sens | phr. | 说得通 | That makes sense. | 有道理。 | B1 | daily,work | 听懂了对方的解释时最自然的回应
no worries | noʊ ˈwɜːriz | phr. | 没事 | No worries, take your time. | 没事，你慢慢来。 | A2 | daily |
fair enough | fer ɪˈnʌf | phr. | 有道理 | Fair enough, let's try it your way. | 有道理，就按你说的试试。 | B2 | daily |
I'd say | aɪd seɪ | phr. | 我觉得 | I'd say it'll take about a week. | 我觉得大概要一周。 | B1 | work,daily | 比 I think 更松弛的说法
to be honest | tuː bi ˈɑːnɪst | phr. | 说实话 | To be honest, I'm not sure yet. | 说实话，我还不确定。 | B1 | daily |
`;

function parse(): VocabItem[] {
  const out: VocabItem[] = [];
  const seen = new Set<string>();
  RAW.trim()
    .split('\n')
    .forEach((line, i) => {
      const cells = line.split('|').map((c) => c.trim());
      if (cells.length < 8) throw new Error(`词库第 ${i + 1} 行字段不够（需要 8~9 段）：${line}`);
      const [word, phonetic, pos, meaning, example, exampleCn, level, tags, trap] = cells;
      if (!word || !meaning || !example || !exampleCn) throw new Error(`词库第 ${i + 1} 行有空字段：${line}`);
      if (seen.has(word)) throw new Error(`词库里有重复词：${word}`);
      seen.add(word);
      if (!['A1', 'A2', 'B1', 'B2', 'C1'].includes(level)) throw new Error(`词库 ${word} 的等级不合法：${level}`);
      out.push({
        word,
        phonetic,
        pos,
        meaning,
        example,
        exampleCn,
        level: level as CEFR,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        trap: trap || undefined,
      });
    });
  return out;
}

export const VOCAB: VocabItem[] = parse();

export const VOCAB_MAP: Record<string, VocabItem> = Object.fromEntries(VOCAB.map((v) => [v.word, v]));

export const getWord = (w: string): VocabItem | undefined => VOCAB_MAP[w];

/** 按标签取词。标签对应用户的目标，这样"今天学什么"才不是随机发牌 */
export function byTag(tag: string): VocabItem[] {
  return VOCAB.filter((v) => v.tags.includes(tag));
}

/** 按等级取词 */
export function byLevel(level: CEFR): VocabItem[] {
  return VOCAB.filter((v) => v.level === level);
}
