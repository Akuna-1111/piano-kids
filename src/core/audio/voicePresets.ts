import { midiToFrequency, noteToMidi } from './notes';

/**
 * 音色预设 —— 「同一架钢琴换一套音色」。
 *
 * ## 为什么需要这个文件
 *
 * 只有一套参数的合成器听感会偏「电子琴」。真实钢琴与合成器的差别集中在三处，
 * 这三处都做成了预设参数：
 *
 *  1. **力度改变音色，而不只是音量**（`spectralTilt`）。
 *     真钢琴敲得越重，高次分音被激发得越多、频谱倾斜越平 —— 是「音色变了」。
 *     便宜的合成器只把整体音量调大，听起来就是「电子琴」。
 *  2. **琴体共鸣**（`bodyResonances`）。音板 / 箱体在几个频率上共振，
 *     给声音一个「木头 / 金属骨架」。完全没有共鸣的干声就是采样器里的干声。
 *  3. **制音器、拍频、非谐性**（`damperTimeConstant` / `beatDetuneCents` / `inharmonicity`）。
 *     这些原本就做对了，现在只是按预设给出不同取值。
 *
 * ## 三套预设
 *
 * | id | 名字 | 性格 |
 * | --- | --- | --- |
 * | `grand` | 三角钢琴 | 明亮、共鸣丰富、余音长（**默认**，也就是原来那套参数） |
 * | `upright` | 立式钢琴 | 温和一点、箱体感更重、余音短一些；家用琴本来也不那么准 |
 * | `electric` | 电钢琴 | 电钢琴（Rhodes 一类）：钟一样的起音 + 很长的基频 + 轻微颤音，没有击弦噪声 |
 *
 * ## 加一套新音色时
 *
 * 照着下面的接口填参数即可，**不需要动 `PianoSynth`**。但要注意：
 * 力度 → 音色的关系（`spectralTilt`）必须写出「形状随力度变化」，
 * 只写一个统一的倍率的话，不管怎么调都会回到电子琴的听感。
 */

/** 琴体（音板 / 箱体）的一个共振峰。 */
export interface BodyResonance {
  frequency: number;
  q: number;
  /** 提升量（dB）。用 peaking 滤波器实现；**负数就是挖一个坑**。 */
  gainDb: number;
}

/** 击弦噪声：高频是毛毡打在弦上的「嗤」，低频是击弦机的「咚」。 */
export interface AttackNoiseSpec {
  /** 高频瞬态 */
  high: {
    gain: number;
    /** 中心频率 = 基频 × 这个比例，再取 max(…, minFrequency) */
    frequencyRatio: number;
    minFrequency: number;
    q: number;
    attackSec: number;
    decaySec: number;
  } | null;
  /** 低频瞬态 */
  low: {
    gain: number;
    frequency: number;
    q: number;
    attackSec: number;
    decaySec: number;
  } | null;
}

export interface VoicePreset {
  id: VoicePresetId;
  /** 设置页里显示的名字 */
  name: string;
  /** 一句话性格描述（给孩子/家长选音色时看的） */
  description: string;

  /** 分音振幅基准（k 从 1 起）。**不含力度影响** —— 力度由 `spectralTilt` 负责。 */
  partialAmplitude(k: number): number;
  /** 非谐性系数：越高的音弦越短越硬，非谐性越强。 */
  inharmonicity(midi: number): number;
  /** 基频的「余音」时长（秒）。 */
  fundamentalDecay(midi: number): number;
  /** 制音器落下的时间常数（秒）。越短=松手后收得越快。 */
  damperTimeConstant(midi: number): number;
  /** 分音上限（实际数量还会受奈奎斯特频率限制）。 */
  maxPartial: number;

  /**
   * 力度 → 频谱倾斜。
   *
   * 返回 k≥3 分音的倍率，**必须随力度改变曲线的形状**：
   * 敲得越重，高次分音相对抬得越多（指数为正），轻触时反过来压下去（指数为负）。
   */
  spectralTilt(k: number, velocity: number): number;

  /** 同音多弦的失谐（音分）。0 = 单弦，没有拍频（电钢琴就是单弦）。 */
  beatDetuneCents: number;
  /** 整台琴调音偏差的满幅（音分）。同一个音每次都得到同样的偏差。 */
  tuningSpreadCents: number;
  /** 拍频弦的数量上限：只有最低的几个分音有多根弦。 */
  beatingPartialCount: number;

  attackNoise: AttackNoiseSpec | null;

