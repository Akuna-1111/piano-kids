import type { KeyboardSize } from '@/features/piano/pianoLayout';

/**
 * 节拍挑战的纯逻辑（开发规划 §12.4）。
 *
 * 第一版只要五样东西：**速度 · marker · hit window · combo · result**。
 * 不做「劲舞团」那套 —— 没有连击特效、没有多轨、没有变奏谱面。
 *
 * ## 为什么单独一个模块
 *
 * 「什么时候该按」是**时间判定的数学**，与渲染、音频都无关：
 * 给它一个按键时刻和一条时间轴，它只回答「这一下属于哪一拍、差了多少毫秒、算哪一档」。
 * 这样节奏判定可以像 `practiceReducer` 一样被单测钉死，而页面只负责画与发声。
 *
 * ## 时钟约定（与跟弹模式一致）
 *
 * - **判定**用 `performance.now()`：输入事件天生在这个时钟里，误差是常数而不是漂移
 * - **发声**用 `AudioContext.currentTime`：由页面在开始时取一次两者差值，之后各自线性推进
 *
 * 两个时钟都按真实时间走，所以只存在一个**常数偏移**（取差值那一刻的几十微秒），
 * 对 ±180ms 的判定窗来说可以忽略；而如果用「每帧重新对表」反而会引入抖动。
 */

/** 判定窗（±毫秒）。窗口开得比跟弹模式宽：孩子第一次接触「跟着拍子按」这件事。 */
export const BEAT_WINDOWS = { perfectMs: 90, goodMs: 180 } as const;

/** 每档命中给多少分（准确率 = 得分 / 总拍数）。没跟上 = 0。 */
export const GRADE_SCORE = { perfect: 1, good: 0.6 } as const;

export type HitGrade = 'perfect' | 'good' | 'miss';

/** 速度档。慢档每分钟 60 拍 = 一秒一拍，是孩子最容易跟上的速度。 */
export const SPEED_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 60, label: '慢' },
  { value: 80, label: '正好' },
  { value: 100, label: '快' },
];

export const DEFAULT_BPM = 80;

/** 每小节几拍（重拍判定与视觉分组都用它） */
export const BEATS_PER_BAR = 4;
/** 预备拍：这几拍只响不判，让孩子先听到速度 */
export const COUNT_IN_BEATS = 4;
/** 正式要跟的拍数：4 小节 */
export const ROUND_BEATS = 16;
/** 开始后留一点时间给音频调度，第一声不会「已经过去了」 */
export const START_DELAY_MS = 600;

export interface BeatJudgement {
  grade: HitGrade;
  /** 落在第几拍（0 起，含预备拍）；没落在任何拍上时为 null */
  beatIndex: number | null;
  /** 与理想拍点的差（毫秒，早了为负） */
  deltaMs: number;
}

export interface BeatTapRecord {
  atMs: number;
  judgement: BeatJudgement;
}

export interface BeatChallengeState {
  bpm: number;
  beatMs: number;
  /** 时间轴起点（performance.now 域） */
  startMs: number;
  /** 每一拍的时刻，含预备拍 */
  beatTimesMs: number[];
  /** 每一拍的判定结果；还没到点或还没按为 null */
  grades: Array<HitGrade | null>;
  /** 前几拍是预备拍，不参与判定 */
  judgedFrom: number;
  taps: BeatTapRecord[];
  combo: number;
  maxCombo: number;
  /** 没有对应拍点的多按：只记录，不扣分（孩子乱按不该被惩罚） */
  extraTaps: number;
}

export interface BeatChallengeInput {
  bpm?: number;
  nowMs: number;
}

export function beatMsFor(bpm: number): number {
  return 60000 / bpm;
}

export function createBeatChallengeState(input: BeatChallengeInput): BeatChallengeState {
  const bpm = input.bpm ?? DEFAULT_BPM;
  const beatMs = beatMsFor(bpm);
  const startMs = input.nowMs + START_DELAY_MS;
  const totalBeats = COUNT_IN_BEATS + ROUND_BEATS;
  const beatTimesMs: number[] = [];
  for (let index = 0; index < totalBeats; index += 1) {
    beatTimesMs.push(startMs + index * beatMs);
  }
  return {
    bpm,
    beatMs,
    startMs,
    beatTimesMs,
    grades: new Array<HitGrade | null>(totalBeats).fill(null),
    judgedFrom: COUNT_IN_BEATS,
    taps: [],
    combo: 0,
    maxCombo: 0,
    extraTaps: 0,
  };
}

/** 这一拍是不是小节重拍（预备拍也按小节算，好让孩子听出「一小节四拍」） */
export function isAccentBeat(beatIndex: number): boolean {
  return beatIndex % BEATS_PER_BAR === 0;
}

/**
 * 判定一次按键。
 *
 * 规则：只在**尚未判定**的正式拍里，找时间上最近的那一拍；
 * 距离在 `goodMs` 之内才算命中（更近算完美）。找不到就算「多按」。
 */
