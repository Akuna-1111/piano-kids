import { describe, expect, it } from 'vitest';
import {
  REAL_OCTAVE_SPAN_MM,
  REAL_WHITE_KEY_MM,
  cssPxToMm,
  describeKeyWidth,
  estimateDeviceMetrics,
  mmToCssPx,
  resolveWhiteKeyWidth,
  type DeviceMetrics,
} from './keySize';

/** 常见目标机型的屏幕 CSS 尺寸（短边 × 长边）与物理 PPI。 */
const DEVICES = {
  'iPad Pro 12.9': { w: 1024, h: 1366, ppi: 264 },
  'iPad Pro 11': { w: 834, h: 1194, ppi: 264 },
  'iPad Air 10.9': { w: 820, h: 1180, ppi: 264 },
  /** iPad 第 7 / 8 / 9 代（10.2"，2160×1620 @ 264ppi）—— 当前主力验证机型 */
  'iPad 7/8/9 (10.2)': { w: 810, h: 1080, ppi: 264 },
  'iPad mini 8.3': { w: 744, h: 1133, ppi: 326 },
} as const;

const IPAD_METRICS: DeviceMetrics = { ppi: 264, dpr: 2, source: 'device-table' };

describe('设备 PPI 估算', () => {
  it('命中已知机型表', () => {
    for (const [name, device] of Object.entries(DEVICES)) {
      const metrics = estimateDeviceMetrics({
        screenWidth: device.w,
        screenHeight: device.h,
        devicePixelRatio: 2,
      });
      expect(metrics.source, name).toBe('device-table');
      expect(metrics.ppi, name).toBe(device.ppi);
    }
  });

  it('屏幕尺寸顺序颠倒（横竖屏差异）也能命中', () => {
    const portrait = estimateDeviceMetrics({
      screenWidth: 1024,
      screenHeight: 1366,
      devicePixelRatio: 2,
    });
    const landscape = estimateDeviceMetrics({
      screenWidth: 1366,
      screenHeight: 1024,
      devicePixelRatio: 2,
    });
    expect(portrait.ppi).toBe(landscape.ppi);
    expect(landscape.ppi).toBe(264);
  });

  it('dpr 为 1 的桌面浏览器按 96dpi 参考像素处理', () => {
    const metrics = estimateDeviceMetrics({
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
    });
    expect(metrics.source).toBe('desktop');
    expect(metrics.ppi).toBe(96);
  });

  it('无法识别的高密度屏退回兜底值并**标记为估算**（不假装精确）', () => {
    const metrics = estimateDeviceMetrics({
      screenWidth: 390,
      screenHeight: 844,
      devicePixelRatio: 3,
    });
    expect(metrics.source).toBe('assumed');
  });

  it('异常的 devicePixelRatio 不会产生 0 或 NaN', () => {
    const metrics = estimateDeviceMetrics({
      screenWidth: 1024,
      screenHeight: 1366,
      devicePixelRatio: 0,
    });
    expect(metrics.dpr).toBe(1);
  });
});

describe('毫米 ↔ CSS px 换算', () => {
  it('iPad（264ppi / dpr2）：1mm = 5.197 CSS px', () => {
    expect(mmToCssPx(1, IPAD_METRICS)).toBeCloseTo(5.1969, 3);
  });

  it('真实白键 23.5mm 在 iPad 上是 122.1 CSS px', () => {
    expect(mmToCssPx(REAL_WHITE_KEY_MM, IPAD_METRICS)).toBeCloseTo(122.13, 1);
  });

  it('真实八度跨度 164.5mm 在 iPad 上是 854.9 CSS px', () => {
    expect(mmToCssPx(REAL_OCTAVE_SPAN_MM, IPAD_METRICS)).toBeCloseTo(854.9, 1);
  });

  it('换算可逆', () => {
    for (const mm of [1, 23.5, 164.5, 300]) {
      expect(cssPxToMm(mmToCssPx(mm, IPAD_METRICS), IPAD_METRICS)).toBeCloseTo(mm, 9);
    }
  });

  it('桌面（96ppi / dpr1）退化成 CSS 参考像素', () => {
    const desktop: DeviceMetrics = { ppi: 96, dpr: 1, source: 'desktop' };
    expect(mmToCssPx(REAL_WHITE_KEY_MM, desktop)).toBeCloseTo(88.82, 2);
  });
});

