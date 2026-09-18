import { useEffect, useState } from 'react';
import { audioEngine } from '@/core/audio/AudioEngine';

/**
 * 音频解锁（文档 6.2）。
 *
 * 浏览器要求 AudioContext 在用户手势中创建 / 恢复。
 * 策略：第一次 pointerdown / keydown 就 ensureReady()，不弹「点击开始」遮罩
 * —— 让孩子按下琴键的那一下既是操作也是解锁。
 *
 * 监听器常驻：iOS 从后台回到前台、锁屏解锁后 AudioContext 可能再次 suspended，
 * 下一次触摸会自然恢复。
 */
export function useAudioUnlock(): boolean {
  const [ready, setReady] = useState(() => audioEngine.isReady());

  useEffect(() => {
    const unsubscribe = audioEngine.subscribe((state) => setReady(state === 'running'));

    const unlock = () => {
      void audioEngine.ensureReady().then((ok) => {
        if (ok) setReady(true);
      });
    };

    // 用 capture 阶段：确保 AudioContext 在任何琴键的 noteOn 之前就已经建好，
    // 否则第一次触摸的那一下会晚一点点才出声。
    document.addEventListener('pointerdown', unlock, { passive: true, capture: true });
    document.addEventListener('keydown', unlock, { capture: true });
    document.addEventListener('visibilitychange', unlock);

    return () => {
      document.removeEventListener('pointerdown', unlock, { capture: true });
      document.removeEventListener('keydown', unlock, { capture: true });
      document.removeEventListener('visibilitychange', unlock);
      unsubscribe();
    };
  }, []);

  return ready;
}
