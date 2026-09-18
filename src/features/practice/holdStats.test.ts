import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOLD_RATIO_BUCKETS,
  MAX_HOLD_SAMPLES,
  clearHoldSamples,
  getHoldSamples,
  getHoldSkippedCount,
  holdRatio,
  recentHoldSamples,
  recordHoldSample,
  recordHoldSkipped,
  summarizeHolds,
  type HoldSample,
} from './holdStats';

/**
 * 按住时长采样器。
 *
 * 它存在的唯一理由是**在做判定之前先看清真实分布** ——
 * 所以测试要钉住的不是「算得准」，而是：
 *   · 只有真的松手才算一条样本（没等到松手的单独计数）
 *   · 统计口径（中位数、档位归属）不会把边界值算丢
 *   · 有上限，长时间练习不会把内存撑大
 *   · 不落 localStorage
 */

function sample(heldMs: number, targetMs: number, note = 'C4'): HoldSample {
  return { note, targetMs, heldMs };
}

describe('按住时长采样：收集', () => {
  beforeEach(() => clearHoldSamples());

  it('初始是空的', () => {
    expect(getHoldSamples()).toHaveLength(0);
    expect(getHoldSkippedCount()).toBe(0);
  });

  it('记录样本与「没等到松手」的次数', () => {
    recordHoldSample(sample(400, 800));
    recordHoldSample(sample(700, 800));
    recordHoldSkipped();

    expect(getHoldSamples()).toHaveLength(2);
    expect(getHoldSkippedCount()).toBe(1);
  });

  it('标称时长非正的样本被丢掉（没有意义，还会把比值算成 Infinity）', () => {
    recordHoldSample(sample(400, 0));
    recordHoldSample(sample(400, -100));
    expect(getHoldSamples()).toHaveLength(0);
  });

  it('超过上限后只保留最近的样本', () => {
    for (let i = 0; i < MAX_HOLD_SAMPLES + 20; i += 1) {
      recordHoldSample(sample(i, 1000, `n${i}`));
    }
    const samples = getHoldSamples();
    expect(samples).toHaveLength(MAX_HOLD_SAMPLES);
    // 保留的是尾部：最后一条是最后一个投进来的
    expect(samples[samples.length - 1].note).toBe(`n${MAX_HOLD_SAMPLES + 19}`);
  });

  it('recentHoldSamples 最新的在前，且不改动原顺序', () => {
    recordHoldSample(sample(1, 100, 'a'));
    recordHoldSample(sample(2, 100, 'b'));
    recordHoldSample(sample(3, 100, 'c'));

    expect(recentHoldSamples(2).map((s) => s.note)).toEqual(['c', 'b']);
    expect(getHoldSamples().map((s) => s.note)).toEqual(['a', 'b', 'c']);
  });

  it('清空会同时清掉样本和「没等到松手」计数', () => {
    recordHoldSample(sample(400, 800));
    recordHoldSkipped();
    clearHoldSamples();
    expect(getHoldSamples()).toHaveLength(0);
    expect(getHoldSkippedCount()).toBe(0);
  });

  it('holdRatio = 实际 ÷ 标称', () => {
    expect(holdRatio(sample(400, 800))).toBeCloseTo(0.5, 9);
    expect(holdRatio(sample(1600, 800))).toBeCloseTo(2, 9);
    expect(holdRatio(sample(400, 0))).toBe(0);
  });
});

describe('按住时长采样：统计口径', () => {
  it('没有样本时全部是 null，而不是 0（避免把「没数据」说成「都是 0」）', () => {
    const summary = summarizeHolds([], 0);
    expect(summary.count).toBe(0);
    expect(summary.medianRatio).toBeNull();
    expect(summary.tooShortRatio).toBeNull();
    expect(summary.reachedTargetRatio).toBeNull();
    expect(summary.buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it('中位数：奇数个取中间，偶数个取中间两个的平均', () => {
    expect(summarizeHolds([sample(100, 100), sample(200, 100), sample(600, 100)]).medianRatio).toBe(
      2,
    );
    expect(summarizeHolds([sample(100, 100), sample(300, 100)]).medianRatio).toBe(2);
  });

  it('「短于一半」和「真的按够了」按比值判定', () => {
    const summary = summarizeHolds([
      sample(300, 1000), // 0.3  太短
      sample(400, 1000), // 0.4  太短
      sample(600, 1000), // 0.6
      sample(1000, 1000), // 1.0 刚好按够
      sample(2000, 1000), // 2.0 超过
    ]);
    expect(summary.count).toBe(5);
    expect(summary.tooShortRatio).toBeCloseTo(2 / 5, 9);
    expect(summary.reachedTargetRatio).toBeCloseTo(2 / 5, 9);
  });

  it('档位覆盖每一个样本，边界值不重不漏', () => {
    const summary = summarizeHolds([
      sample(99, 1000), // 0.099 → 不到 25%
      sample(250, 1000), // 0.25  → 25–50%
      sample(500, 1000), // 0.5   → 50–75%
      sample(750, 1000), // 0.75  → 75–100%
      sample(1000, 1000), // 1.0   → 按够了
      sample(5000, 1000), // 5.0   → 按够了
    ]);

    expect(summary.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 2]);
    // 每一条都落在恰好一个档里
    const total = summary.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(summary.count);
    expect(summary.buckets.map((bucket) => bucket.label)).toEqual(
      HOLD_RATIO_BUCKETS.map((bucket) => bucket.label),
    );
  });

  it('每一档的占比之和为 1', () => {
    const summary = summarizeHolds([sample(100, 1000), sample(900, 1000)]);
    const share = summary.buckets.reduce((sum, bucket) => sum + bucket.share, 0);
    expect(share).toBeCloseTo(1, 9);
  });

  it('「没等到松手」的次数原样带出来（它和样本数是成对的诊断指标）', () => {
    expect(summarizeHolds([sample(500, 1000)], 7).skippedCount).toBe(7);
  });
});