export function judgeTap(
  state: BeatChallengeState,
  tapMs: number,
  windows = BEAT_WINDOWS,
): BeatJudgement {
  let bestIndex: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = state.judgedFrom; index < state.beatTimesMs.length; index += 1) {
    if (state.grades[index] !== null) continue; // 已经判过（命中或已过期）
    const distance = Math.abs(tapMs - state.beatTimesMs[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  if (bestIndex === null || bestDistance > windows.goodMs) {
    return { grade: 'miss', beatIndex: null, deltaMs: 0 };
  }
  return {
    grade: bestDistance <= windows.perfectMs ? 'perfect' : 'good',
    beatIndex: bestIndex,
    deltaMs: tapMs - state.beatTimesMs[bestIndex],
  };
}

/** 把一次按键记进状态（命中则计连击，多按只计数）。返回新状态。 */
export function applyTap(
  state: BeatChallengeState,
  tapMs: number,
  windows = BEAT_WINDOWS,
): BeatChallengeState {
  const judgement = judgeTap(state, tapMs, windows);
  if (judgement.beatIndex === null) {
    return {
      ...state,
      extraTaps: state.extraTaps + 1,
      taps: [...state.taps, { atMs: tapMs, judgement }],
    };
  }
  const grades = [...state.grades];
  grades[judgement.beatIndex] = judgement.grade;
  const combo = state.combo + 1;
  return {
    ...state,
    grades,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    taps: [...state.taps, { atMs: tapMs, judgement }],
  };
}

/**
 * 把「已经过了判定窗还没按」的拍记成没跟上。
 * 由页面的每一帧调用（纯函数，幂等：判过的拍不会重复记）。
 */
export function expireMissedBeats(
  state: BeatChallengeState,
  nowMs: number,
  windows = BEAT_WINDOWS,
): BeatChallengeState {
  const expired = state.beatTimesMs.filter(
    (timeMs, index) => index >= state.judgedFrom && state.grades[index] === null && nowMs > timeMs + windows.goodMs,
  );
  if (expired.length === 0) return state;

  const grades = [...state.grades];
  let combo = state.combo;
  for (let index = state.judgedFrom; index < state.beatTimesMs.length; index += 1) {
    if (grades[index] !== null) continue;
    if (nowMs > state.beatTimesMs[index] + windows.goodMs) {
      grades[index] = 'miss';
      combo = 0;
    }
  }
  return { ...state, grades, combo };
}

/** 正式拍全部判完，或时间已过最后一拍的窗口 → 这一轮结束 */
export function isRoundFinished(state: BeatChallengeState, nowMs: number): boolean {
  const lastIndex = state.beatTimesMs.length - 1;
  if (nowMs > state.beatTimesMs[lastIndex] + BEAT_WINDOWS.goodMs) return true;
  for (let index = state.judgedFrom; index < state.beatTimesMs.length; index += 1) {
    if (state.grades[index] === null) return false;
  }
  return true;
}

/**
 * marker 在轨道上的位置：0 = 刚出现在远端，1 = 正压在判定线上。
 * `leadBeats` 是提前几拍出现，越大越容易预判。
 */
export function markerProgress(nowMs: number, beatTimeMs: number, beatMs: number, leadBeats = 2): number {
  const appearAt = beatTimeMs - leadBeats * beatMs;
  if (beatMs <= 0) return 1;
  return (nowMs - appearAt) / (leadBeats * beatMs);
}

export interface BeatChallengeResult {
  perfect: number;
  good: number;
  miss: number;
  extraTaps: number;
  maxCombo: number;
  /** 0–1 */
  accuracy: number;
  /** 0–3，与跟弹模式的星星口径一致（只用于显示，挑战不给成长值） */
  stars: 0 | 1 | 2 | 3;
}

export function beatChallengeResult(state: BeatChallengeState): BeatChallengeResult {
  let perfect = 0;
  let good = 0;
  let miss = 0;
  for (let index = state.judgedFrom; index < state.grades.length; index += 1) {
    const grade = state.grades[index];
    if (grade === 'perfect') perfect += 1;
    else if (grade === 'good') good += 1;
    else if (grade === 'miss') miss += 1;
  }
  const total = ROUND_BEATS;
  const accuracy = (perfect * GRADE_SCORE.perfect + good * GRADE_SCORE.good) / total;
  const stars: 0 | 1 | 2 | 3 = accuracy >= 0.9 ? 3 : accuracy >= 0.7 ? 2 : accuracy >= 0.4 ? 1 : 0;
  return { perfect, good, miss, extraTaps: state.extraTaps, maxCombo: state.maxCombo, accuracy, stars };
}

/** 键盘档位只用来决定画哪块键盘 —— 节拍挑战里按哪个键都算一拍 */
export function tapKeysOf(size: KeyboardSize): KeyboardSize {
  return size;
}
