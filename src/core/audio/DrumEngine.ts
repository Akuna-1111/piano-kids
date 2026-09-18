/**
 * 节拍器的咔声。
 *
 * **独立于 `PianoSynth`** —— 开发规划 §12.4 明确要求「不要把鼓音逻辑塞进 PianoEngine」：
 * 咔声不是乐器音色，它要走自己的总线，也不该受三角钢琴/电钢琴预设影响。
 *
 * 声音构成：两个正弦叠一记极短的指数衰减（木鱼 / 机械节拍器的「哒」）。
 * 重拍（小节第一拍）更高、更响，孩子才听得出「四拍一组」。
 *
 * ## 电平
 *
 * 它接在**限幅器之前的独立总线上**（`AudioEngine` 负责接线），所以：
 * 咔声不经过钢琴的琴体共振，但仍然受 `limiter → master → 软削波` 的保护 ——
 * 音量跟着用户的音量走，而且不可能把总输出顶破。
 */

/** 咔声总线增益：要听得见，但不能盖过孩子弹的音 */
export const DRUM_BUS_GAIN = 0.32;

export class DrumEngine {
  private readonly bus: GainNode;
  private readonly scheduled = new Set<OscillatorNode>();

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    gain: number = DRUM_BUS_GAIN,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = gain;
    this.bus.connect(destination);
  }

  /**
   * 在**绝对时刻**响一声（`when` 用 `AudioContext.currentTime` 的时间轴）。
   *
   * 一次性把整轮的咔声全排进去，不用逐拍 `setTimeout` —— 这是本项目的音频铁律：
   * 所有音符共用一个时间轴，定时器只负责界面。
   */
  click(when: number, accent = false): void {
    const partials = accent ? [2200, 3300] : [1580, 2370];
    const peak = accent ? 0.9 : 0.62;
    const decaySec = 0.055;

    for (const frequency of partials) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;

      const envelope = this.ctx.createGain();
      envelope.gain.setValueAtTime(0, when);
      envelope.gain.linearRampToValueAtTime(peak, when + 0.002);
      envelope.gain.exponentialRampToValueAtTime(0.0008, when + decaySec);

      osc.connect(envelope);
      envelope.connect(this.bus);
      osc.start(when);
      osc.stop(when + decaySec + 0.02);

      this.scheduled.add(osc);
      osc.onended = () => this.scheduled.delete(osc);
    }
  }

  /** 退出挑战时把**已经排进时间轴**的咔声全部掐掉，不留「鬼声」 */
  stopAll(): void {
    for (const osc of this.scheduled) {
      try {
        osc.stop();
      } catch {
        /* 已经停过就忽略 */
      }
    }
    this.scheduled.clear();
  }

  dispose(): void {
    this.stopAll();
    try {
      this.bus.disconnect();
    } catch {
      /* 忽略 */
    }
  }
}
