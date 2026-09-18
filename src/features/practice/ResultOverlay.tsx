import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audioEngine } from '@/core/audio/AudioEngine';
import type { RewardResult } from '@/core/progress/progressTypes';
import { getAchievementById } from '@/features/achievements/achievements';
import { getSkinById } from '@/features/skins/skins';
import { SkinSample } from '@/features/skins/SkinSample';
import { getSkinTheme } from '@/features/skins/skinThemes';
import type { Song } from '@/features/songs/types';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import {
  hasPlayableRecording,
  startRecordingPlayback,
  type Recording,
  type RecordingPlayback,
} from './recording';
import { formatDuration, starsForAccuracy, type ScoreBreakdown } from './scoring';

export interface SessionOutcome {
  breakdown: ScoreBreakdown;
  reward: RewardResult;
  durationMs: number;
}

export interface ResultOverlayProps {
  song: Song;
  outcome: SessionOutcome;
  nextSong: Song;
  /** 本次演奏的录音；没有可回放的音时传 null */
  recording?: Recording | null;
  onRetry: () => void;
  onNextSong: () => void;
  onExit: () => void;
  onWardrobe: () => void;
}

/**
 * 完成页（开发规划 4.3）。
 *
 * **只回答三个问题**，一屏之内说完，别的一个字都不加：
 *
 * ```text
 * 我弹完了吗     → 完成啦！ + ★★★
 * 我表现怎么样   → 92% 准确率 · 用时 01:32   （一行，不做成大号数字面板）
 * 我解锁了什么   → 获得 N 颗星星 / 新解锁 · XX 琴键 / 新勋章 · XX
 * ```
 *
 * ⚠️ 这一页是**反复精简**过的，加东西之前先读这段：
 *
 * - **不写歌名**：孩子刚刚弹完，再告诉他一次弹的是哪首没有信息量
 * - **不把准确率/用时做成大号数字面板**：那是「考试报告」的视觉语言（4.3 明确避免），
 *   而且星星已经回答了「我表现怎么样」
 * - **不做勋章 pill 墙**：§3.3 禁止「游戏商城式 Badge 墙」。有就拿一句话说出来
 * - **解锁只用一行**：§12.3「解锁信息只需要一句话」，且只做一次完整反馈
 * - 皮肤仍然用**材质本身**表达，不用徽章符号（§46、§12.1）
 */
export function ResultOverlay({
  song,
  outcome,
  nextSong,
  recording = null,
  onRetry,
  onNextSong,
  onExit,
  onWardrobe,
}: ResultOverlayProps) {
  const { breakdown, reward, durationMs } = outcome;
  const stars = starsForAccuracy(breakdown.accuracy);

  // 星星逐颗出现，节奏放慢，让成长被「看见」（状态反馈 300–700ms）
  const [visibleStars, setVisibleStars] = useState(0);
  useEffect(() => {
    setVisibleStars(0);
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setVisibleStars(index);
      if (index >= stars) clearInterval(timer);
    }, 340);
    return () => clearInterval(timer);
  }, [stars]);

  // ------------------------------------------------------------ 听我弹的

  const [playing, setPlaying] = useState(false);
  const playbackRef = useRef<RecordingPlayback | null>(null);

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    setPlaying(false);
  }, []);

  // 离开完成页（点了再弹一次 / 下一首 / 回首页）时必须停掉，否则声音会跟着走
  useEffect(() => stopPlayback, [stopPlayback]);

  const togglePlayback = useCallback(() => {
    if (playbackRef.current) {
      stopPlayback();
      return;
    }
    if (!recording || !hasPlayableRecording(recording)) return;
    // 与「听一遍」同一个约定：不检查 ensureReady 的返回值。
    // 拿不到音频时静默降级（按钮照样走完一轮），而不是留一个点了没反应的按钮。
    void audioEngine.ensureReady().then(() => {
      playbackRef.current = startRecordingPlayback(recording, { onFinish: stopPlayback });
      setPlaying(true);
    });
  }, [recording, stopPlayback]);

  const canReplay = recording !== null && hasPlayableRecording(recording);

  const unlockedSkins = useMemo(
    () =>
      reward.newlyUnlockedSkinIds
        .map((id) => getSkinById(id))
        .filter((skin): skin is NonNullable<typeof skin> => Boolean(skin)),
    [reward.newlyUnlockedSkinIds],
  );

  const unlockedAchievements = useMemo(
    () =>
      reward.newlyUnlockedAchievementIds
        .map((id) => getAchievementById(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [reward.newlyUnlockedAchievementIds],
  );

  const hasSomethingNew = unlockedSkins.length > 0 || unlockedAchievements.length > 0;

  return (
    <div
      className="pp-result"
      role="dialog"
      aria-modal="true"
      aria-label={`${song.title} · 练习完成`}
    >
      <div className="pp-result__card">
        <h1 className="pp-result__title">完成啦！</h1>

        <div className="pp-result__stars" aria-label={`获得 ${stars} 颗星`}>
          {[0, 1, 2].map((index) => (
            <Icon
              key={index}
              name={index < visibleStars ? 'star-filled' : 'star'}
              size={32}
              className={cx('pp-result__star', index < visibleStars && 'is-on')}
            />
          ))}
        </div>

        {/* 我表现怎么样：一行说完，不做成大号数字面板（4.3 避免「考试报告」） */}
        <p className="pp-result__facts">
          {breakdown.accuracy}% 准确率 · 用时 {formatDuration(durationMs)}
        </p>

        {/* 我解锁了什么：每种一行，不堆 pill */}
        {reward.starsEarned > 0 ? (
          <p className="pp-result__gain">
            <Icon name="star-filled" size={16} />
            星星成长值 +{reward.starsEarned}
          </p>
        ) : null}

        {unlockedSkins.map((skin) => (
          <button
            key={skin.id}
            type="button"
            className="pp-result__unlock"
            onClick={onWardrobe}
          >
            {/* 直接展示新琴键的材质本身，而不是用一个徽章符号指代它（§46、§12.1） */}
            <span className="pp-result__unlock-sample">
              <SkinSample theme={getSkinTheme(skin.themeId)} />
            </span>
            新解锁 · {skin.name}琴键
          </button>
        ))}

        {unlockedAchievements.length > 0 ? (
          <p className="pp-result__earned">
            新勋章 · {unlockedAchievements.map((item) => item.name).join('、')}
          </p>
        ) : null}

        {!hasSomethingNew && reward.starsEarned === 0 ? (
          <p className="pp-result__facts">这一遍没有弹完，下次一定可以</p>
        ) : null}

        <div className="pp-result__actions">
          {canReplay ? (
            <button
              type="button"
              className="ui-btn pp-result__replay"
              onClick={togglePlayback}
              aria-pressed={playing}
            >
              <Icon name={playing ? 'stop' : 'play'} size={20} />
              {playing ? '停止' : '听我弹的'}
            </button>
          ) : null}
          <button type="button" className="ui-btn" onClick={onRetry}>
            再弹一次
          </button>
          <button type="button" className="ui-btn ui-btn--primary" onClick={onNextSong}>
            下一首 · {nextSong.title}
          </button>
        </div>

        <button type="button" className="ui-btn ui-btn--ghost pp-result__exit" onClick={onExit}>
          回到首页
        </button>
      </div>
    </div>
  );
}
