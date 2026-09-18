import { describe, expect, it } from 'vitest';
import {
  REAL_KEY_ASPECT,
  REAL_WHITE_KEY_MM,
  describeKeyWidth,
  estimateDeviceMetrics,
  resolveWhiteKeyWidth,
} from './keySize';

/**
 * 「真实尺寸 + 可横向拖动」这一模式（`allowOverflow`）。
 *
 * ## 为什么需要它
 *
 * 先前的死结：小屏上 **键宽真实** 与 **中央C 能在中间** 不可能同时满足 ——
 * 8 键真实尺寸时中央C 只能在最左边；15 键要居中就必须把键压到 10mm。
 * 解法是让键盘**宽出屏幕**、由拖动来选取区域：键保持 23.5mm，中央C 靠视窗位置决定。
 *
 * 这条测试守住「永不压缩」这件事 —— 一旦有人把它改回 `min(ideal, fit)`，
 * 15 键又会悄悄变成 10mm 的窄键。
 */
const IPAD = estimateDeviceMetrics({ screenWidth: 810, screenHeight: 1080, devicePixelRatio: 2 });

describe('琴键尺寸 · 允许溢出（真实尺寸 + 拖动）', () => {
  it('放不下也保持真实 23.5mm，并标记需要横向拖动', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 15,
      availablePx: 778, // iPad 竖屏实际可用宽度
      metrics: IPAD,
      allowOverflow: true,
    });
    expect(result.keyMm).toBeCloseTo(REAL_WHITE_KEY_MM, 1);
    expect(result.isRealSize).toBe(true);
    expect(result.overflows).toBe(true);
    // 15 个真实尺寸白键 ≈ 1832px，比可用宽度宽一倍多
    expect(result.naturalPx).toBeCloseTo(1832, 0);
  });

  it('默认（不打开）仍然是压缩行为，旧路径不受影响', () => {
    const result = resolveWhiteKeyWidth({ whiteCount: 15, availablePx: 778, metrics: IPAD });
    expect(result.overflows).toBe(false);
    expect(result.isRealSize).toBe(false);
    expect(result.keyMm).toBeLessThan(REAL_WHITE_KEY_MM);
  });

  it('放得下时两种模式结果一致（不会白白溢出）', () => {
    const wide = { whiteCount: 15, availablePx: 2400, metrics: IPAD };
    const fit = resolveWhiteKeyWidth(wide);
    const overflow = resolveWhiteKeyWidth({ ...wide, allowOverflow: true });
    expect(overflow.keyPx).toBeCloseTo(fit.keyPx, 6);
    expect(overflow.overflows).toBe(false);
  });

  it('尺寸说明会告诉家长「可左右拖动」', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 15,
      availablePx: 778,
      metrics: IPAD,
      allowOverflow: true,
    });
    expect(describeKeyWidth(result, IPAD)).toContain('真实钢琴尺寸');
    expect(describeKeyWidth(result, IPAD)).toContain('可左右拖动');
  });

  it('真实长宽比是 150 : 23.5 —— 键盘高度按它反推（键盘不再被拉成细长条）', () => {
    expect(REAL_KEY_ASPECT).toBeCloseTo(6.383, 3);
    const keyPx = resolveWhiteKeyWidth({
      whiteCount: 15,
      availablePx: 778,
      metrics: IPAD,
      allowOverflow: true,
    }).keyPx;
    // iPad 竖屏：122.1 × 6.38 ≈ 779.5px —— 和一块真实键盘的比例一致
    expect(keyPx * REAL_KEY_ASPECT).toBeCloseTo(779.5, 0);
  });
});
