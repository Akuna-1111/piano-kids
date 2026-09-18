import { midiToNoteName, noteToMidi } from '@/core/audio/notes';
import { getPlayableMidi, type KeyboardSize } from '@/features/piano/pianoLayout';
import { velocityForNote } from './dynamics';
import type { ResolvedNote, ResolvedSong, Song } from './types';

/**
 * KeyboardRangeResolver（文档 7.3）
 *
 *   原始曲谱 → 键盘档位 → 实际要弹的音
 *
 * 只维护一份曲谱数据。策略分两步，避免「换个键盘就变了一首歌」：
 *  1. 整体移调：在若干个八度位移里选「落入键盘音域的音最多」的那个（并列时位移最小优先）。
 *  2. 单音吸附：仍越界的音，先尝试按八度移入音域（保持唱名不变，听感最自然），
 *     再退化为吸附到最近的、键盘上真实存在的键（8 键没有黑键时要靠这一步）。
 */

/**
 * 候选八度位移，按 |位移| 升序。
 * 顺序很关键：并列时靠 `>` 的严格比较自然保留「位移最小」的方案，
 * 否则会把整首歌无意义地移低一个八度。
 */
const OCTAVE_CANDIDATES = [0, -1, 1, -2, 2] as const;

const playableCache = new Map<KeyboardSize, Set<number>>();

function getPlayableSet(size: KeyboardSize): Set<number> {
  let cached = playableCache.get(size);
  if (!cached) {
    cached = new Set(getPlayableMidi(size));
    playableCache.set(size, cached);
  }
  return cached;
}

/** 把任意 MIDI 吸附到键盘上真实存在的键。 */
function snapToPlayable(midi: number, size: KeyboardSize): number {
  const set = getPlayableSet(size);
  if (set.has(midi)) return midi;

  const sorted = getPlayableMidi(size);
  if (sorted.length === 0) return midi;

  let best = sorted[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of sorted) {
    const distance = Math.abs(candidate - midi);
    // 同音名优先（听感上更接近原曲），其次距离最近，再次偏低
    const samePitchClass = ((candidate - midi) % 12 + 12) % 12 === 0 ? 0 : 1;
    const score = samePitchClass * 100 + distance;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

/** 尝试用纯八度位移把音放进键盘（保持唱名）。 */
function octaveFit(midi: number, size: KeyboardSize): number | null {
  const set = getPlayableSet(size);
  if (set.has(midi)) return midi;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const octave of OCTAVE_CANDIDATES) {
    if (octave === 0) continue;
    const candidate = midi + octave * 12;
    if (set.has(candidate) && Math.abs(octave) < bestDistance) {
      bestDistance = Math.abs(octave);
      best = candidate;
    }
  }
  return best;
}

interface SoundedNote {
  note: string;
  midi: number;
  beat: number;
  duration: number;
  hand?: 'left' | 'right';
  velocity?: number;
}

function soundedNotes(song: Song): SoundedNote[] {
  const result: SoundedNote[] = [];
  for (const note of song.notes) {
    if (!note.note) continue; // 休止符
    const midi = noteToMidi(note.note);
    if (midi === null) continue; // 曲谱数据异常时静默跳过，不让整首歌挂掉
    result.push({
      note: note.note,
      midi,
      beat: note.beat,
      duration: note.duration,
      hand: note.hand,
      velocity: note.velocity,
    });
  }
  return result;
}

/** 选择整体移调量：落入键盘原始音数最多；并列取位移最小的（候选表已按 |位移| 升序）。 */
export function chooseGlobalShift(midis: number[], size: KeyboardSize): number {
  const set = getPlayableSet(size);
  let bestShift = 0;
  let bestPlayable = -1;

  for (const octave of OCTAVE_CANDIDATES) {
    const shift = octave * 12;
    let playableCount = 0;
    for (const midi of midis) {
      if (set.has(midi + shift)) playableCount += 1;
    }
    // 严格大于：并列时保留先出现的（即 |位移| 更小的）
    if (playableCount > bestPlayable) {
      bestPlayable = playableCount;
      bestShift = shift;
    }
  }
  return bestShift;
}

/**
 * 把一首歌解析到指定键盘档位。
 * @param userTransposeSemitones 手动移调（八度的倍数）。**界面不暴露这个档位**：
 *   产品只提供 8 键，而实测 8 键上任何一个 ±1 八度都会让整首歌被 `octaveFit` 吸附回原位
 *   （没有第二个可行音区），按下去等于空动作。参数与单测保留，等真加了更宽的键盘再说。
 */
export function resolveSong(
  song: Song,
  size: KeyboardSize,
  userTransposeSemitones = 0,
): ResolvedSong {
  const sounded = soundedNotes(song);
  const baseShift = chooseGlobalShift(
    sounded.map((n) => n.midi),
    size,
  );
  const totalShift = baseShift + userTransposeSemitones;
  const beatsPerBar = song.beatsPerBar ?? 4;

  const notes: ResolvedNote[] = sounded.map((item) => {
    const target = item.midi + totalShift;
    const fitted = octaveFit(target, size);
    const playedMidi = fitted ?? snapToPlayable(target, size);
    const originalNote = midiToNoteName(item.midi);
    const playedNote = midiToNoteName(playedMidi);
    const resolved: ResolvedNote = {
      note: playedNote,
      originalNote,
      playedNote,
      beat: item.beat,
      duration: item.duration,
      // 重拍力度在这里落定：曲谱显式标注优先，否则按小节位置推导（dynamics.ts）
      velocity: velocityForNote(item, beatsPerBar),
      adjusted: playedMidi !== item.midi,
    };
    if (item.hand) resolved.hand = item.hand;
    return resolved;
  });

  const lastOriginal = song.notes.reduce(
    (max, note) => Math.max(max, note.beat + note.duration),
    0,
  );
  const totalBeats = Math.max(lastOriginal, 1);
  const beatSeconds = 60 / song.bpm;

  const usedNotes = Array.from(new Set(notes.map((n) => n.playedNote))).sort(
    (a, b) => (noteToMidi(a) ?? 0) - (noteToMidi(b) ?? 0),
  );

  return {
    song,
    keyboard: size,
    transposeSemitones: totalShift,
    notes,
    bpm: song.bpm,
    beatSeconds,
    totalBeats,
    totalSeconds: totalBeats * beatSeconds,
    usedNotes,
  };
}

/**
 * 该曲目在这个键盘档位上是否「完全不需要吸附」（用于给曲目打「适配」标记）。 */
export function fitsNatively(song: Song, size: KeyboardSize): boolean {
  return resolveSong(song, size).notes.every((n) => !n.adjusted);
}

export { snapToPlayable, octaveFit };
