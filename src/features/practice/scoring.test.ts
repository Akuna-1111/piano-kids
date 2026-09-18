import { describe, expect, it } from 'vitest';
import {
  baseTimingWindowMs,
  formatDuration,
  scorePerformance,
  starsForAccuracy,
  timingScoreForDelta,
  timingWindowMs,
  type PerformanceEvent,
} from './scoring';

function correctEvent(timingDeltaMs?: number): PerformanceEvent {
  const event: PerformanceEvent = { note: 'C4', expectedNote: 'C4', actualAt: 0, correct: true };
  if (timingDeltaMs !== undefined) event.timingDeltaMs = timingDeltaMs;
  return event;
}

describe('评分系统', () => {
  it('全部弹对且节拍在窗口内 → 100 分', () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      correctEvent(i === 0 ? undefined : 20),
    );
    const score = scorePerformance(events, { difficulty: 1, expectedNotes: 10 });
    expect(score.pitchScore).toBe(100);
    expect(score.timingScore).toBe(100);
    expect(score.accuracy).toBe(100);
    expect(score.missedNotes).toBe(0);
  });

  it('准确率 = pitch * 0.7 + timing * 0.3（文档 8.3）', () => {
    const events = [correctEvent(0), correctEvent(0)];
    const score = scorePerformance(events, { difficulty: 1, expectedNotes: 4 });
    expect(score.pitchScore).toBe(50);
    expect(score.timingScore).toBe(100);
    expect(score.accuracy).toBe(Math.round(50 * 0.7 + 100 * 0.3));
  });

  it('弹错的音会拉低 pitch，并重置连击', () => {
    const events: PerformanceEvent[] = [
      correctEvent(0),
      correctEvent(0),
      { note: 'D4', expectedNote: 'C4', actualAt: 0, correct: false },
      correctEvent(0),
    ];
    const score = scorePerformance(events, { difficulty: 1, expectedNotes: 4 });
    expect(score.correctNotes).toBe(3);
    expect(score.wrongNotes).toBe(1);
    expect(score.maxCombo).toBe(2);
    // (3 - 0.5) / 4 = 62.5
    expect(score.pitchScore).toBe(63);
  });

  it('时间窗口内一律满分；超出后在一个很宽的带内平滑衰减，而不是判 0', () => {
    const window = baseTimingWindowMs(1);
    expect(timingScoreForDelta(window, window)).toBe(1);
    expect(timingScoreForDelta(window * 2, window)).toBeGreaterThan(0.6);
    expect(timingScoreForDelta(window * 4, window)).toBe(0);
    expect(timingScoreForDelta(undefined, window)).toBeNull();
  });

  it('没有可判定的时间数据时不扣分（不惩罚「没有数据」）', () => {
    const score = scorePerformance([correctEvent()], { difficulty: 1, expectedNotes: 1 });
    expect(score.timingScore).toBe(100);
  });

  it('难度越高窗口越紧，设置里的宽松系数可以放大窗口', () => {
    expect(baseTimingWindowMs(1)).toBeGreaterThan(baseTimingWindowMs(3));
    expect(timingWindowMs(1, 2)).toBeCloseTo(baseTimingWindowMs(1) * 2, 6);
    expect(timingWindowMs(1, 99)).toBeCloseTo(baseTimingWindowMs(1) * 3, 6);
  });

  it('分数永远被夹在 0–100', () => {
    const events: PerformanceEvent[] = Array.from({ length: 20 }, () => ({
      note: 'X',
      actualAt: 0,
      correct: false,
    }));
    const score = scorePerformance(events, { difficulty: 1, expectedNotes: 5 });
    expect(score.pitchScore).toBe(0);
    expect(score.accuracy).toBeGreaterThanOrEqual(0);
  });

  it('星级规则与成长积分一致', () => {
    expect(starsForAccuracy(69)).toBe(1);
    expect(starsForAccuracy(70)).toBe(2);
    expect(starsForAccuracy(89)).toBe(2);
    expect(starsForAccuracy(90)).toBe(3);
    expect(starsForAccuracy(100)).toBe(3);
  });

  it('用时格式化为 mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(92_000)).toBe('01:32');
    expect(formatDuration(-500)).toBe('00:00');
  });
});
