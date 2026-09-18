import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { cx } from '@/shared/utils/cx';
import {
  REAL_KEY_ASPECT,
  readDeviceMetrics,
  resolveWhiteKeyWidth,
  type DeviceMetrics,
  type KeyWidthResult,
} from './keySize';
import { getKeyboardLayout, type KeyboardSize } from './pianoLayout';
import { useKeyboardInput } from './useKeyboardInput';
import './piano.css';

export interface KeyFeedback {
  note: string;
  kind: 'correct' | 'wrong';
  /** 每次反馈给一个新的 token，用于重放动画（同一个音连续弹错也能抖动） */
  token: number;
}

export interface PianoKeyboardProps {
  size: KeyboardSize;
  /** 当前要弹的目标音（强引导） */
  guideNote?: string | null;
  /** 下一个音（弱提示） */
  nextNote?: string | null;
  /** 短促的判定反馈 */
  feedback?: KeyFeedback | null;
  /** 是否在琴键上显示音名 */
  showNoteNames?: boolean;
  /** 结算弹窗等场景下关闭输入 */
  disabled?: boolean;
  onNoteOn?: (note: string, velocity: number) => void;
  onNoteOff?: (note: string) => void;
  className?: string;
  /** 键盘尺寸算出来后回调（白键实际毫米数等），供界面如实展示 */
  onMetrics?: (result: KeyWidthResult & { metrics: DeviceMetrics }) => void;
}

/**
 * 钢琴键盘（文档 5.2 + 真实尺寸映射）。
 *
 * ## 结构
 * 双层结构：白键层正常流式排布，黑键层绝对定位覆盖。
 * 之所以不用「白键黑键全部 display:flex」，是因为那样黑键的相对位置会随屏幕宽度漂移，
 * 也无法扩展到 25 键。这里所有水平位置都用「白键宽度的百分比」表达，与像素宽度解耦 ——
 * 也正因为如此，下面按**物理尺寸**设定整块键盘的宽度时，内部布局无需任何改动。
 *
 * ## 尺寸
 * 目标白键宽度取真实钢琴的 23.5mm（八度跨度 164.5mm），让孩子的手指跨度
 * 能迁移到真实钢琴。**放得下就用真实尺寸并居中留白，放不下才压缩**，
 * 且绝不放大超过真实尺寸。实际毫米数通过 `onMetrics` 报给界面，由界面如实告知。
 *
 * 本组件不负责评分、不负责音频（开发规则 8）：只报告「哪个音被按下 / 松开」。
 */
