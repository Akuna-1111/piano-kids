import { noteToMidi } from '@/core/audio/notes';
import { CONTENT_PACK_VERSION, type ContentPack, type PackNote, type PackSong } from './packTypes';

/**
 * 内容包的**防御式校验**。
 *
 * 规矩与 `progress/migrations.ts` 一致：不认识的东西**一律拒绝并说清原因**，
 * 不做「尽力而为的修补」—— 曲谱错一个音就是在教错音，宁可让家长看到一条明确的错误。
 *
 * 校验与「这个音能不能弹」是两回事：
 * - **错误**：数据本身坏了（id 不合法、bpm 越界、音符名解析不出来、拍号不递增）
 * - **警告**：数据没错，但**当前键盘**上要吸附才能弹（越界的音）—— 家长应该知道，但不拦
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const PACK_LIMITS = {
  maxSongs: 200,
  maxNotesPerSong: 800,
  maxNameLength: 40,
  maxSourceLength: 120,
  maxSubtitleLength: 60,
  minBpm: 40,
  maxBpm: 208,
  maxDurationBeats: 8,
} as const;

export interface PackValidationOk {
  ok: true;
  pack: ContentPack;
  /** 数据没问题、但值得提醒的地方 */
  warnings: string[];
}

export interface PackValidationFail {
  ok: false;
  errors: string[];
}

export type PackValidationResult = PackValidationOk | PackValidationFail;

export interface PackValidationOptions {
  /** 当前键盘上真实存在的音（MIDI）。传了就顺带检查「要不要吸附」。 */
  playableMidi?: ReadonlySet<number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return null;
  return trimmed;
}