describe('白键宽度求解：真实尺寸优先，放不下才压缩', () => {
  it('空间足够时用真实钢琴尺寸，不放大', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 8,
      availablePx: 1334, // iPad Pro 12.9 横屏扣除内边距
      metrics: IPAD_METRICS,
    });
    expect(result.isRealSize).toBe(true);
    expect(result.keyMm).toBeCloseTo(REAL_WHITE_KEY_MM, 1);
    expect(result.keyPx).toBeCloseTo(122.13, 1);
    // 8 键 × 122.13 = 977px，比可用宽度窄 —— 两侧留白，而不是把键拉大
    expect(result.naturalPx).toBeLessThan(1334);
  });

  it('绝不放得比真实尺寸更大（放大会破坏手部姿势的可迁移性）', () => {
    const huge = resolveWhiteKeyWidth({
      whiteCount: 8,
      availablePx: 4000,
      metrics: IPAD_METRICS,
    });
    expect(huge.keyMm).toBeCloseTo(REAL_WHITE_KEY_MM, 1);
    expect(huge.isRealSize).toBe(true);
  });

  it('空间不足时压缩到刚好铺满，并如实报告实际毫米数', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 15,
      availablePx: 1334,
      metrics: IPAD_METRICS,
    });
    expect(result.isRealSize).toBe(false);
    expect(result.naturalPx).toBeCloseTo(1334, 0);
    // 15 键在 12.9 寸 iPad 上只有约 17.4mm，明显窄于真实的 23.5mm
    expect(result.keyMm).toBeGreaterThan(17);
    expect(result.keyMm).toBeLessThan(REAL_WHITE_KEY_MM);
  });

  it('25 键会被压得更窄（这是物理决定的，不是实现问题）', () => {
    const r15 = resolveWhiteKeyWidth({ whiteCount: 15, availablePx: 1334, metrics: IPAD_METRICS });
    const r25 = resolveWhiteKeyWidth({ whiteCount: 25, availablePx: 1334, metrics: IPAD_METRICS });
    expect(r25.keyMm).toBeLessThan(r15.keyMm);
  });

  it('极端窄屏不会算出 0 或负宽度', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 25,
      availablePx: 1,
      metrics: IPAD_METRICS,
    });
    expect(result.keyPx).toBeGreaterThan(0);
    expect(Number.isFinite(result.keyMm)).toBe(true);
  });

  it('白键数量为 0 时不会除零', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 0,
      availablePx: 1000,
      metrics: IPAD_METRICS,
    });
    expect(Number.isFinite(result.keyPx)).toBe(true);
  });
});

