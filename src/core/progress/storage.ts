import { migrateProgress, migrateSettings } from './migrations';
import {
  createDefaultProgress,
  createDefaultSettings,
  type AppProgress,
  type AppSettings,
} from './progressTypes';

/**
 * 持久化边界（文档 9.2）。
 * 只有 ProgressStore 允许调用 save* —— 业务组件一律禁止直接碰 localStorage（开发规则 4）。
 */

export const PROGRESS_STORAGE_KEY = 'piano_app_progress_v1';
export const SETTINGS_STORAGE_KEY = 'piano_app_settings_v1';

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    // Safari 无痕模式等：读不到就当没有存档，应用仍然完全可用
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    /* 配额 / 权限问题不阻塞业务 */
  }
}

function removeRaw(key: string): void {
  try {
    localStorage?.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

/** 解析失败时把原始内容另存一份，避免「数据凭空消失又查不到原因」。 */
function quarantine(key: string, raw: string): void {
  writeRaw(`${key}.corrupt.${Date.now()}`, raw.slice(0, 4000));
}

export function loadProgress(): AppProgress {
  const raw = readRaw(PROGRESS_STORAGE_KEY);
  if (raw === null || raw === '') return createDefaultProgress();
  try {
    return migrateProgress(JSON.parse(raw));
  } catch {
    quarantine(PROGRESS_STORAGE_KEY, raw);
    return createDefaultProgress();
  }
}

export function saveProgress(progress: AppProgress): void {
  writeRaw(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

export function loadSettings(): AppSettings {
  const raw = readRaw(SETTINGS_STORAGE_KEY);
  if (raw === null || raw === '') return createDefaultSettings();
  try {
    return migrateSettings(JSON.parse(raw));
  } catch {
    quarantine(SETTINGS_STORAGE_KEY, raw);
    return createDefaultSettings();
  }
}

export function saveSettings(settings: AppSettings): void {
  writeRaw(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

/** 测试辅助 / 设置页「重置成长数据」。 */
export function clearProgressStorage(): void {
  removeRaw(PROGRESS_STORAGE_KEY);
}

export function clearAllStorage(): void {
  removeRaw(PROGRESS_STORAGE_KEY);
  removeRaw(SETTINGS_STORAGE_KEY);
}
