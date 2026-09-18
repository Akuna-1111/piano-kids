import type { ReactNode } from 'react';
import { cx } from '@/shared/utils/cx';

/**
 * 项目自绘图标集（设计规范 §8）。
 *
 * 规范约束：
 *   §8.1 统一使用 SVG / CSS 图形 / 自绘 Icon；**禁止 Emoji**、禁止「字符号代替图标」
 *   §8.2 单色、线性、2px 左右视觉线宽、几何简洁、端点圆润
 *   §8.3 每个图标必须表达一个明确动作或状态，不为「填空」而放图标
 *
 * 实现要点：
 *   - 统一 24×24 viewBox，全部使用 currentColor，颜色由调用处的文字色决定
 *   - strokeWidth 按渲染尺寸反算，保证**任何尺寸下视觉线宽都是 2px**
 *   - 端点/拐角 round，符合「端点圆润」
 */

export type IconName =
  // 导航与状态
  | 'arrow-left'
  | 'chevron-down'
  | 'check'
  | 'sliders'
  // 播放与声音
  | 'play'
  | 'stop'
  | 'volume'
  | 'sound'
  // 音乐
  | 'note'
  | 'notes'
  | 'keyboard'
  // 节拍
  | 'metronome'
  // 入口与成长
  | 'hanger'
  | 'sparkle'
  | 'star'
  | 'star-filled'
  // 勋章
  | 'sprout'
  | 'compass'
  | 'gem'
  | 'target'
  | 'trending-up'
  | 'calendar'
  | 'medal';

/** 规范 §8.2 允许的图标尺寸 */
export type IconSize = 16 | 20 | 24 | 28 | 32;

const ICONS: Record<IconName, ReactNode> = {
  // ---------------------------------------------------------- 导航与状态
  'arrow-left': <path d="M14.5 5 7.5 12l7 7" />,
  'chevron-down': <path d="M6.5 10 12 15.5 17.5 10" />,
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.1" />
      <circle cx="15" cy="12" r="2.1" />
      <circle cx="7.5" cy="17" r="2.1" />
    </>
  ),

  // ---------------------------------------------------------- 播放与声音
  play: <path d="M8.5 5.5 18.5 12l-10 6.5z" />,
  stop: <rect x="6.6" y="6.6" width="10.8" height="10.8" rx="2.4" />,
  volume: (
    <>
      <path d="M4 9.5h3L11 6v12l-4-3.5H4z" />
      <path d="M14.4 9.6a3.6 3.6 0 0 1 0 4.8" />
      <path d="M17 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  sound: (
    <>
      <path d="M5.5 9.4a6 6 0 0 1 0 5.2" />
      <path d="M9.6 6.8a9.5 9.5 0 0 1 0 10.4" />
      <path d="M13.7 4.2a13 13 0 0 1 0 15.6" />
    </>
  ),

  // ---------------------------------------------------------------- 音乐
  note: (
    <>
      <path d="M11.5 18V5" />
      <path d="M11.5 5c3.2.9 5.2 3 5.2 6.2" />
      <circle cx="9" cy="18" r="2.5" />
    </>
  ),
  notes: (
    <>
      <path d="M8 17V6l10-2v11" />
      <path d="M8 6.4 18 4.4" />
      <circle cx="5.5" cy="17" r="2.5" />
      <circle cx="15.5" cy="15" r="2.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7.5 7v10M12 7v10M16.5 7v10" />
      <path d="M9.75 7v4.6M14.25 7v4.6" />
    </>
  ),
  // 节拍
  metronome: (
    <>
      <path d="M9.4 19.5 11 6.5h2l1.6 13z" />
      <path d="M7.5 19.5h9" />
      <path d="M12 7.2 16 17" />
      <circle cx="16" cy="17" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),

  // ------------------------------------------------------------ 入口与成长
  hanger: (
    <>
      <path d="M12 7.5a2 2 0 1 1 2.4-1.9" />
      <path d="M12 7.5 3.9 14.1A1.6 1.6 0 0 0 4.9 17h14.2a1.6 1.6 0 0 0 1-2.9z" />
    </>
  ),
  sparkle: <path d="M12 3 13.9 10.1 21 12l-7.1 1.9L12 21l-1.9-7.1L3 12l7.1-1.9z" />,
  star: (
    <path d="M12 3.6l2.6 5.3 5.8.9-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.8l5.8-.9z" />
  ),
  'star-filled': (
    <path
      d="M12 3.6l2.6 5.3 5.8.9-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.8l5.8-.9z"
      fill="currentColor"
      stroke="none"
    />
  ),

  // ---------------------------------------------------------------- 勋章
  sprout: (
    <>
      <path d="M12 20.5v-7.5" />
      <path d="M12 13C12 9.1 9.1 7 5 7c0 3.9 2.9 6 7 6z" />
      <path d="M12 13c0-3.9 2.9-6 7-6 0 3.9-2.9 6-7 6z" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.6 8.4 13.6 13.6 8.4 15.6 10.4 10.4z" />
    </>
  ),
  gem: (
    <>
      <path d="M5.6 9 9.2 4.5h5.6L18.4 9 12 20z" />
      <path d="M5.6 9h12.8" />
      <path d="M9.2 4.5 8.4 9l3.6 11" />
      <path d="M14.8 4.5 15.6 9 12 20" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  'trending-up': (
    <>
      <path d="M4 17.5 10 11.5l4 4 6-6.5" />
      <path d="M15 9h5v5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10.5h17" />
      <path d="M8.5 3v4.5M15.5 3v4.5" />
      <circle cx="12" cy="15.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5.4" />
      <path d="M8.6 4 10.4 10.2M15.4 4 13.6 10.2" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  /** §8.2：16 极少量辅助 / 20 常规按钮 / 24 主要控制 / 28–32 特殊核心控制 */
  size?: IconSize;
  className?: string;
  /** 传了才有语义（读屏可读）；不传则按纯装饰对读屏隐藏 */
  label?: string;
}

export function Icon({ name, size = 20, className, label }: IconProps) {
  // 让「视觉线宽」恒为 2px，而不是让 viewBox 里的 2 个单位随尺寸缩放
  const strokeWidth = 48 / size;
  return (
    <svg
      className={cx('icon', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}
