import { beforeEach, describe, expect, it } from 'vitest';
import { CONTENT_PACKS_KEY, clearContentPacks, loadContentPacks, saveContentPacks } from './packStorage';
import { CONTENT_PACK_VERSION, type ContentPack } from './packTypes';

/**
 * 内容包的本地存储。
 *
 * 两条必须守住的：
 * 1. **坏数据不能连累好数据** —— 一个包坏了，其余的照常能读
 * 2. **坏了要能捞回来** —— 隔离保存原始串，而不是直接丢掉（家长手打一首曲子不容易）
 */
const pack = (id: string, songId = 's'): ContentPack => ({
  version: CONTENT_PACK_VERSION,
  id,
  name: `包 ${id}`,
  createdAt: 1,
  songs: [{ id: songId, title: '曲子', bpm: 80, notes: [{ note: 'C4', beat: 0, duration: 1 }] }],
});

const quarantineKeys = () =>
  Object.keys(localStorage).filter((key) => key.startsWith(`${CONTENT_PACKS_KEY}.corrupt.`));

describe('内容包存储', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没存过 → 空数组，不报错', () => {
    expect(loadContentPacks()).toEqual({ packs: [], dropped: [] });
  });

  it('存了能原样读回来（含 jianpu 原文）', () => {
    const withJianpu: ContentPack = {
      ...pack('a'),
      songs: [{ ...pack('a').songs[0], jianpu: '1 2 3' }],
    };
    saveContentPacks([withJianpu]);
    const { packs, dropped } = loadContentPacks();
    expect(dropped).toEqual([]);
    expect(packs).toHaveLength(1);
    expect(packs[0].songs[0].jianpu).toBe('1 2 3');
  });

  it('坏 JSON → 隔离保存 + 清空 + 说明原因', () => {
    localStorage.setItem(CONTENT_PACKS_KEY, '{ 这不是 JSON');
    const { packs, dropped } = loadContentPacks();
    expect(packs).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(quarantineKeys()).toHaveLength(1);
    // 清空后还能继续用
    expect(loadContentPacks()).toEqual({ packs: [], dropped: [] });
  });

  it('不是数组 → 隔离并清空', () => {
    localStorage.setItem(CONTENT_PACKS_KEY, JSON.stringify({ nope: 1 }));
    const { packs, dropped } = loadContentPacks();
    expect(packs).toEqual([]);
    expect(dropped.join()).toContain('数组');
    expect(quarantineKeys()).toHaveLength(1);
  });

  it('数组里混了坏包 → 好的留下，坏的丢掉并说明', () => {
    localStorage.setItem(
      CONTENT_PACKS_KEY,
      JSON.stringify([pack('good'), { id: 'bad', name: '坏包', songs: [] }, pack('good2')]),
    );
    const { packs, dropped } = loadContentPacks();
    expect(packs.map((item) => item.id)).toEqual(['good', 'good2']);
    expect(dropped).toHaveLength(1);
    expect(quarantineKeys()).toHaveLength(1);
    // 坏数据已经被写回（不再拖着）
    const again = loadContentPacks();
    expect(again.packs.map((item) => item.id)).toEqual(['good', 'good2']);
    expect(again.dropped).toEqual([]);
  });

  it('重复的包 id 只留第一个', () => {
    localStorage.setItem(CONTENT_PACKS_KEY, JSON.stringify([pack('dup'), pack('dup', 'other')]));
    const { packs, dropped } = loadContentPacks();
    expect(packs).toHaveLength(1);
    expect(packs[0].songs[0].id).toBe('s');
    expect(dropped.join()).toContain('重复');
  });

  it('清空之后回到「没存过」的状态', () => {
    saveContentPacks([pack('a')]);
    clearContentPacks();
    expect(loadContentPacks()).toEqual({ packs: [], dropped: [] });
  });
});