  /** 音色滤波：起音截止 = max(f0 × openRatio, minOpen)，余音截止 = max(f0 × restRatio, minRest)。 */
  toneFilter: {
    openRatio: number;
    restRatio: number;
    minOpen: number;
    minRest: number;
    q: number;
    /** 从起音过渡到余音所用的时间 = 基频余音 × 这个系数 */
    rampFactor: number;
    /** 过渡时长上限（秒） */
    maxRampSec: number;
  };

  /** 琴体共鸣（**放在总线上共享**，见 AudioEngine：它模拟的是同一块音板/箱体） */
  bodyResonances: readonly BodyResonance[];

  /** 颤音（电钢琴的经典特征）。null = 没有。 */
  tremolo: { rateHz: number; depth: number } | null;

  /**
   * 输出增益：把三套音色的**响度**拉平。
   *
   * 换音色不该顺带把音量也换掉。各套音色的频谱能量差别很大 ——
   * 电钢琴只有基频加很弱的几次分音，实测比三角钢琴**低 4.7dB**。
   *
   * 以三角钢琴为 1.0 基准，用 `npm run shot -- "#/" --script scripts/flows/preset-loudness.js`
   * 量出来再填。加新音色时**必须补量一次**，否则切过去会忽然变小或变大。
   */
  outputGain: number;
}

export type VoicePresetId = 'grand' | 'upright' | 'electric';

export const DEFAULT_VOICE_PRESET_ID: VoicePresetId = 'grand';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 高音弦更短更硬 → 非谐性更强。不同琴的硬度不同，用系数区分。 */
function inharmonicityCurve(coefficient: number, midi: number): number {
  return coefficient * Math.pow(2, (midi - 21) / 30);
}

/**
 * 击弦点在大约 1/7 弦长处，所以 7 的倍数次谐波被抑制 —— 这是钢琴频谱的指纹。
 * `notch` 越小，凹坑越深（立式琴的击弦点更靠近弦端，凹坑更明显）。
 */
function struckStringAmplitude(rolloff: number, notch: number, k: number): number {
  return Math.pow(k, -rolloff) * (k % 7 === 0 ? notch : 1);
}

/**
 * 一条「形状随力度变化」的倾斜曲线。
 *
 * 以 k=3 为支点：`(k/3)^exponent`，`exponent` 随力度从负到正。
 * 支点取 3 是因为 k≤2 的分音几乎不随力度变化（钢琴的前两个分音一直很稳），
 * 变化发生在更高的分音上。
 */
function tiltAround(exponentAtZero: number, exponentPerVelocity: number, k: number, velocity: number) {
  if (k <= 2) return 1;
  const exponent = exponentAtZero + exponentPerVelocity * clamp(velocity, 0, 1);
  return Math.pow(k / 3, exponent);
}

/* ============================================================
   三角钢琴（默认）—— 也就是原来那套参数，保持听感不变
   ============================================================ */

const grand: VoicePreset = {
  id: 'grand',
  name: '三角钢琴',
  description: '明亮、开阔，余音很长',
  partialAmplitude: (k) => struckStringAmplitude(1.6, 0.42, k),
  inharmonicity: (midi) => inharmonicityCurve(0.0001, midi),
  fundamentalDecay: (midi) => clamp(12.5 * Math.pow(2, -(midi - 40) / 28), 1.6, 16),
  damperTimeConstant: (midi) => {
    const t = clamp((midi - 21) / 87, 0, 1);
    return 0.19 - t * 0.1; // A0 ≈ 0.19s → C8 ≈ 0.09s
  },
  maxPartial: 18,
  /**
   * 倾斜指数从 -0.7（轻触）到 +0.35（重击）。
   * 在默认力度 0.85 处倍率约 1.19 —— 与原实现几乎一致，
   * 所以默认听感不变，但**动态范围**约 2.5 倍（第 10 次分音处）。
   * 三角琴的看家本领就是动态范围，所以给得比立式琴大得多。
   */
  spectralTilt: (k, velocity) => tiltAround(-0.7, 1.05, k, velocity),
  beatDetuneCents: 1.4,
  tuningSpreadCents: 4.5,
  beatingPartialCount: 3,
  attackNoise: {
    high: { gain: 0.09, frequencyRatio: 5, minFrequency: 1800, q: 0.8, attackSec: 0.0015, decaySec: 0.03 },
    low: { gain: 0.06, frequency: 260, q: 0.7, attackSec: 0.002, decaySec: 0.055 },
  },
  toneFilter: {
    openRatio: 18,
    restRatio: 7,
    minOpen: 2600,
    minRest: 900,
    q: 0.6,
    rampFactor: 0.45,
    maxRampSec: 2.0,
  },
  /**
   * 音板「打开」的形状：低频厚、中低被挖掉一点（避免盒子味）、高频通透。
   * 这是「三角琴的听感」的主要来源 —— 频谱斜率只能改变明暗，
   * **共振的形状**才决定「听起来像哪一台琴」。
   */
  bodyResonances: [
    { frequency: 90, q: 0.9, gainDb: 3.2 },
    { frequency: 330, q: 1.6, gainDb: -2.8 },
    { frequency: 1000, q: 0.8, gainDb: 1.0 },
    { frequency: 2600, q: 1.1, gainDb: 2.8 },
    { frequency: 5200, q: 0.9, gainDb: 1.5 },
  ],
  tremolo: null,
  /** 基准音色 */
  outputGain: 1,
};

