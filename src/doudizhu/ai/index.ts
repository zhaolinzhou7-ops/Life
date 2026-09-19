/** 斗地主 AI 对外入口：牌面分析 -> 候选生成 -> 合法性过滤 -> 局面评价 -> 策略选择 -> 执行 */
export { analyzeHand, minHands, minHandsCached, suggestBid, toCounts, type HandAnalysis } from './analysis';
export { generateCandidates, filterLegal, hintMove } from './candidates';
export {
  buildMemory,
  memoryFacts,
  publicViewFor,
  isUnbeatableMove,
  isUnbeatableSingle,
  maxUnseenRank,
  possibleBombs,
  rocketPossible,
  unseenOf,
  type CardMemory,
  type MemoryFacts,
  type PublicView,
} from './memory';
export {
  DIFFICULTY_NAMES,
  bidAdvice,
  decideBid,
  decidePlay,
  reviewHumanPlay,
  type Decision,
  type Difficulty,
} from './strategy';
