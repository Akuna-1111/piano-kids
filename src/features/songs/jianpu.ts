import { midiToNoteName, noteToMidi } from '@/core/audio/notes';
import { getPlayableMidi, type KeyboardSize } from '@/features/piano/pianoLayout';
import type { SongNote } from './types';

/**
 * 简谱（数字谱）↔ 曲目数据。
 *
 * ## 为什么需要它
 *
 * 曲库里的中文曲目要走**合法且准确**的路径：教材（《中国风钢琴入门教程》等）的**编配**受著作权保护，
 * 不能打包进这个会公开部署的仓库；而民歌旋律虽然多为公有领域，**转写错一个音就是在教错音**，
 * 家长也不会知道错在哪里。
 *
 * 所以约定：**以可核对的简谱原文为准**（家长/使用者手上都有谱），由本模块机械转换 + 校验，
 * 不靠任何人的记忆。转换是纯函数，有单测，还可以把曲目反向打印成简谱供人逐音核对。
 *
 * ## 文本格式（`content/jianpu/<曲目 id>.txt`）
 *
 * ```text
 * # 注释行（# 开头）会被忽略
 * 1=C 4/4            ← 调号与小节拍数（用来检查小节是否凑满）
 *
 * 1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |
 * ```
 *
 * | 写法 | 含义 |
 * | --- | --- |
 * | `1`–`7` | 唱名 do–si，基准音区由 `1=C` 决定（默认 C4） |
 * | `0` | 休止符 |
 * | `#4` / `b7` | 升 / 降（黑键。8 键键盘上没有黑键，会被下面的校验拦下） |
 * | `1'` / `5,` | 高八度 / 低八度（可叠加：`1''`） |
 * | `-` | 每个 `-` 延长一拍：`5-` = 2 拍，`5--` = 3 拍 |
 * | `_` | 每个 `_` 减半：`3_` = 半拍，`3__` = 四分之一拍 |
 * | `~` | 附点（×1.5）：`3~` = 1.5 拍。**不能与 `-` / `_` 混用** |
 * | `\|` 与换行 | 只作分隔，不改变时值 |
 *
 * 一拍 = 四分音符 = 曲目数据里的 `duration: 1`。
 */

export interface JianpuParseResult {
  notes: SongNote[];
  /** 调号里的基准音（默认 C4 → MIDI 60） */
  tonicMidi: number;
  beatsPerBar: number | null;
  /** 可疑之处（不抛错，交给调用方决定）：小节没凑满、无法解析的记号等 */
  warnings: string[];
}

const DIGIT_SEMITONES: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11 };

/** 自然音级（无升降）的半音 → 简谱数字 */
const OCTAVE_DIGITS: Record<number, string> = { 0: '1', 2: '2', 4: '3', 5: '4', 7: '5', 9: '6', 11: '7' };

/** MIDI → 简谱记号（1–7 + 升降号 + 八度点） */
function midiToJianpuToken(midi: number, tonicMidi: number): string {
  const relative = midi - tonicMidi;
  const octave = Math.floor(relative / 12);

  let semitone = ((relative % 12) + 12) % 12;
  let accidental = '';
  if (!(semitone in OCTAVE_DIGITS)) {
    // 黑键：写成下方音级的升号（#1 #2 #4 #5 #6），与简谱习惯一致
    semitone -= 1;
    accidental = '#';
  }
  const digit = OCTAVE_DIGITS[semitone];
  const marker = octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
  return `${accidental}${digit}${marker}`;
}

