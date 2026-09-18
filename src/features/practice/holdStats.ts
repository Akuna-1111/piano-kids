/**
 * 按住时长采样（真机数据收集）。
 *
 * ## 为什么需要它
 *
 * 「按住提示」目前**不参与评分**（见 `HoldGuide` 的注释）。要把它变成判分，
 * 第一步不是写判定，而是**先知道孩子实际按住多久**：
 * iPad 上手指滑到琴键边缘外、多指同按、掌心误触都会让 `noteOff` 提前到达，
 * 宽容系数必须由真实分布决定，不能凭猜。
 *
 * 这个模块就是那个「量一量」的地方：练习页每次确认松手都投一条样本进来，
 * `#/tuning`（隐藏自检路由）把它读出来。
 *
 * ## 刻意不做的事
 *
 * - **不落 localStorage**：这里不是成长数据，没有跨会话的价值，
 *   也就不该碰 `core/progress/storage.ts` 那条唯一的持久化通路。
 *   代价是刷新即清空 —— 所以自检页上明确写着「仅本次会话」。
 * - **不进任何判定**：练习页只写、不读；读只发生在自检页。
 * - **有上限**：最多保留最近 {@link MAX_HOLD_SAMPLES} 条，避免长时间练习把内存撑大。
 *   统计看的是分布，样本够多之后再多的意义不大。
 */

export interface HoldSample {
  /** 音名，例如 "E4" */
  note: string;
  /** 这个音的标称时长（毫秒）——谱面要求按住多久 */
  targetMs: number;
  /** 实际按住多久（毫秒） */
  heldMs: number;
}

/** 最多保留多少条样本。 */
export const MAX_HOLD_SAMPLES = 120;

let samples: HoldSample[] = [];
let skippedCount = 0;

/**
 * 记录一条「确认松手」的样本。
 *
 * 只有真的收到了松手事件才能算 —— 这种样本的 `heldMs` 是**真实**的按住时长。
 * 没等到松手就去弹下一个音的情况由 {@link recordHoldSkipped} 单独计数。
 */
export function recordHoldSample(sample: HoldSample): void {
  if (!(sample.targetMs > 0)) return;
  samples = [...samples, sample].slice(-MAX_HOLD_SAMPLES);
}

/**
 * 记录一次「还没松手就被下一个音顶掉」。
 *
 * 这个计数和样本数是**一对诊断指标**：如果它占比很高，
 * 说明「松手」这个信号在真机上本身就不可靠 —— 那么把它做成判分依据就是危险的，
 * 这正是要在动手写判定之前先看清楚的事。
 */
export function recordHoldSkipped(): void {
  skippedCount += 1;
}

export function getHoldSamples(): readonly HoldSample[] {
  return samples;
}

export function getHoldSkippedCount(): number {
  return skippedCount;
}

export function clearHoldSamples(): void {
  samples = [];
  skippedCount = 0;
}

/** 实际 ÷ 标称 的比值。 */
export function holdRatio(sample: HoldSample): number {
  return sample.targetMs > 0 ? sample.heldMs / sample.targetMs : 0;
}

export const HOLD_RATIO_BUCKETS = [
  { label: '不到 25%', upTo: 0.25 },
  { label: '25–50%', upTo: 0.5 },
  { label: '50–75%', upTo: 0.75 },
  { label: '75–100%', upTo: 1 },
  { label: '按够了', upTo: Number.POSITIVE_INFINITY },
] as const;

export interface HoldStatsSummary {
  /** 确认松手的样本数 */
  count: number;
  /** 没等到松手就被下一个音顶掉的次数 */
  skippedCount: number;
  /** 实际 ÷ 标称 的中位数；没有样本时 null */
  medianRatio: number | null;
  /** 短于标称一半的比例 —— 「戳一下就走」的占比 */
  tooShortRatio: number | null;
  /** 有多少比例真的按够了（比值 ≥ 1） */
  reachedTargetRatio: number | null;
  buckets: ReadonlyArray<{ label: string; count: number; share: number }>;
}

/** 中位数（会复制数组，不改动传入的样本）。 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * 把样本汇成可以直接读的分布。纯函数 —— 自检页传什么就算什么。
 */
export function summarizeHolds(
  input: readonly HoldSample[],
  skippedCount = 0,
): HoldStatsSummary {
  const ratios = input.map(holdRatio);
  const total = ratios.length;

  const buckets = HOLD_RATIO_BUCKETS.map((bucket, index) => {
    // 半开区间 [lower, upTo)：这样「不到 25%」就是字面意思，
    // 边界值（恰好 0.25 / 0.5 / 0.75 / 1）归**右边**那一档，不重不漏。
    const lower = index === 0 ? -Number.POSITIVE_INFINITY : HOLD_RATIO_BUCKETS[index - 1].upTo;
    const count = ratios.filter((ratio) => ratio >= lower && ratio < bucket.upTo).length;
    return {
      label: bucket.label,
      count,
      share: total > 0 ? count / total : 0,
    };
  });

  return {
    count: total,
    skippedCount,
    medianRatio: median(ratios),
    tooShortRatio: total > 0 ? ratios.filter((ratio) => ratio < 0.5).length / total : null,
    reachedTargetRatio: total > 0 ? ratios.filter((ratio) => ratio >= 1).length / total : null,
    buckets,
  };
}

/** 最近 n 条样本，最新的在前（自检页直接渲染）。 */
export function recentHoldSamples(limit: number): readonly HoldSample[] {
  return [...samples].slice(-limit).reverse();
}
