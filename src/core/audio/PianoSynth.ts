import { midiToFrequency, noteToMidi } from './notes';
import {
  DEFAULT_VOICE_PRESET_ID,
  VOICE_PRESETS,
  voicePresetMath,
  type VoicePreset,
  type VoicePresetId,
} from './voicePresets';

/**
 * 轻量合成钢琴音色。
 *
 * 目标不是「电子琴加个包络」，而是复现击弦乐器的几个关键物理特征：
 *
 *  1. **谐波列 + 非谐性**：真实琴弦是刚性的，第 k 次谐波略高于 k 倍基频；
 *     高音弦短，非谐性更强。这一项决定了「像不像钢琴」。
 *  2. **双段衰减**：每根弦先快速衰减（明亮、结实），再进入很慢的「余音」阶段。
 *     这是钢琴最容易被忽略、也最容易被听出来的特征。
 *  3. **同音多弦拍频**：中低音每个音有 2–3 根弦，调音差在 1 音分以内，
 *     产生缓慢的音量起伏。少了它就一定像合成器。
 *  4. **按住期间持续自然衰减**：制音器抬起时琴弦一直在衰减，
 *     绝不能在包络上做成平台（那是电子琴的听感）。
 *  5. **松开是制音器落下**：指数逼近的自然衰减 + 余音，而不是线性切断。
 *  6. **击弦噪声**：木质击弦机的瞬态，给起音一点「锤子打在弦上」的质感。
 *  7. **力度改变音色**（而不只是音量）：敲得越重，高次分音被激发得越多。
 *     便宜的合成器只调音量，这是「电子琴感」最主要的来源。
 *  8. **琴体共鸣**：音板 / 箱体在几个频率上共振，给声音一个木头骨架。
 *
 * 7 与 8 都来自**音色预设**（`voicePresets.ts`）—— 本文件只负责「照着预设把音造出来」，
 * 自己不含任何音色参数。想加一套音色请改 `voicePresets.ts`，不要动这里。
 *
 * 全程程序生成，不引入任何音频资源文件。
 */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 音分 → 频率比例。 */
function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

/** 力度 → 峰值。整体压低一些，因为新音色的谐波能量远多于旧版。 */
function velocityToPeak(velocity: number): number {
  const v = clamp(velocity, 0, 1);
  return 0.2 + 0.58 * Math.pow(v, 1.25);
}

/** 每根弦的完整音量包络：快速起音 → 初段快衰减 → 很长的余音。 */
function schedulePartialEnvelope(
  param: AudioParam,
  when: number,
  attackSec: number,
  peak: number,
  partialDecaySec: number,
): void {
  const initialPhaseSec = Math.min(1.2, partialDecaySec * 0.42);
  const afterLevel = Math.max(peak * 0.3, peak * 0.0006);
  param.setValueAtTime(0, when);
  param.linearRampToValueAtTime(peak, when + attackSec);
  param.exponentialRampToValueAtTime(afterLevel, when + attackSec + initialPhaseSec);
  param.exponentialRampToValueAtTime(
    Math.max(peak * 0.0004, 1e-6),
    when + attackSec + initialPhaseSec + partialDecaySec * 1.9,
  );
}

/** 每根弦的最大保留时长（秒）——防止任何情况下出现「卡住的音」。 */
const MAX_VOICE_LIFETIME_SEC = 30;

export interface PianoVoiceOptions {
  ctx: AudioContext;
  destination: AudioNode;
  frequency: number;
  /** 0–1 */
  velocity: number;
  /** 绝对时间（AudioContext.currentTime 坐标系） */
  when: number;
  /** 音名，仅用于调试与日志 */
  note?: string;
  /** 击弦噪声缓冲，由 PianoSynth 共享 */
  noiseBuffer?: AudioBuffer | null;
  /** 音色预设：决定频谱、衰减、共鸣与颤音 */
  preset: VoicePreset;
}

export class PianoVoice {
  readonly frequency: number;
  readonly note: string;
  /** 制音器时间常数（秒），供 AudioEngine 做诊断 */
  readonly damperTc: number;

  private readonly ctx: AudioContext;
  private readonly oscillators: OscillatorNode[] = [];
  /** 门包络：按住期间恒为 1，松开时做制音器衰减 */
  private readonly gate: GainNode;
  private readonly toneFilter: BiquadFilterNode;
  private readonly startedAt: number;
  private readonly attackSec: number;
  private readonly safetyTimer: ReturnType<typeof setTimeout>;
  private released = false;
  private disposed = false;

