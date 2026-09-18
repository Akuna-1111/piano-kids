import { describe, expect, it } from 'vitest';
import { createDefaultProgress, type AppProgress, type PracticeResult } from './progressTypes';
import {
  addDaysToKey,
  computeStars,
  recordPracticeResult,
  toLocalDateKey,
  updateStreak,
} from './recordPracticeResult';

function makeResult(overrides: Partial<PracticeResult> = {}): PracticeResult {
  return {
    songId: 'twinkle-star',
    accuracy: 95,
    pitchScore: 95,
    timingScore: 95,
    correctNotes: 48,
    wrongNotes: 0,
    totalNotesPlayed: 48,
    durationMs: 60_000,
    completed: true,
    perfectRun: true,
    completedAfterMistake: false,
    maxCombo: 48,
    ...overrides,
  };
}

/** 用固定日期跑一次结算，避免测试受「今天」影响。 */
const DAY1 = new Date(2025, 4, 10, 10, 0, 0);
const DAY2 = new Date(2025, 4, 11, 10, 0, 0);
/** 距离上次练习中断了 3 天 */
const GAP_DAY = new Date(2025, 4, 15, 10, 0, 0);

describe('recordPracticeResult —— 事务式结算', () => {
  it('星星规则：<70 → 1，70–89 → 2，≥90 → 3（文档 8.4）', () => {
    expect(computeStars(0)).toBe(1);
    expect(computeStars(69)).toBe(1);
    expect(computeStars(70)).toBe(2);
    expect(computeStars(89)).toBe(2);
    expect(computeStars(90)).toBe(3);
  });

  it('文档 20.1：songsCompleted 必须累加，而不是长期停在 1', () => {
    let progress = createDefaultProgress();
    for (let i = 0; i < 3; i += 1) {
      progress = recordPracticeResult(progress, makeResult(), DAY1).progress;
    }
    expect(progress.stats.songsCompleted).toBe(3);
    expect(progress.stats.songsStarted).toBe(3);
  });

  it('文档 20.2：bestAccuracy 与历史值比较，不是 Math.max(accuracy, 0)', () => {
    let progress = createDefaultProgress();
    progress = recordPracticeResult(progress, makeResult({ accuracy: 88 }), DAY1).progress;
    progress = recordPracticeResult(progress, makeResult({ accuracy: 61 }), DAY2).progress;
    expect(progress.stats.bestAccuracy).toBe(88);
    expect(progress.bestAccuracyBySong['twinkle-star']).toBe(88);

    const better = recordPracticeResult(
      progress,
      makeResult({ accuracy: 92 }),
      new Date(2025, 4, 12),
    );
    expect(better.reward.isNewBest).toBe(true);
    expect(better.progress.stats.bestAccuracy).toBe(92);
  });

  it('文档 20.3 + 10.5：完成页拿到的就是最终结果，皮肤在同一个事务里解锁', () => {
    const progress = createDefaultProgress();
    const { progress: next, reward } = recordPracticeResult(progress, makeResult(), DAY1);

    // 刚弹完《小星星》，森林皮肤立刻解锁 —— 不需要等下一次状态变化
    expect(reward.newlyUnlockedSkinIds).toContain('forest');
    expect(next.unlockedSkinIds).toContain('forest');
    expect(reward.starsEarned).toBe(3);
    expect(reward.totalStars).toBe(3);
    expect(reward.newlyUnlockedAchievementIds).toContain('first-song');
    expect(reward.newlyUnlockedAchievementIds).toContain('first-perfect');
  });

  it('文档 20.4：指定曲目解锁必须精确判断，弹别的歌不算', () => {
    const progress = createDefaultProgress();
    const first = recordPracticeResult(progress, makeResult({ songId: 'mary-lamb' }), DAY1);
    // forest 的条件是「完整弹完《小星星》」，弹完《玛丽有只小羊羔》不应命中
    expect(first.reward.newlyUnlockedSkinIds).not.toContain('forest');
    expect(first.progress.completedSongIds).toEqual(['mary-lamb']);
    expect(first.progress.stats.songsCompleted).toBe(1);
    expect(first.progress.unlockedSkinIds).not.toContain('forest');

    const second = recordPracticeResult(
      first.progress,
      makeResult({ songId: 'twinkle-star' }),
      DAY1,
    );
    expect(second.reward.newlyUnlockedSkinIds).toContain('forest');
    expect(second.progress.completedSongIds).toEqual(['mary-lamb', 'twinkle-star']);
  });

  it('星星是累计成长值，解锁皮肤不会消耗星星（文档 8.4 / 10.1）', () => {
    let progress: AppProgress = createDefaultProgress();
    let total = 0;
    for (let i = 0; i < 4; i += 1) {
      const outcome = recordPracticeResult(progress, makeResult({ accuracy: 95 }), DAY1);
      progress = outcome.progress;
      total += 3;
      expect(progress.starsTotal).toBe(total); // 一直等于累计值
    }
    expect(progress.starsTotal).toBe(12);
    expect(progress.unlockedSkinIds).toContain('star'); // 累计 10 颗时自动解锁
    expect(progress.starsTotal).toBeGreaterThanOrEqual(10); // 解锁没有扣掉星星
  });

  it('累计星星会解锁对应皮肤，且不会重复解锁', () => {
    let progress = createDefaultProgress();
    const newly: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      const outcome = recordPracticeResult(
        progress,
        makeResult({ songId: `song-${i}` }),
        DAY1,
      );
      progress = outcome.progress;
      newly.push(...outcome.reward.newlyUnlockedSkinIds);
    }
    expect(newly).toContain('star'); // 10 颗
    expect(newly).toContain('candy'); // 30 颗
    expect(new Set(newly).size).toBe(newly.length); // 没有重复
    expect(progress.unlockedSkinIds).toEqual([...new Set(progress.unlockedSkinIds)]);
  });

  it('准确率类解锁：单曲达到 90% 解锁水晶，并写入该曲最好成绩', () => {
    const progress = createDefaultProgress();
    const { progress: next, reward } = recordPracticeResult(
      progress,
      makeResult({ accuracy: 91 }),
      DAY1,
    );
    expect(reward.newlyUnlockedSkinIds).toContain('crystal');
    expect(next.bestAccuracyBySong['twinkle-star']).toBe(91);
  });

  it('文档 20.5 + 10.4：persistence 类型不写死 false，走成就表', () => {
    const progress = createDefaultProgress();
    const { progress: next, reward } = recordPracticeResult(
      progress,
      makeResult({ wrongNotes: 2, perfectRun: false, completedAfterMistake: true }),
      DAY1,
    );
    expect(reward.newlyUnlockedAchievementIds).toContain('comeback');
    // 成就在同一事务内先于皮肤判定，因此勇气皮肤当场解锁
    expect(reward.newlyUnlockedSkinIds).toContain('courage');
    expect(next.achievements).toContain('comeback');
  });

  it('未完整弹完不发星星，但统计仍然记录（不惩罚，也不虚报）', () => {
    const progress = createDefaultProgress();
    const { progress: next, reward } = recordPracticeResult(
      progress,
      makeResult({
        completed: false,
        perfectRun: false,
        correctNotes: 10,
        wrongNotes: 1,
        totalNotesPlayed: 11,
        songId: 'mary-lamb',
      }),
      DAY1,
    );
    expect(reward.starsEarned).toBe(0);
    expect(next.starsTotal).toBe(0);
    expect(next.completedSongIds).toEqual([]);
    expect(next.stats.songsCompleted).toBe(0);
    expect(next.stats.songsStarted).toBe(1);
    expect(next.stats.totalNotesPlayed).toBe(11);
    expect(next.bestAccuracyBySong['mary-lamb']).toBe(95);
  });

  it('完成同一首歌多次不会重复累加 completedSongIds', () => {
    let progress = createDefaultProgress();
    progress = recordPracticeResult(progress, makeResult(), DAY1).progress;
    progress = recordPracticeResult(progress, makeResult(), DAY1).progress;
    expect(progress.completedSongIds).toEqual(['twinkle-star']);
    expect(progress.stats.songsCompleted).toBe(2);
  });

  it('不修改传入的 progress（纯函数，方便回滚与测试）', () => {
    const progress = createDefaultProgress();
    const snapshot = JSON.stringify(progress);
    recordPracticeResult(progress, makeResult(), DAY1);
    expect(JSON.stringify(progress)).toBe(snapshot);
  });

  it('返回的 progress 与 reward 自洽', () => {
    const { progress, reward } = recordPracticeResult(createDefaultProgress(), makeResult(), DAY1);
    expect(reward.totalStars).toBe(progress.starsTotal);
    expect(reward.streakDays).toBe(progress.streak.currentDays);
    for (const id of reward.newlyUnlockedSkinIds) {
      expect(progress.unlockedSkinIds).toContain(id);
    }
    for (const id of reward.newlyUnlockedAchievementIds) {
      expect(progress.achievements).toContain(id);
    }
  });
});

