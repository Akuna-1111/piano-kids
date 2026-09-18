import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { PianoKeyboard } from '@/features/piano/PianoKeyboard';
import { usePianoAudio } from '@/features/piano/usePianoAudio';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import {
  DEFAULT_BPM,
  ROUND_BEATS,
  SPEED_OPTIONS,
  applyTap,
  beatChallengeResult,
  createBeatChallengeState,
  expireMissedBeats,
  isAccentBeat,
  isRoundFinished,
  judgeTap,
  markerProgress,
  type BeatChallengeState,
  type HitGrade,
} from './beatClock';
import './challenges.css';

/**
 * 小挑战：节拍挑战（开发规划 §12.4）。
 *
 * ```text
 * 时间轴 → 目标区 → 用户按键 → 判断命中
 * ```
 *
 * 第一版只有五样东西：**速度 · marker · hit window · combo · result**。
 * 没有多轨、没有变奏谱面、没有连击特效 —— 它是「跟着拍子按」这件事的最小闭环。
 *
 * 两条与全项目一致的约定：
 * - **咔声一次性排到 `AudioContext` 时间轴上**，界面只跑 `requestAnimationFrame`，不用逐拍定时器
 * - 按任意琴键都算一拍（顺便发出钢琴声当反馈），所以判定与音高无关 —— 音高是另一个挑战的事
 */

const LEAD_BEATS = 2;
/** 判定线在轨道上的位置（%）：marker 从右边走到这里 */
const HIT_LINE_PCT = 18;

type Phase = 'ready' | 'playing' | 'done';

