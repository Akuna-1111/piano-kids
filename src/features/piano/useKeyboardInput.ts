import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * 键盘输入（文档 5.3 / 5.4）。
 *
 * 关键决策：
 *  - 事件只挂在键盘容器上，具体琴键靠 `elementFromPoint` 命中测试（读取 data-note）。
 *    这样既支持任意多指（Map<pointerId, note>），又天然支持「手指滑过琴键」的连奏，
 *    而且不依赖 pointerleave 作为唯一释放方案。
 *  - 容器调用 setPointerCapture()，手指划出琴键甚至划出键盘边界后仍能收到 pointermove/up，
 *    不会出现「手指抬起了但音还卡着」。
 *  - pointercancel（系统手势抢占、来电等）与 lostpointercapture 都会释放。
 */

export interface UseKeyboardInputOptions {
  onNoteOn?: (note: string, velocity: number) => void;
  onNoteOff?: (note: string) => void;
  /** 关闭输入（例如结算弹窗打开时） */
  disabled?: boolean;
}

export interface KeyboardInputApi {
  containerRef: RefObject<HTMLDivElement>;
  /** 当前被手指按住的音 */
  pressedNotes: ReadonlySet<string>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (event: { preventDefault: () => void }) => void;
}

function velocityFromPointer(event: ReactPointerEvent<HTMLDivElement>): number {
  // 触摸屏拿不到 analogue pressure，用固定力度；
  // 触控笔 / 支持压感的设备则做一次线性映射，保留表现力。
  if (event.pointerType === 'touch') return 0.9;
  if (event.pointerType === 'pen' && event.pressure > 0) {
    return Math.max(0.35, Math.min(1, 0.35 + event.pressure * 0.75));
  }
  return 0.88;
}

/* ------------------------------------------------------------------ *
 * 滑奏（glissando）
 *
 * ## 为什么需要单独处理
 *
 * 手指从琴键上擦过去时，**同一段手速在窄键上会触发多几倍的音**：
 * 实测 8 键（白键宽 97px）是 79ms 一个音，25 键（白键宽 31px）是 **24ms 一个音**，
 * 也就是 41 个音/秒。而每个音都带着制音器尾巴（0.17s）与一记明亮的起音 ——
 * 叠起来就不是「滑奏」，而是一片嘈杂。
 *
 * 之前两次都在**电平**上找原因（余量、软削波、削波样本数），所以没修好：
 * 实测这种滑动的输出峰值只有 0.90、软削波几乎没有工作，**根本不是削波问题**。
 * 真正的问题在**手势被当成了 N 次独立按键**。
 *
 * ## 规则
 *
 *  · 「上一个键没按多久就滑到了下一个键」( < `GLIDE_HOLD_MS` ) 才算滑奏 ——
 *    正常的逐键弹奏每个键都按住几百毫秒，**完全不受影响**
 *  · 滑奏的音按 `GLIDE_VELOCITY` 发声：擦过去本来就比按下去轻
 *  · 滑奏限速到 `GLIDE_MIN_GAP_MS` 一个音。**手指停下来时仍然会发声** ——
 *    被限掉的音不会丢，它变成「待补发」，停在该键上就补上（见 `decideGlideOnset`）
 * ------------------------------------------------------------------ */

/** 上一个键按住不到这么久就换了键 → 判定为滑奏 */
export const GLIDE_HOLD_MS = 150;
/** 滑奏时两个音之间的最小间隔（≈15 个音/秒） */
export const GLIDE_MIN_GAP_MS = 65;
/** 滑奏时单个音的力度上限（擦过去，不是按下去） */
export const GLIDE_VELOCITY = 0.6;

export interface GlideOnsetDecision {
  /** false = 先别出声，等 `delayMs` 之后再看手指还在不在这个键上 */
  emit: boolean;
  velocity: number;
  delayMs: number;
}

/** 滑奏时的发声决策（纯函数，便于单测）。 */
export function decideGlideOnset(options: {
  gliding: boolean;
  baseVelocity: number;
  sinceLastOnsetMs: number;
}): GlideOnsetDecision {
  const { gliding, baseVelocity, sinceLastOnsetMs } = options;
  if (!gliding) return { emit: true, velocity: baseVelocity, delayMs: 0 };
  const velocity = Math.min(baseVelocity, GLIDE_VELOCITY);
  const delayMs = GLIDE_MIN_GAP_MS - sinceLastOnsetMs;
  if (delayMs <= 0) return { emit: true, velocity, delayMs: 0 };
  return { emit: false, velocity, delayMs };
}

interface PendingNote {
  note: string;
  velocity: number;
}

interface PointerState {
  /** 这个手指当前压着的音（null = 在键盘上但没落在任何键上） */
  note: string | null;
  /** 当前这个键是什么时候按下的 —— 用来区分「滑过去」与「按下去」 */
  pressedAt: number;
  /** 上一次真正发声的时刻 —— 滑奏限速用 */
  lastOnsetAt: number;
  /** 被限速挡下、等待补发的音 */
  pending: PendingNote | null;
  pendingTimer: ReturnType<typeof setTimeout> | null;
}

