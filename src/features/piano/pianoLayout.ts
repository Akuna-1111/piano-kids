import { midiToNoteName, noteToMidi } from '@/core/audio/notes';

/**
 * 键盘布局 —— 纯计算，不含任何 DOM。
 *
 * **产品只提供一个档位：15 键 = C3–C5（两个八度白键 + 黑键）。**
 *
 * 为什么不是 8 键（C4–C5）：钢琴课第一步教的是「**先找中央C**」，
 * 而孩子认 C 靠的是黑键分组。8 键只有一个八度，中央C 只能落在**最左边**，
 * 这会让「中央C 在键盘中间」这个最重要的空间认知从一开始就是错的。
 * 15 键下中央C 正好是第 8 个白键 = 正中间，与真琴一致。
 *
 * 代价是键宽：15 个真实尺寸白键需要 352.5mm，而 iPad 屏幕物理宽最多 263mm，
 * 所以 15 键必然被压缩（`keySize.ts` 如实算出来并在界面上带「约」字告知）。
 *
 * 布局函数对任意白键数通用（`buildKeyboardLayout(8)` 仍然能算出来），
 * 8 / 25 键的能力保留在代码里备查。
 */

export type KeyboardSize = 8 | 15 | 25;

/** **提供给用户的档位**。改这里，界面与存档会自动跟着变。 */
export const KEYBOARD_SIZES: readonly KeyboardSize[] = [15] as const;

/** 黑键宽度相对白键宽度的比例。真实钢琴约 0.58（见 keySize.ts 的 REAL_BLACK_KEY_RATIO）。 */
const BLACK_KEY_WIDTH_RATIO = 0.58;

/** 白键序号 → MIDI 半音偏移（C=0, D=2, E=4, F=5, G=7, A=9, B=11）。 */
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** 相对白键 C 的黑键半音位置：C#, D#, F#, G#, A# 落在白键 0,1,3,4,5 之后。 */
const BLACK_AFTER_WHITE_OFFSET = [0, 1, 3, 4, 5] as const;

export interface KeyLayout {
  note: string;
  midi: number;
  isBlack: boolean;
  /** 白键序号；黑键为其左侧白键的序号 */
  whiteIndex: number;
  /** 相对键盘宽度的百分比位置（0–100） */
  leftPercent: number;
  widthPercent: number;
  /** 白键上显示的音名标签（多数键为空，避免视觉噪音） */
  label: string;
}

export interface KeyboardLayout {
  size: KeyboardSize;
  whiteKeys: KeyLayout[];
  blackKeys: KeyLayout[];
  /** 可弹奏音域（MIDI） */
  minMidi: number;
  maxMidi: number;
  /** 该键盘是否出现黑键 */
  hasBlackKeys: boolean;
}

/** 每档键盘的起始白键（以 C 为起点）。 */
const SIZE_ROOTS: Record<KeyboardSize, number> = {
  8: 60, // C4
  15: 48, // C3
  25: 36, // C2
};

/** 每档键盘的白键数量。 */
const SIZE_WHITE_COUNT: Record<KeyboardSize, number> = {
  8: 8,
  15: 15,
  25: 25,
};

/**
 * 生成某档键盘的完整布局。
 * 结果可安全缓存 —— 布局只依赖 size。
 */
