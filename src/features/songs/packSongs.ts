import { loadContentPacks } from '@/core/content/packStorage';
import { packSongId, type ContentPack, type PackSong } from '@/core/content/packTypes';
import { getSongById } from './songData';
import type { Song } from './types';

/**
 * 内容包 → 内置曲库的 `Song`（AGENTS §16）。
 *
 * ## 两个必须守住的东西
 *
 * 1. **id 必须带包前缀**（`packId:songId`）：`bestAccuracyBySong` 是按曲目 id 存历史成绩的，
 *    不带前缀就会和内置曲目（或另一个包的同名曲子）串成绩。
 * 2. **只读快照**：这里只做「读出来给界面用」，不写回、不修改内容包。
 *
 * 难度（`difficulty`）不写进包里 —— 那是**我们的难度轴**（音域与音数），
 * 由这里从数据推出来，家长不需要填。
 */

/** 按音数与音域跨度推难度（内容包不带这个字段） */
function deriveDifficulty(song: PackSong): 1 | 2 | 3 {
  const midis = song.notes
    .map((note) => (note.note ? note.note : null))
    .filter((note): note is string => note !== null);
  const span = new Set(midis.map((note) => note.replace(/\d/g, ''))).size;
  if (song.notes.length <= 24 && span <= 5) return 1;
  if (song.notes.length <= 64 && span <= 7) return 2;
  return 3;
}

export function packSongToSong(pack: ContentPack, song: PackSong): Song {
  const result: Song = {
    id: packSongId(pack.id, song.id),
    title: song.title,
    category: 'pack',
    difficulty: deriveDifficulty(song),
    bpm: song.bpm,
    notes: song.notes.map((note) => ({ note: note.note, beat: note.beat, duration: note.duration })),
  };
  if (song.subtitle) result.subtitle = song.subtitle;
  if (song.beatsPerBar !== undefined) result.beatsPerBar = song.beatsPerBar;
  return result;
}

/** 本机所有导入曲目（按包顺序，包内按原顺序） */
export function loadPackSongs(): Song[] {
  const { packs } = loadContentPacks();
  const songs: Song[] = [];
  for (const pack of packs) {
    for (const song of pack.songs) songs.push(packSongToSong(pack, song));
  }
  return songs;
}

/**
 * 按 id 找曲子：**先内置曲库，再导入曲目**。
 * 内置曲目 id 不含 `:`，导入曲目一律带包前缀，所以两者不会撞。
 */
export function findSongById(id: string | undefined | null): Song | undefined {
  if (!id) return undefined;
  // 带包前缀的一定是导入曲目，不必再查内置曲库
  if (!id.includes(':')) {
    const builtIn = getSongById(id);
    if (builtIn) return builtIn;
  }
  return loadPackSongs().find((song) => song.id === id);
}
