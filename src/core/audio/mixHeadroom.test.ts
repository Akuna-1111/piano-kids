import { describe, expect, it } from 'vitest';
import {
  PIANO_BUS_HEADROOM,
  SOFT_CLIP_CEILING,
  SOFT_CLIP_KNEE,
  createSoftClipCurve,
  softClipSample,
} from './mixHeadroom';

/**
 * 末端软削波与总线余量。
 *
 * 这组测试守着的是一个真实故障：**连续按键盘出现嘈杂的破音**。
 * 原因是在 `OfflineAudioContext` 里量出来的**数字削波**
 * （三音和弦峰值 1.292、八音全按 1.193、连续单音 1.011）。
 *
 * 削波没法在 jsdom 里渲染验证（没有 Web Audio），但**造成削波的那个传递函数**
 * 是纯数学，可以钉死：
 *
 *   1. 拐点以下必须**完全透明**（否则正常弹奏会被压，单音与和弦的响度差会被挤平）
 *   2. 任何输入都必须**严格小于 1**（这才叫「不可能削波」）
 *   3. 拐点处必须**一阶连续**（折线会产生额外谐波，那是刺耳感的来源）
 *   4. 总线余量必须真的留出来了
 */

describe('末端软削波：透明区', () => {
  it('拐点以下原样输出（不压缩、不染色）', () => {
    for (const x of [0, 0.05, 0.1, 0.25, 0.5, 0.6, SOFT_CLIP_KNEE]) {
      expect(softClipSample(x), `x=${x}`).toBe(x);
      expect(softClipSample(-x), `x=-${x}`).toBe(-x);
    }
  });

  it('拐点处一阶连续：两侧数值与斜率都接得上', () => {
    const epsilon = 1e-6;
    const below = softClipSample(SOFT_CLIP_KNEE - epsilon);
    const at = softClipSample(SOFT_CLIP_KNEE);
    const above = softClipSample(SOFT_CLIP_KNEE + epsilon);

    // 数值连续
    expect(at).toBeCloseTo(SOFT_CLIP_KNEE, 9);
    // 斜率连续（两侧都约等于 1）
    const slopeBelow = (at - below) / epsilon;
    const slopeAbove = (above - at) / epsilon;
    expect(slopeBelow).toBeCloseTo(1, 4);
    expect(slopeAbove).toBeCloseTo(1, 4);
  });
});

describe('末端软削波：不可能削波', () => {
  it('任何输入都严格小于满刻度（tanh 永远到不了 1）', () => {
    for (const x of [0.7, 0.8, 0.9, 1, 1.5, 2, 3, 4, 10, 100, 1000]) {
      expect(Math.abs(softClipSample(x)), `x=${x}`).toBeLessThan(1);
      expect(Math.abs(softClipSample(-x)), `x=-${x}`).toBeLessThan(1);
    }
  });

  it('单调不减：压回来但绝不反向', () => {
    let previous = -Infinity;
    for (let x = -6; x <= 6; x += 0.01) {
      const y = softClipSample(x);
      expect(y).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = y;
    }
  });

  it('压得住：输入 4 倍满刻度时输出仍在 1.0 以内且已经接近饱和', () => {
    const squeezed = softClipSample(SOFT_CLIP_CEILING);
    expect(squeezed).toBeGreaterThan(0.95);
    expect(squeezed).toBeLessThan(1);
  });

  it('奇函数：正负对称，不会引入直流偏移', () => {
    for (const x of [0.3, 0.9, 2, 5]) {
      expect(softClipSample(-x)).toBeCloseTo(-softClipSample(x), 12);
    }
  });
});

describe('末端软削波：波形整形表', () => {
  const curve = createSoftClipCurve();

  it('表长与端点符合 WaveShaper 的约定（−1…1 映射到 ±CEILING）', () => {
    expect(curve.length).toBe(4096);
    expect(curve[0]).toBeCloseTo(softClipSample(-SOFT_CLIP_CEILING), 6);
    expect(curve[curve.length - 1]).toBeCloseTo(softClipSample(SOFT_CLIP_CEILING), 6);
  });

  it('表里没有 NaN / 无穷，且全部在满刻度以内', () => {
    for (const value of curve) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThan(1);
    }
  });

  it('中点（输入 0）输出 0', () => {
    // 偶数长度的表没有「正中间」那个点，用奇数长度精确验证
    const odd = createSoftClipCurve(4097);
    expect(odd[(4097 - 1) / 2]).toBe(0);
  });

  it('可以生成更短的表（自检页 / 测试用）', () => {
    expect(createSoftClipCurve(64).length).toBe(64);
  });
});

describe('总线余量', () => {
  it('真的留出了余量（小于 1）', () => {
    expect(PIANO_BUS_HEADROOM).toBeGreaterThan(0.2);
    expect(PIANO_BUS_HEADROOM).toBeLessThan(0.5);
  });

  it('单音峰值乘上余量之后，落在软拐点附近 —— 留一格给和弦', () => {
    // 实测单音（力度 0.85）的峰值约 0.95，乘以余量后应该接近但不超过拐点
    const singleNotePeak = 0.95 * PIANO_BUS_HEADROOM;
    expect(singleNotePeak).toBeLessThan(SOFT_CLIP_KNEE + 0.1);
    expect(singleNotePeak).toBeGreaterThan(0.25);
  });
});