describe('连续练习（文档 10.7）', () => {
  it('本地自然日 key 不受时区影响', () => {
    expect(toLocalDateKey(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(toLocalDateKey(new Date(2025, 11, 31, 23, 59))).toBe('2025-12-31');
  });

  it('日期 key 可以正确加减天数', () => {
    expect(addDaysToKey('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDaysToKey('2024-02-28', 1)).toBe('2024-02-29'); // 闰年
    expect(addDaysToKey('2025-03-01', -1)).toBe('2025-02-28');
  });

  it('第一次练习 → 1 天', () => {
    const streak = updateStreak({ currentDays: 0, longestDays: 0, lastPracticeDate: null }, '2025-05-10');
    expect(streak.currentDays).toBe(1);
    expect(streak.lastPracticeDate).toBe('2025-05-10');
  });

  it('昨天练过 → +1；今天已经练过 → 不重复增加', () => {
    const first = updateStreak(
      { currentDays: 3, longestDays: 3, lastPracticeDate: '2025-05-09' },
      '2025-05-10',
    );
    expect(first.currentDays).toBe(4);

    const sameDay = updateStreak(first, '2025-05-10');
    expect(sameDay.currentDays).toBe(4);
  });

  it('断档超过一天 → 重置为 1，但最长记录保留', () => {
    const streak = updateStreak(
      { currentDays: 6, longestDays: 6, lastPracticeDate: '2025-05-10' },
      '2025-05-13',
    );
    expect(streak.currentDays).toBe(1);
    expect(streak.longestDays).toBe(6);
  });

  it('连续三天会同时解锁成就与火焰皮肤', () => {
    let progress = createDefaultProgress();
    for (const day of [DAY1, DAY2, new Date(2025, 4, 12)]) {
      progress = recordPracticeResult(progress, makeResult(), day).progress;
    }
    expect(progress.streak.currentDays).toBe(3);
    expect(progress.achievements).toContain('streak-3');
    expect(progress.unlockedSkinIds).toContain('fire');
  });

  it('中断一天后连续天数归 1，皮肤不会因此被收回', () => {
    let progress = createDefaultProgress();
    for (const day of [DAY1, DAY2, new Date(2025, 4, 12)]) {
      progress = recordPracticeResult(progress, makeResult(), day).progress;
    }
    const after = recordPracticeResult(progress, makeResult(), GAP_DAY).progress;
    expect(after.streak.currentDays).toBe(1);
    expect(after.streak.longestDays).toBe(3);
    expect(after.unlockedSkinIds).toContain('fire');
  });
});
