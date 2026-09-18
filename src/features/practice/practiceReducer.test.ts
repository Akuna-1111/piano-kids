import { describe, expect, it } from 'vitest';
import { getSongById } from '@/features/songs/songData';
import { resolveSong } from '@/features/songs/songResolver';
import type { ResolvedSong } from '@/features/songs/types';
import {
  createInitialPracticeState,
  expectedNotesSoFar,
  holdReady,
  MAX_TIMELINE_STEPS,
  MAX_WRONG_ATTEMPTS,
  practiceDurationMs,
  practiceReducer,
  type PracticeAction,
  type PracticeStateShape,
} from './practiceReducer';
import { scorePerformance } from './scoring';

const song = resolveSong(getSongById('mary-lamb')!, 8);

function run(actions: PracticeAction[], from: PracticeStateShape = createInitialPracticeState()) {
  return actions.reduce((state, action) => practiceReducer(state, action, song), from);
}

const playedNotes = song.notes.map((note) => note.playedNote);

describe('练习状态机（文档 8.1）', () => {
  it('初始为 idle，不会凭空记分', () => {
    const state = run([{ type: 'notePressed', note: 'C4', at: 0 }]);
    expect(state.state).toBe('idle');
    expect(state.events).toHaveLength(0);
  });

  it('idle → listening → playing → completed 的合法迁移', () => {
    let state = run([{ type: 'startListening' }]);
    expect(state.state).toBe('listening');
    state = practiceReducer(state, { type: 'finishListening' }, song);
    expect(state.state).toBe('idle');

    state = practiceReducer(state, { type: 'startPlaying', at: 1000 }, song);
    expect(state.state).toBe('playing');
    expect(state.startedAt).toBe(1000);
  });

  it('听一遍时随手弹的音不计入成绩', () => {
    const state = run([{ type: 'startListening' }, { type: 'notePressed', note: playedNotes[0], at: 5 }]);
    expect(state.events).toHaveLength(0);
    expect(state.notesPlayed).toBe(0);
  });

  it('弹对当前目标音才前进，并记录 PerformanceEvent', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: playedNotes[0], at: 900 },
      { type: 'notePressed', note: playedNotes[1], at: 1500 },
    ]);
    expect(state.noteIndex).toBe(2);
    expect(state.events).toHaveLength(2);
    expect(state.events.every((event) => event.correct)).toBe(true);
    expect(state.maxCombo).toBe(2);
  });

  it('第一个音没有 timingDelta（没有「上一个音」可比）', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: playedNotes[0], at: 900 },
      { type: 'notePressed', note: playedNotes[1], at: 1500 },
    ]);
    expect(state.events[0].timingDeltaMs).toBeUndefined();
    expect(state.events[1].timingDeltaMs).toBeDefined();
  });

  it('弹错不前进、连击归零，但会记录错误事件', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: 'B4', at: 100 },
    ]);
    expect(state.noteIndex).toBe(0);
    expect(state.events).toHaveLength(1);
    expect(state.events[0].correct).toBe(false);
    expect(state.combo).toBe(0);
    expect(state.wrongAttemptsOnCurrent).toBe(1);
  });

  it('同一个音连续弹错 3 次后自动前进，避免孩子卡在一个键上失去耐心', () => {
    const actions: PracticeAction[] = [{ type: 'startPlaying', at: 0 }];
    for (let i = 0; i < MAX_WRONG_ATTEMPTS; i += 1) {
      actions.push({ type: 'notePressed', note: 'B4', at: 100 + i });
    }
    const state = run(actions);
    expect(state.noteIndex).toBe(1);
    expect(state.wrongAttemptsOnCurrent).toBe(0);
    expect(state.state).toBe('playing');
  });

  it('弹完整首后进入 completed，并保留最后一个引导位置', () => {
    const actions: PracticeAction[] = [{ type: 'startPlaying', at: 0 }];
    playedNotes.forEach((note, index) => {
      actions.push({ type: 'notePressed', note, at: 1000 + index * 500 });
    });
    const state = run(actions);
    expect(state.state).toBe('completed');
    expect(state.notesPlayed).toBe(playedNotes.length);
    expect(state.finishedAt).toBe(1000 + (playedNotes.length - 1) * 500);
    expect(expectedNotesSoFar(state, song)).toBe(playedNotes.length);
  });

  it('暂停期间的时间不计入用时', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'pause', at: 1000 },
      { type: 'resume', at: 6000 },
      { type: 'abandon', at: 8000 },
    ]);
    expect(practiceDurationMs(state, 8000)).toBe(3000);
  });

  it('reducer 是纯函数：不修改传入的状态', () => {
    const initial = createInitialPracticeState();
    const snapshot = JSON.stringify(initial);
    practiceReducer(initial, { type: 'startPlaying', at: 0 }, song);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });

  it('reset 回到干净的 idle', () => {
    const dirty = run([{ type: 'startPlaying', at: 0 }, { type: 'notePressed', note: playedNotes[0], at: 10 }]);
    expect(practiceReducer(dirty, { type: 'reset' }, song)).toEqual(createInitialPracticeState());
  });

  it('每次按键反馈 token 都会变化，保证同一个键连续判定也能重播动画', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: 'B4', at: 1 },
      { type: 'notePressed', note: 'A4', at: 2 },
    ]);
    expect(state.feedback?.token).toBeGreaterThan(0);
    const cleared = practiceReducer(state, { type: 'clearFeedback' }, song);
    expect(cleared.feedback).toBeNull();
  });
});

