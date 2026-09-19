/**
 * 按难度分档的词表
 *
 * 用途：估计一段话的用词难度。做法很朴素——看这段话里有多少词超出了初级词表。
 *
 * 必须说清楚它的局限，因为产品里会把它变成一个等级显示给用户：
 * 这是**词频分档**，不是真正的 CEFR 词表。CEFR 官方词表是有版权的，
 * 这里用的是公认的高频词按常识分档。所以界面上它只用来给出"大致档位"，
 * 并且和阅读、听力的客观得分一起加权，不单独作为结论。
 *
 * 不在任何档里的词一律当作 B2+：对于自学者，用出一个表外词通常确实说明
 * 词汇量在中高级以上。反过来会低估专有名词（Chengdu、Alibaba），
 * 所以分析时会先剔掉大写开头的词。
 */

const split = (s: string) => new Set(s.trim().split(/\s+/));

/** A1：最基础的功能词和生活词 */
export const BAND_A1 = split(`
a an the i you he she it we they me him her us them my your his its our their this that these those
am is are was were be been being have has had do does did will would can could shall should may might must
and or but so if because when where what who how why not no yes very too also just only then than as of
in on at to from by with for about into out up down over under after before now today tomorrow yesterday
go goes going went come comes came get got give gave take took make made see saw look watch know knew think
want need like love hate say said tell told ask asked answer speak talk work live eat drink sleep buy sell
open close start stop begin end play read write walk run sit stand help use try call meet learn teach study
good bad big small new old young long short high low hot cold happy sad easy hard fast slow nice fine
man woman boy girl people friend family father mother son daughter brother sister child children baby
home house room door window car bus train bike road street city town country school class book pen paper
water food rice meat fish egg milk tea coffee bread fruit apple time day week month year morning night
hand head eye foot name number money job work phone computer music film game name one two three four five
six seven eight nine ten first last next some any all many much more most little few other same different
here there where everyone everything something nothing anyone please thank sorry hello goodbye ok okay
`);

/** A2：日常交流够用的一层 */
export const BAND_A2 = split(`
about above across afraid again against ago agree already although always among angry another answer
anything anyway area arrive back become before begin behind believe below best better between both bring
build busy careful carry catch center certain chance change cheap check choose city clean clear clock close
club coffee college colour color company complete computer continue cook corner cost country course cover
cross cry cup customer dance danger dark date decide deep describe design desk detail dictionary die difficult
dinner direction discuss doctor dog dollar draw dream dress drive driver during early earth easy education
either elephant else email empty enjoy enough enter especially evening ever every exactly example excited
excuse expensive experience explain face fact fail fall famous farm fast favourite favorite feel field fill
film final find finger finish fire floor flower fly follow forget forward free fresh front full fun future
garden general gift glad glass grow guess guest hair half happen health hear heart heavy hold holiday hope
hospital hotel hour however hungry hurry idea important improve include increase inside interest interesting
internet introduce invite island join keep key kind kitchen knife lake land language late laugh lead leave
left less letter library lie light line list listen lose lot loud lucky lunch machine main manager market
marry match matter maybe meal mean meat medicine meeting member memory message middle mind minute miss mistake
modern moment morning move movie museum music nature near necessary nervous never news newspaper noise normal
north note notice office often once order organize outside own page pain paint pair park part party pass past
pay perfect perhaps period person picture piece place plan plane plant plate point police policy poor popular
position possible postcard practice prefer prepare present president price problem produce program project
promise protect public pull push put quality question quick quiet quite radio rain reach ready real reason
receive record remember repeat report restaurant result return rich right ring river road rock room round
rule safe sale salt save scene school science sea season seat second secret section seem sell send sentence
serious serve service several shop short should shoulder show side sign silver similar simple since single
sister sky sleep slow smile smoke snow soft soldier solve someone sometimes song soon sound soup south space
speak special spend sport spring stage stairs star station stay step still stone store story straight strange
street strong student subject success sudden sugar suggest summer sun supermarket sure surprise sweet swim
table taxi teacher team telephone television tell temperature terrible test thank theatre then therefore thing
throw ticket tidy tired together tomorrow tonight total touch tourist towards town traffic train travel tree
trip trouble true trust turn twice type ugly uncle understand university until usual vegetable village visit
voice wait wake walk wall want warm wash waste wear weather wedding week weight welcome west wet while white
whole wide wife wild win wind window wine winter wish woman wonder wood word world worry worse write wrong
`);

