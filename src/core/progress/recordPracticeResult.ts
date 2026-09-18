import { evaluateAchievements } from '@/features/achievements/achievements';
import { findNewlyUnlockedSkinIds } from '@/features/skins/skinResolver';
import type {
  AppProgress,
  PracticeResult,
  RecordOutcome,
  RewardResult,
  StreakInfo,
} from './progressTypes';

/**
 * recordPracticeResult —— 唯一业务入口（文档 10.5 / 20.3）。
 *
 * V2 的致命问题是：
 *   addStars(); updateStats(); checkUnlocks();
 * 三个 React state 更新是异步的，checkUnlocks 可能读到旧 progress，
 * 于是「刚弹完一首歌」的皮肤要等下一次状态变化才出现。
 *
 * 这里改成纯函数式事务：一次算完，一次性提交，并把奖励结果**同步返回**给完成页。
 * 因此完成页不依赖「React state 是否已经刷新」。
 */

/** 星星规则（文档 8.4）：星星是成长累计值，不会被消耗。 */
export function computeStars(accuracy: number): number {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  return 1;
}

/** 本地自然日 key（YYYY-MM-DD）。刻意不用 toISOString，避免时区把日期算错。 */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 日期 key 加减天数（同样按本地自然日）。 */
export function addDaysToKey(key: string, delta: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  date.setDate(date.getDate() + delta);
  return toLocalDateKey(date);
}

/**
 * 连续练习（文档 10.7）。
 * 绝不做简单的 streakDays += 1，必须按 lastPracticeDate 判断：
 *   昨天练过 → +1 ；今天已经练过 → 不重复增加 ；断档 → 重置为 1
 */
export function updateStreak(streak: StreakInfo, todayKey: string): StreakInfo {
  if (streak.lastPracticeDate === todayKey) {
    return {
      currentDays: Math.max(1, streak.currentDays),
      longestDays: Math.max(streak.longestDays, streak.currentDays, 1),
      lastPracticeDate: todayKey,
    };
  }

  const yesterdayKey = addDaysToKey(todayKey, -1);
  const currentDays = streak.lastPracticeDate === yesterdayKey ? streak.currentDays + 1 : 1;

  return {
    currentDays,
    longestDays: Math.max(streak.longestDays, currentDays),
    lastPracticeDate: todayKey,
  };
}

const EMPTY_REWARD: RewardResult = {
  starsEarned: 0,
  newlyUnlockedSkinIds: [],
  newlyUnlockedAchievementIds: [],
  totalStars: 0,
  streakDays: 0,
  isNewBest: false,
};

/**
 * 一次练习结算：
 *   计算星星 → 更新歌曲记录 → 更新最佳成绩 → 更新连续练习
 *   → 检测成就 → 检测皮肤解锁 → 生成 RewardEvent → 一次性提交
 */
export function recordPracticeResult(
  progress: AppProgress,
  result: PracticeResult,
  now: Date = new Date(),
): RecordOutcome {
  const todayKey = toLocalDateKey(now);
  const starsEarned = result.completed ? computeStars(result.accuracy) : 0;

  const completedSongIds = [...progress.completedSongIds];
  if (result.completed && !completedSongIds.includes(result.songId)) {
    completedSongIds.push(result.songId);
  }

  const prevBest = progress.bestAccuracyBySong[result.songId] ?? 0;
  const isNewBest = result.accuracy > prevBest;
  const bestAccuracyBySong = isNewBest
    ? { ...progress.bestAccuracyBySong, [result.songId]: result.accuracy }
    : { ...progress.bestAccuracyBySong };

  const streak = updateStreak(progress.streak, todayKey);

  // 文档 20.1 / 20.2：songsCompleted 必须累加；bestAccuracy 必须与历史值比较
  const stats = {
    ...progress.stats,
    songsStarted: progress.stats.songsStarted + 1,
    songsCompleted: progress.stats.songsCompleted + (result.completed ? 1 : 0),
    totalNotesPlayed: progress.stats.totalNotesPlayed + Math.max(0, result.totalNotesPlayed),
    bestAccuracy: Math.max(progress.stats.bestAccuracy, result.accuracy),
  };

  const afterStats: AppProgress = {
    ...progress,
    starsTotal: progress.starsTotal + starsEarned,
    completedSongIds,
    bestAccuracyBySong,
    streak,
    stats,
  };

  // 先成就，再皮肤 —— 这样 persistence 类型（依赖 achievements）在同一事务内就能命中
  const newlyUnlockedAchievementIds = evaluateAchievements(afterStats, result);
  const withAchievements: AppProgress =
    newlyUnlockedAchievementIds.length > 0
      ? { ...afterStats, achievements: [...afterStats.achievements, ...newlyUnlockedAchievementIds] }
      : afterStats;

  const newlyUnlockedSkinIds = findNewlyUnlockedSkinIds(withAchievements);
  const finalProgress: AppProgress =
    newlyUnlockedSkinIds.length > 0
      ? { ...withAchievements, unlockedSkinIds: [...withAchievements.unlockedSkinIds, ...newlyUnlockedSkinIds] }
      : withAchievements;

  return {
    progress: finalProgress,
    reward: {
      starsEarned,
      newlyUnlockedSkinIds,
      newlyUnlockedAchievementIds,
      totalStars: finalProgress.starsTotal,
      streakDays: finalProgress.streak.currentDays,
      isNewBest,
    },
  };
}

export { EMPTY_REWARD };
