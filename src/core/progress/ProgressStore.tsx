import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { audioEngine } from '@/core/audio/AudioEngine';
import { DEFAULT_SKIN_ID } from '@/features/skins/skins';
import { getSkinById, type Skin } from '@/features/skins/skins';
import { resolveActiveSkin } from '@/features/skins/skinResolver';
import { recordPracticeResult } from './recordPracticeResult';
import { createDefaultProgress, createDefaultSettings } from './progressTypes';
import type { AppProgress, AppSettings, PracticeResult, RewardResult } from './progressTypes';
import { clearAllStorage, loadProgress, loadSettings, saveProgress, saveSettings } from './storage';

/**
 * ProgressStore —— 单一业务数据源（文档 9.1）。
 *
 * 为什么不用普通 useReducer：recordPracticeResult 必须把 RewardResult **同步返回**给完成页，
 * 而 reducer 只能返回新 state。这里用 ref 持有最新存档 + useState 驱动渲染，
 * 既保证「一次事务 → 一次保存 → 一次渲染」，也让调用方拿到确定的结果。
 *
 * 所有成长数据只能通过本 Store 修改（开发规则 4 / 5）。
 */

interface ProgressStoreValue {
  progress: AppProgress;
  settings: AppSettings;
  /** 当前实际渲染的皮肤（previewSkinId ?? equippedSkinId） */
  activeSkin: Skin;
  previewSkinId: string | null;

  /** 结算一次练习，返回本次奖励（不依赖 React state 是否刷新） */
  record(result: PracticeResult): RewardResult;

  equipSkin(skinId: string): void;
  setPreviewSkinId(skinId: string | null): void;
  updateSettings(patch: Partial<AppSettings>): void;
  setLastSongId(songId: string): void;
  resetProgress(): void;
}

const ProgressStoreContext = createContext<ProgressStoreValue | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<AppProgress>(() => loadProgress());
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [previewSkinId, setPreviewSkinId] = useState<string | null>(null);

  const progressRef = useRef(progress);
  progressRef.current = progress;

  // 设置变更 → 落库 + 同步到音频引擎（音量与音色属于音乐引擎，不属于 React）
  useEffect(() => {
    saveSettings(settings);
    audioEngine.setVolume(settings.volume);
    audioEngine.setVoicePreset(settings.voicePreset);
  }, [settings]);

  const record = useCallback((result: PracticeResult): RewardResult => {
    const outcome = recordPracticeResult(progressRef.current, result);
    progressRef.current = outcome.progress;
    setProgress(outcome.progress);
    saveProgress(outcome.progress);
    return outcome.reward;
  }, []);

  const equipSkin = useCallback((skinId: string) => {
    const current = progressRef.current;
    if (!current.unlockedSkinIds.includes(skinId)) return;
    const next: AppProgress = { ...current, equippedSkinId: skinId };
    progressRef.current = next;
    setProgress(next);
    saveProgress(next);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const setLastSongId = useCallback((songId: string) => {
    setSettings((prev) => (prev.lastSongId === songId ? prev : { ...prev, lastSongId: songId }));
  }, []);

  const resetProgress = useCallback(() => {
    clearAllStorage();
    const fresh = createDefaultProgress();
    const freshSettings = createDefaultSettings();
    progressRef.current = fresh;
    setProgress(fresh);
    setSettings(freshSettings);
    saveProgress(fresh);
    saveSettings(freshSettings);
    setPreviewSkinId(null);
  }, []);

  const activeSkin = useMemo(
    () => resolveActiveSkin(progress.equippedSkinId || DEFAULT_SKIN_ID, previewSkinId),
    [progress.equippedSkinId, previewSkinId],
  );

  const value = useMemo<ProgressStoreValue>(
    () => ({
      progress,
      settings,
      activeSkin,
      previewSkinId,
      record,
      equipSkin,
      setPreviewSkinId,
      updateSettings,
      setLastSongId,
      resetProgress,
    }),
    [
      progress,
      settings,
      activeSkin,
      previewSkinId,
      record,
      equipSkin,
      updateSettings,
      setLastSongId,
      resetProgress,
    ],
  );

  return <ProgressStoreContext.Provider value={value}>{children}</ProgressStoreContext.Provider>;
}

export function useProgressStore(): ProgressStoreValue {
  const value = useContext(ProgressStoreContext);
  if (!value) {
    throw new Error('useProgressStore 必须在 <ProgressProvider> 内使用');
  }
  return value;
}

/** 便捷派生：已解锁皮肤 id 集合。 */
export function useUnlockedSkinIds(): Set<string> {
  const { progress } = useProgressStore();
  return useMemo(() => new Set(progress.unlockedSkinIds), [progress.unlockedSkinIds]);
}

export { getSkinById };
