import { audioEngine } from '@/core/audio/AudioEngine';
import type { PerformanceStep } from './practiceReducer';

/**
 * 录音回放（文档 8.2 的第三件事：一份演奏数据同时服务评分、复盘、回放）。
 *
 * ## 回放的是什么
 *
 * 不是「照着谱子再弹一遍」，而是**孩子刚才真正弹出来的东西**：
 * 包括弹错的音、抢拍、拖拍，以及每个音按了多久。
 * 所以它听起来会有自己的节奏感 —— 这正是「听自己弹的」和「听示范」的区别。
 *
 * ## 数据从哪来
 *
 * `PracticeStateShape.timeline`（`PerformanceStep`），与评分用的 `PerformanceEvent` 分开：
 * 回放需要「松开时刻」与「力度」，评分不需要、也不该被影响。
 *
 * ## 时间轴
 *
 * 与 `scheduler.ts` 同一个原则：**统一排程到 `AudioContext` 时间轴**，
 * 不用「每个音一个 setTimeout」。整段回放只有一个定时器，负责收尾。
 */

/** 回放里的一个音：时间是**相对录音开始**的秒数。 */
export interface RecordingStep {
  note: string;
  at: number;
  /** 按住时长（秒） */
  duration: number;
  velocity: number;
}

export interface Recording {
  steps: RecordingStep[];
  totalSeconds: number;
}

/** 音与音之间留一点缝，重复音才分得清（与听一遍的 `NOTE_GATE` 同一个理由）。 */
const GATE = 0.92;
/** 没有配对的松开事件时的兜底时长（秒）—— 最后一个音常常还按在手上。 */
const FALLBACK_HOLD_SEC = 0.5;
/** 「戳一下」也要听得出是个音。 */
const MIN_HOLD_SEC = 0.06;
/** 卡住的音不拖着响满整段回放。 */
const MAX_HOLD_SEC = 4;
/** 起播前留一点余量，避免第一个音被截断。 */
const LEAD_IN_SEC = 0.25;
/** 尾音 + 混响的余量。 */
const TAIL_SEC = 0.8;
const DEFAULT_VELOCITY = 0.85;

function clampHold(seconds: number): number {
  return Math.min(MAX_HOLD_SEC, Math.max(MIN_HOLD_SEC, seconds));
}

/**
 * 把演奏时间轴整理成可回放的录音。纯函数。
 *
 * - `on` / `off` 按音名配对：同一个音弹了两次也能对上各自的松开时刻
 * - 没有配对的 `on` 用兜底时长（最后一个音往往还在手上）
 * - 时间归一化到从 0 开始，这样回放不依赖当时的时间戳原点
 * - 弹错的音**照样保留**：这是「我弹的」，不是「示范」
 */
export function buildRecording(timeline: readonly PerformanceStep[]): Recording {
  /** 先把时间轴上每个「按下」收集起来，松开时回填真实按住时长 */
  const entries: Array<{ note: string; at: number; velocity: number; heldSec: number | null }> = [];
  /** 每个音**已按下但还没松开**的下标（同一个音可以有多条） */
  const openByNote = new Map<string, number[]>();
  let origin: number | null = null;

  for (const step of timeline) {
    if (step.kind === 'on') {
      if (origin === null) origin = step.at;
      entries.push({
        note: step.note,
        at: step.at,
        velocity: step.velocity ?? DEFAULT_VELOCITY,
        heldSec: null,
      });
      const list = openByNote.get(step.note);
      if (list) list.push(entries.length - 1);
      else openByNote.set(step.note, [entries.length - 1]);
      continue;
    }

    // `off`：配给同一个音里最近一次还没松开的按下
    const index = openByNote.get(step.note)?.pop();
    if (index === undefined) continue;
    entries[index].heldSec = (step.at - entries[index].at) / 1000;
  }

  const start = origin ?? 0;
  // 时间归一化到 0 开始；没有配对的用兜底时长。夹取与留缝对所有音一视同仁。
  const steps: RecordingStep[] = entries.map((entry) => ({
    note: entry.note,
    at: (entry.at - start) / 1000,
    duration: clampHold(entry.heldSec ?? FALLBACK_HOLD_SEC) * GATE,
    velocity: entry.velocity,
  }));

  let totalSeconds = 0;
  for (const step of steps) {
    totalSeconds = Math.max(totalSeconds, step.at + step.duration);
  }

  return { steps, totalSeconds: totalSeconds + TAIL_SEC };
}

export interface RecordingPlayback {
  /** 停止播放并静音已排程的音 */
  stop: () => void;
  /** 实际开始时间（`AudioContext` 时间轴） */
  startTime: number;
  totalSeconds: number;
}

export interface RecordingPlaybackCallbacks {
  onFinish?: () => void;
}

/** 录音是否值得回放（空录音不给按钮）。 */
export function hasPlayableRecording(recording: Recording): boolean {
  return recording.steps.length > 0;
}

/**
 * 回放一段录音。
 *
 * 调用前必须先 `audioEngine.ensureReady()`（与听一遍同一个约定）——
 * 否则上下文没 running，`playScheduled` 会静默丢弃，孩子看到按钮在转却没声音。
 */
export function startRecordingPlayback(
  recording: Recording,
  callbacks: RecordingPlaybackCallbacks = {},
): RecordingPlayback {
  const engineReady = audioEngine.isReady();
  const startTime = engineReady ? audioEngine.currentTime + LEAD_IN_SEC : 0;

  if (engineReady) {
    for (const step of recording.steps) {
      audioEngine.playScheduled(
        step.note,
        startTime + step.at,
        step.duration,
        step.velocity,
      );
    }
  }

  let stopped = false;
  // 整段回放只用一个定时器（不是每个音一个），与排程共用同一条时间轴
  const timer = setTimeout(
    () => {
      if (stopped) return;
      stopped = true;
      callbacks.onFinish?.();
    },
    Math.max(0, recording.totalSeconds) * 1000,
  );

  return {
    startTime,
    totalSeconds: recording.totalSeconds,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      // 排程中的音无法逐个撤销，直接全部静音（与听一遍同一个做法）
      if (engineReady) audioEngine.allNotesOff();
    },
  };
}
