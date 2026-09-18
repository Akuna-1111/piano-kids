import { DEFAULT_VOICE_PRESET_ID, type VoicePresetId } from '@/core/audio/voicePresets';
import type { KeyboardSize } from '@/features/piano/pianoLayout';

/** 成长数据模型（文档九）。所有业务状态都收敛到这一个数据源。 */

export const PROGRESS_VERSION = 1;
export const SETTINGS_VERSION = 1;

/**
 * 默认皮肤 id。
 *
 * 放在 core 而不是 features/skins，是因为它属于**存档数据契约**：
 * 旧存档里存的就是这些 id 字符串，改名的成本由迁移层承担。
 * 这样 core/progress 不需要反向依赖 features（皮肤是 feature，成长是核心数据）。
 */
export const DEFAULT_SKIN_ID = 'wood';

/**
 * 已改名皮肤的 id 别名（旧存档 → 新 id）。
 *
 * 「彩虹」在材质化时改成了「原木」：设计规范 §3.3 明文禁止「默认彩虹渐变」，
 * 而 §46 要求皮肤是「给真实乐器更换材质」。旧存档里存的还是 `rainbow`，
 * 由 `migrateProgress` 自动映射，用户不需要做任何事。
 */
export const SKIN_ID_ALIASES: Readonly<Record<string, string>> = {
  rainbow: 'wood',
};

export interface StreakInfo {
  currentDays: number;
  longestDays: number;
  /** 本地自然日，格式 YYYY-MM-DD */
  lastPracticeDate: string | null;
}

export interface ProgressStats {
  songsStarted: number;
  songsCompleted: number;
  totalNotesPlayed: number;
  bestAccuracy: number;
  /** Phase 3 森林冒险使用；MVP 保留字段但不展示 */
  adventureLevel: number;
  /** Phase 3 节拍挑战使用 */
  bestRhythmCombo: number;
}

export interface AppProgress {
  version: number;
  /** 成长累计值，不会被消耗（文档 8.4） */
  starsTotal: number;
  equippedSkinId: string;
  unlockedSkinIds: string[];
  completedSongIds: string[];
  bestAccuracyBySong: Record<string, number>;
  streak: StreakInfo;
  stats: ProgressStats;
  achievements: string[];
}

/** 一次练习会话的原始结果。评分系统只产出它，不直接改存档。 */
export interface PracticeResult {
  songId: string;
  /** 0–100，pitch*0.7 + timing*0.3 */
  accuracy: number;
  pitchScore: number;
  timingScore: number;
  correctNotes: number;
  wrongNotes: number;
  totalNotesPlayed: number;
  durationMs: number;
  /** 是否完整弹完（未完整弹完不发星星，但仍记录统计） */
  completed: boolean;
  /** 零失误完成 */
  perfectRun: boolean;
  /** 中途弹错但最终完整弹完 */
  completedAfterMistake: boolean;
  maxCombo: number;
  /** 结束时间戳；不传则用 Date.now()（测试可注入固定值） */
  finishedAt?: number;
}

/** recordPracticeResult 的唯一返回结构（文档 10.5）。 */
export interface RewardResult {
  starsEarned: number;
  newlyUnlockedSkinIds: string[];
  newlyUnlockedAchievementIds: string[];
  totalStars: number;
  streakDays: number;
  /** 本次是否刷新了该曲目的历史最高准确率 */
  isNewBest: boolean;
}

/** recordPracticeResult 的完整产出：新存档 + 奖励事件。 */
export interface RecordOutcome {
  progress: AppProgress;
  reward: RewardResult;
}

// ------------------------------------------------------------------ 设置

export interface AppSettings {
  version: number;
  /** 0–1 */
  volume: number;
  keyboardSize: KeyboardSize;
  /** 白键是否显示音名 */
  showNoteNames: boolean;
  /**
   * 谱面上是否显示数字简谱（1=do 2=re 3=mi …）。
   * 中国孩子的琴谱以简谱为主，把它和五线谱位置并排给出，认谱快得多。
   */
  showSolfege: boolean;
  /** 谱面上是否显示唱名拼音（do re mi fa sol la si） */
  showPinyin: boolean;
  /** 时间判定窗口的宽松系数，>1 更宽松 */
  timingWindowScale: number;
  /**
   * 音色预设（三角钢琴 / 立式钢琴 / 电钢琴）。
   *
   * 属于**存档数据**：孩子选了一次音色，下次打开还应该是那个音色。
   * 存档里的字符串是契约的一部分，改 id 要同时改 `migrations.ts` 的别名表。
   */
  voicePreset: VoicePresetId;
  lastSongId: string | null;
  /** 手动降级动效（系统 prefers-reduced-motion 之外的自选项） */
  reducedMotion: boolean;
}

export function createDefaultProgress(): AppProgress {
  return {
    version: PROGRESS_VERSION,
    starsTotal: 0,
    equippedSkinId: DEFAULT_SKIN_ID,
    unlockedSkinIds: [DEFAULT_SKIN_ID],
    completedSongIds: [],
    bestAccuracyBySong: {},
    streak: {
      currentDays: 0,
      longestDays: 0,
      lastPracticeDate: null,
    },
    stats: {
      songsStarted: 0,
      songsCompleted: 0,
      totalNotesPlayed: 0,
      bestAccuracy: 0,
      adventureLevel: 1,
      bestRhythmCombo: 0,
    },
    achievements: [],
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    version: SETTINGS_VERSION,
    volume: 0.8,
    keyboardSize: 15,
    showNoteNames: true,
    // 启蒙阶段默认把「五线谱位置 ↔ 数字 ↔ 读音」三件事一起给出来
    showSolfege: true,
    showPinyin: true,
    timingWindowScale: 1,
    voicePreset: DEFAULT_VOICE_PRESET_ID,
    lastSongId: null,
    reducedMotion: false,
  };
}
