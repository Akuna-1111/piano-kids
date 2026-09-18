/**
 * 极短 room reverb —— 为合成钢琴加一点空间感，避免「干瘪的电子琴」听感。
 * 用程序生成脉冲响应，不引入任何音频资源文件（离线优先 / 体积预算友好）。
 */

export interface ReverbOptions {
  /** 混响尾巴长度（秒）。教室 / 小房间量级即可。 */
  durationSec?: number;
  /** 衰减指数，越大衰减越快。 */
  decay?: number;
  /** 干声直达之前的静默时间（秒）。 */
  preDelaySec?: number;
}

const DEFAULT_OPTIONS: Required<ReverbOptions> = {
  durationSec: 0.85,
  decay: 3.4,
  preDelaySec: 0.012,
};

/** 生成一段指数衰减的立体声噪声作为脉冲响应。 */
export function createReverbImpulse(
  ctx: BaseAudioContext,
  options: ReverbOptions = {},
): AudioBuffer {
  const { durationSec, decay, preDelaySec } = { ...DEFAULT_OPTIONS, ...options };
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const preDelaySamples = Math.floor(sampleRate * preDelaySec);

  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      if (i < preDelaySamples) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelaySamples) / (length - preDelaySamples);
      // 噪声 * 指数衰减；右声道轻微错位，制造自然的立体声宽度。
      const jitter = channel === 0 ? 0 : 1 - t * 0.12;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * jitter;
    }
  }

  return impulse;
}

/**
 * 混响总线：作为 send/return 使用，不直接串在主链路上。
 * input → convolver → output
 */
export class Reverb {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly convolver: ConvolverNode;

  constructor(ctx: BaseAudioContext, options: ReverbOptions = {}) {
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.convolver.buffer = createReverbImpulse(ctx, options);

    this.output = ctx.createGain();
    this.output.gain.value = 1;

    this.input.connect(this.convolver);
    this.convolver.connect(this.output);
  }

  /** 调整混响送出量（0–1）。 */
  setSendAmount(amount: number): void {
    const safe = Math.max(0, Math.min(1, amount));
    if (typeof this.convolver.buffer !== 'undefined') {
      this.input.gain.setTargetAtTime(safe, this.input.context.currentTime, 0.05);
    }
  }

  /** 释放底层节点引用，供 AudioContext 关闭时调用。 */
  dispose(): void {
    try {
      this.input.disconnect();
      this.convolver.disconnect();
      this.output.disconnect();
    } catch {
      /* 已断开，忽略 */
    }
    this.convolver.buffer = null;
  }
}
