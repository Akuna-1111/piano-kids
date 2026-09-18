import { audioEngine } from '@/core/audio/AudioEngine';
import type { ResolvedNote, ResolvedSong } from '@/features/songs/types';

/**
 * Listen Mode 调度（文档 6.5）。
 *
 * 严格不使用「每个音符一个 setTimeout」：长曲会累积误差、切后台会失步，
 * 高亮和声音也会错位。这里统一走一条时间轴：
 *
 *   beat → seconds → AudioContext.currentTime
 *
 * 音频全部提前排程到 AudioContext 时间轴上（毫秒级精度），
 * 视觉高亮用 requestAnimationFrame 读同一个 currentTime 反算当前拍，
 * 因此两者永远对齐，且与主线程卡顿无关。
 */

export interface ListenPlaybackCallbacks {
  /** 正在响的音（索引为曲谱中的下标） */
  onNoteChange?: (note: ResolvedNote | null, index: number) => void;
  /** 全部播完（含尾巴） */
  onFinish?: () => void;
}

export interface ListenPlayback {
  /** 停止播放并清空已排程的音 */
  stop: () => void;
  /** 实际开始时间（AudioContext 时间轴） */
  startTime: number;
  /** 总时长（秒） */
  totalSeconds: number;
}

/** 起播前留一点余量，避免第一个音被截断。 */
const LEAD_IN_SEC = 0.22;
/** 音符之间留出的间隙比例，让重复音听得出来。 */
const NOTE_GATE = 0.9;

export function startListenPlayback(
  song: ResolvedSong,
  callbacks: ListenPlaybackCallbacks = {},
): ListenPlayback {
  const beatSeconds = song.beatSeconds;

  // 引擎未就绪时退回一个「静默播放」：视觉照常走，不阻塞孩子看谱。
  const engineReady = audioEngine.isReady();
  const startTime = engineReady ? audioEngine.currentTime + LEAD_IN_SEC : 0;
  const totalSeconds = song.totalSeconds + 0.6;

  if (engineReady) {
    for (const note of song.notes) {
      const when = startTime + note.beat * beatSeconds;
      const duration = Math.max(0.12, note.duration * beatSeconds * NOTE_GATE);
      audioEngine.playScheduled(note.playedNote, when, duration, note.velocity ?? 0.78);
    }
  }

  let rafId: number | null = null;
  let stopped = false;
  let lastIndex = -1;
  const fallbackStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const currentElapsed = (): number => {
    if (engineReady) return audioEngine.currentTime - startTime;
    return ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - fallbackStart) / 1000;
  };

  const tick = () => {
    if (stopped) return;
    const elapsed = currentElapsed();

    if (elapsed >= totalSeconds) {
      if (lastIndex !== -2) {
        lastIndex = -2;
        callbacks.onNoteChange?.(null, -1);
      }
      callbacks.onFinish?.();
      return;
    }

    const currentBeat = elapsed / beatSeconds;
    let index = -1;
    for (let i = 0; i < song.notes.length; i += 1) {
      const note = song.notes[i];
      if (currentBeat >= note.beat && currentBeat < note.beat + note.duration) {
        index = i;
        break;
      }
    }

    if (index !== lastIndex) {
      lastIndex = index;
      callbacks.onNoteChange?.(index >= 0 ? song.notes[index] : null, index);
    }

    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return {
    startTime,
    totalSeconds,
    stop: () => {
      stopped = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      // 排程中的音无法逐个撤销，直接全部静音
      if (engineReady) audioEngine.allNotesOff();
      callbacks.onNoteChange?.(null, -1);
    },
  };
}
