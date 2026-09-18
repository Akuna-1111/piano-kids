import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { noteLetter, noteToSolfege } from '@/core/audio/notes';
import { useProgressStore } from '@/core/progress/ProgressStore';
import type { PracticeResult } from '@/core/progress/progressTypes';
import { PianoKeyboard, type KeyFeedback } from '@/features/piano/PianoKeyboard';
import { describeRange } from '@/features/piano/pianoLayout';
import { describeKeyWidth, type KeyWidthResult, type DeviceMetrics } from '@/features/piano/keySize';
import { getSongsByDifficulty } from '@/features/songs/songData';
import { findSongById } from '@/features/songs/packSongs';
import { resolveSong } from '@/features/songs/songResolver';
import { StaffNote } from '@/features/notation/StaffNote';
import type { Song } from '@/features/songs/types';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import { ResultOverlay, type SessionOutcome } from './ResultOverlay';
import {
  recordHoldSample,
  recordHoldSkipped,
} from './holdStats';
import {
  createInitialPracticeState,
  expectedNotesSoFar,
  holdReady,
  practiceDurationMs,
  practiceReducer,
  type HoldGuide,
  type PracticeStateShape,
} from './practiceReducer';
import { scorePerformance } from './scoring';
import { startListenPlayback, type ListenPlayback } from './scheduler';
import { buildRecording } from './recording';
import './practice.css';

/**
 * 练习页（文档 4.2）。
 *
 * 布局优先级：键盘是主视觉；控件绝不覆盖琴键；底部控制栏只占一行。
 * 本页不直接改 localStorage，也不直接持有 AudioNode —— 只调用 audioEngine 与 ProgressStore。
 */

const TEMPO_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.75, label: '慢' },
  { value: 1, label: '正好' },
  { value: 1.25, label: '快' },
];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 键盘算出的物理尺寸（白键毫米数 + 设备 PPI 估算来源） */
type KeyboardMetrics = KeyWidthResult & { metrics: DeviceMetrics };

export function PracticePage() {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const song = findSongById(songId);

  useEffect(() => {
    if (!song) navigate('/songs', { replace: true });
  }, [song, navigate]);

  if (!song) return null;
  // key=song.id：换歌时彻底重建会话，不残留上一首的成绩
  return <PracticeSession key={song.id} song={song} />;
}

