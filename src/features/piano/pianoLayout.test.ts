import { describe, expect, it } from 'vitest';
import { midiToNoteName } from '@/core/audio/notes';
import {
  buildKeyboardLayout,
  describeRange,
  getKeyboardLayout,
  getKeyboardNotes,
  isNoteOnKeyboard,
  KEYBOARD_SIZES,
  type KeyboardSize,
} from './pianoLayout';

describe('键盘布局', () => {
  it('8 键 = 一个八度的白键 + 5 个黑键（孩子靠黑键找中央C）', () => {
    const layout = buildKeyboardLayout(8);
    expect(layout.whiteKeys).toHaveLength(8);
    expect(layout.whiteKeys[0].note).toBe('C4');
    expect(layout.whiteKeys[7].note).toBe('C5');
    // C4–C5 之间只有 5 个黑键：C#4 D#4 F#4 G#4 A#4（C5 上面那个黑键不在这块键盘里）
    expect(layout.blackKeys.map((key) => key.note)).toEqual(['C#4', 'D#4', 'F#4', 'G#4', 'A#4']);
    expect(layout.hasBlackKeys).toBe(true);
    // 黑键不标音名（键窄，标了看不清）
    expect(layout.blackKeys.every((key) => key.label === '')).toBe(true);
  });

  it('8 键的黑键同样落在两个白键的分界线上，且总宽不变', () => {
    const layout = buildKeyboardLayout(8);
    const whiteWidth = layout.whiteKeys[0].widthPercent;
    expect(whiteWidth).toBeCloseTo(12.5, 10);
    for (const black of layout.blackKeys) {
      const center = black.leftPercent + black.widthPercent / 2;
      expect(center).toBeCloseTo((black.whiteIndex + 1) * whiteWidth, 6);
    }
    // 黑键是**叠在白键上**的：加黑键不会让白键变窄（物理尺寸不变）
    expect(layout.whiteKeys[0].widthPercent).toBeCloseTo(100 / 8, 10);
  });

  it('15 键 = 两个八度白键 + 黑键', () => {
    const layout = buildKeyboardLayout(15);
    expect(layout.whiteKeys).toHaveLength(15);
    expect(layout.blackKeys).toHaveLength(10);
    expect(layout.whiteKeys[0].note).toBe('C3');
    expect(layout.whiteKeys[14].note).toBe('C5');
    expect(describeRange(15)).toBe('C3 – C5');
  });

  it('25 键 = 三个半八度白键，接近真实钢琴结构', () => {
    const layout = buildKeyboardLayout(25);
    expect(layout.whiteKeys).toHaveLength(25);
    expect(layout.whiteKeys[0].note).toBe('C2');
    expect(layout.whiteKeys[24].note).toBe('F5');
    // C2–F5 之间的黑键：三个完整八度 15 个 + C#5/D#5
    expect(layout.blackKeys).toHaveLength(17);
  });

  it('白键等宽且首尾位置精确，不会因为屏幕宽度漂移', () => {
    for (const size of KEYBOARD_SIZES) {
      const layout = buildKeyboardLayout(size);
      const width = layout.whiteKeys[0].widthPercent;
      expect(width).toBeCloseTo(100 / layout.whiteKeys.length, 10);
      expect(layout.whiteKeys[0].leftPercent).toBe(0);
      const last = layout.whiteKeys[layout.whiteKeys.length - 1];
      expect(last.leftPercent + last.widthPercent).toBeCloseTo(100, 6);
    }
  });

  it('黑键总是落在两个白键的分界线上', () => {
    const layout = buildKeyboardLayout(15);
    const whiteWidth = layout.whiteKeys[0].widthPercent;
    for (const black of layout.blackKeys) {
      const center = black.leftPercent + black.widthPercent / 2;
      expect(center).toBeCloseTo((black.whiteIndex + 1) * whiteWidth, 6);
      // 黑键左侧一定是它下方那个白键
      const leftWhite = layout.whiteKeys[black.whiteIndex];
      expect(midiToNoteName(leftWhite.midi + 1)).toBe(black.note);
    }
  });

  it('黑键只出现在 C#/D#/F#/G#/A# 这五个位置', () => {
    const layout = buildKeyboardLayout(25);
    const names = new Set(layout.blackKeys.map((key) => key.note.replace(/-?\d+$/, '')));
    expect([...names].sort()).toEqual(['A#', 'C#', 'D#', 'F#', 'G#']);
  });

  it('8 键模式下每个键都有音名标签', () => {
    const layout = buildKeyboardLayout(8);
    expect(layout.whiteKeys.map((key) => key.label)).toEqual([
      'C', 'D', 'E', 'F', 'G', 'A', 'B', 'C',
    ]);
  });

  it('布局结果被缓存，重复调用返回同一对象', () => {
    expect(getKeyboardLayout(25)).toBe(getKeyboardLayout(25));
  });

  it('键盘可弹音集合与布局一致', () => {
    for (const size of KEYBOARD_SIZES) {
      const notes = getKeyboardNotes(size);
      expect(new Set(notes).size).toBe(notes.length);
      for (const note of notes) expect(isNoteOnKeyboard(size, note)).toBe(true);
    }
    expect(isNoteOnKeyboard(8, 'C#4')).toBe(true);
    expect(isNoteOnKeyboard(8, 'C#5')).toBe(false); // C5 上面的黑键不在这块键盘里
    expect(isNoteOnKeyboard(15, 'C#4')).toBe(true);
    expect(isNoteOnKeyboard(15, 'G5')).toBe(false);
  });

  it('每一档的键盘都可以由 KeyboardSize 唯一决定', () => {
    const sizes: KeyboardSize[] = [8, 15, 25];
    const signatures = sizes.map((size) => getKeyboardNotes(size).join(','));
    expect(new Set(signatures).size).toBe(3);
  });
});
