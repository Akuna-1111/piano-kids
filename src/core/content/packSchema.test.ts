import { describe, expect, it } from 'vitest';
import { getPlayableMidi } from '@/features/piano/pianoLayout';
import { validateContentPack } from './packSchema';
import { CONTENT_PACK_VERSION, packSongId, splitPackSongId } from './packTypes';

/**
 * 内容包的防御式校验。
 *
 * 这里的原则与 `migrations.ts` 一致：**不认识的东西一律拒绝并说清原因**。
 * 曲谱错一个音就是在教错音，所以宁可让家长看到一条明确的错误，也不做「尽力修补」。
 */
const validSong = {
  id: 'mo-li-hua',
  title: '茉莉花',
  bpm: 76,
  beatsPerBar: 4,
  notes: [
    { note: 'E4', beat: 0, duration: 1 },
    { note: 'G4', beat: 1, duration: 1 },
    { note: '', beat: 2, duration: 1 },
    { note: 'C5', beat: 3, duration: 2 },
  ],
};

const validPack = {
  version: CONTENT_PACK_VERSION,
  id: 'my-book',
  name: '家里那本书',
  source: '自己照谱抄的',
  createdAt: 1_700_000_000_000,
  songs: [validSong],
};

describe('内容包校验 · 通过的情况', () => {
  it('合法的包原样通过，可选字段保留', () => {
    const result = validateContentPack({ ...validPack, songs: [{ ...validSong, jianpu: '3 5 | 0 1-' }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.id).toBe('my-book');
    expect(result.pack.songs).toHaveLength(1);
    expect(result.pack.songs[0].jianpu).toBe('3 5 | 0 1-');
    expect(result.pack.songs[0].beatsPerBar).toBe(4);
    expect(result.warnings).toEqual([]);
  });

  it('休止符（note 为空字符串）是合法的', () => {
    const result = validateContentPack(validPack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.songs[0].notes[2].note).toBe('');
  });

  it('缺 createdAt / beatsPerBar / source 也能过（有默认）', () => {
    const result = validateContentPack({
      version: CONTENT_PACK_VERSION,
      id: 'p',
      name: 'p',
      songs: [{ id: 's', title: 's', bpm: 80, notes: [{ note: 'C4', beat: 0, duration: 1 }] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.createdAt).toBe(0);
    expect(result.pack.source).toBeUndefined();
  });

  it('当前键盘放不下的音只是**警告**，不是错误（resolver 会吸附）', () => {
    const result = validateContentPack(
      {
        ...validPack,
        songs: [
          {
            id: 'wide',
            title: '音域很宽',
            bpm: 80,
            notes: [
              { note: 'C4', beat: 0, duration: 1 },
              { note: 'G5', beat: 1, duration: 1 },
            ],
          },
        ],
      },
      { playableMidi: new Set(getPlayableMidi(8)) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('G5');
    expect(result.warnings[0]).toContain('吸附');
  });
});

describe('内容包校验 · 必须拒绝的情况', () => {
  it('版本不认识 → 明确说出来', () => {
    const result = validateContentPack({ ...validPack, version: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('99');
  });

  it('包的 id 不合法（大写 / 空格 / 中文）', () => {
    for (const id of ['My-Book', 'my book', '我的书', '-bad', '']) {
      const result = validateContentPack({ ...validPack, id });
      expect(result.ok, `id=${id} 应该被拒绝`).toBe(false);
    }
  });

  it('一首曲子都没有 → 拒绝', () => {
    expect(validateContentPack({ ...validPack, songs: [] }).ok).toBe(false);
    expect(validateContentPack({ ...validPack, songs: 'nope' }).ok).toBe(false);
  });

  it('bpm 越界、拍号不是 3/4 → 拒绝', () => {
    const slow = validateContentPack({ ...validPack, songs: [{ ...validSong, bpm: 10 }] });
    const fast = validateContentPack({ ...validPack, songs: [{ ...validSong, bpm: 400 }] });
    const meter = validateContentPack({ ...validPack, songs: [{ ...validSong, beatsPerBar: 6 }] });
    expect(slow.ok).toBe(false);
    expect(fast.ok).toBe(false);
    expect(meter.ok).toBe(false);
  });

  it('音名解析不出来 → 指出是第几个音', () => {
    const result = validateContentPack({
      ...validPack,
      songs: [
        {
          ...validSong,
          notes: [
            { note: 'C4', beat: 0, duration: 1 },
            { note: 'H4', beat: 1, duration: 1 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain('第 2 个音');
    expect(result.errors.join()).toContain('H4');
  });

  it('时值越界（太长 / 太短 / 非数字）→ 拒绝', () => {
    for (const duration of [0, 0.01, 20, 'x']) {
      const result = validateContentPack({
        ...validPack,
        songs: [{ ...validSong, notes: [{ note: 'C4', beat: 0, duration }] }],
      });
      expect(result.ok, `duration=${String(duration)} 应该被拒绝`).toBe(false);
    }
  });

  it('beat 往回走（没按时间顺序写）→ 拒绝', () => {
    const result = validateContentPack({
      ...validPack,
      songs: [
        {
          ...validSong,
          notes: [
            { note: 'C4', beat: 2, duration: 1 },
            { note: 'D4', beat: 1, duration: 1 },
          ],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain('时间顺序');
  });

  it('同一包里曲目 id 重复 → 拒绝', () => {
    const result = validateContentPack({ ...validPack, songs: [validSong, { ...validSong }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join()).toContain('重复');
  });

  it('音数超过上限 → 拒绝（避免把 localStorage 塞爆）', () => {
    const notes = Array.from({ length: 900 }, (_, index) => ({
      note: 'C4',
      beat: index,
      duration: 1,
    }));
    expect(validateContentPack({ ...validPack, songs: [{ ...validSong, notes }] }).ok).toBe(false);
  });

  it('不是对象 / 是数组 → 拒绝', () => {
    expect(validateContentPack(null).ok).toBe(false);
    expect(validateContentPack([]).ok).toBe(false);
    expect(validateContentPack('x').ok).toBe(false);
  });
});

describe('内容包曲目 id 前缀', () => {
  it('前缀能拼能拆，保证历史成绩不会串到别的曲子', () => {
    expect(packSongId('my-book', 'mo-li-hua')).toBe('my-book:mo-li-hua');
    expect(splitPackSongId('my-book:mo-li-hua')).toEqual({ packId: 'my-book', songId: 'mo-li-hua' });
  });

  it('没有前缀的内置曲目 id 不会被误认为导入曲目', () => {
    expect(splitPackSongId('twinkle-star')).toBeNull();
    expect(splitPackSongId(':x')).toBeNull();
    expect(splitPackSongId('x:')).toBeNull();
  });
});
