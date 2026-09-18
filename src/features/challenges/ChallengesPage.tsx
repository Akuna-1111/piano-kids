import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { noteLetter, noteToSolfege } from '@/core/audio/notes';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { PianoKeyboard, type KeyFeedback } from '@/features/piano/PianoKeyboard';
import { getKeyboardLayout } from '@/features/piano/pianoLayout';
import { usePianoAudio } from '@/features/piano/usePianoAudio';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import './challenges.css';

/**
 * 小挑战：听一听，找出刚才那个音（音高辨识）。
 *
 * 第一版刻意做得极小：题库就是当前键盘的白键，玩法只有「听 → 找 → 反馈」。
 * 它服务于文档 1.2 里孩子的核心目标「认识高低音和音名」，
 * 并且完全不读写成长数据 —— 挑战不去改皮肤，皮肤只由练习事件解锁（开发规则 10 / 11）。
 */

const ROUNDS = 5;
const FEEDBACK_MS = 900;

type Phase = 'ready' | 'guessing' | 'done';

function pickDifferent(notes: readonly string[], exclude: string | null): string {
  if (notes.length <= 1) return notes[0];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = notes[Math.floor(Math.random() * notes.length)];
    if (candidate !== exclude) return candidate;
  }
  return notes[0];
}

export function ChallengesPage() {
  const navigate = useNavigate();
  const { settings } = useProgressStore();
  const { handleNoteOn, handleNoteOff } = usePianoAudio();

  const [phase, setPhase] = useState<Phase>('ready');
  const [round, setRound] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [feedback, setFeedback] = useState<KeyFeedback | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const candidateNotes = useMemo(
    () => getKeyboardLayout(settings.keyboardSize).whiteKeys.map((key) => key.note),
    [settings.keyboardSize],
  );

  const playNote = useCallback((note: string) => {
    void audioEngine.ensureReady().then(() => {
      if (!audioEngine.isReady()) return;
      audioEngine.playScheduled(note, audioEngine.currentTime + 0.06, 1.15, 0.9);
    });
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const startRound = useCallback(
    (previousTarget: string | null) => {
      const note = pickDifferent(candidateNotes, previousTarget);
      setTarget(note);
      setRevealNote(null);
      setFeedback(null);
      setPhase('guessing');
      window.setTimeout(() => playNote(note), 240);
    },
    [candidateNotes, playNote],
  );

  const startGame = useCallback(() => {
    clearTimer();
    setResults([]);
    setRound(0);
    setTarget(null);
    startRound(null);
  }, [clearTimer, startRound]);

  const finishRound = useCallback(
    (correct: boolean, guessedNote: string) => {
      const nextRound = round + 1;
      setResults((prev) => [...prev, correct]);
      setFeedback({
        note: correct ? guessedNote : (target ?? guessedNote),
        kind: correct ? 'correct' : 'wrong',
        token: nextRound * 1000 + (correct ? 1 : 0),
      });
      if (!correct) setRevealNote(target);

      clearTimer();
      timerRef.current = setTimeout(() => {
        setFeedback(null);
        if (nextRound >= ROUNDS) {
          setPhase('done');
          setRevealNote(null);
          return;
        }
        setRound(nextRound);
        startRound(target);
      }, FEEDBACK_MS);
    },
    [round, target, clearTimer, startRound],
  );

  const handleGuess = useCallback(
    (note: string) => {
      if (phase !== 'guessing' || !target) return;
      finishRound(note === target, note);
    },
    [phase, target, finishRound],
  );

  const onNoteOn = useCallback(
    (note: string, velocity: number) => {
      handleNoteOn(note, velocity);
      handleGuess(note);
    },
    [handleNoteOn, handleGuess],
  );

  const correctCount = results.filter(Boolean).length;
  const isGuessing = phase === 'guessing';

  return (
    <div className="chl">
      <header className="chl__top">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/challenges')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="chl__title">小挑战 · 听音找键</h1>
        <span className="chl__rounds">
          {phase === 'done' ? ROUNDS : Math.min(round + 1, ROUNDS)} / {ROUNDS}
        </span>
      </header>

      <main className="chl__stage">
        <div className="chl__prompt">
          {phase === 'ready' ? (
            <>
              <p className="chl__headline">我来弹一个音，你找出它在哪</p>
              <p className="chl__sub">一共 {ROUNDS} 个音，不着急，慢慢听</p>
            </>
          ) : phase === 'done' ? (
            <>
              <p className="chl__headline">
                {correctCount === ROUNDS
                  ? '全都找到啦！'
                  : correctCount >= 3
                    ? `找到 ${correctCount} 个，耳朵很灵`
                    : `找到 ${correctCount} 个，再来一次会更准`}
              </p>
              <p className="chl__sub chl__results">
                {results.map((ok, index) => (
                  <Icon
                    key={index}
                    name={ok ? 'star-filled' : 'star'}
                    size={20}
                    className={cx('chl__dot', ok && 'is-on')}
                  />
                ))}
              </p>
            </>
          ) : (
            <>
              <p className="chl__headline">听一听</p>
              <button
                type="button"
                className="ui-btn ui-btn--primary ui-btn--lg chl__replay"
                onClick={() => target && playNote(target)}
              >
                <Icon name="volume" size={24} />
                再听一次
              </button>
              <p className="chl__sub">然后在下面按下你听到的那个键</p>
            </>
          )}
        </div>

        <div className="chl__keyboard">
          <PianoKeyboard
            size={settings.keyboardSize}
            guideNote={revealNote}
            feedback={feedback}
            showNoteNames={settings.showNoteNames}
            disabled={!isGuessing}
            onNoteOn={onNoteOn}
            onNoteOff={handleNoteOff}
          />
        </div>

        {isGuessing && target ? (
          <div className="chl__target-hint">
            <span className="chl__target-label">刚才的音</span>
            <span className="chl__target-value">
              {feedback ? `${noteLetter(target)} · ${noteToSolfege(target)}` : '? ? ?'}
            </span>
          </div>
        ) : null}
      </main>

      <footer className="chl__bottom">
        {phase === 'ready' ? (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={startGame}>
            开始
          </button>
        ) : phase === 'done' ? (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={startGame}>
            再玩一次
          </button>
        ) : (
          <span className="ui-pill">听到几个音就按几个键，放轻松</span>
        )}
      </footer>
    </div>
  );
}