/** 按顺序弹对前 n 个音（时间间隔够大，不触发时间窗口的干扰）。 */
function pressFirstCorrectly(count: number, from = createInitialPracticeState()) {
  let state = practiceReducer(from, { type: 'startPlaying', at: 0 }, song);
  for (let i = 0; i < count; i += 1) {
    state = practiceReducer(
      state,
      { type: 'notePressed', note: playedNotes[i], at: 1000 + i * 1000 },
      song,
    );
  }
  return state;
}

describe('按住提示：让时长看得见（不参与评分）', () => {
  const beatMs = song.beatSeconds * 1000;

  it('按对之后给出「按住多久」——就是这个音自己的标称时长', () => {
    // 前 6 个音都是 1 拍
    const state = pressFirstCorrectly(6);
    expect(song.notes[5].duration).toBe(1);
    expect(state.hold?.note).toBe(playedNotes[5]);
    expect(state.hold?.durationMs).toBeCloseTo(1 * beatMs, 6);

    // 第 7 个音（索引 6）是 2 拍 —— 提示要跟着变长
    const next = practiceReducer(
      state,
      { type: 'notePressed', note: playedNotes[6], at: 8000 },
      song,
    );
    expect(song.notes[6].duration).toBe(2);
    expect(next.hold?.note).toBe(playedNotes[6]);
    expect(next.hold?.durationMs).toBeCloseTo(2 * beatMs, 6);
    expect(next.hold!.durationMs).toBeGreaterThan(state.hold!.durationMs);
  });

  it('按住时长用音符自己的时长，不是到下一个音的拍差（休止符是「松开」，不是按住）', () => {
    // 第 1 个音 1 拍，空 2 拍之后才轮到第 2 个音
    const sparse: ResolvedSong = {
      song: { ...song.song, notes: [] },
      keyboard: 8,
      transposeSemitones: 0,
      notes: [
        { note: 'C4', beat: 0, duration: 1, playedNote: 'C4', originalNote: 'C4', adjusted: false },
        { note: 'E4', beat: 3, duration: 1, playedNote: 'E4', originalNote: 'E4', adjusted: false },
      ],
      bpm: 60,
      beatSeconds: 1,
      totalBeats: 4,
      totalSeconds: 4,
      usedNotes: ['C4', 'E4'],
    };

    let state = practiceReducer(createInitialPracticeState(), { type: 'startPlaying', at: 0 }, sparse);
    state = practiceReducer(state, { type: 'notePressed', note: 'C4', at: 0 }, sparse);

    // 1 拍 × 1000ms，而不是到下一个音的 3 拍
    expect(state.hold?.durationMs).toBe(1000);
  });

  it('歌曲弹完就没有按住提示了', () => {
    const state = pressFirstCorrectly(playedNotes.length);
    expect(state.state).toBe('completed');
    expect(state.hold).toBeNull();
  });

  it('还没开始弹的时候没有按住提示', () => {
    expect(createInitialPracticeState().hold).toBeNull();
  });

  it('holdReady：等的时候 false，按满之后 true', () => {
    const state = pressFirstCorrectly(1);
    const until = state.hold!.until;
    expect(until).toBeCloseTo(1000 + beatMs, 6);
    expect(holdReady(state.hold, until - 1)).toBe(false);
    expect(holdReady(state.hold, until)).toBe(true);
  });

  it('记住按下的时刻和松手的时刻（真机采样的数据来源）', () => {
    const pressed = pressFirstCorrectly(1);
    expect(pressed.hold?.startedAt).toBe(1000);
    expect(pressed.hold?.releasedAt).toBeNull();

    const released = practiceReducer(
      pressed,
      { type: 'noteReleased', note: playedNotes[0], at: 1420 },
      song,
    );
    expect(released.hold?.releasedAt).toBe(1420);
    // 真实按住时长 = 松手时刻 − 按下时刻，可以直接算出来
    expect(released.hold!.releasedAt! - released.hold!.startedAt).toBe(420);
  });

  it('holdReady：松手之后立刻 true（不强迫孩子一直按住）', () => {
    const pressed = pressFirstCorrectly(1);
    const released = practiceReducer(
      pressed,
      { type: 'noteReleased', note: playedNotes[0], at: 1010 },
      song,
    );
    expect(holdReady(released.hold, 1010)).toBe(true);
  });

  it('holdReady：没有按住提示时恒为 true', () => {
    expect(holdReady(null, 0)).toBe(true);
  });

  it('松手只结束提示：不写事件、不加连击、不动已弹音数', () => {
    const pressed = pressFirstCorrectly(1);
    const released = practiceReducer(
      pressed,
      { type: 'noteReleased', note: playedNotes[0], at: 1020 },
      song,
    );

    expect(released.hold?.released).toBe(true);
    expect(released.events).toEqual(pressed.events);
    expect(released.notesPlayed).toBe(pressed.notesPlayed);
    expect(released.combo).toBe(pressed.combo);
    expect(released.noteIndex).toBe(pressed.noteIndex);
    expect(released.wrongAttemptsOnCurrent).toBe(pressed.wrongAttemptsOnCurrent);
  });

  it('松别的键不会结束当前的按住提示', () => {
    const pressed = pressFirstCorrectly(1);
    const other = practiceReducer(
      pressed,
      { type: 'noteReleased', note: 'B4', at: 1020 },
      song,
    );
    expect(other.hold).toEqual(pressed.hold);
    expect(other.hold?.released).toBe(false);
    // 注意：这里**不能**断言 `other === pressed` —— 松手现在还要往演奏时间轴记一笔
    // （录音回放需要松开时刻），所以状态对象是会重建的。要看的是「按住提示没被动」。
    expect(other.timeline.length).toBe(pressed.timeline.length + 1);
  });

  it('弹错不打断按住提示（孩子可能只是想去够别的键）', () => {
    const pressed = pressFirstCorrectly(1);
    const wrong = practiceReducer(
      pressed,
      { type: 'notePressed', note: 'B4', at: 1030 },
      song,
    );
    expect(wrong.hold).toEqual(pressed.hold);
    expect(wrong.events).toHaveLength(2);
  });

  it('按下一个音会换掉提示（换成新按的这个音）', () => {
    const state = pressFirstCorrectly(2);
    expect(state.hold?.note).toBe(playedNotes[1]);
    expect(state.hold?.released).toBe(false);
  });

  it('reset 会清掉按住提示', () => {
    const pressed = pressFirstCorrectly(1);
    expect(practiceReducer(pressed, { type: 'reset' }, song).hold).toBeNull();
  });

  it('弹了又弹、按了又按之后，准确率与「完全没有松手这回事」完全一致', () => {
    // 这是这一步最关键的约束：按住提示只是视觉，绝不能影响成绩。
    const count = 8;
    const options = { difficulty: song.song.difficulty, expectedNotes: count } as const;

    let plain = practiceReducer(createInitialPracticeState(), { type: 'startPlaying', at: 0 }, song);
    let withReleases = practiceReducer(
      createInitialPracticeState(),
      { type: 'startPlaying', at: 0 },
      song,
    );

    for (let i = 0; i < count; i += 1) {
      const at = 1000 + i * 1000;
      plain = practiceReducer(plain, { type: 'notePressed', note: playedNotes[i], at }, song);
      withReleases = practiceReducer(
        withReleases,
        { type: 'notePressed', note: playedNotes[i], at },
        song,
      );
      withReleases = practiceReducer(
        withReleases,
        { type: 'noteReleased', note: playedNotes[i], at: at + 50 },
        song,
      );
    }

    expect(withReleases.events).toEqual(plain.events);
    expect(scorePerformance(withReleases.events, options)).toEqual(
      scorePerformance(plain.events, options),
    );
  });
});

