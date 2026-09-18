import {
  DEFAULT_VOICE_PRESET_ID,
  isVoicePresetId,
} from '@/core/audio/voicePresets';
import type { KeyboardSize } from '@/features/piano/pianoLayout';
import {
  DEFAULT_SKIN_ID,
  PROGRESS_VERSION,
  SETTINGS_VERSION,
  SKIN_ID_ALIASES,
  createDefaultProgress,
  createDefaultSettings,
  type AppProgress,
  type AppSettings,
} from './progressTypes';

/**
 * 数据迁移（文档 9.3）。
 * 绝不直接覆盖旧数据：先读原始对象，逐版本补齐 / 转换，再落库。
 * 迁移函数是纯函数，方便单测覆盖「v1 存档 → 未来版本」的路径。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampAccuracy(value: unknown, fallback = 0): number {
  return Math.max(0, Math.min(100, num(value, fallback)));
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === 'number' && Number.isFinite(raw)) result[key] = raw;
  }
  return result;
}

/** 把历史版本里改过名的皮肤 id 映射到当前 id。 */
function aliasSkinId(id: string): string {
  return SKIN_ID_ALIASES[id] ?? id;
}

/** 把任意来源的对象规整成当前版本的 AppProgress。 */
export function migrateProgress(input: unknown): AppProgress {
  const defaults = createDefaultProgress();
  if (!isRecord(input)) return defaults;

  const streakRaw = isRecord(input.streak) ? input.streak : {};
  const statsRaw = isRecord(input.stats) ? input.stats : {};

  // 已改名的皮肤 id 做一次别名映射（例如批次 3 把「彩虹」材质化成「原木」）
  const unlocked = strArray(input.unlockedSkinIds).map(aliasSkinId);
  if (!unlocked.includes(DEFAULT_SKIN_ID)) unlocked.unshift(DEFAULT_SKIN_ID);

  const equipped = aliasSkinId(str(input.equippedSkinId, defaults.equippedSkinId));
  const safeEquipped = unlocked.includes(equipped) ? equipped : unlocked[0];

  const lastPracticeDate = streakRaw.lastPracticeDate;

  const progress: AppProgress = {
    version: PROGRESS_VERSION,
    starsTotal: Math.max(0, Math.floor(num(input.starsTotal, 0))),
    equippedSkinId: safeEquipped,
    unlockedSkinIds: unlocked,
    completedSongIds: strArray(input.completedSongIds),
    bestAccuracyBySong: numberRecord(input.bestAccuracyBySong),
    streak: {
      currentDays: Math.max(0, Math.floor(num(streakRaw.currentDays, 0))),
      longestDays: Math.max(0, Math.floor(num(streakRaw.longestDays, 0))),
      lastPracticeDate: typeof lastPracticeDate === 'string' ? lastPracticeDate : null,
    },
    stats: {
      songsStarted: Math.max(0, Math.floor(num(statsRaw.songsStarted, 0))),
      songsCompleted: Math.max(0, Math.floor(num(statsRaw.songsCompleted, 0))),
      totalNotesPlayed: Math.max(0, Math.floor(num(statsRaw.totalNotesPlayed, 0))),
      bestAccuracy: clampAccuracy(statsRaw.bestAccuracy, 0),
      adventureLevel: Math.max(1, Math.floor(num(statsRaw.adventureLevel, 1))),
      bestRhythmCombo: Math.max(0, Math.floor(num(statsRaw.bestRhythmCombo, 0))),
    },
    achievements: strArray(input.achievements),
  };

  // 一致性修补：不允许出现「历史最长连续天数比当前还短」这类自相矛盾的存档
  progress.streak.longestDays = Math.max(
    progress.streak.longestDays,
    progress.streak.currentDays,
  );
  progress.stats.songsCompleted = Math.max(
    progress.stats.songsCompleted,
    progress.completedSongIds.length,
  );
  progress.stats.bestAccuracy = Math.max(
    progress.stats.bestAccuracy,
    ...Object.values(progress.bestAccuracyBySong),
    0,
  );

  return progress;
}

/**
 * 可用档位。产品只提供 15 键（C3–C5，中央C 在正中间），所以**旧存档里的 8 / 25 一律回落到 15**。
 */
const VALID_KEYBOARD_SIZES: readonly number[] = [15];

export function migrateSettings(input: unknown): AppSettings {
  const defaults = createDefaultSettings();
  if (!isRecord(input)) return defaults;

  const keyboardSize = num(input.keyboardSize, defaults.keyboardSize);
  const lastSongId = input.lastSongId;

  return {
    version: SETTINGS_VERSION,
    volume: Math.max(0, Math.min(1, num(input.volume, defaults.volume))),
    keyboardSize: (VALID_KEYBOARD_SIZES.includes(keyboardSize)
      ? keyboardSize
      : defaults.keyboardSize) as KeyboardSize,
    showNoteNames: typeof input.showNoteNames === 'boolean' ? input.showNoteNames : true,
    showSolfege: typeof input.showSolfege === 'boolean' ? input.showSolfege : true,
    showPinyin: typeof input.showPinyin === 'boolean' ? input.showPinyin : true,
    timingWindowScale: Math.max(0.5, Math.min(3, num(input.timingWindowScale, 1))),
    // 音色 id 是存档契约：不认识的值（旧存档没有这个字段 / 手改过）一律回落到默认音色
    voicePreset: isVoicePresetId(input.voicePreset)
      ? input.voicePreset
      : DEFAULT_VOICE_PRESET_ID,
    lastSongId: typeof lastSongId === 'string' ? lastSongId : null,
    reducedMotion: typeof input.reducedMotion === 'boolean' ? input.reducedMotion : false,
  };
}
