import { describe, expect, it } from 'vitest';
import { contrastHex, dominantHex, gradientStops } from './contrast';
import { SKIN_THEMES, MAX_KEY_SURFACE_CONTRAST } from './skinThemes';
import { SKINS } from './skins';

/**
 * 设计规范 §47 的可执行版本：**Skin Contrast Rule**。
 *
 *   无论任何皮肤：音名可读 / 黑白键关系可辨 / 高亮状态明确 / 按下状态可见。
 *   皮肤绝不能为了「主题感」降低钢琴操作效率。
 *   优先级永远是：可弹 > 可辨 > 可学 > 好看。
 *
 * 这是少数能用数学验证的设计规则。把它做成测试，意味着以后谁调皮肤配色时
 * 「为了好看牺牲可读性」会在 CI 阶段被拦住，而不是等孩子看不清琴键才发现。
 *
 * 阈值依据：
 *   4.5:1  WCAG AA 正文对比度 —— 用于「音名可读」
 *   3.0:1  WCAG AA 非文本图形对比度 —— 用于「黑白键关系可辨」「高亮状态明确」
 *   1.15:1 「看得出来但很克制」—— 用于「按下状态可见」
 *   1.12:1 §10.2 白键键面「极轻微纵向明暗」的上限
 */

const MIN_LABEL_CONTRAST = 4.5;
const MIN_STRUCTURE_CONTRAST = 3;
const MIN_PRESSED_CONTRAST = 1.15;

const themes = Object.entries(SKIN_THEMES);

/** 每个主题都必须有对应的皮肤数据，否则它永远不会被渲染。 */
const usedThemeIds = new Set(SKINS.map((skin) => skin.themeId));

describe('§47 皮肤对比规则', () => {
  it('注册表里的每套主题都真的被某套皮肤引用（没有孤儿主题）', () => {
    for (const [id] of themes) {
      expect(usedThemeIds.has(id), `主题 ${id} 没有任何皮肤引用`).toBe(true);
    }
  });

  it.each(themes)('%s：音名可读（白键标签 ≥ 4.5:1）', (_id, theme) => {
    const ratio = contrastHex(theme.keyLabel, dominantHex(theme.keyBg)!);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
  });

  it.each(themes)('%s：音名可读（黑键标签 ≥ 4.5:1）', (_id, theme) => {
    const ratio = contrastHex(theme.keyBlackLabel, theme.keyBlackBg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_LABEL_CONTRAST);
  });

  it.each(themes)('%s：黑白键关系可辨（≥ 3:1）', (_id, theme) => {
    const ratio = contrastHex(dominantHex(theme.keyBg)!, theme.keyBlackBg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_STRUCTURE_CONTRAST);
  });

  it.each(themes)('%s：高亮状态明确（白键引导色 vs 白键 ≥ 3:1）', (_id, theme) => {
    const ratio = contrastHex(theme.guide, dominantHex(theme.keyBg)!);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_STRUCTURE_CONTRAST);
  });

  it.each(themes)('%s：高亮状态明确（黑键引导色 vs 黑键 ≥ 3:1）', (_id, theme) => {
    const ratio = contrastHex(theme.guideOnBlack, theme.keyBlackBg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_STRUCTURE_CONTRAST);
  });

  it.each(themes)('%s：按下状态可见（白键静止 vs 按下 ≥ 1.15:1）', (_id, theme) => {
    const ratio = contrastHex(theme.keyActive, dominantHex(theme.keyBg)!);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_PRESSED_CONTRAST);
  });

  it.each(themes)('%s：按下状态可见（黑键静止 vs 按下 ≥ 1.15:1）', (_id, theme) => {
    const ratio = contrastHex(theme.keyBlackActive, theme.keyBlackBg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(MIN_PRESSED_CONTRAST);
  });

  it.each(themes)('%s：边界可辨（边框 vs 白键键面）', (_id, theme) => {
    // §10.2 要求 1px 边界；边界是秩序工具（§7.2），不追求高对比，但必须看得出来
    const ratio = contrastHex(theme.keyBorder, dominantHex(theme.keyBg)!);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(1.1);
  });
});

describe('§10.2 白键键面只允许「极轻微纵向明暗变化」', () => {
  it.each(themes)('%s：键面渐变两端对比度 ≤ 1.12:1（不是玻璃渐变）', (_id, theme) => {
    const stops = gradientStops(theme.keyBg);
    if (stops.length < 2) {
      // 纯色也完全合规
      expect(stops.length).toBeLessThanOrEqual(1);
      return;
    }
    const ratio = contrastHex(stops[0], stops[stops.length - 1]);
    expect(ratio, `键面两端 ${stops[0]} → ${stops[stops.length - 1]} 差值过大`).not.toBeNull();
    expect(ratio!).toBeLessThanOrEqual(MAX_KEY_SURFACE_CONTRAST);
  });

  it.each(themes)('%s：按下态与黑键一律用纯色（避免玻璃感）', (_id, theme) => {
    expect(gradientStops(theme.keyActive).length).toBeLessThanOrEqual(1);
    expect(gradientStops(theme.keyBlackBg).length).toBeLessThanOrEqual(1);
    expect(gradientStops(theme.keyBlackActive).length).toBeLessThanOrEqual(1);
  });
});

describe('§5.3 高饱和色只用在被允许的地方', () => {
  it.each(themes)('%s：引导色是纯色，不是渐变', (_id, theme) => {
    expect(gradientStops(theme.guide).length).toBeLessThanOrEqual(1);
    expect(gradientStops(theme.guideOnBlack).length).toBeLessThanOrEqual(1);
  });

  it.each(themes)('%s：皮肤强度 —— 只有键面与舞台允许渐变（§11.4 的 10% 装饰）', (_id, theme) => {
    // §11.4：70% 基础琴键结构 / 20% 皮肤材质 / 10% 装饰。
    // 琴键几何完全由 piano.css 决定，皮肤只能给颜色；
    // 允许带渐变（视觉复杂度更高）的只有「白键键面」与「舞台背景」两处。
    const gradientSurfaces = (
      [
        ['keyBg', theme.keyBg],
        ['stageBg', theme.stageBg],
        ['guide', theme.guide],
        ['guideOnBlack', theme.guideOnBlack],
        ['decoration', theme.decoration],
        ['keyActive', theme.keyActive],
        ['keyBlackBg', theme.keyBlackBg],
        ['keyBlackActive', theme.keyBlackActive],
      ] as const
    ).filter(([, value]) => value.includes('gradient('));

    expect(
      gradientSurfaces.length,
      `带渐变的字段：${gradientSurfaces.map(([name]) => name).join(', ') || '（无）'}`,
    ).toBeLessThanOrEqual(2);
  });
});
