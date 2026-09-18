import { describe, expect, it } from 'vitest';
import { noteToMidi } from '@/core/audio/notes';
import { KEYBOARD_SIZES } from '@/features/piano/pianoLayout';
import {
  SONGS,
  SONG_CATEGORIES,
  getSongById,
  getSongsByCategory,
  getSongsByDifficulty,
} from './songData';
import { velocityForNote } from './dynamics';
import { fitsNatively, resolveSong } from './songResolver';

describe('曲谱数据', () => {
  it('id 唯一', () => {
    expect(new Set(SONGS.map((song) => song.id)).size).toBe(SONGS.length);
  });

  it('曲目数量足够支撑反复使用（至少 9 首）', () => {
    expect(SONGS.length).toBeGreaterThanOrEqual(9);
  });

  it('每个音名都能解析，且没有残缺数据', () => {
    for (const song of SONGS) {
      expect(song.notes.length).toBeGreaterThan(0);
      for (const note of song.notes) {
        expect(noteToMidi(note.note)).not.toBeNull();
        expect(note.duration).toBeGreaterThan(0);
        expect(note.beat).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('音符按时间顺序排列，且没有重叠（起始拍严格紧接前一个音）', () => {
    for (const song of SONGS) {
      for (let i = 1; i < song.notes.length; i += 1) {
        const prev = song.notes[i - 1];
        const current = song.notes[i];
        expect(current.beat).toBeCloseTo(prev.beat + prev.duration, 6);
      }
      expect(song.notes[0].beat).toBe(0);
    }
  });

  it('总拍数是每小节拍数的整数倍 —— 否则重拍力度会错位', () => {
    for (const song of SONGS) {
      const beatsPerBar = song.beatsPerBar ?? 4;
      const totalBeats = song.notes.reduce((sum, note) => sum + note.duration, 0);
      expect(totalBeats).toBeGreaterThan(0);
      expect(totalBeats % beatsPerBar).toBeCloseTo(0, 6);
    }
  });

  it('每小节的拍数只允许 3 或 4', () => {
    for (const song of SONGS) {
      if (song.beatsPerBar !== undefined) {
        expect([3, 4]).toContain(song.beatsPerBar);
      }
    }
  });

  it('速度在儿童可接受的范围内', () => {
    for (const song of SONGS) {
      expect(song.bpm).toBeGreaterThanOrEqual(60);
      expect(song.bpm).toBeLessThanOrEqual(160);
    }
  });

  it('每首曲子的每个音都能算出合理力度', () => {
    for (const song of SONGS) {
      const beatsPerBar = song.beatsPerBar ?? 4;
      for (const note of song.notes) {
        const velocity = velocityForNote(note, beatsPerBar);
        expect(velocity).toBeGreaterThanOrEqual(0.5);
        expect(velocity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('至少一半的曲目能在最小键盘（8 键）上原调弹完', () => {
    const nativeCount = SONGS.filter((song) => fitsNatively(song, 8)).length;
    expect(nativeCount).toBeGreaterThanOrEqual(Math.ceil(SONGS.length / 2));
  });

  it('每首曲子在每一档键盘上都能解析出可弹的音（换键盘不会让曲子失效）', () => {
    for (const song of SONGS) {
      for (const size of KEYBOARD_SIZES) {
        const resolved = resolveSong(song, size);
        expect(resolved.notes.length).toBe(song.notes.length);
        expect(resolved.totalSeconds).toBeGreaterThan(1);
        expect(resolved.usedNotes.length).toBeGreaterThan(0);
        for (const note of resolved.notes) {
          expect(note.playedNote).toBeTruthy();
        }
      }
    }
  });

  it('每首曲目都能在当前的键盘档位上整首放进去（不靠单音吸附改变旋律轮廓）', () => {
    // 产品只有一个档位，所以这条是**曲目数据的硬门槛**：
    // 整体移调（整首歌同一个位移）允许，单音被吸附则会让旋律轮廓变形。
    const broken: string[] = [];
    for (const song of SONGS) {
      for (const size of KEYBOARD_SIZES) {
        const resolved = resolveSong(song, size);
        let snapped = 0;
        for (const note of resolved.notes) {
          const original = noteToMidi(note.originalNote);
          const played = noteToMidi(note.playedNote);
          if (original === null || played === null) continue;
          if (played !== original + resolved.transposeSemitones) snapped += 1;
        }
        if (snapped > 0) broken.push(`${song.id}@${size}键(${snapped} 个音)`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('getSongById / getSongsByDifficulty 行为正确', () => {
    expect(getSongById('twinkle-star')?.title).toBe('小星星');
    expect(getSongById('nope')).toBeUndefined();

    const sorted = getSongsByDifficulty();
    expect(sorted).toHaveLength(SONGS.length);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i - 1].difficulty).toBeLessThanOrEqual(sorted[i].difficulty);
    }
  });

  it('曲目难度集中在入门区间（不给孩子设置陡峭曲线）', () => {
    for (const song of SONGS) {
      expect(song.difficulty).toBeGreaterThanOrEqual(1);
      expect(song.difficulty).toBeLessThanOrEqual(2);
    }
    expect(SONGS.filter((song) => song.difficulty === 1).length).toBeGreaterThanOrEqual(5);
  });

  it('每一档难度都有可选的曲子，不会出现断层', () => {
    for (const level of [1, 2] as const) {
      expect(SONGS.some((song) => song.difficulty === level)).toBe(true);
    }
  });

  it('分类齐全，且筛选结果与分类一致', () => {
    for (const category of SONG_CATEGORIES) {
      const songs = getSongsByCategory(category.id);
      expect(songs.length).toBeGreaterThan(0);
      for (const song of songs) {
        expect(song.category).toBe(category.id);
      }
    }
    expect(getSongsByCategory('all')).toHaveLength(SONGS.length);
  });

  it('每首曲子的标题与副标题都不为空，方便孩子认歌', () => {
    for (const song of SONGS) {
      expect(song.title.trim().length).toBeGreaterThan(0);
      expect((song.subtitle ?? '').trim().length).toBeGreaterThan(0);
    }
  });

  it('同一首曲子的音域跨度不会大到要来回八度吸附', () => {
    for (const song of SONGS) {
      const midis = song.notes.map((note) => noteToMidi(note.note) as number);
      const span = Math.max(...midis) - Math.min(...midis);
      // 一个八度 + 六度以内
      expect(span).toBeLessThanOrEqual(20);
    }
  });
});