function readOptionalText(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

function readNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

/** 校验一个音 */
function readNote(value: unknown, index: number, errors: string[]): PackNote | null {
  if (!isRecord(value)) {
    errors.push(`第 ${index + 1} 个音不是对象`);
    return null;
  }
  const note = value.note;
  if (typeof note !== 'string') {
    errors.push(`第 ${index + 1} 个音缺少 note`);
    return null;
  }
  const trimmed = note.trim();
  // 空字符串是休止符；其余必须是能解析的音名
  if (trimmed !== '' && noteToMidi(trimmed) === null) {
    errors.push(`第 ${index + 1} 个音「${trimmed}」不是合法音名`);
    return null;
  }
  const beat = readNumber(value.beat, 0, 100000);
  if (beat === null) {
    errors.push(`第 ${index + 1} 个音的 beat 不合法`);
    return null;
  }
  const duration = readNumber(value.duration, 0.0625, PACK_LIMITS.maxDurationBeats);
  if (duration === null) {
    errors.push(`第 ${index + 1} 个音的 duration 不合法（应在 1/16 – 8 拍之间）`);
    return null;
  }
  return { note: trimmed, beat, duration };
}

function readSong(value: unknown, index: number, errors: string[], warnings: string[], options: PackValidationOptions): PackSong | null {
  if (!isRecord(value)) {
    errors.push(`第 ${index + 1} 首不是对象`);
    return null;
  }
  const label = `第 ${index + 1} 首`;

  const id = typeof value.id === 'string' && ID_PATTERN.test(value.id) ? value.id : null;
  if (!id) {
    errors.push(`${label}的 id 不合法（只允许小写字母、数字、连字符，以字母或数字开头）`);
    return null;
  }
  const title = readText(value.title, PACK_LIMITS.maxNameLength);
  if (!title) {
    errors.push(`${label}（${id}）的 title 缺失或过长（≤ ${PACK_LIMITS.maxNameLength} 字）`);
    return null;
  }
  const subtitle = readOptionalText(value.subtitle, PACK_LIMITS.maxSubtitleLength);
  if (subtitle === null) {
    errors.push(`${label}（${id}）的 subtitle 过长（≤ ${PACK_LIMITS.maxSubtitleLength} 字）`);
    return null;
  }
  const bpm = readNumber(value.bpm, PACK_LIMITS.minBpm, PACK_LIMITS.maxBpm);
  if (bpm === null) {
    errors.push(`${label}（${id}）的 bpm 不合法（${PACK_LIMITS.minBpm}–${PACK_LIMITS.maxBpm}）`);
    return null;
  }

  let beatsPerBar: 3 | 4 | undefined;
  if (value.beatsPerBar !== undefined) {
    if (value.beatsPerBar !== 3 && value.beatsPerBar !== 4) {
      errors.push(`${label}（${id}）的 beatsPerBar 只能是 3 或 4`);
      return null;
    }
    beatsPerBar = value.beatsPerBar;
  }

  if (!Array.isArray(value.notes) || value.notes.length === 0) {
    errors.push(`${label}（${id}）一个音都没有`);
    return null;
  }
  if (value.notes.length > PACK_LIMITS.maxNotesPerSong) {
    errors.push(`${label}（${id}）的音数超过 ${PACK_LIMITS.maxNotesPerSong}`);
    return null;
  }

  const notes: PackNote[] = [];
  let lastBeat = -1;
  for (let i = 0; i < value.notes.length; i += 1) {
    const note = readNote(value.notes[i], i, errors);
    if (!note) continue;
    if (note.beat < lastBeat) {
      errors.push(`${label}（${id}）第 ${i + 1} 个音的 beat 比前一个音小（曲谱要按时间顺序写）`);
      continue;
    }
    lastBeat = note.beat;
    notes.push(note);
  }
  if (notes.length === 0) return null;

  if (options.playableMidi) {
    const outside = new Set<string>();
    for (const note of notes) {
      if (note.note === '') continue;
      const midi = noteToMidi(note.note);
      if (midi !== null && !options.playableMidi.has(midi)) outside.add(note.note);
    }
    if (outside.size > 0) {
      warnings.push(
        `${label}（${id}）有 ${outside.size} 个音不在当前键盘上（${[...outside].slice(0, 6).join(' ')}），弹的时候会被吸附到最近的键`,
      );
    }
  }

  const song: PackSong = { id, title, bpm, notes };
  if (subtitle) song.subtitle = subtitle;
  if (beatsPerBar !== undefined) song.beatsPerBar = beatsPerBar;
  if (typeof value.jianpu === 'string' && value.jianpu.trim().length > 0) {
    song.jianpu = value.jianpu;
  }
  return song;
}

export function validateContentPack(
  input: unknown,
  options: PackValidationOptions = {},
): PackValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(input)) return { ok: false, errors: ['内容包不是一个对象'] };

  const version = input.version;
  if (version !== undefined && version !== CONTENT_PACK_VERSION) {
    return {
      ok: false,
      errors: [`内容包版本是 ${String(version)}，这个版本的应用只认识 ${CONTENT_PACK_VERSION}`],
    };
  }

  const id = typeof input.id === 'string' && ID_PATTERN.test(input.id) ? input.id : null;
  if (!id) {
    errors.push('包的 id 不合法（只允许小写字母、数字、连字符，以字母或数字开头）');
  }
  const name = readText(input.name, PACK_LIMITS.maxNameLength);
  if (!name) errors.push(`包的 name 缺失或过长（≤ ${PACK_LIMITS.maxNameLength} 字）`);
  const source = readOptionalText(input.source, PACK_LIMITS.maxSourceLength);
  if (source === null) errors.push(`包的 source 过长（≤ ${PACK_LIMITS.maxSourceLength} 字）`);

  if (!Array.isArray(input.songs) || input.songs.length === 0) {
    errors.push('包里面一首曲子都没有');
    return { ok: false, errors };
  }
  if (input.songs.length > PACK_LIMITS.maxSongs) {
    errors.push(`曲目数量超过上限 ${PACK_LIMITS.maxSongs}`);
    return { ok: false, errors };
  }

  const songs: PackSong[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < input.songs.length; i += 1) {
    const song = readSong(input.songs[i], i, errors, warnings, options);
    if (!song) continue;
    if (seenIds.has(song.id)) {
      errors.push(`曲目 id「${song.id}」在包里重复了`);
      continue;
    }
    seenIds.add(song.id);
    songs.push(song);
  }

  if (errors.length > 0) return { ok: false, errors };
  if (songs.length === 0) return { ok: false, errors: ['包里没有任何可用的曲目'] };

  const createdAt = readNumber(input.createdAt, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const pack: ContentPack = {
    version: CONTENT_PACK_VERSION,
    id: id as string,
    name: name as string,
    createdAt,
    songs,
  };
  if (source) pack.source = source;
  return { ok: true, pack, warnings };
}
