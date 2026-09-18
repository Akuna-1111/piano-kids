import { beforeEach, describe, expect, it } from 'vitest';
import { saveContentPacks } from '@/core/content/packStorage';
import { CONTENT_PACK_VERSION, packSongId, type ContentPack } from '@/core/content/packTypes';
import { findSongById, loadPackSongs, packSongToSong } from './packSongs';

/**
 * 内容包 → 曲库 的接入契约（AGENTS §16）。
 *
 * 最要紧的一条是 **id 前缀**：`bestAccuracyBySong` 按曲目 id 存历史成绩，
 * 导入曲目不带包前缀就会和内置曲目（或另一个包里的同名曲子）串成绩。
 */
const sample: ContentPack = {
  version: CONTENT_PACK_VERSION,
  id: 'my-book',
  name: '第 1 册上',
  createdAt: 1,
  songs: [
    {
      id: 'mo-li-hua',
      title: '茉莉花',
      bpm: 76,
      beatsPerBar: 4,
      notes: [
        { note: 'E4', beat: 0, duration: 1 },
        { note: '', beat: 1, duration: 1 },
        { note: 'G4', beat: 2, duration: 2 },
      ],
    },
  ],
};

describe('内容包接入曲库', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('导入曲目的 id 一定带包前缀（历史成绩不会串曲）', () => {
    const song = packSongToSong(sample, sample.songs[0]);
    expect(song.id).toBe('my-book:mo-li-hua');
    expect(packSongId('my-book', 'mo-li-hua')).toBe(song.id);
    expect(song.category).toBe('pack');
  });

  it('难度由数据推出来（内容包不带这个字段）', () => {
    const short = packSongToSong(sample, sample.songs[0]);
    expect(short.difficulty).toBe(1);

    const wide: ContentPack = {
      ...sample,
      songs: [
        {
          ...sample.songs[0],
          notes: Array.from({ length: 80 }, (_, index) => ({
            note: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'][index % 8],
            beat: index,
            duration: 1,
          })),
        },
      ],
    };
    expect(packSongToSong(wide, wide.songs[0]).difficulty).toBe(3);
  });

  it('查找顺序：内置曲库优先，导入曲目靠前缀命中', () => {
    saveContentPacks([sample]);

    // 内置
    expect(findSongById('twinkle-star')?.title).toBe('小星星');
    // 导入
    expect(findSongById('my-book:mo-li-hua')?.title).toBe('茉莉花');
    // 找不到
    expect(findSongById('nope')).toBeUndefined();
    expect(findSongById(undefined)).toBeUndefined();
    expect(findSongById(null)).toBeUndefined();
  });

  it('没有内容包时，曲库就只有内置的 9 首（不会凭空多出分类）', () => {
    expect(loadPackSongs()).toEqual([]);
    expect(findSongById('twinkle-star')?.title).toBe('小星星');
  });

  it('读的时候不修改内容包（只读快照）', () => {
    saveContentPacks([sample]);
    const before = localStorage.getItem('piano_app_packs_v1');
    loadPackSongs();
    findSongById('my-book:mo-li-hua');
    expect(localStorage.getItem('piano_app_packs_v1')).toBe(before);
  });
});