export function useKeyboardInput(options: UseKeyboardInputOptions = {}): KeyboardInputApi {
  const { onNoteOn, onNoteOff, disabled = false } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  /** pointerId → 这个手指的状态 */
  const pointers = useRef(new Map<number, PointerState>());
  const [pressedNotes, setPressedNotes] = useState<ReadonlySet<string>>(() => new Set());

  const stateOf = useCallback((pointerId: number): PointerState => {
    let state = pointers.current.get(pointerId);
    if (!state) {
      state = { note: null, pressedAt: 0, lastOnsetAt: 0, pending: null, pendingTimer: null };
      pointers.current.set(pointerId, state);
    }
    return state;
  }, []);

  // 回调放进 ref，事件处理函数保持稳定引用，避免每次渲染重绑
  const onNoteOnRef = useRef(onNoteOn);
  const onNoteOffRef = useRef(onNoteOff);
  onNoteOnRef.current = onNoteOn;
  onNoteOffRef.current = onNoteOff;

  const syncPressed = useCallback(() => {
    const next = new Set<string>();
    for (const state of pointers.current.values()) {
      if (state.note) next.add(state.note);
      // 待补发的音也要立刻显示为按下 —— 视觉上不能「手指在键上但键没亮」
      if (state.pending) next.add(state.pending.note);
    }
    setPressedNotes((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const note of next) {
          if (!prev.has(note)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, []);

  const noteAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const container = containerRef.current;
    if (!container || typeof document === 'undefined') return null;
    const element = document.elementFromPoint(clientX, clientY);
    if (!element) return null;
    const keyElement = (element as HTMLElement).closest?.('[data-note]') as HTMLElement | null;
    if (!keyElement || !container.contains(keyElement)) return null;
    return keyElement.dataset.note ?? null;
  }, []);

  const clearPending = useCallback((state: PointerState) => {
    if (state.pendingTimer !== null) {
      clearTimeout(state.pendingTimer);
      state.pendingTimer = null;
    }
    state.pending = null;
  }, []);

  /** 把某个指针切换到目标音：先放开旧音，再按下新音（滑奏按滑奏的规则） */
  const movePointerToNote = useCallback(
    (pointerId: number, note: string | null, event: ReactPointerEvent<HTMLDivElement>) => {
      const state = stateOf(pointerId);
      if (state.note === note && state.pending === null) return;

      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const gliding = state.note !== null && now - state.pressedAt < GLIDE_HOLD_MS;
      const previous = state.note;

      clearPending(state);
      state.note = note;
      state.pressedAt = now;
      if (previous) onNoteOffRef.current?.(previous);

      if (note) {
        const decision = decideGlideOnset({
          gliding,
          baseVelocity: velocityFromPointer(event),
          sinceLastOnsetMs: now - state.lastOnsetAt,
        });
        if (decision.emit) {
          state.lastOnsetAt = now;
          onNoteOnRef.current?.(note, decision.velocity);
        } else {
          state.pending = { note, velocity: decision.velocity };
          state.pendingTimer = setTimeout(() => {
            const pending = state.pending;
            state.pending = null;
            state.pendingTimer = null;
            // 手指已经滑走了就不补发（否则会冒出一个不属于任何按键的音）
            if (!pending || state.note !== pending.note) return;
            state.lastOnsetAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            onNoteOnRef.current?.(pending.note, pending.velocity);
          }, decision.delayMs);
        }
      }
      syncPressed();
    },
    [clearPending, stateOf, syncPressed],
  );

  const releasePointer = useCallback(
    (pointerId: number) => {
      const state = pointers.current.get(pointerId);
      if (!state) return;
      clearPending(state);
      pointers.current.delete(pointerId);
      if (state.note) onNoteOffRef.current?.(state.note);
      syncPressed();
    },
    [clearPending, syncPressed],
  );

  const releaseAll = useCallback(() => {
    for (const state of pointers.current.values()) {
      clearPending(state);
      if (state.note) onNoteOffRef.current?.(state.note);
    }
    pointers.current.clear();
    syncPressed();
  }, [clearPending, syncPressed]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // 只处理主按键；鼠标右键交给 contextmenu 屏蔽
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const container = containerRef.current;
      if (container) {
        try {
          container.setPointerCapture(event.pointerId);
        } catch {
          /* 某些环境不支持捕获，退化为普通事件流 */
        }
      }
      movePointerToNote(event.pointerId, noteAtPoint(event.clientX, event.clientY), event);
    },
    [disabled, movePointerToNote, noteAtPoint],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!pointers.current.has(event.pointerId)) return;
      movePointerToNote(event.pointerId, noteAtPoint(event.clientX, event.clientY), event);
    },
    [disabled, movePointerToNote, noteAtPoint],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      releasePointer(event.pointerId);
      const container = containerRef.current;
      if (container && container.hasPointerCapture?.(event.pointerId)) {
        try {
          container.releasePointerCapture(event.pointerId);
        } catch {
          /* 忽略 */
        }
      }
    },
    [releasePointer],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer],
  );

  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      releasePointer(event.pointerId);
    },
    [releasePointer],
  );

  const onContextMenu = useCallback((event: { preventDefault: () => void }) => {
    // iPad 长按会弹出系统菜单，直接屏蔽
    event.preventDefault();
  }, []);

  // 组件卸载 / 页面隐藏时绝不允许残留按下的音
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) releaseAll();
    };
    const handleBlur = () => releaseAll();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      releaseAll();
    };
  }, [releaseAll]);

  return useMemo(
    () => ({
      containerRef,
      pressedNotes,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onContextMenu,
    }),
    [
      pressedNotes,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture,
      onContextMenu,
    ],
  );
}