interface JudgeView {
  grade: HitGrade;
  /** 命中时的差值（毫秒，负 = 早了） */
  deltaMs: number;
  /** 没有对应拍点 = 多按了一下 */
  stray: boolean;
  token: number;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function BeatChallengePage() {
  const navigate = useNavigate();
  const { settings } = useProgressStore();
  const { handleNoteOn } = usePianoAudio();

  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [phase, setPhase] = useState<Phase>('ready');
  const [, setFrame] = useState(0);
  const [judge, setJudge] = useState<JudgeView | null>(null);

  const stateRef = useRef<BeatChallengeState | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const handleStart = useCallback(() => {
    void audioEngine.ensureReady().then((ready) => {
      if (!ready) return;
      const startedAt = nowMs();
      const state = createBeatChallengeState({ bpm, nowMs: startedAt });
      stateRef.current = state;

      // 整轮的咔声一次性排进 AudioContext 时间轴（不做逐拍 setTimeout）
      const audioNow = audioEngine.currentTime;
      state.beatTimesMs.forEach((beatTimeMs, index) => {
        audioEngine.metronomeClick(audioNow + (beatTimeMs - startedAt) / 1000, isAccentBeat(index));
      });

      setJudge(null);
      setPhase('playing');
    });
  }, [bpm]);

  // 每一帧：把过期的拍记成没跟上、推进画面、到点结算
  useEffect(() => {
    if (phase !== 'playing') return;
    let frame = 0;
    const loop = () => {
      const current = stateRef.current;
      if (!current) return;
      const now = nowMs();
      const next = expireMissedBeats(current, now);
      if (next !== current) stateRef.current = next;

      frame += 1;
      if (frame % 2 === 0) setFrame((value) => value + 1);
      if (isRoundFinished(next, now)) {
        setPhase('done');
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return stopLoop;
  }, [phase, stopLoop]);

  /** 退出（或组件卸载）时掐掉还没响的咔声，不留鬼声 */
  useEffect(
    () => () => {
      audioEngine.stopMetronome();
    },
    [],
  );

  const handleTap = useCallback(() => {
    const current = stateRef.current;
    if (!current || phase !== 'playing') return;
    const tapMs = nowMs();
    const judgement = judgeTap(current, tapMs);
    stateRef.current = applyTap(current, tapMs);
    setJudge({
      grade: judgement.grade,
      deltaMs: judgement.deltaMs,
      stray: judgement.beatIndex === null,
      token: tapMs,
    });
    setFrame((value) => value + 1);
  }, [phase]);

  const onNoteOn = useCallback(
    (note: string, velocity: number) => {
      handleNoteOn(note, velocity);
      handleTap();
    },
    [handleNoteOn, handleTap],
  );

  const handleExit = useCallback(() => {
    audioEngine.stopMetronome();
    navigate('/challenges');
  }, [navigate]);

  const state = stateRef.current;
  const now = nowMs();
  const judgedGrades = state ? state.grades.slice(state.judgedFrom) : [];
  const judgedBeats = judgedGrades.filter((grade) => grade !== null).length;
  const result = phase === 'done' && state ? beatChallengeResult(state) : null;

  const markers =
    state && phase === 'playing'
      ? state.beatTimesMs
          .map((beatTimeMs, index) => ({
            index,
            progress: markerProgress(now, beatTimeMs, state.beatMs, LEAD_BEATS),
            grade: state.grades[index],
          }))
          .filter((marker) => marker.progress >= -0.15 && marker.progress <= 1.2)
      : [];

  const judgeText = judge
    ? judge.stray
      ? '多按了一下'
      : judge.grade === 'perfect'
        ? '完美'
        : judge.deltaMs < 0
          ? '不错 · 早了一点'
          : '不错 · 晚了一点'
    : null;

  return (
    <div className="chl">
      <header className="chl__top">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={handleExit}>
          <Icon name="arrow-left" size={20} />
          退出
        </button>
        <h1 className="chl__title">小挑战 · 节拍挑战</h1>
        <span className="chl__rounds">
          {phase === 'playing' ? `第 ${judgedBeats} / ${ROUND_BEATS} 拍` : `${bpm} 拍/分`}
        </span>
      </header>

      <main className="chl__stage">
        <div className="chl__prompt">
          {phase === 'ready' ? (
            <>
              <p className="chl__headline">跟着咔声按琴键</p>
              <p className="chl__sub">
                先听四拍预备，之后每响一下按一次任意琴键 —— 一共 {ROUND_BEATS} 拍
              </p>
            </>
          ) : phase === 'playing' ? (
            <>
              <div className="chl__track" aria-hidden>
                <div className="chl__hitline" />
                {markers.map((marker) => (
                  <div
                    key={marker.index}
                    className={cx(
                      'chl__marker',
                      isAccentBeat(marker.index) && 'is-accent',
                      marker.grade === 'miss' && 'is-missed',
                      (marker.grade === 'perfect' || marker.grade === 'good') && 'is-hit',
                    )}
                    style={{
                      left: `${Math.max(0, Math.min(100, HIT_LINE_PCT + (100 - HIT_LINE_PCT) * (1 - marker.progress)))}%`,
                    }}
                  />
                ))}
              </div>
              <p className="chl__combo">
                <span className="chl__combo-value">{state?.combo ?? 0}</span>
                连击
                {judgeText ? (
                  <span
                    className={cx('chl__judge', judge?.grade === 'perfect' && !judge.stray && 'is-perfect')}
                  >
                    {judgeText}
                  </span>
                ) : null}
              </p>
            </>
          ) : (
            <>
              <p className="chl__headline">这一轮结束了</p>
              <div className="chl__result">
                <span>
                  完美 <span className="chl__result-value">{result?.perfect ?? 0}</span>
                </span>
                <span>
                  不错 <span className="chl__result-value">{result?.good ?? 0}</span>
                </span>
                <span>
                  没跟上 <span className="chl__result-value">{result?.miss ?? 0}</span>
                </span>
                <span>
                  最高连击 <span className="chl__result-value">{result?.maxCombo ?? 0}</span>
                </span>
                <span>
                  准确率{' '}
                  <span className="chl__result-value">
                    {Math.round((result?.accuracy ?? 0) * 100)}%
                  </span>
                </span>
              </div>
              <div className="chl__results" aria-hidden>
                {judgedGrades.map((grade, index) => (
                  <span
                    key={index}
                    className={cx('chl__dot', grade !== null && grade !== 'miss' && 'is-on')}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="chl__keyboard">
          <PianoKeyboard
            size={settings.keyboardSize}
            showNoteNames={settings.showNoteNames}
            onNoteOn={onNoteOn}
          />
        </div>
      </main>

      <footer className="chl__bottom">
        <div className="chl__speed" role="group" aria-label="速度">
          {SPEED_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cx('chl__speed-btn', bpm === option.value && 'is-active')}
              onClick={() => setBpm(option.value)}
              disabled={phase === 'playing'}
            >
              {option.label}
            </button>
          ))}
        </div>
        {phase === 'playing' ? null : (
          <button type="button" className="ui-btn ui-btn--primary ui-btn--lg" onClick={handleStart}>
            {phase === 'done' ? '再玩一次' : '开始'}
          </button>
        )}
      </footer>
    </div>
  );
}
