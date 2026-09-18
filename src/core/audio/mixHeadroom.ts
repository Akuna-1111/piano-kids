/**
 * 混音余量与末端保护。
 *
 * ## 为什么需要这个文件
 *
 * 现象：**连续按键盘会出现嘈杂的破音**。
 *
 * 在 `OfflineAudioContext` 里复现真实弹奏后量出来的原因很直接 —— **数字削波**：
 *
 * | 场景 | 修复前峰值 | 削波样本 |
 * | --- | --- | --- |
 * | 单音 | 0.952 | 0 |
 * | 三音和弦 | **1.292** | 118 |
 * | 八音全按 | **1.193** | 342 |
 * | 连续单音 16 下 | **1.011** | 9 |
 * | 八键连按 4 轮 | **1.086** | 202 |
 *
 * 为什么会这样：`PianoVoice` 的所有分音都是**同相位起音**的
 * （所有振荡器都从相位 0 开始），所以**单个音**的瞬时峰值就已经接近
 * 分音振幅之和（约 0.95）—— 一个音就把满刻度用完了，再来一个必然溢出。
 *
 * ## 两道防线
 *
 * 1. **总线余量**（`PIANO_BUS_HEADROOM`）：把整块键盘的输出先压下来，
 *    让单音落在 0.7 左右，给和弦留出空间。
 * 2. **末端软削波**（`softClipSample`）：放在**音量之后、输出之前**，
 *    保证不管音量开到多大、同时按下多少个键，输出都**永远不会**超过满刻度。
 *    0.7 以下完全线性（正常弹奏一点不压缩），之上用 tanh 软拐点渐进压回。
 *
 * ⚠️ 为什么不用 `DynamicsCompressorNode` 当限幅器：它不是砖墙限幅器。
 * 实测把它配成 threshold −10dB / ratio 6 / attack 3ms 之后，八音和弦的输出
 * 仍然到 **1.19** —— 起音瞬态在 attack 时间里直接穿过去了。
 * 压缩器可以留作「减少饱和程度」的手段，但**保证不削波只能靠波形整形**。
 */

/**
 * 键盘总线的余量。
 *
 * 实测取值依据（音量 0.8）：
 *
 * | 余量 | 单音峰值 | 八音峰值 | 单音 RMS | 八音/单音动态 |
 * | --- | --- | --- | --- | --- |
 * | 1.0（原来） | 0.952 | 1.193（削波） | 0.192 | — |
 * | 0.55 | 0.857 | 0.937 | 0.170 | 0.8 dB |
 * | 0.45 | 0.823 | 0.925 | 0.150 | 1.0 dB |
 * | 0.35 | 0.736 | 0.912 | 0.119 | 1.9 dB |
 *
 * 取 0.42：削波彻底消失，单音与和弦的响度差保留得比较多（约 1.5dB），
 * 同时比 0.35 找回约 1.6dB 的响度 —— 加了琴体共鸣塑形之后整体电平降了一点，
 * 这里补回来一部分。**改这个值之后必须重跑 `scripts/flows/audio-clipping.js`**
 * 确认八音全按在音量 1.0 下仍然不削波。
 */
export const PIANO_BUS_HEADROOM = 0.42;

/** 软拐点：这个电平以下完全透明（斜率 1），以上才开始压。 */
export const SOFT_CLIP_KNEE = 0.7;

/** 波形整形表覆盖的输入范围；超出这个范围会被夹到端点（端点值 ≈ 1.0）。 */
export const SOFT_CLIP_CEILING = 4;

/** 波形整形表的取样点数。 */
const CURVE_SAMPLES = 4096;

/**
 * 从饱和区的上限里再让出的极小量，用来**证明**输出严格小于 1。
 *
 * 光靠 `tanh` 不够：`tanh(31)` 在 float64 里就是 1.0，
 * 于是「输入足够大」时输出会精确等于 1.0（也就是触顶）。
 * 让出 1e-6（约 −120dB）之后，输出有数学上的上界 `1 − EPS`。
 */
const SATURATION_EPS = 1e-6;

/**
 * 饱和区的宽度。分子的缩放与分母相同，保证拐点处**导数正好是 1**。
 */
const KNEE_RANGE = 1 - SOFT_CLIP_KNEE - SATURATION_EPS;

/**
 * 单样本软削波：`|x| ≤ KNEE` 时原样返回，之上用 tanh 渐进逼近 `1 − EPS`。
 *
 * 在拐点处**一阶连续**（两侧导数都是 1），所以不会有折线造成的额外谐波 ——
 * 这一点很重要：硬削波（以及不连续的软削波）正是「嘈杂刺耳」的来源。
 *
 * 值域有严格上界 `1 − EPS`，所以输出**永远**不会触顶。
 */
export function softClipSample(x: number): number {
  const magnitude = Math.abs(x);
  if (magnitude <= SOFT_CLIP_KNEE) return x;
  const shaped = SOFT_CLIP_KNEE + KNEE_RANGE * Math.tanh((magnitude - SOFT_CLIP_KNEE) / KNEE_RANGE);
  return x < 0 ? -shaped : shaped;
}

/**
 * 生成 `WaveShaperNode` 的曲线表。
 *
 * `WaveShaper` 把输入区间 `[-1, 1]` 映射到曲线数组，超出部分夹到端点 ——
 * 所以曲线本身要表示 `[-CEILING, CEILING]` 这一段，
 * 调用方在串接时前置一个 `1 / CEILING` 的增益。
 */
export function createSoftClipCurve(
  samples = CURVE_SAMPLES,
  ceiling = SOFT_CLIP_CEILING,
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = (i / (samples - 1)) * 2 - 1; // −1 … 1
    curve[i] = softClipSample(t * ceiling);
  }
  return curve;
}
