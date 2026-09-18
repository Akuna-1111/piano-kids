import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceStep } from './practiceReducer';
import { buildRecording, hasPlayableRecording, startRecordingPlayback } from './recording';

/**
 * 排程部分的假引擎。
 *
 * `vi.hoisted` 是必须的：`vi.mock` 的工厂会在 import 之前被提升执行，
 * 直接引用下面的常量会拿到 undefined。
 */
const engine = vi.hoisted(() => ({
  playScheduled: vi.fn(),
  allNotesOff: vi.fn(),
  isReady: vi.fn(() => true),
  currentTime: 10,
}));

vi.mock('@/core/audio/AudioEngine', () => ({
  audioEngine: {
    playScheduled: engine.playScheduled,
    allNotesOff: engine.allNotesOff,
    isReady: engine.isReady,
    get currentTime() {
      return engine.currentTime;
    },
  },
}));

/**
 * 录音回放：把演奏时间轴整理成可回放的录音。
 *
 * 三条要点：
 *   · 回放的是**孩子真正弹的**（含弹错的音），不是照着谱子重弹一遍
 *   · 按住时长来自真实的「松开时刻」，不是谱面标称时长
 *   · 时间归一化到 0 开始，所以回放不依赖当时的时间戳原点
 */

function on(note: string, at: number, velocity?: number): PerformanceStep {
  return velocity === undefined ? { kind: 'on', note, at } : { kind: 'on', note, at, velocity };
}

function off(note: string, at: number): PerformanceStep {
  return { kind: 'off', note, at };
}

describe('录音回放：整理时间轴', () => {
  it('空时间轴 → 空录音（不会给出一个点了没反应的按钮）', () => {
    const recording = buildRecording([]);
    expect(recording.steps).toEqual([]);
    expect(hasPlayableRecording(recording)).toBe(false);
  });

  it('按下 / 松开配对，按住时长来自真实的松开时刻', () => {
    const recording = buildRecording([on('C4', 1000), off('C4', 1500)]);
    expect(recording.steps).toHaveLength(1);
    expect(recording.steps[0].note).toBe('C4');
    expect(recording.steps[0].at).toBe(0);
    // 按住 500ms，留一点缝让重复音分得清
    expect(recording.steps[0].duration).toBeCloseTo(0.5 * 0.92, 6);
  });

  it('时间归一化：第一个音从 0 开始，后面的按差值排', () => {
    const recording = buildRecording([
      on('C4', 5000),
      off('C4', 5300),
      on('E4', 6000),
      off('E4', 6500),
    ]);
    expect(recording.steps.map((s) => s.at)).toEqual([0, 1]);
  });

  it('同一个音弹两次，各自配上自己的松开时刻', () => {
    const recording = buildRecording([
      on('C4', 0),
      off('C4', 200),
      on('C4', 1000),
      off('C4', 1800),
    ]);
    expect(recording.steps).toHaveLength(2);
    expect(recording.steps[0].duration).toBeCloseTo(0.2 * 0.92, 6);
    expect(recording.steps[1].duration).toBeCloseTo(0.8 * 0.92, 6);
  });

  it('没有配对的松开时用兜底时长（最后一个音常常还按在手上）', () => {
    const recording = buildRecording([on('C4', 0), off('C4', 300), on('G4', 400)]);
    expect(recording.steps).toHaveLength(2);
    // 兜底 0.5 秒，同样留一点缝
    expect(recording.steps[1].duration).toBeCloseTo(0.5 * 0.92, 6);
  });

  it('「戳一下」被抬到最短时长，卡住的音被截到最长时长', () => {
    const recording = buildRecording([
      on('C4', 0),
      off('C4', 5), // 5ms，几乎没按住
      on('E4', 1000),
      off('E4', 30000), // 30 秒，手指卡住了
    ]);
    expect(recording.steps[0].duration).toBeCloseTo(0.06 * 0.92, 6);
    expect(recording.steps[1].duration).toBeCloseTo(4 * 0.92, 6);
  });

  it('**弹错的音照样保留** —— 这是「我弹的」，不是示范', () => {
    // 时间轴里本来就不区分对错，buildRecording 也不该丢任何东西
    const recording = buildRecording([
      on('C4', 0),
      off('C4', 200),
      on('D4', 250), // 这个音是弹错的
      off('D4', 400),
      on('C4', 500),
      off('C4', 700),
    ]);
    expect(recording.steps.map((s) => s.note)).toEqual(['C4', 'D4', 'C4']);
  });

  it('力度被带过来；没有记力度时用兜底值', () => {
    const recording = buildRecording([on('C4', 0, 0.5), on('E4', 100), on('G4', 200)]);
    expect(recording.steps[0].velocity).toBe(0.5);
    expect(recording.steps[1].velocity).toBe(0.85);
  });

  it('孤立的松开事件（没有对应按下）被忽略，不会凭空多出一个音', () => {
    const recording = buildRecording([off('C4', 0), on('E4', 100), off('E4', 300)]);
    expect(recording.steps.map((s) => s.note)).toEqual(['E4']);
  });

  it('总时长覆盖到最后一个音的尾巴，并留出混响余量', () => {
    const recording = buildRecording([on('C4', 0), off('C4', 1000), on('E4', 2000), off('E4', 3000)]);
    // 断言的是**不变量**（覆盖到最后一个音的结束 + 尾音余量），而不是一个魔法数字
    const last = recording.steps[recording.steps.length - 1];
    expect(last.at).toBeCloseTo(2, 6);
    expect(recording.totalSeconds).toBeCloseTo(last.at + last.duration + 0.8, 6);
    expect(recording.totalSeconds).toBeGreaterThan(last.at + last.duration);
  });

  it('纯函数：不修改传入的时间轴', () => {
    const timeline: PerformanceStep[] = [on('C4', 0), off('C4', 400)];
    const snapshot = JSON.stringify(timeline);
    buildRecording(timeline);
    expect(JSON.stringify(timeline)).toBe(snapshot);
  });
});

