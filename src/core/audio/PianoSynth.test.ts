import { describe, expect, it } from 'vitest';
import { PianoSynth, PianoVoice, pianoVoiceMath } from './PianoSynth';
import { noteToMidi } from './notes';
import { VOICE_PRESETS } from './voicePresets';

/**
 * 音色的「听感」无法在自动化测试里判断，但**造成听感错误的那些参数**可以。
 *
 * 这组测试锁定的是两个真实出现过的缺陷：
 *   1. 松开琴键时用线性斜坡切到 0 → 听起来像被掐断，而不是制音器落下；
 *   2. 按住期间包络平台化（setTargetAtTime 到某个中间电平）→ 不再是钢琴的自然衰减。
 */

// ------------------------------------------------------------ 极简 Web Audio 桩

type ParamCall = { method: string; args: number[] };

class FakeParam {
  value = 0;
  readonly calls: ParamCall[] = [];

  private record(method: string, args: number[]): void {
    this.calls.push({ method, args });
  }

  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.record('setValueAtTime', [v, t]);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.record('linearRampToValueAtTime', [v, t]);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.record('exponentialRampToValueAtTime', [v, t]);
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.value = v;
    this.record('setTargetAtTime', [v, t, tc]);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.record('cancelScheduledValues', [t]);
    return this;
  }
  cancelAndHoldAtTime(t: number) {
    this.record('cancelAndHoldAtTime', [t]);
    return this;
  }
}

