import { describe, expect, it } from 'vitest';
import { noteToMidi } from '@/core/audio/notes';
import { getKeyboardLayout, getPlayableMidi } from '@/features/piano/pianoLayout';
import { SONGS, getSongById } from './songData';
import { chooseGlobalShift, fitsNatively, resolveSong, snapToPlayable } from './songResolver';

describe('KeyboardRangeResolver', () => {
  it('解析结果里的每个音都能在这个键盘上真实按到（文档 7.3）', () => {
    for (const song of SONGS) {
      for (const size of [8, 15, 25] as const) {
        const resolved = resolveSong(song, size);
        const layout = getKeyboardLayout(size);
        const playable = new Set([...layout.whiteKeys, ...layout.blackKeys].map((k) => k.note));
        for (const note of resolved.notes) {
          expect(playable.has(note.playedNote)).toBe(true);
        }
      }
    }
  });

  it('只在必要时才调整音高，8 键也能弹完 C 大调的儿歌', () => {
    const mary = getSongById('mary-lamb')!;
    const resolved = resolveSong(mary, 8);
    expect(resolved.notes.every((note) => !note.adjusted)).toBe(true);
    expect(fitsNatively(mary, 8)).toBe(true);
  });

  it('越界的低音按八度移入音域，保持唱名不变（比吸附到最近的键更好听）', () => {
    // 用内联曲谱，**不依赖曲库内容**：曲库本身受「8 键必须原样弹完」的约束，
    // 所以真实曲目里已经不存在这种越界低音了（见 songData.test.ts）。
    const song = {
      id: 'low-g',
      title: 'low-g',
      category: 'folk' as const,
      difficulty: 1 as const,
      bpm: 100,
      notes: [
        { note: 'C4', beat: 0, duration: 1 },
        { note: 'C4', beat: 1, duration: 1 },
        { note: 'E4', beat: 2, duration: 1 },
        { note: 'G3', beat: 3, duration: 1 },
      ],
    };
    const resolved = resolveSong(song, 8);
    // 整体移调帮不上忙（那会让 E4 越界），所以只能对这个音做八度吸附
    expect(resolved.transposeSemitones).toBe(0);
    const lowG = resolved.notes.filter((note) => note.originalNote === 'G3');
    expect(lowG).toHaveLength(1);
    expect(lowG[0].playedNote).toBe('G4');
    expect(lowG[0].adjusted).toBe(true);
  });

  it('整体移调选择「落入音域音数最多」的方案，并列时位移最小', () => {
    // 全部在 C4–C5 内：不需要任何移调
    expect(chooseGlobalShift([60, 62, 64], 8)).toBe(0);
    // 明显偏低：整体上移一个八度
    expect(chooseGlobalShift([48, 50, 52, 53], 8)).toBe(12);
  });

  it('同一个音在更大的键盘上不会被改动', () => {
    const twinkle = getSongById('twinkle-star')!;
    for (const size of [8, 15, 25] as const) {
      const resolved = resolveSong(twinkle, size);
      expect(resolved.notes.every((note) => !note.adjusted)).toBe(true);
    }
  });

  it('用户手动移调会叠加在自动移调之上', () => {
    const twinkle = getSongById('twinkle-star')!;
    const base = resolveSong(twinkle, 25);
    const up = resolveSong(twinkle, 25, 12);
    expect(up.transposeSemitones).toBe(base.transposeSemitones + 12);
    expect(noteToMidi(up.notes[0].playedNote)! - noteToMidi(base.notes[0].playedNote)!).toBe(12);
  });

  it('键盘上有的音原样保留：8 键现在也含黑键（C4–C5 的半音）', () => {
    const playable = new Set(getPlayableMidi(8));
    for (const midi of [60, 61, 63, 66, 68, 70, 72]) {
      expect(snapToPlayable(midi, 8)).toBe(midi);
    }
    // C5 上方那个黑键（C#5 = 73）不在这块键盘里
    expect(playable.has(73)).toBe(false);
  });

  it('键盘上没有的音会吸附到真实存在的键（同音名优先，其次最近）', () => {
    const playable = new Set(getPlayableMidi(8));
    // 8 键的音域是 C4–C5：越界的音一定落到键盘上
    for (const midi of [55, 57, 58, 73, 74, 79]) {
      expect(playable.has(snapToPlayable(midi, 8))).toBe(true);
    }
    // 同音名优先：C5(72) 上方的 C6(84) 会落到 C5，而不是更近的 B4
    expect(snapToPlayable(84, 8)).toBe(72);
  });

  it('时间轴以「拍」为单位换算，总时长自洽', () => {
    const twinkle = getSongById('twinkle-star')!;
    const resolved = resolveSong(twinkle, 8);
    expect(resolved.beatSeconds).toBeCloseTo(60 / twinkle.bpm, 10);
    expect(resolved.totalBeats).toBe(48);
    expect(resolved.totalSeconds).toBeCloseTo(48 * (60 / twinkle.bpm), 6);
  });

  it('休止符 / 损坏数据不会让整首歌挂掉', () => {
    const resolved = resolveSong(
      {
        id: 'x',
        title: 'x',
        category: 'folk',
        difficulty: 1,
        bpm: 100,
        notes: [
          { note: '', beat: 0, duration: 1 },
          { note: 'C4', beat: 1, duration: 1 },
          { note: 'ZZZ', beat: 2, duration: 1 },
          { note: 'D4', beat: 3, duration: 1 },
        ],
      },
      8,
    );
    expect(resolved.notes.map((n) => n.playedNote)).toEqual(['C4', 'D4']);
    expect(resolved.totalBeats).toBe(4);
  });
});
