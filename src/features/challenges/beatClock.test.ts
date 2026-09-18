import { describe, expect, it } from 'vitest';
import {
  BEAT_WINDOWS,
  COUNT_IN_BEATS,
  ROUND_BEATS,
  START_DELAY_MS,
  applyTap,
  beatChallengeResult,
  createBeatChallengeState,
  expireMissedBeats,
  isAccentBeat,
  isRoundFinished,
  judgeTap,
  markerProgress,
} from './beatClock';

/**
 * 节拍挑战的时间判定。
 *
 * 这套判定的特点是**没有中间状态**：给定时间轴与按键时刻，结果只有一个。
 * 所以这里全部用 60 BPM（一拍正好 1000ms）把边界值写死 ——
 * 判定窗是孩子能不能过关的关键参数，含糊的测试等于没测。
 */
const BPM = 60;
const BEAT_MS = 1000;

function stateAt(nowMs = 1000) {
  return createBeatChallengeState({ bpm: BPM, nowMs });
}

describe('节拍挑战 · 时间轴', () => {
  it('起点留出调度余量，间隔由 BPM 决定', () => {
    const state = stateAt(1000);
    expect(state.startMs).toBe(1000 + START_DELAY_MS);
    expect(state.beatMs).toBeCloseTo(BEAT_MS, 9);
    expect(state.beatTimesMs).toHaveLength(COUNT_IN_BEATS + ROUND_BEATS);
    expect(state.beatTimesMs[1] - state.beatTimesMs[0]).toBeCloseTo(BEAT_MS, 9);
  });

  it('每小节第一拍是重拍（预备拍也照小节算，孩子才听得出四拍一组）', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(isAccentBeat)).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it('marker 提前 leadBeats 拍出现，正点压在判定线上', () => {
    const state = stateAt(1000);
    const first = state.beatTimesMs[COUNT_IN_BEATS];
    expect(markerProgress(first - 2 * BEAT_MS, first, BEAT_MS)).toBeCloseTo(0, 9);
    expect(markerProgress(first, first, BEAT_MS)).toBeCloseTo(1, 9);
    expect(markerProgress(first - BEAT_MS, first, BEAT_MS)).toBeCloseTo(0.5, 9);
  });
});

