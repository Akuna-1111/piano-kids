import type { AppProgress, PracticeResult } from '@/core/progress/progressTypes';
import type { IconName } from '@/shared/ui/Icon';

/**
 * 勋章（文档 20.5）。
 *
 * 关键设计：把「特殊行为」（弹错后仍坚持弹完、连续练习、长期积累）
 * 统一抽象成 achievement，皮肤只作为消费者检查 `progress.achievements`。
 * 这样皮肤模块永远不需要知道「为什么达成」，persistence / event 也不需要写死 return false。
 *
 * 图形一律用项目自绘 SVG 图标（设计规范 §3.2 禁止 Emoji、§8.1 禁止字符号代替图标），
 * 因此这里只保存 `iconId`，由渲染层交给 <Icon /> 解析。
 */

export interface AchievementContext {
  /** 已完成本轮统计更新、但尚未加入 achievements 的存档 */
  progress: AppProgress;
  result: PracticeResult;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  iconId: IconName;
  /** 隐藏成就：解锁前在界面上只显示「?」 */
  hidden?: boolean;
  check: (ctx: AchievementContext) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'first-song',
    name: '第一首歌',
    description: '完整弹完一首歌',
    iconId: 'sprout',
    check: ({ progress }) => progress.stats.songsCompleted >= 1,
  },
  {
    id: 'three-songs',
    name: '小小的旅行',
    description: '完整弹完 3 首歌',
    iconId: 'compass',
    check: ({ progress }) => progress.stats.songsCompleted >= 3,
  },
  {
    id: 'notes-100',
    name: '一百个音符',
    description: '累计按下 100 个音',
    iconId: 'note',
    check: ({ progress }) => progress.stats.totalNotesPlayed >= 100,
  },
  {
    id: 'notes-500',
    name: '五百个音符',
    description: '累计按下 500 个音',
    iconId: 'notes',
    check: ({ progress }) => progress.stats.totalNotesPlayed >= 500,
  },
  {
    id: 'first-perfect',
    name: '一个都没错',
    description: '零失误完整弹完一首歌',
    iconId: 'gem',
    check: ({ result }) => result.completed && result.perfectRun,
  },
  {
    id: 'accuracy-95',
    name: '稳稳的小手',
    description: '单曲准确率达到 95%',
    iconId: 'target',
    check: ({ result }) => result.completed && result.accuracy >= 95,
  },
  {
    id: 'comeback',
    name: '不放弃',
    description: '弹错了也坚持把整首弹完',
    iconId: 'trending-up',
    hidden: true,
    check: ({ result }) => result.completed && result.completedAfterMistake,
  },
  {
    id: 'streak-3',
    name: '连来三天',
    description: '连续 3 天来弹琴',
    iconId: 'calendar',
    check: ({ progress }) => progress.streak.currentDays >= 3,
  },
  {
    id: 'streak-7',
    name: '一周的小琴手',
    description: '连续 7 天来弹琴',
    iconId: 'medal',
    check: ({ progress }) => progress.streak.currentDays >= 7,
  },
];

const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((item) => [item.id, item]));

export function getAchievementById(id: string): Achievement | undefined {
  return ACHIEVEMENT_BY_ID.get(id);
}

/** 返回本轮新解锁的成就 id（已解锁的不会重复出现）。 */
export function evaluateAchievements(
  progress: AppProgress,
  result: PracticeResult,
): string[] {
  const owned = new Set(progress.achievements);
  const newly: string[] = [];
  for (const achievement of ACHIEVEMENTS) {
    if (owned.has(achievement.id)) continue;
    try {
      if (achievement.check({ progress, result })) newly.push(achievement.id);
    } catch {
      // 单个成就判定异常不应影响整次结算
    }
  }
  return newly;
}