  constructor(options: PianoVoiceOptions) {
    const { ctx, destination, frequency, velocity, when, noiseBuffer, preset } = options;
    this.ctx = ctx;
    this.frequency = frequency;
    this.note = options.note ?? `f${Math.round(frequency)}`;
    this.startedAt = when;

    const midi =
      options.note !== undefined && noteToMidi(options.note) !== null
        ? (noteToMidi(options.note) as number)
        : Math.round(69 + 12 * Math.log2(frequency / 440));
    this.damperTc = preset.damperTimeConstant(midi);

    const nyquist = ctx.sampleRate * 0.47;
    const fundamentalDecay = preset.fundamentalDecay(midi);
    const peak = velocityToPeak(velocity);
    // 起音更快（重击时几乎瞬时），但绝不为 0，避免出现爆音
    this.attackSec = 0.004 + 0.006 * (1 - clamp(velocity, 0, 1));

    // 音高整体做一个稳定的微小失谐，模拟这台琴的调音偏差。
    // 幅度由预设决定：立式琴偏得多，电钢琴几乎不偏。
    const tunedFrequency =
      frequency * centsToRatio(voicePresetMath.stableDetuneCents(this.note, preset.tuningSpreadCents));

    // ---------------- 门包络（制音器） ----------------
    // ⚠️ 必须**第一个**创建 GainNode：测试里用 `gains[0]` 取门包络。
    this.gate = ctx.createGain();
    this.gate.gain.value = 0;
    this.gate.gain.setValueAtTime(0, when);
    this.gate.gain.linearRampToValueAtTime(1, when + this.attackSec);
    // 注意：这里**不再**做任何「衰减到某个电平后平台化」的处理。
    // 按住期间的自然衰减完全由各分音的包络负责，这是钢琴手感的关键。
    this.gate.connect(destination);

    // ---------------- 信号链 ----------------
    // 分音 → 音色滤波 → 颤音（电钢琴）→ 门包络 → 总线
    // 琴体共鸣在总线上共享（见 buildVoiceTail 的注释）
    const tailInput = this.buildVoiceTail(ctx, preset);

    // ---------------- 音色滤波器（起音亮、余音暖） ----------------
    this.toneFilter = ctx.createBiquadFilter();
    this.toneFilter.type = 'lowpass';
    this.toneFilter.Q.value = preset.toneFilter.q;
    const openCutoff = Math.min(nyquist, Math.max(tunedFrequency * preset.toneFilter.openRatio, preset.toneFilter.minOpen));
    const restCutoff = Math.min(nyquist, Math.max(tunedFrequency * preset.toneFilter.restRatio, preset.toneFilter.minRest));
    this.toneFilter.frequency.setValueAtTime(openCutoff, when);
    this.toneFilter.frequency.exponentialRampToValueAtTime(
      restCutoff,
      when + Math.min(preset.toneFilter.maxRampSec, fundamentalDecay * preset.toneFilter.rampFactor),
    );
    this.toneFilter.connect(tailInput);

    // ---------------- 谐波列 ----------------
    const inharmonicity = preset.inharmonicity(midi);

    for (let k = 1; k <= preset.maxPartial; k += 1) {
      const ratio = k * Math.sqrt(1 + inharmonicity * k * k);
      const partialFreq = tunedFrequency * ratio;
      if (partialFreq >= nyquist) break;

      // 基准振幅 × 力度倾斜 × 预设的输出增益（后者用来把三套音色拉成等响）
      let amplitude =
        preset.partialAmplitude(k) * preset.spectralTilt(k, velocity) * preset.outputGain;
      const isBeating = k <= preset.beatingPartialCount && preset.beatDetuneCents > 0;
      // 同音多弦：两根弦略微失谐，加起来做 0.62 倍归一，保留拍频又不放大音量
      if (isBeating) amplitude *= 0.62;
      if (amplitude < 0.0015) continue;

      const partialDecaySec = Math.max(0.22, fundamentalDecay / Math.pow(k, 0.9));

      const partialGain = ctx.createGain();
      schedulePartialEnvelope(
        partialGain.gain,
        when,
        this.attackSec,
        amplitude,
        partialDecaySec,
      );
      partialGain.connect(this.toneFilter);

      const stringCount = isBeating ? 2 : 1;
      for (let string = 0; string < stringCount; string += 1) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const detune =
          stringCount === 1
            ? 0
            : string === 0
              ? -preset.beatDetuneCents
              : preset.beatDetuneCents;
        osc.frequency.setValueAtTime(partialFreq * centsToRatio(detune), when);
        osc.connect(partialGain);
        osc.start(when);
        this.oscillators.push(osc);
      }
    }

