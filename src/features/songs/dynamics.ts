import type { Song } from './types';

/**
 * 力度模型。
 *
 * 真实演奏里没有一个音是「一样响」的：重拍强、弱拍弱，这是音乐性最廉价也最有效的来源。
 * 这里按小节位置推导力度，而不是在曲谱数据里手写每一个音的力度 ——
 * 手写 400 多个音的力度既容易出错，也无法在改速度/换拍号时保持一致。
 *
 * 注意：这**只影响「听一遍」的播放**。孩子自己弹的时候，力度来自触控（见 docs 的《触控力度评估》），
 * 而且绝不参与评分（开发规则：不给孩子无法控制的东西扣分）。
 */

/** 基准力度。与旧版 scheduler 里写死的 0.78 保持一致，避免听感整体变响或变轻。 */
export const BASE_VELOCITY = 0.78;

/**
 * 重拍倍率。
 *
 * 动态范围刻意控制在 ±20% 以内：这个量级已经能明显听出「有人在弹」，
 * 又不会让重拍显得做作。而且即使某一首曲子的小节对齐不完美，
 * 落错的「重拍」也只像人的自然力度起伏，不会变成明显的错误。
 */
const ACCENT_4_4 = [1.06, 0.84, 0.96, 0.84] as const;
const ACCENT_3_4 = [1.06, 0.84, 0.92] as const;

const MIN_VELOCITY = 0.5;
const MAX_VELOCITY = 1;

function clampVelocity(value: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, value));
}

/** 这一拍在它所在小节里的重拍倍率。 */
export function meterAccent(beat: number, beatsPerBar: 3 | 4 = 4): number {
  const accent = beatsPerBar === 3 ? ACCENT_3_4 : ACCENT_4_4;
  const raw = Math.floor(beat);
  const position = ((raw % accent.length) + accent.length) % accent.length;
  return accent[position];
}

/**
 * 一个音的最终力度。
 * 曲谱里显式写了 velocity 就以它为准（供个别需要强调的音使用），否则按重拍推导。
 */
export function velocityForNote(
  note: { beat: number; velocity?: number },
  beatsPerBar: 3 | 4 = 4,
): number {
  if (note.velocity !== undefined) return clampVelocity(note.velocity);
  return clampVelocity(BASE_VELOCITY * meterAccent(note.beat, beatsPerBar));
}

/** 给整首曲子套上重拍力度（纯函数，不改动入参）。 */
export function applyMeterDynamics(song: Song): Song {
  const beatsPerBar = song.beatsPerBar ?? 4;
  return {
    ...song,
    notes: song.notes.map((note) => ({
      ...note,
      velocity: velocityForNote(note, beatsPerBar),
    })),
  };
}