describe('各机型上的真实尺寸可行性（这是物理约束，不是实现取舍）', () => {
  /** 横屏可用宽度 = 横屏 CSS 宽度 − 页面左右内边距（16px × 2） */
  const padding = 32;

  const metricsOf = (device: { w: number; h: number }) =>
    estimateDeviceMetrics({
      screenWidth: device.w,
      screenHeight: device.h,
      devicePixelRatio: 2,
    });

  it('10.2 寸及以上的 iPad：8 键能达到真实钢琴尺寸（23.5mm）', () => {
    const bigIpads = Object.entries(DEVICES).filter(([name]) => name !== 'iPad mini 8.3');
    expect(bigIpads.length).toBeGreaterThanOrEqual(4);
    for (const [name, device] of bigIpads) {
      const result = resolveWhiteKeyWidth({
        whiteCount: 8,
        availablePx: device.h - padding,
        metrics: metricsOf(device),
      });
      expect(result.isRealSize, name).toBe(true);
      expect(result.keyMm, name).toBeCloseTo(REAL_WHITE_KEY_MM, 1);
    }
  });

  it('iPad mini 8.3"：屏幕物理宽度只有约 176mm，8 键也差一点（约 21.4mm）', () => {
    // 记录这个事实而不是绕过它 —— 界面会用 describeKeyWidth 如实告知用户
    const device = DEVICES['iPad mini 8.3'];
    const result = resolveWhiteKeyWidth({
      whiteCount: 8,
      availablePx: device.h - padding,
      metrics: metricsOf(device),
    });
    expect(result.isRealSize).toBe(false);
    expect(result.keyMm).toBeGreaterThan(20);
    expect(result.keyMm).toBeLessThan(REAL_WHITE_KEY_MM);
  });

  it('15 / 25 键在任何 iPad 上都达不到真实尺寸 —— 真实八度跨度 164.5mm 装不下', () => {
    for (const [name, device] of Object.entries(DEVICES)) {
      const available = device.h - padding;
      for (const whiteCount of [15, 25]) {
        const result = resolveWhiteKeyWidth({
          whiteCount,
          availablePx: available,
          metrics: metricsOf(device),
        });
        expect(result.isRealSize, `${name} / ${whiteCount} 键`).toBe(false);
      }
    }
  });

  it('记录 12.9 寸 iPad 的实际可得尺寸（供文档与界面说明使用）', () => {
    const metrics = metricsOf(DEVICES['iPad Pro 12.9']);
    const available = DEVICES['iPad Pro 12.9'].h - padding;
    const rows = [8, 15, 25].map((whiteCount) => {
      const r = resolveWhiteKeyWidth({ whiteCount, availablePx: available, metrics });
      return { whiteCount, mm: Number(r.keyMm.toFixed(1)), isReal: r.isRealSize };
    });
    // 8 键达到真实尺寸；15 / 25 键被压缩
    expect(rows[0].isReal).toBe(true);
    expect(rows[0].mm).toBeCloseTo(23.5, 1);
    expect(rows[1].isReal).toBe(false);
    expect(rows[2].isReal).toBe(false);
  });

  it('iPad 第 7 代（10.2"）的具体结果 —— 8 键八度跨度精确等于真实钢琴的 164.5mm', () => {
    // 这是当前主力验证机型，把数字钉住，避免以后改动悄悄影响真实尺寸
    const device = DEVICES['iPad 7/8/9 (10.2)'];
    const metrics = metricsOf(device);
    const available = device.h - padding; // 1080 - 32 = 1048

    const eight = resolveWhiteKeyWidth({ whiteCount: 8, availablePx: available, metrics });
    expect(eight.isRealSize).toBe(true);
    expect(eight.keyMm).toBeCloseTo(23.5, 1);
    // 8 × 23.5 = 188mm，正好是真实钢琴一个八度的跨度
    expect(eight.keyMm * 7).toBeCloseTo(REAL_OCTAVE_SPAN_MM, 0);
    // 键盘没有铺满，而是居中留白（§55 留白是内容）
    expect(eight.naturalPx).toBeLessThan(available);

    const fifteen = resolveWhiteKeyWidth({ whiteCount: 15, availablePx: available, metrics });
    expect(fifteen.isRealSize).toBe(false);
    expect(fifteen.keyMm).toBeCloseTo(13.4, 0);

    const twentyFive = resolveWhiteKeyWidth({ whiteCount: 25, availablePx: available, metrics });
    expect(twentyFive.isRealSize).toBe(false);
    expect(twentyFive.keyMm).toBeCloseTo(8.1, 0);
  });

  it('iPad 第 7 代：25 键只剩约 42 CSS px 宽，已接近触控下限（§25 核心操作 ≥44px）', () => {
    // 记录这个事实供产品决策 —— 不是实现缺陷，是屏幕物理宽度决定的
    const device = DEVICES['iPad 7/8/9 (10.2)'];
    const metrics = metricsOf(device);
    const available = device.h - padding;
    const result = resolveWhiteKeyWidth({ whiteCount: 25, availablePx: available, metrics });
    expect(result.keyPx).toBeGreaterThan(40);
    expect(result.keyPx).toBeLessThan(44);
  });
});

describe('尺寸说明文案', () => {
  it('达到真实尺寸时明确说出来', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 8,
      availablePx: 1334,
      metrics: IPAD_METRICS,
    });
    expect(describeKeyWidth(result, IPAD_METRICS)).toBe('白键 23.5 mm（真实钢琴尺寸）');
  });

  it('被压缩时如实说明，并标出真实尺寸作对照', () => {
    const result = resolveWhiteKeyWidth({
      whiteCount: 25,
      availablePx: 1334,
      metrics: IPAD_METRICS,
    });
    const text = describeKeyWidth(result, IPAD_METRICS);
    expect(text).toContain('屏幕所限');
    expect(text).toContain('23.5 mm');
  });

  it('PPI 是估算值时会加上「约」字', () => {
    const assumed: DeviceMetrics = { ppi: 264, dpr: 2, source: 'assumed' };
    const result = resolveWhiteKeyWidth({ whiteCount: 25, availablePx: 1334, metrics: assumed });
    expect(describeKeyWidth(result, assumed)).toContain('约 白键');
  });
});
