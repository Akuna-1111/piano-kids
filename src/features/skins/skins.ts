import { ACHIEVEMENTS } from '@/features/achievements/achievements';
import { getSongById } from '@/features/songs/songData';

/**
 * 皮肤数据（文档 10.3 / 10.4）。
 *
 * 只保存 themeId —— 不保存任何 CSS 字符串（设计规范 §33）。
 *
 * 刻意**没有**「皮肤图标」字段：§46 明确皮肤是给真实乐器更换材质，
 * 而不是给角色换服装；§12.1 的「琴键样品板」也不用图标表达皮肤。
 * 界面上直接渲染一小段该套材质的真实琴键（见 SkinSample），
 * 因此不需要再用一个徽章式的符号去指代它（§0.9 先删再加）。
 *
 * 儿童界面不出现 rarity「普通/稀有/传奇」，只保留内部 collectionGroup 用于排序。
 */

export type UnlockCondition =
  | { type: 'default' }
  | { type: 'stars'; count: number }
  | { type: 'songCompleted'; songId: string }
  | { type: 'streak'; days: number }
  | { type: 'accuracy'; threshold: number }
  | { type: 'adventure'; level: number }
  | { type: 'rhythmCombo'; combo: number }
  | { type: 'persistence'; achievementId: string }
  | { type: 'seasonal'; eventId: string };

export interface Skin {
  id: string;
  name: string;
  description: string;
  themeId: string;
  unlock: UnlockCondition;
  /** 内部排序分组，不在儿童界面展示竞争性标签 */
  collectionGroup?: 'starter' | 'growth' | 'skill' | 'longterm';
}

/**
 * 默认皮肤 id 与「已改名皮肤的 id 别名」都定义在 `core/progress/progressTypes.ts`。
 *
 * 理由：它们属于**存档数据契约**（旧存档里存的就是这些 id 字符串），
 * 放在 core 可以让 core/progress 不必反向依赖 features。
 * 这里重新导出，保持皮肤模块的调用方写法不变。
 */
export { DEFAULT_SKIN_ID, SKIN_ID_ALIASES } from '@/core/progress/progressTypes';

export const SKINS: readonly Skin[] = [
  {
    id: 'wood',
    name: '原木',
    description: '最开始的琴键，温暖干净的木头质感。',
    themeId: 'wood',
    unlock: { type: 'default' },
    collectionGroup: 'starter',
  },
  {
    id: 'forest',
    name: '森林',
    description: '弹完《小星星》，琴键会长出叶子。',
    themeId: 'forest',
    unlock: { type: 'songCompleted', songId: 'twinkle-star' },
    collectionGroup: 'starter',
  },
  {
    id: 'star',
    name: '夜空',
    description: '攒够 10 颗星星，就有月光陪着你。',
    themeId: 'night',
    unlock: { type: 'stars', count: 10 },
    collectionGroup: 'growth',
  },
  {
    id: 'crystal',
    name: '水晶',
    description: '某一首歌弹到 90% 准确率。',
    themeId: 'crystal',
    unlock: { type: 'accuracy', threshold: 90 },
    collectionGroup: 'skill',
  },
  {
    id: 'candy',
    name: '糖果',
    description: '累计 30 颗星星。',
    themeId: 'candy',
    unlock: { type: 'stars', count: 30 },
    collectionGroup: 'growth',
  },
  {
    id: 'fire',
    name: '火焰',
    description: '连续 3 天来弹琴。',
    themeId: 'fire',
    unlock: { type: 'streak', days: 3 },
    collectionGroup: 'skill',
  },
  {
    id: 'courage',
    name: '勇气',
    description: '弹错了也没有放弃，把整首弹完。',
    themeId: 'courage',
    unlock: { type: 'persistence', achievementId: 'comeback' },
    collectionGroup: 'skill',
  },
  {
    id: 'space',
    name: '太空',
    description: '累计 50 颗星星，去更远的地方。',
    themeId: 'space',
    unlock: { type: 'stars', count: 50 },
    collectionGroup: 'longterm',
  },
];

const SKIN_BY_ID = new Map(SKINS.map((skin) => [skin.id, skin]));

export function getSkinById(id: string): Skin | undefined {
  return SKIN_BY_ID.get(id);
}

/** 装扮页展示顺序：已解锁优先靠前，其余按解锁条件「由易到难」。 */
export function getOrderedSkins(unlockedIds: readonly string[]): Skin[] {
  const owned = new Set(unlockedIds);
  const groupWeight: Record<NonNullable<Skin['collectionGroup']>, number> = {
    starter: 0,
    growth: 1,
    skill: 2,
    longterm: 3,
  };
  return [...SKINS].sort((a, b) => {
    const ownedDiff = Number(owned.has(b.id)) - Number(owned.has(a.id));
    if (ownedDiff !== 0) return ownedDiff;
    const groupDiff =
      groupWeight[a.collectionGroup ?? 'starter'] - groupWeight[b.collectionGroup ?? 'starter'];
    if (groupDiff !== 0) return groupDiff;
    return SKINS.indexOf(a) - SKINS.indexOf(b);
  });
}

const ACHIEVEMENT_NAME = new Map(ACHIEVEMENTS.map((item) => [item.id, item.name]));

/** 给家长 / 已解锁进度看的人话描述（儿童界面只在未解锁卡片上显示一句）。 */
export function describeUnlockCondition(condition: UnlockCondition): string {
  switch (condition.type) {
    case 'default':
      return '一开始就有';
    case 'stars':
      return `累计 ${condition.count} 颗星星`;
    case 'songCompleted':
      return `完整弹完《${getSongById(condition.songId)?.title ?? '指定歌曲'}》`;
    case 'streak':
      return `连续练习 ${condition.days} 天`;
    case 'accuracy':
      return `单曲准确率达到 ${condition.threshold}%`;
    case 'adventure':
      return `音乐森林到达第 ${condition.level} 关`;
    case 'rhythmCombo':
      return `节拍挑战连击 ${condition.combo}`;
    case 'persistence':
      return `获得「${ACHIEVEMENT_NAME.get(condition.achievementId) ?? '隐藏勋章'}」`;
    case 'seasonal':
      return '节日活动限定';
    default:
      return '';
  }
}