/* ============================================================
   立式钢琴
   ============================================================ */

const upright: VoicePreset = {
  id: 'upright',
  name: '立式钢琴',
  description: '木头味重、箱子嗡嗡的，像家里那台琴',
  // 滚降更陡 = 更暗；凹坑更深（击弦点更靠弦端）
  partialAmplitude: (k) => struckStringAmplitude(1.95, 0.34, k),
  /**
   * **弦短 → 非谐性明显更高**。这是「立式琴」最强的听感线索之一：
   * 分音不在整数倍上，听起来比三角琴「紧、闷、有点走音」。
   * 差 4 倍不是随手写的 —— 三角琴弦长、立式琴弦短，这一项本来就该差一个数量级。
   */
  inharmonicity: (midi) => inharmonicityCurve(0.00042, midi),
  /** 余音只有三角琴的一半不到（实测 C4：2.8s vs 7.6s） */
  fundamentalDecay: (midi) => clamp(6.4 * Math.pow(2, -(midi - 40) / 17), 0.9, 8),
  damperTimeConstant: (midi) => {
    const t = clamp((midi - 21) / 87, 0, 1);
    return 0.16 - t * 0.08;
  },
  maxPartial: 15,
  /** 动态范围明显更小 —— 家用立式琴弹不出三角琴那种强弱对比 */
  spectralTilt: (k, velocity) => tiltAround(-0.44, 0.5, k, velocity),
  /** 弦的调音更不干净，拍频更明显（嗡嗡的合唱感） */
  beatDetuneCents: 3.4,
  // 家用琴的调音本来就不那么准
  tuningSpreadCents: 9.5,
  beatingPartialCount: 3,
  attackNoise: {
    // 高音更闷（没有开盖），低频「咚」更重（击弦机就在手边，箱体小）
    high: { gain: 0.045, frequencyRatio: 4.2, minFrequency: 1200, q: 0.9, attackSec: 0.0018, decaySec: 0.028 },
    low: { gain: 0.125, frequency: 200, q: 0.9, attackSec: 0.002, decaySec: 0.065 },
  },
  toneFilter: {
    openRatio: 12,
    restRatio: 5,
    minOpen: 2000,
    minRest: 700,
    q: 0.7,
    rampFactor: 0.5,
    maxRampSec: 2.2,
  },
  /**
   * 小箱体的形状：低频隆起、**中低一个大包（箱子嗡嗡的「honky」）**、
   * 上部被挖掉（没有开盖，传不远）、顶上再压一点。
   *
   * 和三角琴的对比是**形状上的**，不是「把高音拧小」——
   * 只改明暗的话，听起来只会像同一台琴蒙了块布。
   *
   * ⚠️ 挖坑的深度要克制：`-3dB` 已经足够听出「闷」，`-8dB` 就会变成「坏了」。
   * 这里几个高频段是**叠加**的（音色滤波 + 分音上限 + 共鸣链），
   * 所以每一段都不能给太狠 —— 实测总量见 `scripts/flows/preset-spectrum.js`。
   */
  bodyResonances: [
    { frequency: 140, q: 1.8, gainDb: 4.8 },
    { frequency: 620, q: 2.0, gainDb: 4.6 },
    { frequency: 1600, q: 1.6, gainDb: -3.0 },
    { frequency: 3000, q: 2.0, gainDb: 1.6 },
    { frequency: 6500, q: 1.0, gainDb: -2.5 },
  ],
  tremolo: null,
  // 更暗、共鸣更重的频谱整体能量略低，补回来（量值见 preset-loudness.js）
  outputGain: 1.32,
};

/* ============================================================
   电钢琴（Rhodes 一类）
   ============================================================ */

