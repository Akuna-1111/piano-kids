import { PianoSynth, PianoVoice } from './PianoSynth';
import { DrumEngine } from './DrumEngine';
import { Reverb } from './Reverb';
import {
  PIANO_BUS_HEADROOM,
  SOFT_CLIP_CEILING,
  createSoftClipCurve,
} from './mixHeadroom';
import { DEFAULT_VOICE_PRESET_ID, getVoicePreset, type VoicePreset, type VoicePresetId } from './voicePresets';

/**
 * AudioEngine —— 应用唯一的音频出口。
 *
 * 设计约束（来自开发规则 6 / 7）：
 *  - React 不直接持有 AudioNode 的生命周期，只调用本模块暴露的少量方法。
 *  - AudioContext 必须在用户手势中创建 / 恢复。
 *  - 状态模型使用 Map<note, voice> + Set<scheduled>，天然支持多点触控与双手弹奏。
 *  - 任何情况下都不允许出现「卡住的音」：多路兜底（safety timer / 切后台 / 超复音数抢占）。
 */

export type AudioEngineState = 'uninitialized' | 'suspended' | 'running' | 'closed' | 'unsupported';

type StateListener = (state: AudioEngineState) => void;

// 每个音现在是「完整谐波列 + 同音多弦」，振荡器远多于旧版，
// 因此复音上限收紧到孩子真实会用到的范围（同时按 12 个键已经很夸张了）。
const MAX_HELD_VOICES = 12;
const MAX_SCHEDULED_VOICES = 40;
const REVERB_SEND = 0.19;
const DEFAULT_VOLUME = 0.8;

function createAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private state: AudioEngineState = 'uninitialized';
  private listeners = new Set<StateListener>();

  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  pianoBus: GainNode | null = null;
  dryGain: GainNode | null = null;
  reverb: Reverb | null = null;
  reverbSend: GainNode | null = null;
  /** 末端软削波（音量之后）：保证输出永不触顶 */
  private clipPreGain: GainNode | null = null;
  private softClipper: WaveShaperNode | null = null;
  /** 当前音色的琴体共鸣链（整台琴共享） */
  private cabinetNodes: BiquadFilterNode[] = [];
  private synth: PianoSynth | null = null;
  /** 节拍器咔声（独立引擎 —— 开发规划 §12.4：鼓音逻辑不塞进钢琴引擎） */
  private drum: DrumEngine | null = null;

  /** 当前按住的音：note → voice（支持任意多指同时按下） */
  private readonly heldVoices = new Map<string, PianoVoice>();
  /** 未来已排程 / 正在自然衰减的音（Listen Mode 用） */
  private readonly scheduledVoices = new Set<PianoVoice>();

  private volume = DEFAULT_VOLUME;
  /** 当前音色预设；上下文建立之前先记住，建好 synth 后补上 */
  private voicePresetId: VoicePresetId = DEFAULT_VOICE_PRESET_ID;
  private visibilityBound = false;

  // ---------------------------------------------------------------- 状态

  getState(): AudioEngineState {
    if (this.ctx && this.state !== 'unsupported') {
      if (this.ctx.state === 'running') return 'running';
      if (this.ctx.state === 'closed') return 'closed';
      return 'suspended';
    }
    return this.state;
  }

  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** AudioContext 时间轴（秒）。所有排程与视觉同步都基于它。 */
  get currentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(next: AudioEngineState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  // ------------------------------------------------------------ 初始化

  /**
   * 在用户手势中调用。首次调用创建 AudioContext 与整条信号链。
   * 返回是否已经可用（running）。
   */
  /**
   * 节拍器咔声（节拍挑战用）。`when` 用 `AudioContext.currentTime` 时间轴；
   * 不传就是「立刻」。`accent` = 小节第一拍。
   */
  metronomeClick(when?: number, accent = false): void {
    if (!this.ctx || !this.drum) {
      void this.ensureReady().then((ready) => {
        if (ready) this.metronomeClick(when, accent);
      });
      return;
    }
    this.drum.click(when ?? this.ctx.currentTime, accent);
  }

  /** 掐掉所有已排进时间轴的咔声（退出节拍挑战时用） */
  stopMetronome(): void {
    this.drum?.stopAll();
  }

  async ensureReady(): Promise<boolean> {
    if (!this.ctx) {
      const ctx = createAudioContext();
      if (!ctx) {
        this.emit('unsupported');
        return false;
      }
      this.buildGraph(ctx);
    }
    const ctx = this.ctx!;

    if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
      try {
        await ctx.resume();
      } catch {
        /* 手势不足，下一次手势会再试 */
      }
    }
    this.bindVisibility();
    this.emit(ctx.state as AudioEngineState);
    return ctx.state === 'running';
  }

  private buildGraph(ctx: AudioContext): void {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;

    // 限幅器：**不是**用来保证不削波的（压缩器做不到，见 mixHeadroom.ts），
    // 它的作用是先把和弦的电平压下来，让末端软削波少饱和一点。
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 4;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;

    // 键盘总线留出余量：单音才能给和弦让出空间（见 mixHeadroom.ts 的实测表）
    this.pianoBus = ctx.createGain();
    this.pianoBus.gain.value = PIANO_BUS_HEADROOM;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 1;

    this.reverb = new Reverb(ctx, { durationSec: 1.15, decay: 2.9 });
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = REVERB_SEND;

    this.dryGain.connect(this.limiter);
    this.reverbSend.connect(this.reverb.input);
    this.reverb.output.connect(this.limiter);

    this.limiter.connect(this.master);

    // 琴体共鸣：整台琴共享的一串共振峰，串在总线上（见 rebuildCabinet）
    this.rebuildCabinet(ctx, getVoicePreset(this.voicePresetId));

    /**
     * 末端软削波：音量之后、输出之前。
     *
     * 放在这个位置是关键 —— 它保证**不管音量开到多大、同时按下多少个键**，
     * 出去的东西都不会超过满刻度。硬削波会生成刺耳的高次谐波，
     * 就是「连续按键盘时的嘈杂破音」；软饱和只是把超出的部分温和压回来。
     */
    this.clipPreGain = ctx.createGain();
    this.clipPreGain.gain.value = 1 / SOFT_CLIP_CEILING;
    this.softClipper = ctx.createWaveShaper();
    this.softClipper.curve = createSoftClipCurve();
    // 2x 过采样：非线性环节会产生超出奈奎斯特的谐波，不过采样会折回可听频段
    this.softClipper.oversample = '2x';

    this.master.connect(this.clipPreGain);
    this.clipPreGain.connect(this.softClipper);
    this.softClipper.connect(ctx.destination);

    this.synth = new PianoSynth(ctx, this.pianoBus);
    // 咔声走自己的总线，直接进限幅器：不经过钢琴的琴体共振，但同样受反向的两道保护
    this.drum = new DrumEngine(ctx, this.limiter);
    // 上下文建立前可能已经选过音色（设置是从存档读的），这里补上
    this.synth.setPreset(this.voicePresetId);

    ctx.onstatechange = () => this.emit(ctx.state as AudioEngineState);
    this.emit(ctx.state as AudioEngineState);
  }

  /**
   * 琴体共鸣（音板 / 箱体）：**整台琴共享的一串共振峰**。
   *
   * 关键点是「共享」：它模拟的是同一块音板，跟具体弹哪个音无关。
   *
   * - 放在单个音里：每个发声的音都要建 5 个双二阶滤波器 ——
   *   同时按 8 个键就是 40 个滤波器，iPad 上纯属浪费。
   * - 放在总线上：整台琴只有 5 个，而且**数学上完全等价**
   *   （线性时不变滤波器与求和可交换：`filter(Σ音) === Σfilter(音)`）。
   *
   * 省下来的预算换成了「每个预设 5 段塑形」—— 这才是三套音色听起来像
   * 三台不同的琴（而不是同一台琴蒙了块布）的原因：频谱斜率只能改变明暗，
   * **共振的形状**才决定「像哪台琴」。
   */
  private rebuildCabinet(ctx: AudioContext, preset: VoicePreset): void {
    for (const node of this.cabinetNodes) {
      try {
        node.disconnect();
      } catch {
        /* 已断开 */
      }
    }
    this.cabinetNodes = [];

    if (!this.pianoBus || !this.dryGain || !this.reverbSend) return;

    // 拆掉总线上原有的直连，改成串过共鸣链
    try {
      this.pianoBus.disconnect();
    } catch {
      /* 忽略 */
    }

    let node: AudioNode = this.pianoBus;
    for (const band of preset.bodyResonances) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      // 保 45% 采样率以下，避免在奈奎斯特附近出现无意义的峰
      filter.frequency.value = Math.min(ctx.sampleRate * 0.45, band.frequency);
      filter.Q.value = band.q;
      filter.gain.value = band.gainDb;
      node.connect(filter);
      node = filter;
      this.cabinetNodes.push(filter);
    }
    node.connect(this.dryGain);
    node.connect(this.reverbSend);
  }

  /** 切后台 / 锁屏再回来：绝不允许残留挂起的音。 */
  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        this.allNotesOff();
        void this.ctx.suspend().catch(() => undefined);
      } else {
        // 不需要新手势：如果失败，用户的下一次触摸会通过 ensureReady() 恢复。
        void this.ctx.resume().catch(() => undefined);
      }
    });
  }

  // -------------------------------------------------------------- 播放

  /**
   * 按下 / 触发一个音。
   * @param note  音名，例如 "C#4"
   * @param velocity 0–1
   */
  noteOn(note: string, velocity = 0.85): void {
    if (!this.ctx || !this.synth) {
      // 还没有初始化：在用户手势里尝试初始化后补发。
      void this.ensureReady().then((ok) => {
        if (ok) this.noteOn(note, velocity);
      });
      return;
    }
    if (this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => this.noteOn(note, velocity));
      return;
    }

    // 重复触发同一个音：先快速淡出旧的，避免叠加成「越来越响」
    const existing = this.heldVoices.get(note);
    if (existing) {
      existing.stopNow(this.ctx.currentTime);
      this.heldVoices.delete(note);
    }

    this.enforcePolyphony();

    const voice = this.synth.createVoice(note, velocity, this.ctx.currentTime);
    this.heldVoices.set(note, voice);
  }

  /** 松开琴键：交给琴音自己做制音器衰减，会有自然的余音。 */
  noteOff(note: string): void {
    const voice = this.heldVoices.get(note);
    if (!voice) return;
    this.heldVoices.delete(note);
    voice.release(this.ctx ? this.ctx.currentTime : 0);
  }

  /** 全部松开：切页面、切后台、异常兜底都走这里（快速淡出，不留尾音）。 */
  allNotesOff(): void {
    const at = this.ctx ? this.ctx.currentTime : 0;
    for (const voice of this.heldVoices.values()) voice.stopNow(at);
    this.heldVoices.clear();
    for (const voice of this.scheduledVoices) voice.stopNow(at);
    this.scheduledVoices.clear();
  }

  /**
   * 在统一时间轴上排程一个音（Listen Mode / 回放使用）。
   * 不使用 per-note setTimeout —— 长曲不会累积误差。
   */
  playScheduled(
    note: string,
    when: number,
    durationSec: number,
    velocity = 0.8,
  ): PianoVoice | null {
    if (!this.ctx || !this.synth) return null;
    if (this.ctx.state !== 'running') return null;

    this.enforcePolyphony();
    const voice = this.synth.createVoice(note, velocity, when);
    this.scheduledVoices.add(voice);
    if (this.scheduledVoices.size > MAX_SCHEDULED_VOICES) {
      const oldest = this.scheduledVoices.values().next().value;
      if (oldest) {
        this.scheduledVoices.delete(oldest);
        oldest.stopNow();
      }
    }
    // 到点自动松开：走自然制音器衰减，让 Listen Mode 的每个音都有真实余音
    const releaseDelay = Math.max(0, (when - this.ctx.currentTime + durationSec) * 1000);
    setTimeout(() => {
      voice.release(this.ctx ? this.ctx.currentTime : 0);
      this.scheduledVoices.delete(voice);
    }, releaseDelay);
    return voice;
  }

  /** 超复音数时抢占最早的音，保证不会因为长时间按住而失去响应。 */
  private enforcePolyphony(): void {
    while (this.heldVoices.size >= MAX_HELD_VOICES) {
      const oldestKey = this.heldVoices.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.heldVoices.get(oldestKey);
      this.heldVoices.delete(oldestKey);
      oldest?.stopNow(this.ctx ? this.ctx.currentTime : 0);
    }
  }

  // -------------------------------------------------------------- 控制

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  /**
   * 切换音色预设。
   *
   * 只影响**之后**造出来的音：已经在响的音继续用旧音色自然衰减完
   * （真实琴上换音色本来也不该把正在响的音掐掉）。
   * 上下文还没建立时先记住选择，`ensureReady()` 建好 synth 后再补上。
   */
  setVoicePreset(id: VoicePresetId | string): void {
    this.voicePresetId = getVoicePreset(id).id;
    this.synth?.setPreset(this.voicePresetId);
    // 琴体共鸣是整台琴的，换音色要跟着换
    if (this.ctx) this.rebuildCabinet(this.ctx, getVoicePreset(this.voicePresetId));
  }

  getVoicePresetId(): VoicePresetId {
    return this.voicePresetId;
  }

  /** 当前按住的音数量 —— 用于真机自检「有没有卡住的音」。 */
  getActiveVoiceCount(): number {
    return this.heldVoices.size + this.scheduledVoices.size;
  }

  /** Phase 0 真机验证用的诊断快照（文档十九 / Phase 0 验收标准）。 */
  getDiagnostics(): {
    state: AudioEngineState;
    sampleRate: number;
    baseLatencyMs: number | null;
    outputLatencyMs: number | null;
    heldVoices: number;
    scheduledVoices: number;
    volume: number;
    voicePreset: VoicePresetId;
  } {
    const ctx = this.ctx;
    const extended = ctx as (AudioContext & { outputLatency?: number }) | null;
    return {
      state: this.getState(),
      sampleRate: ctx ? ctx.sampleRate : 0,
      baseLatencyMs: ctx ? Math.round(ctx.baseLatency * 1000 * 100) / 100 : null,
      outputLatencyMs:
        extended && typeof extended.outputLatency === 'number'
          ? Math.round(extended.outputLatency * 1000 * 100) / 100
          : null,
      heldVoices: this.heldVoices.size,
      scheduledVoices: this.scheduledVoices.size,
      volume: this.volume,
      voicePreset: this.voicePresetId,
    };
  }

  /** 仅用于测试 / 特殊场景：彻底释放底层资源。 */
  async dispose(): Promise<void> {
    this.allNotesOff();
    this.reverb?.dispose();
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close();
      } catch {
        /* 忽略 */
      }
    }
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    this.drum = null;
    this.pianoBus = null;
    this.dryGain = null;
    this.reverb = null;
    this.reverbSend = null;
    this.clipPreGain = null;
    this.softClipper = null;
    this.synth = null;
    this.emit('closed');
  }
}

/** 全应用单例。 */
export const audioEngine = new AudioEngine();
