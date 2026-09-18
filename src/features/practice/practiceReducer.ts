import type { ResolvedSong } from '@/features/songs/types';
import type { PerformanceEvent } from './scoring';

/**
 * 练习状态机（文档 8.1）。
 * 明确状态，而不是 idle/isPlaying/isPaused/isDone 几个 boolean 互相组合。
 */

export type PracticeState = 'idle' | 'listening' | 'playing' | 'paused' | 'completed' | 'result';

/** 同一个音连续弹错这么多次后自动前进，避免孩子卡在一个音上失去耐心。 */
export const MAX_WRONG_ATTEMPTS = 3;

export interface KeyFeedback {
  note: string;
  kind: 'correct' | 'wrong';
  token: number;
}

/**
 * 「按住提示」：按对一个音之后，要**按住它多久**才算弹满。
 *
 * ⚠️ 这一步只把「按住」变得**看得见**，不参与任何评分 ——
 * `noteReleased` 不产生 PerformanceEvent，`scoring.ts` 也没有任何改动。
 * 原因见 `docs/开发进度与验收.md` 的《按住提示》：iPad 上松手时机不够可靠，
 * 在拿到真机数据之前不拿它扣分（§44 无羞耻错误机制）。
 */
export interface HoldGuide {
  /** 需要按住的音 */
  note: string;
  /** 这个音的标称时长（毫秒）——孩子要按住这么久 */
  durationMs: number;
  /** 按下的时刻（与 notePressed 的 at 同一坐标系） */
  startedAt: number;
  /** 按满的时刻 */
  until: number;
  /** 孩子是否已经松手 */
  released: boolean;
  /** 松手的时刻；还没松手就是 null */
  releasedAt: number | null;
}

/**
 * 演奏时间轴上的一个瞬间 —— **录音回放的原始素材**。
 *
 * 刻意与 `PerformanceEvent` 分开：
 *
 * | | 关心什么 | 谁在用 |
 * | --- | --- | --- |
 * | `PerformanceEvent` | 音高对不对、早到晚到 | 评分 |
 * | `PerformanceStep` | 什么时候按下、什么时候松开、多大力 | 录音回放 |
 *
 * 两者生命周期不同：回放需要「松开时刻」和「力度」，而评分既不需要也不该被它们影响。
 * 分开之后，加回放不会动到任何评分逻辑（`scoring.ts` 一行不用改）。
 */
export interface PerformanceStep {
  kind: 'on' | 'off';
  note: string;
  /** 与 `notePressed` 的 `at` 同一坐标系（毫秒） */
  at: number;
  /** 只在 `kind === 'on'` 上有意义 */
  velocity?: number;
}

/**
 * 时间轴上限。
 *
 * 一首曲子通常几十个音，但孩子可能长时间乱按 —— 到上限后不再记录，
 * 回放会缺尾巴，但内存不会被撑大。
 */
export const MAX_TIMELINE_STEPS = 1200;

function pushStep(timeline: PerformanceStep[], step: PerformanceStep): PerformanceStep[] {
  if (timeline.length >= MAX_TIMELINE_STEPS) return timeline;
  return [...timeline, step];
}

export interface PracticeStateShape {
  state: PracticeState;
  /** 当前应当弹第几个音（0 起） */
  noteIndex: number;
  events: PerformanceEvent[];
  /** 本次演奏的时间轴（录音回放用），只在 `playing` 期间记录 */
  timeline: PerformanceStep[];
  combo: number;
  maxCombo: number;
  wrongAttemptsOnCurrent: number;
  /** 上一个音是「连错 3 次后自动跳过」的 —— 用来继续给孩子一句安慰而不是冷场 */
  lastAdvanceWasSkip: boolean;
  /** 一共弹了多少个音（含错误），用于判断「是否真的开始过」 */
  notesPlayed: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** 暂停累计时长，用于正确计算用时 */
  pausedTotalMs: number;
  pausedAt: number | null;
  lastCorrectAt: number | null;
  feedback: KeyFeedback | null;
  feedbackToken: number;
  /** 当前的按住提示；null 表示无需按住（还没开始 / 刚开完歌曲的最后一个音） */
  hold: HoldGuide | null;
}

export function createInitialPracticeState(): PracticeStateShape {
  return {
    state: 'idle',
    noteIndex: 0,
    events: [],
    timeline: [],
    combo: 0,
    maxCombo: 0,
    wrongAttemptsOnCurrent: 0,
    notesPlayed: 0,
    startedAt: null,
    finishedAt: null,
    pausedTotalMs: 0,
    pausedAt: null,
    lastCorrectAt: null,
    feedback: null,
    feedbackToken: 0,
    lastAdvanceWasSkip: false,
    hold: null,
  };
}

