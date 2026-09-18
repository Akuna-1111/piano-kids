import { validateContentPack } from './packSchema';
import { CONTENT_PACK_VERSION, type ContentPack } from './packTypes';

/**
 * 内容包的本地存储 —— **只有这里允许碰内容存储**（与 `progress/storage.ts` 一个规矩）。
 *
 * 数据只存在用户自己的设备上：不上传、不进构建产物、没有后端。
 * 损坏的数据不扔掉了事，而是**隔离保存**（`.corrupt.<时间戳>`），
 * 这样出问题时还能捞回来 —— 家长手打一首曲子不容易。
 */

export const CONTENT_PACKS_KEY = 'piano_app_packs_v1';

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 存储满了 / 隐私模式：静默失败，应用继续可用（内容包是加分项，不是核心）
  }
}

function quarantine(key: string, raw: string): void {
  writeRaw(`${key}.corrupt.${Date.now()}`, raw);
}

export interface LoadPacksResult {
  packs: ContentPack[];
  /** 被丢弃的条目与原因（界面可以如实告诉家长） */
  dropped: string[];
}

export function loadContentPacks(): LoadPacksResult {
  const raw = readRaw(CONTENT_PACKS_KEY);
  if (raw === null) return { packs: [], dropped: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    quarantine(CONTENT_PACKS_KEY, raw);
    writeRaw(CONTENT_PACKS_KEY, JSON.stringify([]));
    return { packs: [], dropped: ['存储里的内容包不是合法 JSON，已隔离保存并清空'] };
  }
  if (!Array.isArray(parsed)) {
    quarantine(CONTENT_PACKS_KEY, raw);
    writeRaw(CONTENT_PACKS_KEY, JSON.stringify([]));
    return { packs: [], dropped: ['存储里的内容包不是一个数组，已隔离保存并清空'] };
  }

  const packs: ContentPack[] = [];
  const dropped: string[] = [];
  const seenPackIds = new Set<string>();

  for (const entry of parsed) {
    const result = validateContentPack(entry);
    if (!result.ok) {
      dropped.push(`丢弃一个内容包：${result.errors[0] ?? '数据不合法'}`);
      continue;
    }
    if (seenPackIds.has(result.pack.id)) {
      dropped.push(`丢弃重复的内容包「${result.pack.id}」`);
      continue;
    }
    seenPackIds.add(result.pack.id);
    packs.push(result.pack);
  }

  if (dropped.length > 0) {
    // 隔离原始数据，但把能用的部分写回去，避免坏数据一直拖着
    quarantine(CONTENT_PACKS_KEY, raw);
    saveContentPacks(packs);
  }
  return { packs, dropped };
}

export function saveContentPacks(packs: readonly ContentPack[]): void {
  const payload = packs.map((pack) => ({ ...pack, version: CONTENT_PACK_VERSION }));
  writeRaw(CONTENT_PACKS_KEY, JSON.stringify(payload));
}

/** 清空所有导入内容（家长在自检页 / 导入页里可以主动清） */
export function clearContentPacks(): void {
  try {
    localStorage.removeItem(CONTENT_PACKS_KEY);
  } catch {
    /* 忽略 */
  }
}
