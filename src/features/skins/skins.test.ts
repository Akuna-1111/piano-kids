import { describe, expect, it } from 'vitest';
import { createDefaultProgress, type AppProgress } from '@/core/progress/progressTypes';
import { ACHIEVEMENTS } from '@/features/achievements/achievements';
import {
  DEFAULT_SKIN_ID,
  SKIN_ID_ALIASES,
  SKINS,
  describeUnlockCondition,
  getOrderedSkins,
  getSkinById,
  type Skin,
} from './skins';
import {
  ALLOWED_SKIN_VARS,
  DEFAULT_THEME_ID,
  getSkinTheme,
  SKIN_THEMES,
  themeToCssVars,
} from './skinThemes';
import {
  describeSkinProgress,
  evaluateUnlockCondition,
  findNewlyUnlockedSkinIds,
  isSkinUnlocked,
  resolveActiveSkin,
} from './skinResolver';

describe('皮肤系统', () => {
  it('每套皮肤都指向注册表里真实存在的主题', () => {
    for (const skin of SKINS) {
      expect(SKIN_THEMES[skin.themeId]).toBeDefined();
      expect(getSkinTheme(skin.themeId).id).toBe(skin.themeId);
    }
  });

  it('皮肤只覆盖「皮肤层」语义变量，绝不重写整个应用的 CSS（文档 3.2 / 11.2）', () => {
    for (const theme of Object.values(SKIN_THEMES)) {
      const vars = Object.keys(themeToCssVars(theme));
      expect(vars).toEqual([...ALLOWED_SKIN_VARS]);
      for (const name of vars) {
        expect(name.startsWith('--skin-')).toBe(true);
      }
    }
  });

  it('皮肤数据里不保存任何 CSS 字符串（文档 10.2）', () => {
    for (const skin of SKINS) {
      const values = Object.values(skin);
      for (const value of values) {
        if (typeof value === 'string') {
          expect(value).not.toContain('gradient');
          expect(value).not.toContain('rgb');
          expect(value).not.toContain('#');
        }
      }
    }
  });

  it('儿童界面数据里没有 rarity / 价格 / 商店这类字段（文档 10.1 / 10.3）', () => {
    const banned = ['rarity', 'price', 'cost', 'shop', 'buy', 'currency'];
    for (const skin of SKINS as unknown as Record<string, unknown>[]) {
      for (const key of banned) {
        expect(Object.keys(skin)).not.toContain(key);
      }
    }
  });

  it('默认皮肤恒为可用，且不依赖任何条件', () => {
    const rainbow = getSkinById(DEFAULT_SKIN_ID)!;
    expect(rainbow.unlock.type).toBe('default');
    expect(evaluateUnlockCondition(rainbow.unlock, createDefaultProgress())).toBe(true);
  });

  it('新存档只有默认皮肤，其它全部锁上', () => {
    const progress = createDefaultProgress();
    const unlocked = SKINS.filter((skin) => isSkinUnlocked(skin, progress));
    expect(unlocked.map((skin) => skin.id)).toEqual([DEFAULT_SKIN_ID]);
  });

  it('每个解锁条件都能给出人话描述，且不抛错', () => {
    for (const skin of SKINS) {
      expect(describeUnlockCondition(skin.unlock).length).toBeGreaterThan(0);
      expect(() => evaluateUnlockCondition(skin.unlock, createDefaultProgress())).not.toThrow();
    }
  });

  it('未实现的解锁类型（冒险 / 节拍 / 节日）判定为 false，而不是崩溃', () => {
    const progress = createDefaultProgress();
    const conditions = [
      { type: 'adventure', level: 5 },
      { type: 'rhythmCombo', combo: 20 },
      { type: 'seasonal', eventId: 'spring-2025' },
    ] as const;
    for (const condition of conditions) {
      expect(evaluateUnlockCondition(condition, progress)).toBe(false);
    }
  });

  it('seasonal / persistence 走成就表：拿到对应成就即视为满足（文档 20.5）', () => {
    const progress: AppProgress = {
      ...createDefaultProgress(),
      achievements: ['spring-2025', 'comeback'],
    };
    expect(evaluateUnlockCondition({ type: 'seasonal', eventId: 'spring-2025' }, progress)).toBe(true);
    expect(evaluateUnlockCondition({ type: 'persistence', achievementId: 'comeback' }, progress)).toBe(true);
    expect(evaluateUnlockCondition({ type: 'persistence', achievementId: 'nope' }, progress)).toBe(false);
  });

  it('持久化条件引用的成就 id 都是真实存在的', () => {
    const ids = new Set(ACHIEVEMENTS.map((item) => item.id));
    for (const skin of SKINS) {
      if (skin.unlock.type === 'persistence') {
        expect(ids.has(skin.unlock.achievementId)).toBe(true);
      }
    }
  });

  it('星星阈值刚好达到时解锁，超过阈值也解锁', () => {
    const starSkin = SKINS.find((skin) => skin.unlock.type === 'stars' && skin.unlock.count === 10)!;
    const at = { ...createDefaultProgress(), starsTotal: 10 };
    const over = { ...createDefaultProgress(), starsTotal: 11 };
    const under = { ...createDefaultProgress(), starsTotal: 9 };
    expect(isSkinUnlocked(starSkin, at)).toBe(true);
    expect(isSkinUnlocked(starSkin, over)).toBe(true);
    expect(isSkinUnlocked(starSkin, under)).toBe(false);
    expect(describeSkinProgress(starSkin, under)).toBe('还差 1 颗星星');
  });

  it('findNewlyUnlockedSkinIds 不会重复返回已解锁的皮肤', () => {
    const progress: AppProgress = {
      ...createDefaultProgress(),
      starsTotal: 100,
      unlockedSkinIds: [DEFAULT_SKIN_ID, 'star', 'candy', 'space'],
    };
    const newly = findNewlyUnlockedSkinIds(progress);
    expect(newly).not.toContain('star');
    expect(newly).not.toContain('candy');
    expect(newly).not.toContain('space');
    // 森林 / 水晶 / 火焰 / 勇气 的条件本轮尚未满足
    expect(newly).toEqual([]);
  });

  it('预览不修改正式装备状态，关闭后立即恢复（文档 10.8）', () => {
    const progress: AppProgress = {
      ...createDefaultProgress(),
      equippedSkinId: DEFAULT_SKIN_ID,
      unlockedSkinIds: [DEFAULT_SKIN_ID, 'star'],
    };
    expect(resolveActiveSkin(progress.equippedSkinId, 'star').id).toBe('star');
    expect(resolveActiveSkin(progress.equippedSkinId, null).id).toBe(DEFAULT_SKIN_ID);
    expect(progress.equippedSkinId).toBe(DEFAULT_SKIN_ID);
  });

  it('装备了不存在的皮肤时安全回落到默认皮肤', () => {
    expect(resolveActiveSkin('does-not-exist', null).id).toBe(DEFAULT_SKIN_ID);
    expect(getSkinTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID);
  });

  it('装扮页排序：已解锁靠前，其余按由易到难', () => {
    const ordered = getOrderedSkins([DEFAULT_SKIN_ID, 'space']);
    expect(ordered[0].id).toBe(DEFAULT_SKIN_ID);
    expect(ordered[1].id).toBe('space');
    const rest = ordered.slice(2).map((skin: Skin) => skin.collectionGroup);
    const weight: Record<string, number> = { starter: 0, growth: 1, skill: 2, longterm: 3 };
    for (let i = 1; i < rest.length; i += 1) {
      expect(weight[rest[i - 1] ?? 'starter']).toBeLessThanOrEqual(weight[rest[i] ?? 'starter']);
    }
  });

  it('皮肤 id 唯一', () => {
    expect(new Set(SKINS.map((skin) => skin.id)).size).toBe(SKINS.length);
  });

  it('旧 id 别名只指向当前真实存在的皮肤（改名的皮肤不会留下死引用）', () => {
    const ids = new Set(SKINS.map((skin) => skin.id));
    for (const [oldId, newId] of Object.entries(SKIN_ID_ALIASES)) {
      expect(ids.has(newId), `${oldId} → ${newId}，但 ${newId} 不存在`).toBe(true);
      expect(ids.has(oldId), `${oldId} 已经是当前 id，不需要别名`).toBe(false);
    }
  });

  it('设计规范 §46：每套皮肤都声明了「材质」，而不只是颜色', () => {
    for (const skin of SKINS) {
      const theme = getSkinTheme(skin.themeId);
      expect(theme.material.trim().length).toBeGreaterThan(0);
    }
  });
});