class FakeNode {
  connect() {
    return this;
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  readonly frequency = new FakeParam();
  readonly Q = new FakeParam();
  /** peaking 滤波器（琴体共鸣）用得到；桩要跟着真实 API 一起长 */
  readonly gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  onended: (() => void) | null = null;
  readonly frequency = new FakeParam();
  start() {}
  stop() {}
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  start() {}
  stop() {}
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly oscillators: FakeOscillator[] = [];
  readonly sources: FakeBufferSource[] = [];

  createGain() {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }
  createOscillator() {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }
  createBufferSource() {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

function createVoice(note = 'C4', velocity = 0.9) {
  const ctx = new FakeAudioContext();
  const destination = new FakeGain();
  const voice = new PianoVoice({
    ctx: ctx as unknown as AudioContext,
    destination: destination as unknown as AudioNode,
    frequency: 440 * Math.pow(2, ((noteToMidi(note) ?? 60) - 69) / 12),
    velocity,
    when: 0,
    note,
    noiseBuffer: null,
    // 这一组测试锁的是**默认预设（三角钢琴）**的行为
    preset: VOICE_PRESETS.grand,
  });
  return { ctx, voice };
}

/** 门包络就是第一个创建的 GainNode。 */
function gateParam(ctx: FakeAudioContext): FakeParam {
  return ctx.gains[0].gain;
}

// ------------------------------------------------------------ 测试

describe('钢琴音色：松开琴键必须是自然的指数衰减', () => {
  it('release() 使用 setTargetAtTime 做指数衰减，而不是线性斜坡切到 0', () => {
    const { ctx, voice } = createVoice('C4');
    const gate = gateParam(ctx);

    voice.release(1.0);

    const methods = gate.calls.map((call) => call.method);
    expect(methods).toContain('setTargetAtTime');
    // 关键断言：绝不能出现「线性斜坡到 0」
    const linearToZero = gate.calls.filter(
      (call) => call.method === 'linearRampToValueAtTime' && call.args[0] === 0,
    );
    expect(linearToZero).toHaveLength(0);
  });

  it('制音器衰减的时间常数是正的、有限值，且低音比高音衰减更慢', () => {
    const { ctx, voice: c4 } = createVoice('C4');
    c4.release(1.0);
    const target = gateParam(ctx).calls.find((call) => call.method === 'setTargetAtTime');
    expect(target).toBeDefined();
    const tc = target!.args[2];
    expect(tc).toBeGreaterThan(0);
    expect(tc).toBeLessThan(1);

    const { damperTimeConstant } = pianoVoiceMath;
    expect(damperTimeConstant(noteToMidi('C2')!)).toBeGreaterThan(
      damperTimeConstant(noteToMidi('C6')!),
    );
  });

  it('松开时先「保持住此刻的电平」再衰减，避免参数回退到 0 造成爆音/断音', () => {
    const { ctx, voice } = createVoice('C4');
    const gate = gateParam(ctx);
    voice.release(1.0);

    // 起音阶段已经排了一个 setValueAtTime(0, 0)，这里要找的是释放时刻那一个
    const setValue = gate.calls.find(
      (call) => call.method === 'setValueAtTime' && call.args[1] === 1.0,
    );
    expect(setValue).toBeDefined();
    // 起音早已结束，释放时应当从满电平开始衰减
    expect(setValue!.args[0]).toBeCloseTo(1, 5);
    expect(gate.calls.map((c) => c.method)).toContain('cancelScheduledValues');
  });

  it('在起音过程中就被松开（极短的一碰）也不会断掉，而是从当前电平平滑衰减', () => {
    const { ctx, voice } = createVoice('C4');
    const gate = gateParam(ctx);
    voice.release(0.002); // 起音尚未结束

    const setValue = gate.calls.find(
      (call) => call.method === 'setValueAtTime' && call.args[1] === 0.002,
    );
    expect(setValue).toBeDefined();
    expect(setValue!.args[0]).toBeGreaterThan(0);
    expect(setValue!.args[0]).toBeLessThan(1);
  });

  it('快速淡出（切页面 / 切后台）仍然是指数衰减，且时间常数更小', () => {
    const a = createVoice('C4');
    a.voice.release(1.0);
    const natural = gateParam(a.ctx).calls.find((c) => c.method === 'setTargetAtTime')!.args[2];

    const b = createVoice('C4');
    b.voice.stopNow(1.0);
    const quick = gateParam(b.ctx).calls.find((c) => c.method === 'setTargetAtTime')!.args[2];

    expect(quick).toBeLessThan(natural);
    expect(quick).toBeGreaterThan(0);
  });

  it('释放后振荡器的停止时间远晚于时间常数，保证余音不会被截断', () => {
    const { ctx, voice } = createVoice('C4');
    const stopTimes: number[] = [];
    for (const osc of ctx.oscillators) {
      osc.stop = ((when?: number) => {
        if (when !== undefined) stopTimes.push(when);
      }) as typeof osc.stop;
    }

    voice.release(1.0);
    expect(stopTimes.length).toBeGreaterThan(0);
    // 至少留出 6 个时间常数的尾巴
    expect(Math.min(...stopTimes)).toBeGreaterThan(1.4);
  });

  it('重复调用 release 是幂等的', () => {
    const { ctx, voice } = createVoice('C4');
    voice.release(1.0);
    const countAfterFirst = gateParam(ctx).calls.length;
    voice.release(1.2);
    expect(gateParam(ctx).calls.length).toBe(countAfterFirst);
  });
});

describe('钢琴音色：按住期间必须持续自然衰减', () => {
  it('门包络按住期间恒为 1，不做任何「衰减到中间电平后平台化」的处理', () => {
    const { ctx } = createVoice('C4');
    const gate = gateParam(ctx);

    // 只应有「起音到 1」这一个斜坡，没有后续的衰减事件
    expect(gate.calls).toHaveLength(2);
    expect(gate.calls[0].method).toBe('setValueAtTime');
    expect(gate.calls[0].args[0]).toBe(0);
    expect(gate.calls[1].method).toBe('linearRampToValueAtTime');
    expect(gate.calls[1].args[0]).toBe(1);

    const decayEvents = gate.calls.filter(
      (call) => call.method === 'setTargetAtTime' || call.method === 'exponentialRampToValueAtTime',
    );
    expect(decayEvents).toHaveLength(0);
  });

  it('每个分音都是「快起音 → 初段快衰减 → 长余音」的双段衰减', () => {
    const param = new FakeParam();
    pianoVoiceMath.schedulePartialEnvelope(param as unknown as AudioParam, 0, 0.005, 1, 3.0);

    const methods = param.calls.map((call) => call.method);
    expect(methods).toEqual([
      'setValueAtTime',
      'linearRampToValueAtTime',
      'exponentialRampToValueAtTime',
      'exponentialRampToValueAtTime',
    ]);

    const [, attack, firstDecay, secondDecay] = param.calls;
    // 起音是快到几乎瞬时的
    expect(attack.args[1]).toBeLessThan(0.02);
    // 初段衰减到 30% 左右，随后是很长的余音
    expect(firstDecay.args[0]).toBeCloseTo(0.3, 3);
    const initialPhase = firstDecay.args[1] - attack.args[1];
    const afterSoundPhase = secondDecay.args[1] - firstDecay.args[1];
    expect(initialPhase).toBeLessThan(1.3); // 初段很快就过
    expect(afterSoundPhase).toBeGreaterThan(initialPhase * 2); // 余音远长于初段
    // 指数衰减的每一个目标值都必须严格大于 0（否则 Web Audio 会抛错）
    expect(firstDecay.args[0]).toBeGreaterThan(0);
    expect(secondDecay.args[0]).toBeGreaterThan(0);
  });
});

describe('钢琴音色的物理参数', () => {
  const {
    fundamentalDecaySeconds,
    partialAmplitude,
    inharmonicityFor,
    velocityToPeak,
    stableNoteDetuneCents,
  } = pianoVoiceMath;

  it('低音余音长、高音衰减快（真实琴弦的行为）', () => {
    expect(fundamentalDecaySeconds(noteToMidi('C2')!)).toBeGreaterThan(
      fundamentalDecaySeconds(noteToMidi('C4')!),
    );
    expect(fundamentalDecaySeconds(noteToMidi('C4')!)).toBeGreaterThan(
      fundamentalDecaySeconds(noteToMidi('C6')!),
    );
    // 中音区至少要有几秒的余音，否则一定听起来像电子琴
    expect(fundamentalDecaySeconds(60)).toBeGreaterThan(4);
  });

  it('高次谐波振幅整体滚降，且击弦点处（7 的倍数）形成局部凹坑', () => {
    // 总体趋势向下
    expect(partialAmplitude(2)).toBeLessThan(partialAmplitude(1));
    expect(partialAmplitude(12)).toBeLessThan(partialAmplitude(3));
    // 击弦点在弦长 1/7 处：7 次谐波被抑制，形成「凹坑」——这是钢琴频谱的指纹
    expect(partialAmplitude(7)).toBeLessThan(partialAmplitude(6));
    expect(partialAmplitude(7)).toBeLessThan(partialAmplitude(8));
    expect(partialAmplitude(14)).toBeLessThan(partialAmplitude(13));
  });

  it('非谐性随音高增强（高音弦更短更硬）', () => {
    expect(inharmonicityFor(noteToMidi('C6')!)).toBeGreaterThan(inharmonicityFor(60));
    expect(inharmonicityFor(60)).toBeGreaterThan(inharmonicityFor(noteToMidi('C2')!));
  });

  it('力度映射单调、有界，且不会为 0', () => {
    expect(velocityToPeak(0)).toBeGreaterThan(0);
    expect(velocityToPeak(1)).toBeGreaterThan(velocityToPeak(0.5));
    expect(velocityToPeak(1)).toBeLessThan(1);
  });

  it('每个音都有稳定且微小的调音偏差（同一次会话里同一个音始终一致）', () => {
    const a = stableNoteDetuneCents('C4');
    expect(stableNoteDetuneCents('C4')).toBe(a);
    expect(Math.abs(a)).toBeLessThan(2.5);
    expect(stableNoteDetuneCents('D4')).not.toBe(a);
  });
});

describe('钢琴音色：振荡器数量控制在可接受范围', () => {
  it('单个音的分音数量有限，且同音多弦只在低次分音上使用', () => {
    const { ctx } = createVoice('C4');
    // 每个分音 1 根弦，低三个分音各多一根拍频弦
    expect(ctx.oscillators.length).toBeGreaterThan(8);
    expect(ctx.oscillators.length).toBeLessThanOrEqual(22);
  });

  it('超出奈奎斯特频率的分音不会被创建（不会产生混叠）', () => {
    const { ctx } = createVoice('C8'); // 4186Hz，48000Hz 采样率下只有很少分音可用
    expect(ctx.oscillators.length).toBeLessThan(12);
    for (const osc of ctx.oscillators) {
      const freq = osc.frequency.calls[0].args[0];
      expect(freq).toBeLessThan(48000 * 0.47);
    }
  });
});

describe('PianoSynth 工厂', () => {
  it('createVoice 会为每个音营造独立的声部', () => {
    const ctx = new FakeAudioContext();
    const output = new FakeGain();
    const synth = new PianoSynth(ctx as unknown as AudioContext, output as unknown as GainNode);
    const voice = synth.createVoice('E4', 0.9, 0);
    expect(voice.note).toBe('E4');
    expect(voice.frequency).toBeCloseTo(329.63, 1);
    expect(voice.damperTc).toBeGreaterThan(0);
  });
});
