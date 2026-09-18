/**
 * 音符基础工具 —— 全应用唯一的「音名 ↔ MIDI ↔ 频率」转换来源。
 * 约定：使用科学音高记法，C4 = MIDI 60 = 中央 C。
 */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTER_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** 当前音域：A0(21) – C8(108)，覆盖真实钢琴 88 键。 */
export const MIDI_MIN = 21;
export const MIDI_MAX = 108;

export interface ParsedNote {
  /** 还原后的标准音名，例如 "C#4" */
  name: string;
  midi: number;
}

/**
 * 解析音名，支持 C4 / C#4 / Db4 / c#4 等写法。
 * 解析失败返回 null —— 曲谱数据损坏时不应该让整个应用崩掉。
 */
export function parseNote(input: string): ParsedNote | null {
  if (typeof input !== 'string') return null;
  const m = /^\s*([A-Ga-g])\s*([#♯b♭]?)\s*(-?\d{1,2})\s*$/.exec(input);
  if (!m) return null;

  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = Number(m[3]);

  let semitone = LETTER_SEMITONE[letter];
  if (accidental === '#' || accidental === '♯') semitone += 1;
  else if (accidental === 'b' || accidental === '♭') semitone -= 1;

  const midi = (octave + 1) * 12 + semitone;
  if (midi < MIDI_MIN || midi > MIDI_MAX) return null;

  return { name: midiToNoteName(midi), midi };
}

/** MIDI 编号 → 音名（只用升号写法，保证全应用字符串唯一）。 */
export function midiToNoteName(midi: number): string {
  const safe = Math.max(MIDI_MIN, Math.min(MIDI_MAX, Math.round(midi)));
  const name = SHARP_NAMES[safe % 12];
  const octave = Math.floor(safe / 12) - 1;
  return `${name}${octave}`;
}

/** 音名 → MIDI；失败返回 null。 */
export function noteToMidi(note: string): number | null {
  return parseNote(note)?.midi ?? null;
}

/** 十二平均律频率（A4 = 440Hz）。 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 音名 → 频率；失败返回 0（调用方应当用 parseNote 先校验曲谱）。 */
export function noteToFrequency(note: string): number {
  const midi = noteToMidi(note);
  return midi === null ? 0 : midiToFrequency(midi);
}

/** 是否黑键（用于键盘渲染判断）。 */
export function isBlackKey(note: string): boolean {
  const midi = noteToMidi(note);
  if (midi === null) return false;
  return SHARP_NAMES[midi % 12].includes('#');
}

/** 曲谱里显示给大人的另一种写法（降号），仅用于展示。 */
export function toFlatName(note: string): string {
  const midi = noteToMidi(note);
  if (midi === null) return note;
  return `${FLAT_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

/** 八度平移，越界则返回原音名。 */
export function transposeNote(note: string, semitones: number): string {
  const midi = noteToMidi(note);
  if (midi === null) return note;
  const next = midi + semitones;
  if (next < MIDI_MIN || next > MIDI_MAX) return note;
  return midiToNoteName(next);
}

/** 音名排序比较（按音高）。 */
export function compareNote(a: string, b: string): number {
  return (noteToMidi(a) ?? 0) - (noteToMidi(b) ?? 0);
}

const SOLFEGE_BY_PITCH_CLASS = ['1', '♯1', '2', '♯2', '3', '4', '♯4', '5', '♯5', '6', '♯6', '7'];

/**
 * 简谱唱名（1=do … 7=si）。
 * 中国孩子的琴谱绝大多数是简谱，比字母音名更容易对上号。
 */
export function noteToSolfege(note: string): string {
  const midi = noteToMidi(note);
  if (midi === null) return '';
  return SOLFEGE_BY_PITCH_CLASS[midi % 12];
}

const PINYIN_BY_PITCH_CLASS = [
  'do',
  '升do',
  're',
  '升re',
  'mi',
  'fa',
  '升fa',
  'sol',
  '升sol',
  'la',
  '升la',
  'si',
];

/**
 * 唱名拼音（do re mi fa sol la si）。
 *
 * 和简谱数字是同一套唱名的两种写法 —— 谱面上同时给出，
 * 孩子就能把「五线谱位置 ↔ 数字 ↔ 读音」三件事一次对上。
 * 用 sol 而不是 so，与国内教材一致。
 */
export function noteToPinyin(note: string): string {
  const midi = noteToMidi(note);
  if (midi === null) return '';
  return PINYIN_BY_PITCH_CLASS[midi % 12];
}

/** 去掉八度，只保留音名字母部分（用于大字号展示）。 */
export function noteLetter(note: string): string {
  return note.replace(/-?\d+$/, '');
}
