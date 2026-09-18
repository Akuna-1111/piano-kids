import { useCallback } from 'react';
import { audioEngine } from '@/core/audio/AudioEngine';

/**
 * 把钢琴的按下 / 松开接到 AudioEngine。
 * 组件永远不直接碰 AudioNode（开发规则 6 / 7）。
 */
export function usePianoAudio() {
  const handleNoteOn = useCallback((note: string, velocity: number) => {
    audioEngine.noteOn(note, velocity);
  }, []);

  const handleNoteOff = useCallback((note: string) => {
    audioEngine.noteOff(note);
  }, []);

  return { handleNoteOn, handleNoteOff };
}