/**
 * 电钢琴的音：一根被敲响的金属齿（tine）+ 一个共鸣管。
 *
 * 频谱上只有基频很强、高次分音很弱，但在**高次处有一个「铃」**
 * （齿的金属声）。轻触时几乎只有基频（柔和），敲重了铃就出来（bark）——
 * 这个力度→音色的关系就是电钢琴的灵魂，靠 `spectralTilt` 的大指数实现。
 */
const electric: VoicePreset = {
  id: 'electric',
  name: '电钢琴',
  description: '柔和的钟声起音，敲得重会「亮」起来',
  partialAmplitude: (k) => {
    const base = Math.pow(k, -2.6);
    // 齿的金属共鸣：第 8–12 次分音处抬起来
    const bell = k >= 8 && k <= 12 ? 5 : 1;
    return base * bell;
  },
  // 齿不是刚硬的琴弦：不做非谐性
  inharmonicity: () => 0,
  fundamentalDecay: (midi) => clamp(9.5 * Math.pow(2, -(midi - 40) / 40), 1.6, 12),
  damperTimeConstant: (midi) => {
    const t = clamp((midi - 21) / 87, 0, 1);
    return 0.11 - t * 0.05;
  },
  maxPartial: 16,
  /**
   * 电钢琴的力度曲线要「夸张」：指数从 -0.55（轻触，高频被压下去）
   * 到 +1.65（重击，高频抬 7 倍左右）。这一条决定了「会不会 bark」。
   */
  spectralTilt: (k, velocity) => tiltAround(-1.1, 2.2, k, velocity),
  // 单根齿，没有拍频
  beatDetuneCents: 0,
  // 电子乐器，音准很稳
  tuningSpreadCents: 1.6,
  beatingPartialCount: 0,
  attackNoise: {
    // 只有一点点齿的「嗒」，没有毛毡噪声
    high: { gain: 0.02, frequencyRatio: 8, minFrequency: 3000, q: 1.2, attackSec: 0.0008, decaySec: 0.012 },
    low: null,
  },
  toneFilter: {
    // 截止开得很高，铃才能出来
    openRatio: 20,
    restRatio: 8,
    minOpen: 3200,
    minRest: 900,
    q: 0.5,
    rampFactor: 0.5,
    maxRampSec: 3.0,
  },
  // 塑料 + 木头的箱体，共鸣比钢琴克制
  bodyResonances: [
    { frequency: 200, q: 1.0, gainDb: 1.8 },
    { frequency: 2400, q: 1.2, gainDb: 2.4 },
    { frequency: 5000, q: 0.8, gainDb: 1.0 },
  ],
  // 经典的电钢琴颤音
  tremolo: { rateHz: 4.6, depth: 0.24 },
  /**
   * 电钢琴的频谱能量远低于钢琴（只有基频加很弱的几次分音），
   * 实测单音比三角钢琴低 4.7dB —— 不补回来的话一切过去就以为「坏了」。
   * 数值随琴体共鸣的改动重算过，量值见 `scripts/flows/preset-loudness.js`。
   */
  outputGain: 1.3,
};

export const VOICE_PRESETS: Record<VoicePresetId, VoicePreset> = {
  grand,
  upright,
  electric,
};

/** 设置页里的顺序（也是界面上的呈现顺序）。 */
export const VOICE_PRESET_IDS: readonly VoicePresetId[] = ['grand', 'upright', 'electric'];

export function getVoicePreset(id: string | null | undefined): VoicePreset {
  if (id && id in VOICE_PRESETS) return VOICE_PRESETS[id as VoicePresetId];
  return VOICE_PRESETS[DEFAULT_VOICE_PRESET_ID];
}

export function isVoicePresetId(value: unknown): value is VoicePresetId {
  return typeof value === 'string' && value in VOICE_PRESETS;
}

/** 供单测使用的纯计算部分（不涉及任何 AudioNode）。 */
export const voicePresetMath = {
  /** 同一个音每次都得到**相同**的调音偏差（模拟「这台琴就是这样调的」）。 */
  stableDetuneCents(note: string, spreadCents = grand.tuningSpreadCents): number {
    let hash = 2166136261;
    for (let i = 0; i < note.length; i += 1) {
      hash ^= note.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const unit = ((hash >>> 0) % 1000) / 1000;
    return (unit - 0.5) * spreadCents;
  },
  noteFrequency(note: string): number {
    const midi = noteToMidi(note);
    return midi === null ? 440 : midiToFrequency(midi);
  },
} as const;