describe('录音回放：排程到 AudioContext 时间轴', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    engine.isReady.mockReturnValue(true);
  });

  it('每个音只排程一次，时刻与时长都按录音来（不是每个音一个 setTimeout）', () => {
    const recording = buildRecording([
      on('C4', 1000),
      off('C4', 1500),
      on('E4', 2000),
      off('E4', 2500),
    ]);
    startRecordingPlayback(recording);

    expect(engine.playScheduled).toHaveBeenCalledTimes(2);
    const [note0, when0, duration0] = engine.playScheduled.mock.calls[0];
    expect(note0).toBe('C4');
    // currentTime + 起播余量 + 相对时刻
    expect(when0).toBeCloseTo(engine.currentTime + 0.25, 6);
    expect(duration0).toBeCloseTo(0.5 * 0.92, 6);

    const [note1, when1] = engine.playScheduled.mock.calls[1];
    expect(note1).toBe('E4');
    expect(when1).toBeCloseTo(engine.currentTime + 0.25 + 1, 6);
  });

  it('力度一起传给引擎（孩子自己的轻重会被还原）', () => {
    startRecordingPlayback(buildRecording([on('C4', 0, 0.42), off('C4', 300)]));
    expect(engine.playScheduled.mock.calls[0][3]).toBe(0.42);
  });

  it('整段回放只有一个定时器，到点回调 onFinish', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    const recording = buildRecording([on('C4', 0), off('C4', 500)]);
    startRecordingPlayback(recording, { onFinish });

    expect(onFinish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(recording.totalSeconds * 1000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('stop() 立刻静音，并且不再回调 onFinish', () => {
    vi.useFakeTimers();
    const onFinish = vi.fn();
    const recording = buildRecording([on('C4', 0), off('C4', 500)]);
    const playback = startRecordingPlayback(recording, { onFinish });

    playback.stop();
    expect(engine.allNotesOff).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(recording.totalSeconds * 1000);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('音频没就绪时静默降级：不排程，但整段仍然照常走完并回调', () => {
    vi.useFakeTimers();
    engine.isReady.mockReturnValue(false);
    const onFinish = vi.fn();
    const recording = buildRecording([on('C4', 0), off('C4', 500)]);

    const playback = startRecordingPlayback(recording, { onFinish });
    expect(engine.playScheduled).not.toHaveBeenCalled();
    expect(playback.startTime).toBe(0);

    vi.advanceTimersByTime(recording.totalSeconds * 1000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