function PracticeSession({ song }: { song: Song }) {
  const navigate = useNavigate();
  const { settings, record, setLastSongId, progress } = useProgressStore();

  const [tempoScale, setTempoScale] = useState(1);
  const [outcome, setOutcome] = useState<SessionOutcome | null>(null);
  const [listeningNote, setListeningNote] = useState<string | null>(null);
  /** 键盘算出的白键实际物理尺寸，用于如实告知孩子/家长是否达到真实钢琴尺寸 */
  const [keySize, setKeySize] = useState<KeyboardMetrics | null>(null);

  const handleKeyboardMetrics = useCallback((result: KeyboardMetrics) => {
    setKeySize((prev) =>
      prev &&
      Math.abs(prev.keyMm - result.keyMm) < 0.05 &&
      prev.isRealSize === result.isRealSize
        ? prev
        : result,
    );
  }, []);

  // 曲谱只保存一份；速度在运行时通过 resolver 推导（文档 7.3）
  const resolved = useMemo(() => {
    const base = resolveSong(song, settings.keyboardSize);
    if (tempoScale === 1) return base;
    const beatSeconds = base.beatSeconds / tempoScale;
    return {
      ...base,
      bpm: Math.round(base.bpm * tempoScale),
      beatSeconds,
      totalSeconds: base.totalBeats * beatSeconds,
    };
  }, [song, settings.keyboardSize, tempoScale]);

  const reducerWithSong = useCallback(
    (state: PracticeStateShape, action: Parameters<typeof practiceReducer>[1]) =>
      practiceReducer(state, action, resolved),
    [resolved],
  );
  const [state, dispatch] = useReducer(reducerWithSong, undefined, createInitialPracticeState);

  const playbackRef = useRef<ListenPlayback | null>(null);
  const recordedRef = useRef(false);
  /** 最新的按住提示。给 handleNoteOff 读 —— 那个回调不能依赖 state，否则键盘的 memo 会失效 */
  const holdRef = useRef<HoldGuide | null>(null);

  useEffect(() => {
    setLastSongId(song.id);
  }, [song.id, setLastSongId]);

  // 换键盘档位会让「这一轮」的谱面失效，直接重置，避免出现半截成绩
  useEffect(() => {
    dispatch({ type: 'reset' });
    setOutcome(null);
    recordedRef.current = false;
  }, [settings.keyboardSize]);

  // ------------------------------------------------------------ 听一遍

  useEffect(() => {
    if (state.state !== 'listening') return;
    const playback = startListenPlayback(resolved, {
      onNoteChange: (note) => setListeningNote(note ? note.playedNote : null),
      onFinish: () => {
        playbackRef.current = null;
        setListeningNote(null);
        dispatch({ type: 'finishListening' });
      },
    });
    playbackRef.current = playback;
    return () => {
      playback.stop();
      playbackRef.current = null;
      setListeningNote(null);
    };
  }, [state.state, resolved]);

  // ------------------------------------------------------------ 反馈清理

  useEffect(() => {
    if (!state.feedback) return;
    const timer = setTimeout(() => dispatch({ type: 'clearFeedback' }), 460);
    return () => clearTimeout(timer);
  }, [state.feedbackToken, state.feedback]);

  // ------------------------------------------------------------ 结算

  useEffect(() => {
    if (state.state !== 'completed' || recordedRef.current) return;
    recordedRef.current = true;

    const breakdown = scorePerformance(state.events, {
      difficulty: song.difficulty,
      timingWindowScale: settings.timingWindowScale,
      expectedNotes: resolved.notes.length,
    });
    const durationMs = practiceDurationMs(state, nowMs());

    const result: PracticeResult = {
      songId: song.id,
      accuracy: breakdown.accuracy,
      pitchScore: breakdown.pitchScore,
      timingScore: breakdown.timingScore,
      correctNotes: breakdown.correctNotes,
      wrongNotes: breakdown.wrongNotes,
      totalNotesPlayed: state.notesPlayed,
      durationMs,
      completed: true,
      perfectRun: breakdown.wrongNotes === 0,
      completedAfterMistake: breakdown.wrongNotes > 0,
      maxCombo: breakdown.maxCombo,
    };

    // 一次事务：星星 + 记录 + 连续天数 + 成就 + 皮肤解锁，同步拿到奖励结果
    const reward = record(result);
    setOutcome({ breakdown, reward, durationMs });
  }, [state, song.id, song.difficulty, resolved, settings.timingWindowScale, record]);

  // ------------------------------------------------------------ 交互

  const handleNoteOn = useCallback(
    (note: string, velocity: number) => {
      audioEngine.noteOn(note, velocity);
      if (state.state === 'playing') {
        // 力度也记进时间轴：回放时能听出孩子自己的轻重
        dispatch({ type: 'notePressed', note, at: nowMs(), velocity });
      }
    },
    [state.state],
  );

  const handleNoteOff = useCallback((note: string) => {
    audioEngine.noteOff(note);
    const at = nowMs();
    // 松手只用来结束「按住提示」；它不参与评分（见 practiceReducer 的 HoldGuide）
    dispatch({ type: 'noteReleased', note, at });

    // 真机数据收集：松开的就是刚按对的那个音时，记一条真实按住时长。
    // 读 ref 而不是 state —— 这个回调不能依赖 state，否则键盘的 memo 会失效。
    const hold = holdRef.current;
    if (hold !== null && hold.note === note && !hold.released) {
      recordHoldSample({ note, targetMs: hold.durationMs, heldMs: at - hold.startedAt });
    }
  }, []);

  const handleListen = useCallback(() => {
    void audioEngine.ensureReady().then(() => dispatch({ type: 'startListening' }));
  }, []);

  const handleStartPlaying = useCallback(() => {
    void audioEngine.ensureReady().then(() => {
      setOutcome(null);
      recordedRef.current = false;
      dispatch({ type: 'startPlaying', at: nowMs() });
    });
  }, []);

  const handleRetry = useCallback(() => {
    setOutcome(null);
    recordedRef.current = false;
    dispatch({ type: 'reset' });
  }, []);

  const handleExit = useCallback(() => {
    // 中途退出：只要真的弹过就把音符数记入统计（但不发星星）
    if (
      (state.state === 'playing' || state.state === 'paused') &&
      state.notesPlayed > 0 &&
      !recordedRef.current
    ) {
      recordedRef.current = true;
      const breakdown = scorePerformance(state.events, {
        difficulty: song.difficulty,
        timingWindowScale: settings.timingWindowScale,
        expectedNotes: expectedNotesSoFar(state, resolved),
      });
      record({
        songId: song.id,
        accuracy: breakdown.accuracy,
        pitchScore: breakdown.pitchScore,
        timingScore: breakdown.timingScore,
        correctNotes: breakdown.correctNotes,
        wrongNotes: breakdown.wrongNotes,
        totalNotesPlayed: state.notesPlayed,
        durationMs: practiceDurationMs(state, nowMs()),
        completed: false,
        perfectRun: false,
        completedAfterMistake: false,
        maxCombo: breakdown.maxCombo,
      });
    }
    audioEngine.allNotesOff();
    navigate('/');
  }, [state, song.id, song.difficulty, resolved, settings.timingWindowScale, record, navigate]);

  // ------------------------------------------------------------ 按住提示

  /**
   * 「按住提示」做两件事，都只是**让时长变得看得见**，不改动任何评分：
   *
   *   1. 按对一个音之后，把「下一个键」从强引导降成弱提示，直到按住的时间够了。
   *      正好用上 §10.5 的引导层级：等的时候是弱外轮廓，可以弹的时候才给强高亮。
   *      它要解决的是「孩子还在按着这个键，眼睛已经在找下一个键」。
   *   2. 显示一道会走完的填充条（沿用 .pp__progress 的语言）。
   *
   * ⚠️ 键**始终可弹**，早弹不额外扣分 —— 这是等待的视觉，不是闸门（§44）。
   */
  const [expiredHold, setExpiredHold] = useState<HoldGuide | null>(null);

  useEffect(() => {
    const hold = state.hold;
    if (hold === null || holdReady(hold, nowMs())) {
      // 已经按满 / 已经松手 / 本来就不用等 → 不需要排定时器
      return;
    }
    // 整段等待只用一个定时器（不是每帧），到点把「这一个」hold 标记为按满
    const remaining = hold.until - nowMs();
    const timer = setTimeout(() => setExpiredHold(hold), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state.hold]);

  const hold = state.state === 'playing' ? state.hold : null;
  // 用**对象身份**判断，而不是时间戳：换一个音就自动失效，
  // 不会出现「上一个音已按满」的状态把新的 hold 也顺带跳过一帧。
  const holdActive = hold !== null && !hold.released && expiredHold !== hold;

  /**
   * 真机数据收集：把「上一个 hold 是怎么结束的」投给 `holdStats`。
   *
   * 两种结束方式分开记 —— 它们的含义完全不同：
   *   · 收到松手 → 一条真实样本（`heldMs` 是真实按住时长）
   *   · 还没松手就被下一个音顶掉 → 只记「没等到松手」的次数
   *
   * 后者占比高，说明松手信号在真机上本身不可靠，
   * 那么把它做成判分依据就是危险的。这正是写判定之前要先看清楚的事。
   */
  useEffect(() => {
    const previous = holdRef.current;
    const current = state.hold;
    if (previous !== null && previous !== current && !previous.released) {
      recordHoldSkipped();
    }
    holdRef.current = current;
  }, [state.hold]);

  // ------------------------------------------------------------ 派生展示

  const isPlaying = state.state === 'playing' || state.state === 'paused';
  const currentNote = isPlaying ? (resolved.notes[state.noteIndex]?.playedNote ?? null) : null;
  const nextNote = isPlaying
    ? (resolved.notes[Math.min(state.noteIndex + 1, resolved.notes.length - 1)]?.playedNote ?? null)
    : null;

  const guideNote =
    state.state === 'playing'
      ? holdActive
        ? null
        : currentNote
      : state.state === 'listening'
        ? listeningNote
        : null;
  // 按住期间，「下一个键」降级为弱提示（§10.5 二级提示）；按满了才升回强引导
  const hintedNote = isPlaying ? (holdActive ? currentNote : nextNote) : null;

  const correctCount = state.events.reduce((sum, e) => sum + (e.correct ? 1 : 0), 0);
  const progressRatio =
    resolved.notes.length > 0 ? Math.min(1, correctCount / resolved.notes.length) : 0;

  // 录音回放：结算时时间轴已经定稿（完成后不再有 notePressed/noteReleased）
  const recording = useMemo(() => buildRecording(state.timeline), [state.timeline]);

  const nextSong = useMemo(() => {
    // 「下一首」按推荐练习顺序走（难度低→高），而不是曲谱文件里的排列顺序
    const ordered = getSongsByDifficulty();
    const index = ordered.findIndex((item) => item.id === song.id);
    if (index < 0) return ordered[0];
    return ordered[(index + 1) % ordered.length];
  }, [song.id]);

  const feedback: KeyFeedback | null = state.feedback;

  return (
    <div className="pp">
      <header className="pp__top">
        <button type="button" className="ui-btn ui-btn--ghost pp__back" onClick={handleExit}>
          <Icon name="arrow-left" size={20} />
          退出
        </button>

        <div className="pp__title">
          <span className="pp__title-name">{song.title}</span>
          <span className="pp__title-meta">
            {describeRange(settings.keyboardSize)} · {resolved.bpm} 拍/分
          </span>
        </div>

        <div className="pp__top-actions">
          <button
            type="button"
            className="ui-btn pp__listen"
            onClick={handleListen}
            disabled={state.state === 'listening'}
          >
            <Icon name="play" size={20} />
            听一遍
          </button>
          <div className="pp__tempo" role="group" aria-label="速度">
            {TEMPO_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cx('pp__tempo-btn', tempoScale === option.value && 'is-active')}
                onClick={() => setTempoScale(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="pp__stage">
        <div className="pp__prompt">
          {state.state === 'listening' ? (
            <>
              {/* 听的时候也把谱面亮出来：耳朵听、眼睛跟 —— 这是「听一遍」最有价值的地方 */}
              {listeningNote ? (
                <StaffNote
                  note={listeningNote}
                  showSolfege={settings.showSolfege}
                  showPinyin={settings.showPinyin}
                  className="pp__staff"
                />
              ) : null}
              <div className="pp__listen-hint">
                <Icon name="notes" size={28} className="pp__listen-icon" />
                <span>先听一遍，看看每个音在哪里</span>
              </div>
            </>
          ) : isPlaying && currentNote ? (
            <>
              {/* 跟弹模式也要看谱：谱面在上、琴键在下，孩子练的是「看谱 → 找键」这条链路 */}
              <StaffNote
                note={currentNote}
                showSolfege={settings.showSolfege}
                showPinyin={settings.showPinyin}
                className="pp__staff"
              />
              <div className="pp__note-row">
                <span className="pp__note-current">{noteLetter(currentNote)}</span>
                <div className="pp__note-next">
                  <span className="pp__note-next-label">下一个</span>
                  <span className="pp__note-next-value">
                    {nextNote && nextNote !== currentNote
                      ? `${noteLetter(nextNote)} · ${noteToSolfege(nextNote)}`
                      : '—'}
                  </span>
                </div>
              </div>
              {holdActive && hold ? (
                <div className="pp__hold">
                  <span className="pp__hold-label">按住 {noteLetter(hold.note)}</span>
                  <div className="pp__hold-track" aria-hidden>
                    <div
                      // key：换一个音就重建节点，CSS 动画从头开始
                      key={`${hold.note}-${hold.until}`}
                      className="pp__hold-bar"
                      style={
                        { '--pp-hold-ms': `${Math.round(hold.durationMs)}ms` } as React.CSSProperties
                      }
                    />
                  </div>
                </div>
              ) : state.wrongAttemptsOnCurrent > 0 || state.lastAdvanceWasSkip ? (
                <p className="pp__mistake-hint">没关系，再试一次 —— 就是亮起来的那个键</p>
              ) : null}
            </>
          ) : (
            <div className="pp__idle-hint">
              <span className="pp__idle-main">准备好了吗？</span>
              <span className="pp__idle-sub">
                这一首有 {resolved.notes.length} 个音，一共用到 {resolved.usedNotes.length} 个键
              </span>
            </div>
          )}
        </div>

        <div className="pp__keyboard">
          <PianoKeyboard
            size={settings.keyboardSize}
            guideNote={guideNote}
            nextNote={hintedNote}
            feedback={feedback}
            showNoteNames={settings.showNoteNames}
            disabled={outcome !== null}
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            onMetrics={handleKeyboardMetrics}
          />
        </div>

        {isPlaying ? (
          <div className="pp__progress" aria-hidden>
            <div className="pp__progress-bar" style={{ width: `${progressRatio * 100}%` }} />
          </div>
        ) : null}
      </main>

      <footer className="pp__bottom">
        <div className="pp__bottom-actions">
          {state.state === 'idle' ? (
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--lg"
              onClick={handleStartPlaying}
            >
              开始跟弹
            </button>
          ) : null}
          {state.state === 'paused' ? (
            <button
              type="button"
              className="ui-btn ui-btn--primary ui-btn--lg"
              onClick={() => dispatch({ type: 'resume', at: nowMs() })}
            >
              继续
            </button>
          ) : null}
          {state.state === 'playing' ? (
            <button
              type="button"
              className="ui-btn pp__pause"
              onClick={() => dispatch({ type: 'pause', at: nowMs() })}
            >
              歇一会儿
            </button>
          ) : null}
          {state.state === 'listening' ? (
            <button type="button" className="ui-btn ui-btn--primary" onClick={handleStartPlaying}>
              直接开始跟弹
            </button>
          ) : null}
        </div>

        <div className="pp__stats">
          {keySize ? (
            <span
              className={cx('ui-pill', keySize.isRealSize && 'pp__keysize--real')}
              title="白键物理宽度。达到真实钢琴尺寸时，手指跨度可以迁移到真琴。"
            >
              {describeKeyWidth(keySize, keySize.metrics)}
            </span>
          ) : null}
          <span className="ui-pill">
            <Icon name="star-filled" size={16} /> {progress.starsTotal}
          </span>
          {isPlaying ? (
            <span className="ui-pill">
              {Math.min(correctCount, resolved.notes.length)} / {resolved.notes.length}
            </span>
          ) : null}
        </div>
      </footer>

      {outcome ? (
        <ResultOverlay
          song={song}
          outcome={outcome}
          nextSong={nextSong}
          recording={recording}
          onRetry={handleRetry}
          onExit={() => navigate('/')}
          onNextSong={() => navigate(`/practice/${nextSong.id}`)}
          onWardrobe={() => navigate('/wardrobe')}
        />
      ) : null}
    </div>
  );
}
