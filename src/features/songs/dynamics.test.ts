import { describe, expect, it } from 'vitest';
import { applyMeterDynamics, BASE_VELOCITY, meterAccent, velocityForNote } from './dynamics';
import { getSongById, SONGS } from './songData';

describe('重拍力度模型', () => {
  it('4/4：第 1 拍最强，第 3 拍次强，第 2、4 拍弱', () => {
    const accents = [0, 1, 2, 3].map((beat) => meterAccent(beat, 4));
    expect(accents[0]).toBeGreaterThan(accents[2]);
    expect(accents[2]).toBeGreaterThan(accents[1]);
    expect(accents[1]).toBe(accents[3]);
  });

  it('3/4：第 1 拍最强，第 3 拍次强，第 2 拍弱', () => {
    const accents = [0, 1, 2].map((beat) => meterAccent(beat, 3));
    expect(accents[0]).toBeGreaterThan(accents[2]);
    expect(accents[2]).toBeGreaterThan(accents[1]);
  });

  it('重拍按小节循环，跨小节后重新开始', () => {
    expect(meterAccent(4, 4)).toBe(meterAccent(0, 4));
    expect(meterAccent(7, 4)).toBe(meterAccent(3, 4));
    expect(meterAccent(3, 3)).toBe(meterAccent(0, 3));
    expect(meterAccent(0.5, 4)).toBe(meterAccent(0, 4));
  });

  it('动态范围刻意保持温和：最强与最弱之间不超过 30%', () => {
    const accents = [0, 1, 2, 3].map((beat) => meterAccent(beat, 4));
    const ratio = Math.max(...accents) / Math.min(...accents);
    expect(ratio).toBeLessThan(1.3);
    expect(ratio).toBeGreaterThan(1.15); // 但必须听得出来
  });

  it('基准力度与旧版写死的 0.78 一致，不会整体变响或变轻', () => {
    expect(BASE_VELOCITY).toBe(0.78);
    const average =
      [0, 1, 2, 3].reduce((sum, beat) => sum + velocityForNote({ beat }, 4), 0) / 4;
    expect(average).toBeGreaterThan(0.6);
    expect(average).toBeLessThan(0.9);
  });

  it('曲谱里显式写的力度优先于重拍推导', () => {
    expect(velocityForNote({ beat: 0, velocity: 0.3 }, 4)).toBe(0.5); // 被夹到下限
    expect(velocityForNote({ beat: 0, velocity: 0.65 }, 4)).toBe(0.65);
  });

  it('力度永远落在 0.5–1 的安全区间（不会突然没有声音）', () => {
    for (let beat = 0; beat < 24; beat += 0.5) {
      for (const bar of [3, 4] as const) {
        const v = velocityForNote({ beat }, bar);
        expect(v).toBeGreaterThanOrEqual(0.5);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('applyMeterDynamics 是纯函数，且给每个音都写上力度', () => {
    const song = getSongById('twinkle-star')!;
    const snapshot = JSON.stringify(song);
    const withDynamics = applyMeterDynamics(song);

    expect(JSON.stringify(song)).toBe(snapshot); // 没有改到入参
    expect(withDynamics.notes).toHaveLength(song.notes.length);
    for (const note of withDynamics.notes) {
      expect(note.velocity).toBeGreaterThan(0);
      expect(note.velocity).toBeLessThanOrEqual(1);
    }
    // 第一个音在重拍上，应该比小节里最弱的音更响
    const first = withDynamics.notes[0].velocity!;
    const fourth = withDynamics.notes[3].velocity!;
    expect(first).toBeGreaterThan(fourth);
  });

  it('每一首曲子在「听一遍」时的力度都有起伏，而不是一个音量到底', () => {
    for (const song of SONGS) {
      const velocities = song.notes
        .map((note) => velocityForNote(note, song.beatsPerBar ?? 4));
      expect(new Set(velocities).size).toBeGreaterThan(1);
    }
  });
});