describe('节拍挑战 · 判定', () => {
  it('正中拍点是完美，窗口边界值分毫不差', () => {
    const state = stateAt();
    const first = state.beatTimesMs[COUNT_IN_BEATS];
    expect(judgeTap(state, first).grade).toBe('perfect');
    expect(judgeTap(state, first - BEAT_WINDOWS.perfectMs).grade).toBe('perfect');
    expect(judgeTap(state, first + BEAT_WINDOWS.perfectMs).grade).toBe('perfect');
    expect(judgeTap(state, first + BEAT_WINDOWS.perfectMs + 1).grade).toBe('good');
    expect(judgeTap(state, first + BEAT_WINDOWS.goodMs).grade).toBe('good');
    expect(judgeTap(state, first + BEAT_WINDOWS.goodMs + 1).beatIndex).toBeNull();
  });

  it('早按也算，差值带符号（页面要告诉孩子「早了/晚了」）', () => {
    const state = stateAt();
    const first = state.beatTimesMs[COUNT_IN_BEATS];
    expect(judgeTap(state, first - 50).deltaMs).toBe(-50);
    expect(judgeTap(state, first + 50).deltaMs).toBe(50);
  });

  it('预备拍不参与判定：那几拍上按下去只会算「多按」', () => {
    const state = stateAt();
    const countInBeat = state.beatTimesMs[1];
    // 距第一正式拍还有 3 拍，远在窗口外
    const judgement = judgeTap(state, countInBeat);
    expect(judgement.beatIndex).toBeNull();

    const after = applyTap(state, countInBeat);
    expect(after.extraTaps).toBe(1);
    expect(after.grades.every((grade) => grade === null)).toBe(true);
    expect(after.combo).toBe(0);
  });

  it('已经判过的拍不会被第二次按到（连点两下不会都算命中）', () => {
    const state = stateAt();
    const first = state.beatTimesMs[COUNT_IN_BEATS];
    const once = applyTap(state, first);
    const twice = applyTap(once, first + 10);
    expect(twice.grades[COUNT_IN_BEATS]).toBe('perfect');
    // 第二下找不到未判定的附近拍点 → 多按
    expect(twice.extraTaps).toBe(1);
    expect(twice.maxCombo).toBe(1);
  });

  it('多按不扣分、也不打断连击（孩子乱按不该被惩罚）', () => {
    const state = stateAt();
    let current = applyTap(state, state.beatTimesMs[COUNT_IN_BEATS]);
    current = applyTap(current, current.beatTimesMs[COUNT_IN_BEATS + 1]);
    current = applyTap(current, current.beatTimesMs[COUNT_IN_BEATS + 1] + 500); // 拍与拍中间的乱按
    current = applyTap(current, current.beatTimesMs[COUNT_IN_BEATS + 2]);
    expect(current.combo).toBe(3);
    expect(current.extraTaps).toBe(1);
  });

  it('过了窗口还没按 = 没跟上，连击归零；重复调用不会重复记', () => {
    const state = stateAt();
    const first = state.beatTimesMs[COUNT_IN_BEATS];
    const hit = applyTap(state, first);
    const expired = expireMissedBeats(hit, first + BEAT_MS + BEAT_WINDOWS.goodMs + 1);
    expect(expired.grades[COUNT_IN_BEATS + 1]).toBe('miss');
    expect(expired.combo).toBe(0);
    // 幂等
    const again = expireMissedBeats(expired, first + BEAT_MS + BEAT_WINDOWS.goodMs + 1);
    expect(again).toBe(expired);
  });

  it('结束判定：全部判完，或最后一拍窗口也过去了', () => {
    const state = stateAt();
    expect(isRoundFinished(state, state.beatTimesMs[0])).toBe(false);
    const last = state.beatTimesMs[state.beatTimesMs.length - 1];
    expect(isRoundFinished(state, last + BEAT_WINDOWS.goodMs + 1)).toBe(true);

    let allHit = state;
    for (let index = COUNT_IN_BEATS; index < state.beatTimesMs.length; index += 1) {
      allHit = applyTap(allHit, allHit.beatTimesMs[index]);
    }
    expect(isRoundFinished(allHit, allHit.beatTimesMs[0])).toBe(true);
  });
});

describe('节拍挑战 · 结算', () => {
  it('只统计正式拍：完美 / 不错 / 没跟上 + 最高连击', () => {
    let state = stateAt();
    const times = state.beatTimesMs;
    // 第 1 拍完美、第 2 拍不错（偏 100ms）、第 3 拍没跟上、其余完美
    state = applyTap(state, times[COUNT_IN_BEATS]);
    state = applyTap(state, times[COUNT_IN_BEATS + 1] + 100);
    state = expireMissedBeats(state, times[COUNT_IN_BEATS + 2] + BEAT_WINDOWS.goodMs + 1);
    for (let index = COUNT_IN_BEATS + 3; index < times.length; index += 1) {
      state = applyTap(state, times[index]);
    }
    const result = beatChallengeResult(state);
    expect(result.perfect).toBe(ROUND_BEATS - 2);
    expect(result.good).toBe(1);
    expect(result.miss).toBe(1);
    expect(result.accuracy).toBeCloseTo((14 + 0.6) / 16, 9);
    expect(result.stars).toBe(3);
    expect(result.maxCombo).toBe(13); // 第 3 拍断了，之后连着 13 拍
  });

  it('星星分档与跟弹模式同口径', () => {
    const score = (perfect: number) => {
      let state = stateAt();
      for (let index = 0; index < COUNT_IN_BEATS + ROUND_BEATS; index += 1) {
        if (index - COUNT_IN_BEATS < perfect) state = applyTap(state, state.beatTimesMs[index]);
      }
      return beatChallengeResult(expireMissedBeats(state, Number.MAX_SAFE_INTEGER)).stars;
    };
    expect(score(16)).toBe(3);
    expect(score(15)).toBe(3); // 15/16 = 0.94
    expect(score(12)).toBe(2); // 0.75
    expect(score(7)).toBe(1); // 0.44
    expect(score(4)).toBe(0); // 0.25
  });
});