describe('演奏时间轴（录音回放的素材，与评分数据分开）', () => {
  it('只记录 playing 期间的事件：听一遍时随手弹的不算', () => {
    const listening = run([
      { type: 'startListening' },
      { type: 'notePressed', note: playedNotes[0], at: 100 },
    ]);
    expect(listening.timeline).toEqual([]);

    const idle = run([{ type: 'notePressed', note: playedNotes[0], at: 100 }]);
    expect(idle.timeline).toEqual([]);
  });

  it('按下与松开都进时间轴，且带上力度', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: playedNotes[0], at: 500, velocity: 0.62 },
      { type: 'noteReleased', note: playedNotes[0], at: 1200 },
    ]);
    expect(state.timeline).toEqual([
      { kind: 'on', note: playedNotes[0], at: 500, velocity: 0.62 },
      { kind: 'off', note: playedNotes[0], at: 1200 },
    ]);
  });

  it('弹错的音也记进时间轴（回放要还原孩子真正弹了什么）', () => {
    const state = run([
      { type: 'startPlaying', at: 0 },
      { type: 'notePressed', note: 'B4', at: 100 },
    ]);
    expect(state.timeline).toHaveLength(1);
    expect(state.timeline[0].note).toBe('B4');
    // 评分那边仍然只认「弹错了」
    expect(state.events[0].correct).toBe(false);
  });

  it('弹完之后再按不再记录（时间轴在结算时定稿）', () => {
    const state = pressFirstCorrectly(playedNotes.length);
    expect(state.state).toBe('completed');
    const after = practiceReducer(state, { type: 'notePressed', note: 'C6', at: 99999 }, song);
    expect(after.timeline).toEqual(state.timeline);
  });

  it('reset 会清空时间轴', () => {
    const played = pressFirstCorrectly(2);
    expect(played.timeline.length).toBeGreaterThan(0);
    expect(practiceReducer(played, { type: 'reset' }, song).timeline).toEqual([]);
  });

  it('弹完之后重新开始，时间轴从头再来', () => {
    const finished = pressFirstCorrectly(playedNotes.length);
    expect(finished.state).toBe('completed');
    const restarted = practiceReducer(finished, { type: 'startPlaying', at: 50000 }, song);
    expect(restarted.state).toBe('playing');
    expect(restarted.timeline).toEqual([]);
  });

  it('弹到一半的 startPlaying 被忽略（本来就不允许中途重开），时间轴原样保留', () => {
    const playing = pressFirstCorrectly(2);
    expect(practiceReducer(playing, { type: 'startPlaying', at: 50000 }, song)).toBe(playing);
  });

  it('时间轴有上限，孩子长时间乱按也不会把内存撑大', () => {
    // 需要一首足够长的曲子：连错 3 次才前进 1 个音，600 个音足够撑到上限
    const long: ResolvedSong = {
      ...song,
      notes: Array.from({ length: 600 }, (_, i) => ({
        note: 'C4',
        beat: i,
        duration: 1,
        playedNote: 'C4',
        originalNote: 'C4',
        adjusted: false,
      })),
      totalBeats: 600,
      totalSeconds: 600 * song.beatSeconds,
      usedNotes: ['C4'],
    };

    let state = practiceReducer(createInitialPracticeState(), { type: 'startPlaying', at: 0 }, long);
    for (let i = 0; i < MAX_TIMELINE_STEPS + 100; i += 1) {
      // 弹一个错的音，永远不会「完成」
      state = practiceReducer(state, { type: 'notePressed', note: 'B4', at: i }, long);
    }

    expect(state.state).toBe('playing');
    expect(state.timeline).toHaveLength(MAX_TIMELINE_STEPS);
  });

  it('时间轴**不影响评分**：同一串按键，有没有记录下来得分一样', () => {
    // 加回放时最需要守住的一条 —— 时间轴是旁路，不能渗进评分
    const count = 8;
    const options = { difficulty: song.song.difficulty, expectedNotes: count } as const;

    let plain = practiceReducer(createInitialPracticeState(), { type: 'startPlaying', at: 0 }, song);
    let withReleases = practiceReducer(
      createInitialPracticeState(),
      { type: 'startPlaying', at: 0 },
      song,
    );

    for (let i = 0; i < count; i += 1) {
      const at = 1000 + i * 1000;
      plain = practiceReducer(plain, { type: 'notePressed', note: playedNotes[i], at }, song);
      withReleases = practiceReducer(
        withReleases,
        { type: 'notePressed', note: playedNotes[i], at, velocity: 0.7 },
        song,
      );
      withReleases = practiceReducer(
        withReleases,
        { type: 'noteReleased', note: playedNotes[i], at: at + 50 },
        song,
      );
    }

    expect(withReleases.events).toEqual(plain.events);
    expect(scorePerformance(withReleases.events, options)).toEqual(
      scorePerformance(plain.events, options),
    );
    // 时间轴才是多出来的那份数据
    expect(withReleases.timeline.length).toBeGreaterThan(plain.timeline.length);
  });
});
