import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { noteLetter, noteToSolfege } from '@/core/audio/notes';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { PianoKeyboard, type KeyFeedback } from '@/features/piano/PianoKeyboard';
import { isNoteOnKeyboard, type KeyboardSize } from '@/features/piano/pianoLayout';
import { usePianoAudio } from '@/features/piano/usePianoAudio';
import { StaffNote } from '@/features/notation/StaffNote';
import {
  NOTATION_LEVELS,
  levelForRound,
  noteValueForLevel,
  notesForLevel,
} from '@/features/notation/staffLayout';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import './challenges.css';

/**
 * 小挑战 · 看谱找键（五线谱识谱）。
 *
 * 学习目标：把「五线谱上的位置」和「琴键」建立对应关系 —— 这是识谱的第一层，
 * 也是从「跟着亮起的琴键弹」过渡到「自己看谱弹」的必经一步。
 *
 * 设计取舍：
 *   · 练习用**自然音**（中央 C 到高音 G），不含升降号 —— 初学阶段先把线和间认熟
 *   · 音符形态由档位决定（`NOTATION_LEVELS[].noteValue`）：第 1–2 档是**全音符**
 *     （没有符干也没有符尾），注意力全落在「音在哪个位置」上；
 *     第 3 档换成**二分音符**，让孩子在练习里就见过真教材上的样子。
 *     形态**不是**难度变量 —— 符干不影响该按哪个键，所以它不改变这道题要判断什么
 *   · 难度按**音域分档**自动上升（`NOTATION_LEVELS`）：先认谱表以内，
 *     再加下加一线的中央 C，最后才扩展到更外的加线。见 `levelForRound()`
 *   · 出题音域再和**当前键盘档位**取交集 —— 弹不到的音不出题，
 *     否则这道题在物理上无法作答（8 键键盘只覆盖 C4–C5）
 *   · 谱面下方可标出数字简谱与唱名拼音（设置里可开关），
 *     让「位置 → 数字 → 读音」一次对上，印象更深
 *   · 默认显示各线音名参考（E G B D F），因为这是「熟悉」而不是「考试」（§43 L2 引导优先）
 *   · 弹对弹错都只给一次轻反馈，不做扣分、不做倒计时（§44 无羞耻错误机制）
 *   · 不读写成长数据：挑战不去改皮肤，皮肤只由练习事件解锁（开发规则 10 / 11）
 */

const ROUNDS = 6;
const FEEDBACK_MS = 900;

type Phase = 'ready' | 'guessing' | 'done';

/** 出题：在给定的音域池里取一个和上一个不同的音。 */
function pickNote(pool: readonly string[], exclude: string | null): string {
  if (pool.length === 0) return 'C4';
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = pool[Math.floor(Math.random() * pool.length)];
    if (candidate !== exclude) return candidate;
  }
  return pool[0];
}

/**
 * 某一档音域里**当前键盘真的能弹**的音。
 *
 * 跳过这一步会出一个弹不到的题：15 / 25 键键盘够宽，但 8 键键盘只覆盖 C4–C5，
 * 第 1 档里的 D5 / E5 / F5 在它上面根本不存在。
 */
function poolFor(level: number, size: KeyboardSize): readonly string[] {
  return notesForLevel(level).filter((note) => isNoteOnKeyboard(size, note));
}

