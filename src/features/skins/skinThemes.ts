/**
 * 皮肤主题注册表（文档 10.2 + 设计规范 §11 / §46 / §47）。
 *
 * 皮肤数据里只保存 themeId，颜色由这里的 TypeScript 主题表提供，
 * 再由 themeToCssVars() 转成受控的 CSS 变量写入。
 * 好处：类型安全、不可能把任意字符串塞进 style、设计系统统一、数据层不被视觉污染。
 *
 * ## 设计规范对这一层的约束
 *
 * §46 Skin Is Material：皮肤是「给真实乐器更换材质」，不是「给游戏角色换服装」。
 *   方向是木材 / 纸张 / 石材 / 金属 / 夜色 / 自然，而不是角色 / 表情 / 贴图 / 贴纸 / 徽章。
 *   因此每套主题都带一个 `material` 字段，说明它是什么材质，而不只是什么颜色。
 *
 * §11.2：皮肤围绕一种视觉材料或空间氛围展开，全部皮肤经过同一套设计质量控制。
 *
 * §11.4 皮肤强度：70% 基础琴键结构 / 20% 皮肤材质 / 10% 装饰。
 *   落地方式：琴键几何完全由 piano.css 决定，皮肤只改色与边界；装饰只体现在 stageBg 与 decoration。
 *
 * §47 Skin Contrast Rule：无论任何皮肤，音名可读 / 黑白键关系可辨 / 高亮状态明确 / 按下状态可见。
 *   这一条由 `skins.contrast.test.ts` 用 WCAG 对比度**自动强制**，改配色会被测试拦住。
 *   实测教训：深色皮肤的「白键」如果也做得很暗，黑白键就只有 1.5:1，孩子分不出键位 ——
 *   因此夜空 / 太空的琴键保持在中间调，把「夜色」交给舞台背景去表达（可弹 > 好看，§47）。
 *
 * §10.5：下一键提示是最重要的视觉反馈，必须在**被高亮的那个键**上看得见。
 *   一个颜色无法同时对比浅色键面与深色键面，因此这里拆成两个变量：
 *   `guide` 用于白键，`guideOnBlack` 用于黑键。规范要求的是「高亮明确」，不是「高亮同色」。
 *
 * §10.2：白键「极轻微纵向明暗变化可以使用，但不要做明显玻璃渐变」。
 *   因此 keyBg 的渐变两端对比度被限制在 1.12:1 以内（由测试强制）；
 *   按下态与黑键一律用纯色，避免任何「玻璃感」。
 *
 * 皮肤只允许覆盖以下语义变量：
 *   琴键：--skin-key-bg / --skin-key-active / --skin-key-border / --skin-key-shadow
 *        --skin-key-black-bg / --skin-key-black-active
 *        --skin-key-label / --skin-key-black-label（音名，§47 要求可读）
 *   引导：--skin-guide / --skin-guide-on-black
 *   氛围：--skin-stage-bg / --skin-decoration
 */

export interface SkinTheme {
  id: string;
  /** 材质 / 空间氛围（§11.2、§46）—— 不是「颜色主题」 */
  material: string;
  /** 装扮页的小色卡（无需为每套皮肤准备图片资源） */
  swatch: {
    key: string;
    active: string;
    stage: string;
    guide: string;
  };
  /** 白键键面。允许极轻微纵向明暗变化（§10.2），两端对比度必须 ≤ 1.12:1 */
  keyBg: string;
  /** 白键按下态。纯色（§10.4 用 background shift，不用 glow） */
  keyActive: string;
  keyBorder: string;
  keyShadow: string;
  /** 白键上的音名标签。必须对 keyBg 达到可读对比度（§47） */
  keyLabel: string;
  keyBlackBg: string;
  keyBlackActive: string;
  /** 黑键上的音名标签 */
  keyBlackLabel: string;
  /** 当前目标键 / 下一键提示 —— 用于浅色键面（§10.5、§5.3） */
  guide: string;
  /** 同一个提示色在黑键上的版本（深色键面需要更亮的取值） */
  guideOnBlack: string;
  /** 少量舞台背景（§11.1） */
  stageBg: string;
  /** 少量装饰线条（§11.1） */
  decoration: string;
}

export const DEFAULT_THEME_ID = 'wood';