    // ---------------- 击弦噪声（锤子 / 击弦机） ----------------
    if (noiseBuffer && preset.attackNoise) {
      const { high, low } = preset.attackNoise;
      if (high) {
        // 高频成分：毛毡打在弦上的「嗤」
        this.addNoiseBurst(noiseBuffer, {
          when,
          gain: high.gain * peak * preset.outputGain,
          filterType: 'bandpass',
          frequency: Math.min(nyquist, Math.max(tunedFrequency * high.frequencyRatio, high.minFrequency)),
          q: high.q,
          attackSec: high.attackSec,
          decaySec: high.decaySec,
        });
      }
      if (low) {
        // 低频成分：击弦机的「咚」，让起音有实体感
        this.addNoiseBurst(noiseBuffer, {
          when,
          gain: low.gain * peak * preset.outputGain,
          filterType: 'lowpass',
          frequency: Math.min(nyquist, low.frequency),
          q: low.q,
          attackSec: low.attackSec,
          decaySec: low.decaySec,
        });
      }
    }

    // 兜底：任何异常路径都不允许出现永久卡住的音
    this.safetyTimer = setTimeout(() => {
      if (!this.released) this.release(this.ctx.currentTime);
    }, MAX_VOICE_LIFETIME_SEC * 1000);
  }

  /**
   * 颤音（电钢琴的经典特征）+ 接到门包络，返回「信号该接进去的那个节点」。
   *
   * ⚠️ **琴体共鸣不在这里**：它模拟的是同一块音板/箱体，属于整台琴而不是单个音，
   * 所以放在 `AudioEngine` 的总线共享链上（见 `AudioEngine.rebuildCabinet`）。
   * 数学上完全等价（线性时不变滤波器与求和可交换），但省下「每音 5 个双二阶」的开销。
   */
  private buildVoiceTail(
    ctx: AudioContext,
    preset: VoicePreset,
  ): AudioNode {
    let node: AudioNode = this.gate;

    if (preset.tremolo) {
      const depth = clamp(preset.tremolo.depth, 0, 0.9);
      const tremolo = ctx.createGain();
      // 中心电平取 1 - depth/2，LFO 的振幅取 depth/2 → 在 [1-depth, 1] 之间摆动
      tremolo.gain.value = 1 - depth / 2;
      tremolo.connect(this.gate);

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(preset.tremolo.rateHz, this.startedAt);
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth / 2;
      lfo.connect(lfoGain);
      lfoGain.connect(tremolo.gain);
      lfo.start(this.startedAt);
      // 跟着其他振荡器一起在松开后被停掉
      this.oscillators.push(lfo);
      node = tremolo;
    }

    return node;
  }

  private addNoiseBurst(    buffer: AudioBuffer,
    options: {
      when: number;
      gain: number;
      filterType: BiquadFilterType;
      frequency: number;
      q: number;
      attackSec: number;
      decaySec: number;
    },
  ): void {
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = options.filterType;
    filter.frequency.value = options.frequency;
    filter.Q.value = options.q;
    const gain = ctx.createGain();
    const start = options.when;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(options.gain, start + options.attackSec);
    gain.gain.exponentialRampToValueAtTime(1e-6, start + options.attackSec + options.decaySec);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.gate);
    source.start(start);
    source.stop(start + options.attackSec + options.decaySec + 0.02);
  }

  /**
   * 松开琴键：制音器落下。
   *
   * 用 setTargetAtTime 做指数逼近，而不是 linearRampToValueAtTime ——
   * 人耳对响度的感知是对数的，线性衰减会听起来像「掉下悬崖」，
   * 指数衰减才符合真实钢琴「逐渐变小、最后消失在房间混响里」的过程。
   */
  release(when = this.ctx.currentTime): void {
    this.beginRelease(when, this.damperTc);
  }

  /** 快速淡出：切页面 / 切后台 / 抢占复音时使用，仍保留一点点渐弱避免爆音。 */
  stopNow(when = this.ctx.currentTime): void {
    this.beginRelease(when, 0.045);
  }

  private beginRelease(when: number, timeConstant: number): void {
    if (this.disposed || this.released) return;
    this.released = true;
    clearTimeout(this.safetyTimer);

    const at = Math.max(when, this.startedAt);
    const param = this.gate.gain;

    // cancelScheduledValues 会把起音斜坡一并取消，参数会回退到上一个事件的 0，
    // 因此这里手工算出「此刻应该处于的电平」，不依赖浏览器对 param.value 的实现差异。
    const attackEnd = this.startedAt + this.attackSec;
    const levelNow =
      at >= attackEnd
        ? 1
        : Math.max(0.0001, (at - this.startedAt) / this.attackSec);

    param.cancelScheduledValues(at);
    param.setValueAtTime(levelNow, at);
    param.setTargetAtTime(0, at, timeConstant);

    // 指数逼近永远到不了 0，声学上 ~7 个时间常数已经是 -60dB，可以安全停止振荡器。
    const stopAt = at + timeConstant * 7 + 0.08;
    for (const osc of this.oscillators) {
      try {
        osc.stop(stopAt);
      } catch {
        /* 已经停止 */
      }
    }

    const first = this.oscillators[0];
    if (first) {
      first.onended = () => this.dispose();
    } else {
      // 极端情况下（频率超出奈奎斯特，没有创建任何振荡器）直接清理
      setTimeout(() => this.dispose(), (stopAt - this.ctx.currentTime + 0.05) * 1000);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.safetyTimer);
    for (const osc of this.oscillators) {
      try {
        osc.onended = null;
        osc.stop();
      } catch {
        /* 忽略 */
      }
      osc.disconnect();
    }
    this.oscillators.length = 0;
    try {
      this.gate.disconnect();
      this.toneFilter.disconnect();
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * PianoSynth：只负责「造一个音」，不管理生命周期。
 * 生命周期由 AudioEngine 的 VoiceManager 统一管理（避免 React 持有 AudioNode）。
 *
 * 音色由**当前预设**决定，预设可以随时切换 —— 已经在响的音不受影响，
 * 之后按下的键用新音色（同一架琴上换音色本来就该是这个手感）。
 */
export class PianoSynth {
  private readonly ctx: AudioContext;
  private readonly output: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  private preset: VoicePreset = VOICE_PRESETS[DEFAULT_VOICE_PRESET_ID];

  constructor(ctx: AudioContext, output: GainNode) {
    this.ctx = ctx;
    this.output = output;
  }

  setPreset(id: VoicePresetId | string): void {
    this.preset = VOICE_PRESETS[id as VoicePresetId] ?? VOICE_PRESETS[DEFAULT_VOICE_PRESET_ID];
  }

  getPresetId(): VoicePresetId {
    return this.preset.id;
  }

  createVoice(note: string, velocity = 0.85, when = this.ctx.currentTime): PianoVoice {
    const midi = noteToMidi(note);
    const frequency = midi === null ? 0 : midiToFrequency(midi);
    return new PianoVoice({
      ctx: this.ctx,
      destination: this.output,
      frequency: frequency > 0 ? frequency : 440,
      velocity,
      when,
      note,
      noiseBuffer: this.getNoiseBuffer(),
      preset: this.preset,
    });
  }

  /** 60ms 白噪声，带轻微衰减包络，供击弦瞬态使用。 */
  private getNoiseBuffer(): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const length = Math.max(1, Math.floor(this.ctx.sampleRate * 0.06));
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length);
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}

/**
 * 供单测使用的纯计算部分（不涉及任何 AudioNode）。
 *
 * ⚠️ 这里导出的都是**默认预设（三角钢琴）**的数学 —— 音色回归测试锁的就是它。
 * 想改音色请改 `voicePresets.ts` 里对应预设的参数。
 */
export const pianoVoiceMath = {
  partialAmplitude: (k: number) => VOICE_PRESETS.grand.partialAmplitude(k),
  inharmonicityFor: (midi: number) => VOICE_PRESETS.grand.inharmonicity(midi),
  fundamentalDecaySeconds: (midi: number) => VOICE_PRESETS.grand.fundamentalDecay(midi),
  damperTimeConstant: (midi: number) => VOICE_PRESETS.grand.damperTimeConstant(midi),
  velocityToPeak,
  brightnessScale: (k: number, velocity: number) => VOICE_PRESETS.grand.spectralTilt(k, velocity),
  stableNoteDetuneCents: (note: string) => voicePresetMath.stableDetuneCents(note),
  schedulePartialEnvelope,
} as const;