export function parseJianpu(text: string): JianpuParseResult {
  const warnings: string[] = [];
  let tonicMidi = noteToMidi('C4') ?? 60;
  let beatsPerBar: number | null = null;
  const notes: SongNote[] = [];
  /** 当前小节的累计拍数（`|` 是真正的小节线，用来查出没凑满的小节） */
  let barBeats = 0;
  let barCount = 1;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    // 调号 / 拍号行
    const tonicMatch = /1\s*=\s*([A-Ga-g])(#|b)?/.exec(line);
    if (tonicMatch) {
      const letter = tonicMatch[1].toUpperCase();
      const suffix = tonicMatch[2] ?? '';
      const tonic = noteToMidi(`${letter}${suffix}4`);
      if (tonic !== null) tonicMidi = tonic;
      else warnings.push(`调号无法识别：${line}`);
    }
    const meterMatch = /(\d)\s*\/\s*(\d)/.exec(line);
    if (meterMatch) beatsPerBar = Number(meterMatch[1]) * (4 / Number(meterMatch[2]));
    if (tonicMatch || meterMatch) continue;

    // `|` 单独成 token（即使和音符粘在一起也能切开）
    for (const token of line.match(/[^|\s]+|\|/g) ?? []) {
      if (token === '|') {
        if (beatsPerBar !== null && barBeats > 0 && Math.abs(barBeats - beatsPerBar) > 1e-9) {
          warnings.push(`第 ${barCount} 小节有 ${barBeats} 拍，拍号要求 ${beatsPerBar} 拍`);
        }
        barBeats = 0;
        barCount += 1;
        continue;
      }

      // 时值后缀：~ 附点 / _ 减半 / - 延长
      let duration = 1;
      let body = token;
      const dotted = body.endsWith('~');
      if (dotted) body = body.slice(0, -1);
      const halves = (body.match(/_+$/)?.[0] ?? '').length;
      if (halves > 0) body = body.slice(0, -halves);
      const extendsCount = (body.match(/-+$/)?.[0] ?? '').length;
      if (extendsCount > 0) body = body.slice(0, -extendsCount);

      if (dotted && (halves > 0 || extendsCount > 0)) {
        warnings.push(`${token}：附点不能与 - / _ 混用，按附点处理`);
      }
      if (dotted) duration = 1.5;
      else if (halves > 0) duration = 1 / 2 ** halves;
      else if (extendsCount > 0) duration = 1 + extendsCount;
      barBeats += duration;

      if (body === '0') {
        notes.push({ note: '', beat: 0, duration });
        continue;
      }

      const octaveUp = (body.match(/'+$/)?.[0] ?? '').length;
      const octaveDown = (body.match(/,+$/)?.[0] ?? '').length;
      const core = body.slice(0, body.length - octaveUp - octaveDown).replace(/[',]/g, '');

      const accidental = core.startsWith('#') ? 1 : core.startsWith('b') ? -1 : 0;
      const digit = core.replace(/^[#b]/, '');
      const semitone = DIGIT_SEMITONES[digit];
      if (semitone === undefined) {
        warnings.push(`无法解析的音：${token}`);
        continue;
      }
      const midi = tonicMidi + semitone + accidental + 12 * (octaveUp - octaveDown);
      const noteName = midiToNoteName(midi);
      if (noteName === null) {
        warnings.push(`音高超出范围：${token}`);
        continue;
      }
      notes.push({ note: noteName, beat: 0, duration });
    }
  }

  // 小节是否凑满已经在上面遇到 `|` 时检查过了，这里只落 beat
  let beat = 0;
  for (const note of notes) {
    note.beat = beat;
    beat += note.duration;
  }
  if (beatsPerBar !== null && barBeats > 0) {
    warnings.push(`最后一小节只有 ${barBeats} 拍（少了一个 | ？）`);
  }

  return { notes, tonicMidi, beatsPerBar, warnings };
}

/** 曲目 → 简谱文本（用来逐音核对，也是往返单测的另一半）。 */
export function songToJianpu(notes: readonly SongNote[], tonicMidi = 60, beatsPerBar = 4): string {
  const tokens: string[] = [];
  let beatInBar = 0;
  for (const note of notes) {
    let token = note.note === '' ? '0' : midiToJianpuToken(noteToMidi(note.note) ?? tonicMidi, tonicMidi);
    if (note.duration === 1.5) token += '~';
    else if (note.duration < 1) {
      const halves = Math.round(Math.log2(1 / note.duration));
      token += '_'.repeat(halves);
    } else if (note.duration > 1) token += '-'.repeat(Math.round(note.duration - 1));
    tokens.push(token);

    beatInBar += note.duration;
    if (beatInBar >= beatsPerBar - 1e-9) {
      tokens.push('|');
      beatInBar = 0;
    }
  }
  return tokens
    .join(' ')
    .replace(/ \| /g, ' |\n')
    .trim();
}

/**
 * 校验一组音能否**原样**放进键盘（不做任何吸附）。
 * 返回人类可读的问题列表 —— 空数组表示可以放心收录。
 */
export function checkPlayable(notes: readonly SongNote[], size: KeyboardSize): string[] {
  const playable = new Set(getPlayableMidi(size));
  const problems: string[] = [];
  for (const note of notes) {
    if (note.note === '') continue;
    const midi = noteToMidi(note.note);
    if (midi === null) {
      problems.push(`${note.note}：音名无法解析`);
      continue;
    }
    if (!playable.has(midi)) problems.push(`${note.note}：不在 ${size} 键键盘上（需要吸附）`);
  }
  return problems;
}