export function buildKeyboardLayout(size: KeyboardSize): KeyboardLayout {
  const rootMidi = SIZE_ROOTS[size];
  const whiteCount = SIZE_WHITE_COUNT[size];
  // **黑键一律画出来**：孩子靠「两个黑键左边那个白键就是 C」来找中央C，
  // 只有一排白键的键盘是找不到 C 的（这比「初学者看不到黑键」重要得多）。
  const showBlackKeys = true;

  const whiteWidthPercent = 100 / whiteCount;
  const blackWidthPercent = whiteWidthPercent * BLACK_KEY_WIDTH_RATIO;

  const whiteKeys: KeyLayout[] = [];
  for (let i = 0; i < whiteCount; i += 1) {
    const octave = Math.floor(i / 7);
    const degree = i % 7;
    const midi = rootMidi + octave * 12 + WHITE_SEMITONES[degree];
    const note = midiToNoteName(midi);
    whiteKeys.push({
      note,
      midi,
      isBlack: false,
      whiteIndex: i,
      leftPercent: i * whiteWidthPercent,
      widthPercent: whiteWidthPercent,
      // 15 / 25 键：只标 C，作为音域坐标（15 键下三个 C，中间那个就是中央C）
      // 黑键一律不标（键窄，标了反而看不清；音名由简谱/唱名标注负责）
      label: size === 8 ? note.replace(/\d/g, '') : note.startsWith('C') ? note : '',
    });
  }

  const blackKeys: KeyLayout[] = [];
  if (showBlackKeys) {
    const lastWhiteIndex = whiteCount - 1;
    for (let i = 0; i < whiteCount; i += 1) {
      const octave = Math.floor(i / 7);
      const degree = i % 7;
      if (!BLACK_AFTER_WHITE_OFFSET.includes(degree as (typeof BLACK_AFTER_WHITE_OFFSET)[number])) {
        continue;
      }
      // 最后一组里若右侧没有白键，则该黑键不存在（例如 F5 之后）
      if (i >= lastWhiteIndex) continue;

      const midi = rootMidi + octave * 12 + WHITE_SEMITONES[degree] + 1;
      blackKeys.push({
        note: midiToNoteName(midi),
        midi,
        isBlack: true,
        whiteIndex: i,
        leftPercent: (i + 1) * whiteWidthPercent - blackWidthPercent / 2,
        widthPercent: blackWidthPercent,
        label: '',
      });
    }
  }

  const maxMidi = whiteKeys[whiteKeys.length - 1].midi;

  return {
    size,
    whiteKeys,
    blackKeys,
    minMidi: rootMidi,
    maxMidi,
    hasBlackKeys: blackKeys.length > 0,
  };
}

const layoutCache = new Map<KeyboardSize, KeyboardLayout>();

/** 带缓存的布局获取（渲染热路径会反复调用）。 */
export function getKeyboardLayout(size: KeyboardSize): KeyboardLayout {
  let layout = layoutCache.get(size);
  if (!layout) {
    layout = buildKeyboardLayout(size);
    layoutCache.set(size, layout);
  }
  return layout;
}

/** 该键盘全部可弹奏的音名（白键 + 黑键），按音高排序。 */
export function getKeyboardNotes(size: KeyboardSize): string[] {
  const layout = getKeyboardLayout(size);
  return [...layout.whiteKeys, ...layout.blackKeys]
    .map((key) => key.note)
    .sort((a, b) => (noteToMidi(a) ?? 0) - (noteToMidi(b) ?? 0));
}

const playableMidiCache = new Map<KeyboardSize, number[]>();

/** 该键盘上真实存在的键（MIDI 编号，已排序）。用于音域判断与吸附。 */
export function getPlayableMidi(size: KeyboardSize): number[] {
  let cached = playableMidiCache.get(size);
  if (!cached) {
    const layout = getKeyboardLayout(size);
    cached = [...layout.whiteKeys, ...layout.blackKeys]
      .map((key) => key.midi)
      .sort((a, b) => a - b);
    playableMidiCache.set(size, cached);
  }
  return cached;
}

/**
 * 键盘上是否存在这个音。
 * 注意不能只比较音域：8 键虽然覆盖 C4–C5 的**音域**，但没有黑键。
 */
export function isNoteOnKeyboard(size: KeyboardSize, note: string): boolean {
  const midi = noteToMidi(note);
  if (midi === null) return false;
  return getPlayableMidi(size).includes(midi);
}

/** 给大人看的音域描述，例如 "C4 – C5"。 */
export function describeRange(size: KeyboardSize): string {
  const layout = getKeyboardLayout(size);
  return `${midiToNoteName(layout.minMidi)} – ${midiToNoteName(layout.maxMidi)}`;
}