export function StaffReadingPage() {
  const navigate = useNavigate();
  const { settings } = useProgressStore();
  const { handleNoteOn, handleNoteOff } = usePianoAudio();

  const [phase, setPhase] = useState<Phase>('ready');
  const [round, setRound] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [results, setResults] = useState<boolean[]>([]);
  const [feedback, setFeedback] = useState<KeyFeedback | null>(null);
  const [showReference, setShowReference] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const startRound = useCallback((previous: string | null, roundIndex: number, size: KeyboardSize) => {
    const level = levelForRound(roundIndex, ROUNDS);
    const note = pickNote(poolFor(level, size), previous);
    setTarget(note);
    setRevealNote(null);
    setFeedback(null);
    setPhase('guessing');
  }, []);

  const startGame = useCallback(() => {
    clearTimer();
    setResults([]);
    setRound(0);
    setTarget(null);
    startRound(null, 0, settings.keyboardSize);
  }, [clearTimer, startRound, settings.keyboardSize]);

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
        startRound(target, nextRound, settings.keyboardSize);
      }, FEEDBACK_MS);
    },
    [round, target, clearTimer, startRound, settings.keyboardSize],
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

  /** 听一下这个音（不是必须的，但对建立「看到 → 听到」的关联很有帮助） */
  const playTarget = useCallback(() => {
    if (!target) return;
    void audioEngine.ensureReady().then(() => {
      if (!audioEngine.isReady()) return;
      audioEngine.playScheduled(target, audioEngine.currentTime + 0.06, 1.1, 0.85);
    });
  }, [target]);

  const correctCount = results.filter(Boolean).length;
  const isGuessing = phase === 'guessing';

  // 当前这一题的档位 + 实际可出题音域（用于告诉孩子「现在练到哪一档了」）
  const level = levelForRound(round, ROUNDS);
  const pool = useMemo(() => poolFor(level, settings.keyboardSize), [level, settings.keyboardSize]);
  const levelName = NOTATION_LEVELS[level - 1].name;
  const rangeText = pool.length > 0 ? `${pool[0]} – ${pool[pool.length - 1]}` : '';
  // 形态只做迁移用，不进界面文案 —— 它不是这道题的难度变量（见 NOTATION_LEVELS 的注释）
  const noteValue = noteValueForLevel(level);

  return (
    <div className="chl">
      <header className="chl__top">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/challenges')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="chl__title">小挑战 · 看谱找键</h1>
        <span className="chl__rounds">
          {phase === 'done' ? ROUNDS : Math.min(round + 1, ROUNDS)} / {ROUNDS}
        </span>
      </header>

      <main className="chl__stage">
        <div className="chl__prompt">
          {phase === 'ready' ? (
            <>
              <p className="chl__headline">看看这个音在五线谱的哪里</p>
              <p className="chl__sub">
                一共 {ROUNDS} 个音，音域会一档一档变宽，不着急
              </p>
            </>
          ) : phase === 'done' ? (
            <>
              <p className="chl__headline">
                {correctCount === ROUNDS
                  ? '全都找到啦！'
                  : correctCount >= 4
                    ? `找到 ${correctCount} 个，认谱很快`
                    : `找到 ${correctCount} 个，再来一次会更熟`}
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
              <p className="chl__headline">这个音在键盘的哪里？</p>
              <p className="chl__sub">
                第 {level} 档 · {levelName}
                {rangeText ? `（${rangeText}）` : ''}
              </p>
            </>
          )}
        </div>

        {/* 谱面：这是本题的主视觉（§0.1 当前任务优先）。
            直接铺在舞台底色上，没有卡片 —— 谱面自己就是内容，
            不需要再套一层填充色块（§3.3 不要把每个模块都做成卡片）。 */}
        {target && (isGuessing || phase === 'done') ? (
          <StaffNote
            note={target}
            noteValue={noteValue}
            showReference={showReference}
            showSolfege={settings.showSolfege}
            showPinyin={settings.showPinyin}
            label={`五线谱上的 ${noteLetter(target)}`}
          />
        ) : null}

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

        {isGuessing ? (
          <div className="chl__target-hint">
            <span className="chl__target-label">刚才的音</span>
            <span className="chl__target-value">
              {feedback ? `${noteLetter(target!)} · ${noteToSolfege(target!)}` : '? ? ?'}
            </span>
          </div>
        ) : null}
      </main>

      <footer className="chl__bottom">
        {phase === 'ready' ? (
          <>
            <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={startGame}>
              开始
            </button>
          </>
        ) : phase === 'done' ? (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={startGame}>
            再玩一次
          </button>
        ) : (
          <>
            <button type="button" className="ui-btn" onClick={playTarget}>
              <Icon name="volume" size={20} />
              听一下
            </button>
            <button
              type="button"
              className={cx('ui-btn', showReference && 'chl__toggle--on')}
              onClick={() => setShowReference((prev) => !prev)}
              aria-pressed={showReference}
            >
              音名参考{showReference ? '开' : '关'}
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
