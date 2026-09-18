import { describe, expect, it } from 'vitest';
import {
  midiToFrequency,
  midiToNoteName,
  noteToMidi,
  noteToPinyin,
  noteToSolfege,
  noteLetter,
  parseNote,
  isBlackKey,
  transposeNote,
} from './notes';

describe('音符基础工具', () => {
  it('C4 = MIDI 60 = 261.63Hz（科学音高记法）', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 2);
  });

  it('A4 = 440Hz', () => {
    expect(midiToFrequency(noteToMidi('A4')!)).toBeCloseTo(440, 6);
  });

  it('支持升号 / 降号 / 小写 / 空格写法', () => {
    expect(noteToMidi('C#4')).toBe(61);
    expect(noteToMidi('Db4')).toBe(61);
    expect(noteToMidi('c#4')).toBe(61);
    expect(noteToMidi(' c4 ')).toBe(60);
    expect(noteToMidi('C♯4')).toBe(61);
  });

  it('把降号音名统一归一成升号写法，保证字符串唯一', () => {
    expect(parseNote('Db4')?.name).toBe('C#4');
    expect(parseNote('Bb3')?.name).toBe('A#3');
  });

  it('越界或非法输入返回 null 而不是抛错', () => {
    expect(parseNote('H4')).toBeNull();
    expect(parseNote('C99')).toBeNull();
    expect(parseNote('')).toBeNull();
    expect(noteToMidi('')).toBeNull();
    expect(isBlackKey('nonsense')).toBe(false);
  });

  it('跨八度的往返转换稳定', () => {
    for (let midi = 21; midi <= 108; midi += 1) {
      expect(noteToMidi(midiToNoteName(midi))).toBe(midi);
    }
  });

  it('简谱唱名映射正确', () => {
    expect(noteToSolfege('C4')).toBe('1');
    expect(noteToSolfege('E4')).toBe('3');
    expect(noteToSolfege('G4')).toBe('5');
    expect(noteToSolfege('B4')).toBe('7');
    expect(noteToSolfege('C#4')).toBe('♯1');
  });

  it('noteLetter 去掉八度', () => {
    expect(noteLetter('C#4')).toBe('C#');
    expect(noteLetter('A3')).toBe('A');
  });

  it('唱名拼音映射正确，且与简谱数字一一对应', () => {
    expect(noteToPinyin('C4')).toBe('do');
    expect(noteToPinyin('E4')).toBe('mi');
    expect(noteToPinyin('G4')).toBe('sol');
    expect(noteToPinyin('B4')).toBe('si');
    expect(noteToPinyin('C#4')).toBe('升do');
  });

  it('跨八度唱名不变（C4 与 C5 都是 1 / do）', () => {
    for (let octave = 3; octave <= 6; octave += 1) {
      expect(noteToSolfege(`C${octave}`)).toBe('1');
      expect(noteToPinyin(`C${octave}`)).toBe('do');
    }
  });

  it('初学者音域内每个音都有简谱数字和唱名拼音', () => {
    const naturals = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    for (const letter of naturals) {
      const note = `${letter}4`;
      expect(noteToSolfege(note), note).not.toBe('');
      expect(noteToPinyin(note), note).not.toBe('');
    }
  });

  it('非法音名的唱名返回空串，不抛错', () => {
    expect(noteToSolfege('nonsense')).toBe('');
    expect(noteToPinyin('')).toBe('');
  });

  it('transposeNote 越界时返回原值', () => {
    expect(transposeNote('C4', 12)).toBe('C5');
    expect(transposeNote('C4', -12)).toBe('C3');
    expect(transposeNote('C8', 12)).toBe('C8');
  });
});