export type PracticeAction =
  | { type: 'startListening' }
  | { type: 'finishListening' }
  | { type: 'startPlaying'; at: number }
  | { type: 'pause'; at: number }
  | { type: 'resume'; at: number }
  | { type: 'notePressed'; note: string; at: number; velocity?: number }
  | { type: 'noteReleased'; note: string; at: number }
  | { type: 'abandon'; at: number }
  | { type: 'toResult' }
  | { type: 'clearFeedback' }
  | { type: 'reset' };

/**
 * 期望的「下一个音间隔」：用相邻两音的拍差换算成毫秒。
 * 步进式跟弹里孩子自己控制节奏，这个间隔只用于算 timingDelta。
 */
function expectedGapMs(song: ResolvedSong, index: number): number | null {
  if (index <= 0) return null;
  const prev = song.notes[index - 1];
  const current = song.notes[index];
  if (!prev || !current) return null;
  const gapBeats = current.beat - prev.beat;
  if (!(gapBeats > 0)) return null;
  return gapBeats * song.beatSeconds * 1000;
}

/**
 * 某个音**自己的**标称时长（毫秒）。
 *
 * 用 `duration` 而不是相邻音的拍差：两者在有休止符时会不一样，
 * 而「按住这个音多久」问的是音符本身的长度，不是到下一个音的空档 ——
 * 休止符是**松开**，不是按住。
 */
function noteDurationMs(song: ResolvedSong, index: number): number | null {
  const note = song.notes[index];
  if (!note) return null;
  if (!(note.duration > 0)) return null;
  return note.duration * song.beatSeconds * 1000;
}

/**
 * 按住提示是否已经结束：孩子松手了，或者按满了标称时长。
 *
 * 故意只接受 `HoldGuide`（而不是整个 state）：调用方通常在一个只依赖
 * 「当前这个 hold」的 effect 里用它，传整个 state 会读到闭包里的旧值。
 *
 * 纯函数，`now` 由调用方传入（与 `notePressed` 的 `at` 同一坐标系）。
 * ⚠️ 它只影响「下一个键要不要高亮」，**不影响能不能弹** ——
 * 键永远是可弹的，早弹也不会额外扣分（§44）。
 */
export function holdReady(hold: HoldGuide | null, now: number): boolean {
  if (hold === null) return true;
  return hold.released || now >= hold.until;
}

function withFeedback(
  state: PracticeStateShape,
  note: string,
  kind: 'correct' | 'wrong',
): Pick<PracticeStateShape, 'feedback' | 'feedbackToken'> {
  const token = state.feedbackToken + 1;
  return { feedback: { note, kind, token }, feedbackToken: token };
}