/** B1：能聊工作和抽象话题的一层 */
export const BAND_B1 = split(`
ability absolutely accept access accident according account achieve action active activity actually adapt add
addition admit advance advantage advertise advice affect afford afterwards agent agreement aim allow almost
alone along aloud alternative amount analyse analyze ancient announce annoy anxious apart apologize appear
apply appointment appreciate approach appropriate approve argue argument arrange arrest article artificial
aspect assist associate assume attach attack attempt attend attention attitude attract audience author
available average avoid award aware background balance ban bargain barrier basic basis battle behave
behaviour behavior belief belong benefit beyond bill blame blank block boring borrow bother brand brave brief
brilliant broad budget calm campaign cancel candidate capable capacity career case cash casual cause
celebrate challenge character charge charity chart chemical circumstance citizen civil claim clarify client
climate code collapse colleague collect combine comfort comment commit committee common communicate community
compare compete complain complex concentrate concept concern conclude condition confidence confirm conflict
confuse connect consider consist constant construct consult consume contact contain content context continue
contract contrast contribute control convenient convince cooperate cope copy correct count courage create
creative credit crime crisis criticize crowd cultural culture cure curious currency current damage deal debate
decade decision declare decline decrease definite degree delay deliver demand democracy demonstrate deny
department depend deposit depress describe deserve desire despite destroy detail determine develop device
devote differ digital direct disagree disappear disappoint discipline discount discover discuss disease
dismiss display distance distinguish distribute divide document domestic dominate doubt download dramatic due
duty eager earn economic economy edit effect efficient effort elect element eliminate embarrass emerge
emergency emotion emphasis employ empty enable encourage energy engage engine enhance ensure entertain
enthusiasm entire environment equal equipment error escape essential establish estimate evaluate eventually
evidence exact examine exceed excellent exchange exclude excuse exist expand expect expense expert explore
export expose express extend extra extreme facility factor failure fair faith familiar fashion feature fee
feedback figure finance firm fit fix flexible focus force forecast formal format former fortune found
foundation frame frequent frustrate fuel function fund fundamental furthermore gain gap gather gender generate
generation genuine gesture goal govern grade grant grateful guarantee guide habit handle hardly harm hesitate
highlight hire honest household huge humour humor identify identity ignore illegal illustrate image imagine
immediate impact implement imply import impose impress impression improve incident income indeed indicate
individual industry influence inform initial injure innocent innovation inquiry insist inspect inspire
install instance instead institute instruction insurance intend intense interact interfere internal interpret
interrupt interview introduce invest investigate involve issue item journey judge justify label labour labor
lack launch lay leadership leak lean legal length liberal licence license limit link liquid literature loan
local locate logic loyal luxury maintain major manage manner manufacture margin mark mass master material
maximum meanwhile measure media medium mention merely method minimum minor mixture mobile mode moderate modify
monitor mood moral mortgage motivate multiple mutual narrow nation native nature nearby necessity negative
neglect negotiate neighbour neighbor network neutral nevertheless nonsense norm notion nuclear objective
obligation observe obtain obvious occasion occupy occur odd offer official operate opinion opportunity oppose
option organic origin otherwise outcome output overall overcome overseas owe pace package panel participate
particular partner passion patient pattern perform permanent permit persuade phase phenomenon philosophy
physical pick pitch platform pleasant plenty plot policy polite politics pollution portion positive possess
potential poverty practical praise precise predict prefer pregnant prejudice preserve pressure prevent
previous primary principle priority private privilege procedure proceed process produce professional profit
progress prohibit promote proof proper property proportion propose prospect protect prove provide psychology
publish punish purchase purpose pursue qualify quantity quote race radical range rank rapid rare rate rather
ratio react realize recall recent recognize recommend recover reduce refer reflect reform refuse regard region
register regret regular reject relate relative relax release relevant reliable relief religion reluctant rely
remain remark remind remote remove repair replace reply represent reputation request require rescue research
reserve resident resist resolve resource respect respond responsible restore restrict retire reveal reverse
review revise reward rid risk role rough route routine row royal rural sample satisfy scale scan scare scheme
scope score search secure seek select senior sense sensitive separate sequence series session settle severe
shade shape share shift shock shortage sight signal significant silence similar situation skill slight
software solution somehow sophisticated sort source specific spread stable staff stake standard status steady
steep stick stock strategy strength stress stretch strict strike structure struggle style submit substance
substitute subtle sufficient suggest suit summary supply support suppose surface surround survey survive
suspect sustain switch symbol sympathy system tackle talent target task technical technique technology
temporary tend tension term terms theme theory therapy threat thorough thus tight tiny tone tool topic trace
track trade tradition transfer transform translate transport treat trend trial trigger trust typical ultimate
unique unit unless update upgrade urban urge usual valid value variety various vary version victim view
violence virtual visible vision volume voluntary vote wage warn wealth weapon whereas whether widespread
willing withdraw witness worth yield zone
`);

/** 一个词属于哪一档；不在表里的当 B2+ */
export function bandOf(word: string): 'A1' | 'A2' | 'B1' | 'B2' {
  const w = word.toLowerCase();
  if (BAND_A1.has(w)) return 'A1';
  if (BAND_A2.has(w)) return 'A2';
  if (BAND_B1.has(w)) return 'B1';
  return 'B2';
}

/** 常见短语动词。用出来是口语地道度的正面信号，值得在复盘里表扬 */
export const PHRASAL_VERBS = [
  'turn on', 'turn off', 'turn down', 'turn up', 'pick up', 'give up', 'look for', 'look after',
  'look forward to', 'find out', 'figure out', 'work out', 'come up with', 'get along', 'get back',
  'get used to', 'run into', 'run out of', 'put off', 'put up with', 'take off', 'take over',
  'bring up', 'set up', 'show up', 'end up', 'check in', 'check out', 'catch up', 'deal with',
  'hang out', 'go over', 'go through', 'hold on', 'sort out', 'carry out', 'break down', 'cut down on',
];

/** 从句/连接标记。用了就说明能组织复合句，不再是一句一顿 */
export const CONNECTIVES = [
  'because', 'although', 'though', 'even though', 'while', 'whereas', 'however', 'therefore',
  'so that', 'in order to', 'as long as', 'unless', 'if', 'when', 'after', 'before', 'since',
  'which', 'who', 'that', 'besides', 'moreover', 'on the other hand', 'for example', 'such as',
  'instead of', 'rather than', 'as a result', 'in fact', 'actually', 'basically', 'anyway',
];
