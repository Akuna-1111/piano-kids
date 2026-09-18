import { describe, expect, it } from 'vitest';
import { KEYBOARD_SIZES } from '@/features/piano/pianoLayout';
import { SONGS } from './songData';
import { checkPlayable, parseJianpu, songToJianpu } from './jianpu';

/**
 * 简谱 ↔ 曲目数据。
 *
 * 这套东西存在的唯一理由：**中文曲目必须来自可核对的简谱原文，不能靠记忆转写**。
 * 教材（《中国风钢琴入门教程》等）的编配受著作权保护、不能进仓库，而民歌旋律即便属公有领域，
 * 错一个音也是在教错音。所以约定：拿到简谱原文 → 机械转换 → 由这里守住。
 */
describe('简谱解析', () => {
  it('时值：延长、减半、附点', () => {
    const { notes } = parseJianpu('5 5- 3_ 3__ 3~');
    expect(notes.map((note) => note.duration)).toEqual([1, 2, 0.5, 0.25, 1.5]);
  });

  it('八度记号：1 是本位，撇号上移、逗号下移（可叠加）', () => {
    const { notes } = parseJianpu("1 1' 5, 5''");
    expect(notes.map((note) => note.note)).toEqual(['C4', 'C5', 'G3', 'G6']);
  });

  it('0 是休止符，升降号能表达黑键', () => {
    const { notes } = parseJianpu('0 #4 b7');
    expect(notes.map((note) => note.note)).toEqual(['', 'F#4', 'A#4']);
  });

  it('按拍号与小节线检查小节是否凑满（只警告，不抛错）', () => {
    const ok = parseJianpu('1=C 4/4\n1 1 1 1 | 2 2 2 2 |');
    expect(ok.warnings).toEqual([]);

    const short = parseJianpu('1=C 4/4\n1 1 1 | 2 2 2 2 |');
    expect(short.warnings.join()).toContain('拍号要求 4 拍');
  });

  it('认不出来的记号会被记成警告，而不是静默丢掉', () => {
    const { notes, warnings } = parseJianpu('1 xx 2');
    expect(notes).toHaveLength(2);
    expect(warnings.join()).toContain('无法解析');
  });

  it('调号 1=F 会把 1 落到 F4', () => {
    const { notes } = parseJianpu('1=F 4/4\n1 1 1 1 |');
    expect(notes[0].note).toBe('F4');
  });
});

describe('曲目 ↔ 简谱往返', () => {
  it('曲库里的每一首都能量化成简谱并原样解析回来', () => {
    for (const song of SONGS) {
      const jianpu = songToJianpu(song.notes, 60, song.beatsPerBar ?? 4);
      const { notes, warnings } = parseJianpu(jianpu);
      // 末小节没凑满只是提示（曲目最后一小节本来就可能短），其余警告都算错
      const real = warnings.filter((warning) => !warning.includes('最后一小节'));
      expect(real, `${song.id} 的简谱有警告：${jianpu}`).toEqual([]);
      expect(
        notes.map((note) => ({ note: note.note, duration: note.duration, beat: note.beat })),
        `${song.id} 往返不一致`,
      ).toEqual(
        song.notes.map((note) => ({ note: note.note, duration: note.duration, beat: note.beat })),
      );
    }
  });

  it('曲库里的每一首都完全落在当前提供的键盘档位上（不需要任何吸附）', () => {
    for (const song of SONGS) {
      for (const size of KEYBOARD_SIZES) {
        expect(checkPlayable(song.notes, size), `${song.id}@${size}键 有越界的音`).toEqual([]);
      }
    }
  });
});