export function practiceReducer(
  state: PracticeStateShape,
  action: PracticeAction,
  song: ResolvedSong,
): PracticeStateShape {
  switch (action.type) {
    case 'startListening': {
      // 听的过程中不改动演奏数据，只是切换状态
      return { ...state, state: 'listening', feedback: null };
    }

    case 'finishListening': {
      if (state.state !== 'listening') return state;
      return { ...state, state: state.startedAt === null ? 'idle' : 'paused' };
    }

    case 'startPlaying': {
      if (state.state === 'paused') {
        return {
          ...state,
          state: 'playing',
          pausedTotalMs: state.pausedTotalMs + (action.at - (state.pausedAt ?? action.at)),
          pausedAt: null,
        };
      }
      if (state.state !== 'idle' && state.state !== 'completed') return state;
      return {
        ...createInitialPracticeState(),
        state: 'playing',
        startedAt: action.at,
        lastCorrectAt: null,
      };
    }

    case 'pause': {
      if (state.state !== 'playing') return state;
      return { ...state, state: 'paused', pausedAt: action.at };
    }

    case 'resume': {
      if (state.state !== 'paused') return state;
      return {
        ...state,
        state: 'playing',
        pausedTotalMs: state.pausedTotalMs + (action.at - (state.pausedAt ?? action.at)),
        pausedAt: null,
      };
    }

    case 'notePressed': {
      // 只有 playing 状态才计入成绩：听一遍时的随手弹奏不算
      if (state.state !== 'playing') return state;

      const current = song.notes[state.noteIndex];
      if (!current) return state;

      // 演奏时间轴：**弹错的音也记**，回放要还原孩子真正弹了什么
      const pressedStep: PerformanceStep = { kind: 'on', note: action.note, at: action.at };
      if (action.velocity !== undefined) pressedStep.velocity = action.velocity;
      const timeline = pushStep(state.timeline, pressedStep);

      const expectedNote = current.playedNote;
      const isCorrect = action.note === expectedNote;

      if (isCorrect) {
        const gap = expectedGapMs(song, state.noteIndex);
        const timingDeltaMs =
          state.lastCorrectAt !== null && gap !== null
            ? action.at - state.lastCorrectAt - gap
            : undefined;
        const expectedAt =
          state.lastCorrectAt !== null && gap !== null
            ? state.lastCorrectAt + gap
            : undefined;

        const event: PerformanceEvent = {
          note: action.note,
          expectedNote,
          actualAt: action.at,
          correct: true,
        };
        if (timingDeltaMs !== undefined) event.timingDeltaMs = timingDeltaMs;
        if (expectedAt !== undefined) event.expectedAt = expectedAt;

        const nextIndex = state.noteIndex + 1;
        const combo = state.combo + 1;
        const isDone = nextIndex >= song.notes.length;

        // 按住提示：刚刚按对的这个音要按住多久。用**它自己**的标称时长。
        // 歌曲弹完了就没有「按住」这件事了。
        const holdDurationMs = isDone ? null : noteDurationMs(song, state.noteIndex);
        const hold: HoldGuide | null =
          holdDurationMs === null
            ? null
            : {
                note: action.note,
                durationMs: holdDurationMs,
                startedAt: action.at,
                until: action.at + holdDurationMs,
                released: false,
                releasedAt: null,
              };

        return {
          ...state,
          state: isDone ? 'completed' : 'playing',
          noteIndex: isDone ? state.noteIndex : nextIndex,
          events: [...state.events, event],
          timeline,
          combo,
          maxCombo: Math.max(state.maxCombo, combo),
          wrongAttemptsOnCurrent: 0,
          lastAdvanceWasSkip: false,
          notesPlayed: state.notesPlayed + 1,
          lastCorrectAt: action.at,
          finishedAt: isDone ? action.at : state.finishedAt,
          hold,
          ...withFeedback(state, action.note, 'correct'),
        };
      }

      // 弹错了：记录事件，不前进（不打断孩子的探索），但累计错误次数
      const wrongAttempts = state.wrongAttemptsOnCurrent + 1;
      const shouldSkip = wrongAttempts >= MAX_WRONG_ATTEMPTS;
      const event: PerformanceEvent = {
        note: action.note,
        expectedNote,
        actualAt: action.at,
        correct: false,
      };

      const nextIndex = shouldSkip ? state.noteIndex + 1 : state.noteIndex;
      const isDone = shouldSkip && nextIndex >= song.notes.length;

      return {
        ...state,
        state: isDone ? 'completed' : 'playing',
        noteIndex: isDone ? state.noteIndex : nextIndex,
        events: [...state.events, event],
        timeline,
        combo: 0,
        wrongAttemptsOnCurrent: shouldSkip ? 0 : wrongAttempts,
        lastAdvanceWasSkip: shouldSkip,
        notesPlayed: state.notesPlayed + 1,
        finishedAt: isDone ? action.at : state.finishedAt,
        ...withFeedback(state, action.note, 'wrong'),
      };
    }

    case 'noteReleased': {
      // 演奏时间轴：回放需要「松开时刻」，所以无论按住提示是否在用都要记一笔
      const timeline =
        state.state === 'playing'
          ? pushStep(state.timeline, { kind: 'off', note: action.note, at: action.at })
          : state.timeline;

      // 按住提示：只认「刚按对的那个音」。松手就结束提示 ——
      // 但**不**写 PerformanceEvent、**不**扣分（见 HoldGuide 的注释）。
      // `releasedAt` 只服务于真机自检页的采样，不参与判定。
      const hold =
        state.hold !== null && !state.hold.released && state.hold.note === action.note
          ? { ...state.hold, released: true, releasedAt: action.at }
          : state.hold;

      // 两件事都没变就原样返回，避免无意义的重渲染
      if (timeline === state.timeline && hold === state.hold) return state;
      return { ...state, timeline, hold };
    }

    case 'abandon': {
      if (state.state === 'idle') return state;
      return { ...state, state: 'result', finishedAt: action.at, feedback: null };
    }

    case 'toResult': {
      return { ...state, state: 'result' };
    }

    case 'clearFeedback': {
      // 清掉反馈类名，下一次同一个键按下时动画才能重放
      if (state.feedback === null) return state;
      return { ...state, feedback: null };
    }

    case 'reset':
      return createInitialPracticeState();

    default:
      return state;
  }
}

/** 已经进行到第几个音（中途退出时用于计算 pitchScore 的分母）。 */
export function expectedNotesSoFar(state: PracticeStateShape, song: ResolvedSong): number {
  if (state.state === 'completed' || state.noteIndex >= song.notes.length) {
    return song.notes.length;
  }
  const correct = state.events.reduce((sum, event) => sum + (event.correct ? 1 : 0), 0);
  return Math.max(1, state.noteIndex, correct);
}

export function practiceDurationMs(state: PracticeStateShape, now: number = Date.now()): number {
  if (state.startedAt === null) return 0;
  const end = state.finishedAt ?? now;
  const paused = state.pausedTotalMs + (state.pausedAt !== null ? end - state.pausedAt : 0);
  return Math.max(0, end - state.startedAt - paused);
}
