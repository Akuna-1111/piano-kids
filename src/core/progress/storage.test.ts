import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_VOICE_PRESET_ID, VOICE_PRESET_IDS } from '@/core/audio/voicePresets';
import {
  PROGRESS_VERSION,
  createDefaultProgress,
  createDefaultSettings,
  type AppProgress,
} from './progressTypes';
import { migrateProgress, migrateSettings } from './migrations';
import { DEFAULT_SKIN_ID } from '@/features/skins/skins';
import {
  clearAllStorage,
  loadProgress,
  loadSettings,
  PROGRESS_STORAGE_KEY,
  saveProgress,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from './storage';

/** 文档 19.3：localStorage 数据损坏 / 版本迁移 必须覆盖。 */

describe('数据迁移与持久化', () => {
  beforeEach(() => {
    clearAllStorage();
  });

  it('空存档返回默认值', () => {
    expect(loadProgress()).toEqual(createDefaultProgress());
    expect(loadSettings()).toEqual(createDefaultSettings());
  });

  it('损坏的 JSON 不会让应用崩溃，原始内容会被隔离保存', () => {
    localStorage.setItem(PROGRESS_STORAGE_KEY, '{ 这不是 JSON');
    const progress = loadProgress();
    expect(progress.starsTotal).toBe(0);
    expect(progress.equippedSkinId).toBe(DEFAULT_SKIN_ID);

    const quarantined = Object.keys(localStorage).filter((key) =>
      key.startsWith(`${PROGRESS_STORAGE_KEY}.corrupt.`),
    );
    expect(quarantined.length).toBe(1);
    expect(localStorage.getItem(quarantined[0])).toContain('这不是 JSON');
  });

  it('结构不完整的对象会被补齐成合法存档（而不是整份丢弃）', () => {
    localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({ starsTotal: 7, unlockedSkinIds: ['star'] }),
    );
    const progress = loadProgress();
    expect(progress.starsTotal).toBe(7);
    expect(progress.version).toBe(PROGRESS_VERSION);
    expect(progress.stats.songsCompleted).toBe(0);
    expect(progress.streak.currentDays).toBe(0);
    // 默认皮肤必须始终可用
    expect(progress.unlockedSkinIds).toContain(DEFAULT_SKIN_ID);
    expect(progress.unlockedSkinIds).toContain('star');
  });

  it('装备了未解锁皮肤时会被纠正回已解锁的皮肤', () => {
    const progress = migrateProgress({
      equippedSkinId: 'space',
      unlockedSkinIds: [DEFAULT_SKIN_ID],
    });
    expect(progress.equippedSkinId).toBe(DEFAULT_SKIN_ID);
    expect(progress.unlockedSkinIds).not.toContain('space');
  });

  it('皮肤改名后旧存档会被自动映射（rainbow → wood），用户不需要做任何事', () => {
    const progress = migrateProgress({
      equippedSkinId: 'rainbow',
      unlockedSkinIds: ['rainbow', 'star'],
    });
    expect(progress.unlockedSkinIds).toEqual([DEFAULT_SKIN_ID, 'star']);
    expect(progress.equippedSkinId).toBe(DEFAULT_SKIN_ID);
    expect(progress.unlockedSkinIds).not.toContain('rainbow');
  });

  it('自相矛盾的存档会被修补：最长连续天数 / 完成曲目数 / 最高准确率', () => {
    const progress = migrateProgress({
      streak: { currentDays: 9, longestDays: 2, lastPracticeDate: '2025-05-10' },
      completedSongIds: ['a', 'b', 'c'],
      stats: { songsCompleted: 1, bestAccuracy: 40 },
      bestAccuracyBySong: { a: 88 },
    });
    expect(progress.streak.longestDays).toBe(9);
    expect(progress.stats.songsCompleted).toBe(3);
    expect(progress.stats.bestAccuracy).toBe(88);
  });

  it('非数字 / 负数 / 越界值都会被裁剪', () => {
    const progress = migrateProgress({
      starsTotal: -5,
      achievements: ['x', 'x', 3, null],
      stats: { totalNotesPlayed: Number.NaN, bestAccuracy: 480, adventureLevel: 0 },
    });
    expect(progress.starsTotal).toBe(0);
    expect(progress.achievements).toEqual(['x']);
    expect(progress.stats.totalNotesPlayed).toBe(0);
    expect(progress.stats.bestAccuracy).toBe(100);
    expect(progress.stats.adventureLevel).toBe(1);
  });

  it('未来版本号的存档仍然可用（向后兼容读取，不直接覆盖）', () => {
    const progress = migrateProgress({ version: 99, starsTotal: 42 });
    expect(progress.version).toBe(PROGRESS_VERSION);
    expect(progress.starsTotal).toBe(42);
  });

  it('设置项：非法键盘档位回落到 15 键，音量被夹在 0–1', () => {
    const settings = migrateSettings({ keyboardSize: 42, volume: 3, timingWindowScale: 100 });
    expect(settings.keyboardSize).toBe(15);
    expect(settings.volume).toBe(1);
    expect(settings.timingWindowScale).toBe(3);
  });

  it('老存档没有识谱提示开关时，默认打开（数字简谱 + 唱名拼音）', () => {
    const settings = migrateSettings({ keyboardSize: 15, volume: 0.5 });
    expect(settings.showSolfege).toBe(true);
    expect(settings.showPinyin).toBe(true);
  });

  it('识谱提示开关关掉后能被原样读回来，不会被默认值覆盖', () => {
    const settings = migrateSettings({ showSolfege: false, showPinyin: false });
    expect(settings.showSolfege).toBe(false);
    expect(settings.showPinyin).toBe(false);
  });

  it('识谱提示开关的非布尔值被当作未设置，回落为打开', () => {
    const settings = migrateSettings({ showSolfege: 'yes', showPinyin: 0 });
    expect(settings.showSolfege).toBe(true);
    expect(settings.showPinyin).toBe(true);
  });

  it('老存档没有音色字段时，默认是三角钢琴', () => {
    const settings = migrateSettings({ keyboardSize: 15, volume: 0.5 });
    expect(settings.voicePreset).toBe('grand');
    expect(settings.voicePreset).toBe(DEFAULT_VOICE_PRESET_ID);
  });

  it('音色选择能被原样读回来（音色是存档契约的一部分）', () => {
    for (const id of VOICE_PRESET_IDS) {
      expect(migrateSettings({ voicePreset: id }).voicePreset).toBe(id);
    }
  });

  it('不认识的音色 id（手改过 / 更早的存档）回落到默认，而不是崩掉', () => {
    for (const bad of ['nonsense', '', 42, null, { id: 'grand' }]) {
      expect(migrateSettings({ voicePreset: bad }).voicePreset).toBe(DEFAULT_VOICE_PRESET_ID);
    }
  });

  it('存档可以完整往返（save → load）', () => {
    const progress: AppProgress = {
      ...createDefaultProgress(),
      starsTotal: 21,
      unlockedSkinIds: [DEFAULT_SKIN_ID, 'star', 'forest'],
      equippedSkinId: 'star',
      completedSongIds: ['twinkle-star'],
      achievements: ['first-song'],
      stats: { ...createDefaultProgress().stats, songsCompleted: 1 },
    };
    saveProgress(progress);
    expect(loadProgress()).toEqual(progress);
  });

  it('读回来的存档永远是自洽的，不会连「完成 1 首但完成列表是 3 首」都存进去', () => {
    saveProgress({
      ...createDefaultProgress(),
      completedSongIds: ['a', 'b', 'c'],
      stats: { ...createDefaultProgress().stats, songsCompleted: 1 },
    });
    expect(loadProgress().stats.songsCompleted).toBe(3);
  });

  it('设置与成长数据分开存放（文档 9.2）', () => {
    saveProgress({ ...createDefaultProgress(), starsTotal: 9 });
    saveSettings({ ...createDefaultSettings(), volume: 0.33 });

    expect(JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY)!).starsTotal).toBe(9);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).volume).toBe(0.33);
    expect(loadSettings().volume).toBe(0.33);
    expect(loadProgress().starsTotal).toBe(9);
  });
});