function PianoKeyboardImpl({
  size,
  guideNote = null,
  nextNote = null,
  feedback = null,
  showNoteNames = true,
  disabled = false,
  onNoteOn,
  onNoteOff,
  className,
  onMetrics,
}: PianoKeyboardProps) {
  const layout = useMemo(() => getKeyboardLayout(size), [size]);
  const frameRef = useRef<HTMLDivElement>(null);
  const [availablePx, setAvailablePx] = useState<number | null>(null);
  const [availablePy, setAvailablePy] = useState<number | null>(null);
  const metrics = useMemo(() => readDeviceMetrics(), []);

  const { containerRef, pressedNotes, ...handlers } = useKeyboardInput({
    onNoteOn,
    onNoteOff,
    disabled,
  });

  // 观察「可用宽度」的是外层 frame，而不是键盘本身 ——
  // 键盘宽度依赖这个测量结果，观察自己会形成循环。
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const measure = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width > 0) {
        setAvailablePx(rect.width);
        setAvailablePy(rect.height);
      }
    };

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width;
          const height = entry.contentRect.height;
          if (width > 0) {
            setAvailablePx(width);
            setAvailablePy(height);
          }
        }
      });
      observer.observe(frame);
      return () => observer.disconnect();
    }

    // 没有 ResizeObserver 的环境（老浏览器 / jsdom）：至少量一次并跟随窗口变化。
    // 量不到就退回原有的「铺满容器」行为，功能降级但不会坏。
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  const keyWidth = useMemo<KeyWidthResult | null>(() => {
    if (availablePx === null) return null;
    return resolveWhiteKeyWidth({
      whiteCount: layout.whiteKeys.length,
      availablePx,
      metrics,
      // **永不压缩**：宁可键盘宽出屏幕、由拖动来选取区域，
      // 也不把琴键压窄 —— 见 keySize.ts 的 allowOverflow
      allowOverflow: true,
    });
  }, [availablePx, layout.whiteKeys.length, metrics]);

  /** 键盘高度：按真实白键长宽比反推，再用可用高度封顶（屏幕高永远小于真琴，够不到的部分不强求） */
  const keyboardHeightPx = useMemo(() => {
    if (!keyWidth) return null;
    const ideal = keyWidth.keyPx * REAL_KEY_ASPECT;
    return availablePy === null ? ideal : Math.min(ideal, availablePy);
  }, [keyWidth, availablePy]);

  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;
  useEffect(() => {
    if (keyWidth) onMetricsRef.current?.({ ...keyWidth, metrics });
  }, [keyWidth, metrics]);

  // ------------------------------------------------------------ 横向选取区域

  /**
   * 把**中央C 滚到中间**。
   *
   * 钢琴课第一步教的是「先找中央C」，而 15 键真实尺寸下键盘比屏幕宽得多 ——
   * 如果默认从最左边开始看，中央C 又会落在边上。所以默认视窗以 C4 为中心，
   * 孩子也可以自己左右拖动去够其它的音（这正是「选取区域」的意思）。
   */
  useEffect(() => {
    const frame = frameRef.current;
    const container = containerRef.current;
    if (!frame || !container || !keyWidth) return;
    const middleC = container.querySelector<HTMLElement>('[data-note="C4"]');
    if (!middleC) return;
    frame.scrollLeft = middleC.offsetLeft + middleC.offsetWidth / 2 - frame.clientWidth / 2;
  }, [keyWidth]);

  /** 引导键被拖出视窗时把它带回来（否则「亮起来的那个键」看不见了） */
  useEffect(() => {
    const frame = frameRef.current;
    const container = containerRef.current;
    if (!frame || !container || !guideNote) return;
    const key = container.querySelector<HTMLElement>(`[data-note="${guideNote}"]`);
    if (!key) return;
    const start = key.offsetLeft;
    const end = start + key.offsetWidth;
    const viewStart = frame.scrollLeft;
    const viewEnd = viewStart + frame.clientWidth;
    if (start < viewStart) frame.scrollLeft = Math.max(0, start - key.offsetWidth);
    else if (end > viewEnd) frame.scrollLeft = end - frame.clientWidth + key.offsetWidth;
  }, [guideNote]);

  const renderKeyClasses = (
    note: string,
    isBlack: boolean,
    extra: string,
  ): string => {
    const isPressed = pressedNotes.has(note);
    const isGuide = guideNote === note;
    const isNext = !isGuide && nextNote === note;
    const isCorrect = feedback?.kind === 'correct' && feedback.note === note;
    const isWrong = feedback?.kind === 'wrong' && feedback.note === note;
    return cx(
      'pk-key',
      isBlack ? 'pk-key--black' : 'pk-key--white',
      extra,
      isPressed && 'is-pressed',
      isGuide && 'is-guide',
      isNext && 'is-next',
      isCorrect && 'is-correct',
      isWrong && 'is-wrong',
    );
  };

  return (
    <div className="pk-frame" ref={frameRef}>
      <div
        ref={containerRef}
        className={cx('pk', `pk--${size}`, keyWidth && 'is-sized', className)}
        data-keyboard-size={size}
        // 整块键盘的自然宽度：按真实钢琴尺寸算出来（可能宽出屏幕，由拖动选取区域）
        style={
          keyWidth
            ? ({
                '--pk-natural-width': `${keyWidth.naturalPx}px`,
                height: keyboardHeightPx ? `${Math.round(keyboardHeightPx)}px` : undefined,
              } as React.CSSProperties)
            : undefined
        }
        role="application"
        aria-label={`钢琴键盘，共 ${layout.whiteKeys.length + layout.blackKeys.length} 个键`}
        {...handlers}
      >
        <div className="pk__whites">
          {layout.whiteKeys.map((key) => (
            <div
              key={key.note}
              data-note={key.note}
              className={renderKeyClasses(key.note, false, 'pk-key--white')}
              style={{ width: `${key.widthPercent}%` }}
              aria-label={key.note}
            >
              {showNoteNames && key.label ? (
                <span className="pk-key__label">{key.label}</span>
              ) : null}
              {guideNote === key.note ? <span className="pk-key__finger" aria-hidden /> : null}
            </div>
          ))}
        </div>

        <div className="pk__blacks">
          {layout.blackKeys.map((key) => (
            <div
              key={key.note}
              data-note={key.note}
              className={renderKeyClasses(key.note, true, 'pk-key--black')}
              style={{ left: `${key.leftPercent}%`, width: `${key.widthPercent}%` }}
              aria-label={key.note}
            >
              {guideNote === key.note ? <span className="pk-key__finger" aria-hidden /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const PianoKeyboard = memo(PianoKeyboardImpl);
PianoKeyboard.displayName = 'PianoKeyboard';