/** 极轻微纵向明暗：两端亮度差被测试限制在这个对比度以内（§10.2） */
export const MAX_KEY_SURFACE_CONTRAST = 1.12;

export const SKIN_THEMES: Record<string, SkinTheme> = {
  // ------------------------------------------------------------ 自然木质（默认）
  wood: {
    id: 'wood',
    material: '自然木质',
    swatch: { key: '#fbf7f0', active: '#ded3bd', stage: '#efe9de', guide: '#a9662f' },
    keyBg: 'linear-gradient(180deg, #fffdf9 0%, #fbf7f0 100%)',
    keyActive: '#ded3bd',
    keyBorder: '#d9cdb6',
    keyShadow: 'rgba(74, 58, 34, 0.2)',
    keyLabel: '#6b5b45',
    keyBlackBg: '#3a342a',
    keyBlackActive: '#5c5342',
    keyBlackLabel: '#e8dfce',
    guide: '#a9662f',
    guideOnBlack: '#e8b071',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fdfbf7 0%, #efe9de 100%)',
    decoration: '#d9cdb6',
  },

  // ---------------------------------------------------------------- 森林
  forest: {
    id: 'forest',
    material: '林木与苔藓',
    swatch: { key: '#f4f8ec', active: '#d3e0c2', stage: '#e6eedc', guide: '#3f7a3a' },
    keyBg: 'linear-gradient(180deg, #fbfdf7 0%, #f4f8ec 100%)',
    keyActive: '#d3e0c2',
    keyBorder: '#c4d3b4',
    keyShadow: 'rgba(38, 56, 28, 0.2)',
    keyLabel: '#4a5c3a',
    keyBlackBg: '#2e3d26',
    keyBlackActive: '#4c6140',
    keyBlackLabel: '#e4eedc',
    guide: '#3f7a3a',
    guideOnBlack: '#a8d68f',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fbfdf7 0%, #e6eedc 100%)',
    decoration: '#a8c48e',
  },

  // ---------------------------------------------------------------- 夜空
  // 琴键保持中间调：深色键面会让黑白键只剩 1.5:1，「夜色」交给舞台背景表达（§47 可弹 > 好看）
  night: {
    id: 'night',
    material: '夜色与月光',
    swatch: { key: '#b6bccd', active: '#8f97ad', stage: '#10152c', guide: '#3b4c8a' },
    keyBg: 'linear-gradient(180deg, #b8becf 0%, #b6bccd 100%)',
    keyActive: '#8f97ad',
    keyBorder: '#9aa1b5',
    keyShadow: 'rgba(5, 8, 22, 0.5)',
    keyLabel: '#2a3358',
    keyBlackBg: '#0e1226',
    keyBlackActive: '#333c62',
    keyBlackLabel: '#b9c2e0',
    guide: '#3b4c8a',
    guideOnBlack: '#f2c65a',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #141a36 0%, #080b1c 100%)',
    decoration: 'rgba(200, 214, 255, 0.35)',
  },

  // ---------------------------------------------------------------- 水晶
  crystal: {
    id: 'crystal',
    material: '冰晶与寒光',
    swatch: { key: '#f4fafe', active: '#cfe6f5', stage: '#e4f1f9', guide: '#1f7fa8' },
    keyBg: 'linear-gradient(180deg, #fbfdff 0%, #f4fafe 100%)',
    keyActive: '#cfe6f5',
    keyBorder: '#bbd4e4',
    keyShadow: 'rgba(24, 62, 84, 0.18)',
    keyLabel: '#3f5c70',
    keyBlackBg: '#35505f',
    keyBlackActive: '#567586',
    keyBlackLabel: '#e2f0f8',
    guide: '#1f7fa8',
    guideOnBlack: '#9fd8ee',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fbfdff 0%, #e4f1f9 100%)',
    decoration: '#9cc8de',
  },

  // ---------------------------------------------------------------- 糖果
  candy: {
    id: 'candy',
    material: '奶油与糖霜',
    swatch: { key: '#fdf3f6', active: '#f2d3e0', stage: '#f7e9ef', guide: '#c94a7c' },
    keyBg: 'linear-gradient(180deg, #fffcfd 0%, #fdf3f6 100%)',
    keyActive: '#f2d3e0',
    keyBorder: '#ebc5d4',
    keyShadow: 'rgba(92, 40, 60, 0.18)',
    keyLabel: '#7a4558',
    keyBlackBg: '#6b3b4c',
    keyBlackActive: '#8f5a6d',
    keyBlackLabel: '#f7e3ea',
    guide: '#c94a7c',
    guideOnBlack: '#f5b8d0',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fffcfd 0%, #f7e9ef 100%)',
    decoration: '#e9b7c9',
  },

  // ---------------------------------------------------------------- 火焰
  fire: {
    id: 'fire',
    material: '暖炉与炭火',
    swatch: { key: '#fdf6ec', active: '#f0d8b6', stage: '#f7e8d6', guide: '#c4571e' },
    keyBg: 'linear-gradient(180deg, #fffcf7 0%, #fdf6ec 100%)',
    keyActive: '#f0d8b6',
    keyBorder: '#e8c9a4',
    keyShadow: 'rgba(88, 44, 12, 0.2)',
    keyLabel: '#7a4a22',
    keyBlackBg: '#442c1a',
    keyBlackActive: '#6b4526',
    keyBlackLabel: '#f2e0cc',
    guide: '#c4571e',
    guideOnBlack: '#f5b77a',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fffcf7 0%, #f7e8d6 100%)',
    decoration: '#e0a878',
  },

  // ---------------------------------------------------------------- 勇气
  courage: {
    id: 'courage',
    material: '石纹与暮紫',
    swatch: { key: '#f5f2fc', active: '#ddd4f2', stage: '#ede7f9', guide: '#6c4fc4' },
    keyBg: 'linear-gradient(180deg, #fcfbff 0%, #f5f2fc 100%)',
    keyActive: '#ddd4f2',
    keyBorder: '#c8bfe4',
    keyShadow: 'rgba(46, 32, 84, 0.19)',
    keyLabel: '#4e3d78',
    keyBlackBg: '#3b3059',
    keyBlackActive: '#5d4e80',
    keyBlackLabel: '#e6dff5',
    guide: '#6c4fc4',
    guideOnBlack: '#c3b0f0',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #fcfbff 0%, #ede7f9 100%)',
    decoration: '#b6a6dc',
  },

  // ---------------------------------------------------------------- 太空
  space: {
    id: 'space',
    material: '深空与远星',
    swatch: { key: '#aeb6d4', active: '#838db4', stage: '#1b2140', guide: '#1e5f7a' },
    keyBg: 'linear-gradient(180deg, #b0b8d6 0%, #aeb6d4 100%)',
    keyActive: '#838db4',
    keyBorder: '#8f98bb',
    keyShadow: 'rgba(4, 6, 18, 0.55)',
    keyLabel: '#232a4a',
    keyBlackBg: '#0e1226',
    keyBlackActive: '#363e66',
    keyBlackLabel: '#bbc3de',
    guide: '#1e5f7a',
    guideOnBlack: '#8fd4e8',
    stageBg: 'radial-gradient(120% 120% at 50% 0%, #1f2749 0%, #0d1128 100%)',
    decoration: 'rgba(150, 170, 220, 0.32)',
  },
};

export function getSkinTheme(themeId: string): SkinTheme {
  return SKIN_THEMES[themeId] ?? SKIN_THEMES[DEFAULT_THEME_ID];
}

/** 主题 → CSS 变量。只输出皮肤层允许的变量，绝不触碰基础层。 */
export function themeToCssVars(theme: SkinTheme): Record<string, string> {
  return {
    '--skin-key-bg': theme.keyBg,
    '--skin-key-active': theme.keyActive,
    '--skin-key-border': theme.keyBorder,
    '--skin-key-shadow': theme.keyShadow,
    '--skin-key-label': theme.keyLabel,
    '--skin-key-black-bg': theme.keyBlackBg,
    '--skin-key-black-active': theme.keyBlackActive,
    '--skin-key-black-label': theme.keyBlackLabel,
    '--skin-guide': theme.guide,
    '--skin-guide-on-black': theme.guideOnBlack,
    '--skin-stage-bg': theme.stageBg,
    '--skin-decoration': theme.decoration,
  };
}

/** 皮肤层变量白名单 —— 单测会校验 registry 没有越界。 */
export const ALLOWED_SKIN_VARS: readonly string[] = Object.keys(
  themeToCssVars(SKIN_THEMES[DEFAULT_THEME_ID]),
);
