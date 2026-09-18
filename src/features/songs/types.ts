import type { KeyboardSize } from '@/features/piano/pianoLayout';

/** 歌曲数据模型（对应文档 7.1 / 7.2）。 */

/**
 * 曲目分类。`pack` = 用户自己导入的曲目（内容包），
 * **不写进 `SONG_CATEGORIES`** —— 那一份是内置曲库的分类表，
 * 导入分类只在真的有导入曲目时才出现在筛选里（见 SongListPage）。
 */
export type SongCategory = 'folk' | 'classic' | 'english' | 'festival' | 'pack';

export type Difficulty = 1 | 2 | 3;

export interface SongNote {
  /** 音名，例如 "C4"。空字符串表示休止符。 */
  note: string;
  /** 起始位置，单位「拍」（0 起） */
  beat: number;
  /** 时长，单位「拍」 */
  duration: number;
  hand?: 'left' | 'right';
  velocity?: number;
}

export interface SongTranspose {
  id: string;
  label: string;
  semitones: number;
}

export interface Song {
  id: string;
  title: string;
  /** 副标题 / 歌词首句，帮助孩子认歌 */
  subtitle?: string;
  category: SongCategory;
  difficulty: Difficulty;
  bpm: number;
  /** 每小节几拍。用于按小节位置推导重拍力度，默认 4/4。 */
  beatsPerBar?: 3 | 4;
  /** 原始旋律，只保存一份；实际要弹的音由 resolver 推导（文档 7.3） */
  notes: SongNote[];
  transpositions?: SongTranspose[];
}

/** 解析后的音符：把「曲谱上的音」与「孩子实际要按的键」分开。 */
export interface ResolvedNote extends SongNote {
  /** 一定在键盘范围内、且键盘上真实存在的音 */
  playedNote: string;
  /** 曲谱原始音 */
  originalNote: string;
  /** 是否经过整体移调 / 单音八度吸附 */
  adjusted: boolean;
}

export interface ResolvedSong {
  song: Song;
  keyboard: KeyboardSize;
  /** 整体移调量（半音） */
  transposeSemitones: number;
  notes: ResolvedNote[];
  bpm: number;
  /** 一拍多少秒 */
  beatSeconds: number;
  totalBeats: number;
  totalSeconds: number;
  /** 该曲目用到的键（去重、按音高排序），用于练习页提示键位范围 */
  usedNotes: string[];
}
