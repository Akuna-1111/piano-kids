import type { Difficulty } from '@/features/songs/types';

/**
 * 评分系统（文档 8.2 / 8.3）。
 *
 * 一份 PerformanceEvent 数据同时服务三件事：评分、复盘、录音回放。
 * 时间和难度都按「对孩子友好」的方式放宽，绝不做竞技化处理。
 */

export interface PerformanceEvent {
  note: string;
  expectedNote?: string;
  /** 毫秒时间戳（performance.now 或 Date.now 的同一坐标系） */
  actualAt: number;
  expectedAt?: number;
  timingDeltaMs?: number;
  correct: boolean;
}

export interface ScoreBreakdown {
  pitchScore: number;
  timingScore: number;
  accuracy: number;
  correctNotes: number;
  wrongNotes: number;
  missedNotes: number;
  expectedNotes: number;
  maxCombo: number;
}

export interface ScoringOptions {
  difficulty: Difficulty;
  /** >1 更宽松（设置页可调） */
  timingWindowScale?: number;
  /** 曲目总音符数（可以是「已进行到的位置」，用于中途退出的情况） */
  expectedNotes: number;
}

/** 基础时间窗口：初学者极宽松，随难度收窄（文档 8.3）。 */
export function baseTimingWindowMs(difficulty: Difficulty): number {
  switch (difficulty) {
    case 1:
      return 750;
    case 2:
      return 550;
    case 3:
      return 400;
    default:
      return 750;
  }
}

export function timingWindowMs(difficulty: Difficulty, scale = 1): number {
  return baseTimingWindowMs(difficulty) * Math.max(0.5, Math.min(3, scale));
}

/**
 * 单个音的时间分。
 *
 * 步进式「跟弹」里孩子自己控制速度，因此窗口内一律满分；
 * 超出窗口后在一个很宽的带内平滑衰减，而不是直接判 0 ——
 * 让孩子「想久一点」不会毁掉整首曲子的成绩。
 */
export function timingScoreForDelta(deltaMs: number | undefined, windowMs: number): number | null {
  if (deltaMs === undefined || !Number.isFinite(deltaMs)) return null;
  const over = Math.max(0, Math.abs(deltaMs) - windowMs);
  const graceBand = windowMs * 3;
  return Math.max(0, Math.min(1, 1 - over / graceBand));
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/**
 * 汇总一次演奏。
 *
 * pitchScore：正确音数 - 0.5 × 错误音数，再对「应弹音数」归一化。
 * timingScore：所有带 timingDelta 的事件的时间分均值。
 * accuracy = pitch * 0.7 + timing * 0.3
 */
export function scorePerformance(
  events: readonly PerformanceEvent[],
  options: ScoringOptions,
): ScoreBreakdown {
  const expectedNotes = Math.max(1, Math.floor(options.expectedNotes));
  const windowMs = timingWindowMs(options.difficulty, options.timingWindowScale ?? 1);

  let correctNotes = 0;
  let wrongNotes = 0;
  let combo = 0;
  let maxCombo = 0;
  let timingSum = 0;
  let timingCount = 0;

  for (const event of events) {
    if (event.correct) {
      correctNotes += 1;
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      const score = timingScoreForDelta(event.timingDeltaMs, windowMs);
      if (score !== null) {
        timingSum += score;
        timingCount += 1;
      }
    } else {
      wrongNotes += 1;
      combo = 0;
    }
  }

  const missedNotes = Math.max(0, expectedNotes - correctNotes);

  const pitchRaw = (correctNotes - wrongNotes * 0.5) / expectedNotes;
  const pitchScore = clampScore(pitchRaw * 100);
  // 没有可判定的时间数据时给满分：不该因为「没有数据」而扣分
  const timingScore = timingCount === 0 ? 100 : clampScore((timingSum / timingCount) * 100);
  const accuracy = clampScore(pitchScore * 0.7 + timingScore * 0.3);

  return {
    pitchScore: Math.round(pitchScore),
    timingScore: Math.round(timingScore),
    accuracy: Math.round(accuracy),
    correctNotes,
    wrongNotes,
    missedNotes,
    expectedNotes,
    maxCombo,
  };
}

/** 完成页展示用的星级（与 ProgressStore 的星星规则保持一致）。 */
export function starsForAccuracy(accuracy: number): number {
  if (accuracy >= 90) return 3;
  if (accuracy >= 70) return 2;
  return 1;
}

/** 毫秒 → mm:ss。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
