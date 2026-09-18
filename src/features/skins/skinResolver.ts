import type { AppProgress } from '@/core/progress/progressTypes';
import { DEFAULT_SKIN_ID, getSkinById, SKINS, type Skin, type UnlockCondition } from './skins';
import { getSkinTheme, type SkinTheme } from './skinThemes';

/**
 * 皮肤解析（文档 10.6 / 10.8）。
 *
 * 这里只做两件事：
 *  1. 把 UnlockCondition 判定成布尔值（判定输入永远是「已经更新完的 progress」）。
 *  2. 解析当前应当渲染的皮肤：activeSkin = previewSkinId ?? equippedSkinId。
 */

/** 判定一个解锁条件是否满足。输入必须是事务内更新后的存档。 */
export function evaluateUnlockCondition(
  condition: UnlockCondition,
  progress: AppProgress,
): boolean {
  switch (condition.type) {
    case 'default':
      return true;

    case 'stars':
      return progress.starsTotal >= condition.count;

    // 文档 20.4：必须是「这一首」而不是「任意一首」
    case 'songCompleted':
      return progress.completedSongIds.includes(condition.songId);

    case 'streak':
      return progress.streak.currentDays >= condition.days;

    // 历史上任一曲目的最高准确率
    case 'accuracy':
      return (
        progress.stats.bestAccuracy >= condition.threshold ||
        Object.values(progress.bestAccuracyBySong).some((v) => v >= condition.threshold)
      );

    case 'adventure':
      return progress.stats.adventureLevel >= condition.level;

    case 'rhythmCombo':
      return progress.stats.bestRhythmCombo >= condition.combo;

    // 文档 20.5：不写死 return false，统一看成就表
    case 'persistence':
      return progress.achievements.includes(condition.achievementId);

    case 'seasonal':
      return progress.achievements.includes(condition.eventId);

    default:
      return false;
  }
}

/** 皮肤当前是否可用（存档里的解锁列表优先，其次实时判定）。 */
export function isSkinUnlocked(skin: Skin, progress: AppProgress): boolean {
  if (progress.unlockedSkinIds.includes(skin.id)) return true;
  return evaluateUnlockCondition(skin.unlock, progress);
}

/** 事务内使用：找出本次新解锁的皮肤 id。 */
export function findNewlyUnlockedSkinIds(progress: AppProgress): string[] {
  return SKINS.filter((skin) => evaluateUnlockCondition(skin.unlock, progress))
    .map((skin) => skin.id)
    .filter((id) => !progress.unlockedSkinIds.includes(id));
}

/**
 * 解析当前渲染的皮肤。
 * 预览不修改正式装备状态（文档 10.8）。
 */
export function resolveActiveSkin(
  equippedSkinId: string,
  previewSkinId: string | null = null,
): Skin {
  const candidate = previewSkinId ?? equippedSkinId;
  return getSkinById(candidate) ?? getSkinById(DEFAULT_SKIN_ID)!;
}

export function resolveSkinTheme(skin: Skin): SkinTheme {
  return getSkinTheme(skin.themeId);
}

/** 未解锁皮肤的进度提示（例如「还差 3 颗星星」）。 */
export function describeSkinProgress(skin: Skin, progress: AppProgress): string | null {
  switch (skin.unlock.type) {
    case 'stars': {
      const remain = skin.unlock.count - progress.starsTotal;
      return remain > 0 ? `还差 ${remain} 颗星星` : null;
    }
    case 'streak': {
      const remain = skin.unlock.days - progress.streak.currentDays;
      return remain > 0 ? `还差 ${remain} 天` : null;
    }
    case 'accuracy': {
      const best = Math.max(progress.stats.bestAccuracy, 0);
      return `最高准确率 ${Math.round(best)}%`;
    }
    default:
      return null;
  }
}
