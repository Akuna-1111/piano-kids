/**
 * 琴键物理尺寸（真实钢琴尺寸映射）。
 *
 * ## 为什么需要这个模块
 *
 * 目标是让孩子在 iPad 上练琴时形成**能迁移到真实钢琴的手部姿势**。
 * 这要求屏幕上的琴键在**物理尺寸**上接近真实钢琴，而不是「按屏幕比例铺满」。
 *
 * 现代钢琴（DIN 8993 等标准）：
 *   白键前缘宽度 23.5 mm
 *   一个八度跨度（7 个白键）164.5 mm
 *
 * ## 难点：浏览器不告诉你物理尺寸
 *
 * CSS 的 `mm` / `in` 在规范里被固定为 1in = 96px，**与真实物理尺寸无关**
 * （iOS Safari 与 Chrome 都遵守这条）。因此 `23.5mm` 写进 CSS，在任何设备上都是 88.8px，
 * 在 iPad 上实际只有约 17 mm —— 而不是 23.5 mm。
 *
 * 浏览器也没有 PPI 接口。因此这里用「已知机型表 + devicePixelRatio」反推：
 *
 *   1 device px = 1 / ppi 英寸
 *   1 CSS px    = dpr 个 device px
 *   ⇒ 1 CSS px = dpr / ppi 英寸 = 25.4 × dpr / ppi 毫米
 *   ⇒ 1 mm     = ppi / (25.4 × dpr) 个 CSS px
 *
 * 验证：iPad（ppi=264, dpr=2）→ 1mm = 264 / 50.8 = 5.1969 CSS px
 *       → 23.5mm = 122.1 CSS px；八度跨度 164.5mm = 854.9 CSS px
 */

/** 现代钢琴白键前缘宽度（毫米）。 */
export const REAL_WHITE_KEY_MM = 23.5;

/** 白键可见长度（毫米）。真实钢琴约 150mm。 */
export const REAL_WHITE_KEY_LENGTH_MM = 150;

/**
 * 白键的长宽比（150 / 23.5 ≈ 6.38）。
 *
 * 键盘撑满剩余高度会让琴键变成「细长条」（15 键时约 18:1），看起来不像钢琴。
 * 所以高度按这个比例反推：`高 = 键宽 × 6.38`，再用可用高度封顶。
 * 屏幕高度远小于一台真琴（iPad 竖屏约 104mm，真琴白键就有 150mm），
 * 所以**绝对长度永远达不到**，但长宽比可以做到 —— 看起来才像琴键。
 */
export const REAL_KEY_ASPECT = REAL_WHITE_KEY_LENGTH_MM / REAL_WHITE_KEY_MM;

/** 一个八度跨度（7 个白键，毫米）。 */
export const REAL_OCTAVE_SPAN_MM = REAL_WHITE_KEY_MM * 7;

/** 黑键宽度相对白键的比例（真实钢琴约 0.58）。 */
export const REAL_BLACK_KEY_RATIO = 0.58;

/**
 * 已知机型表：按屏幕 CSS 尺寸（短边 × 长边，竖屏基准）索引物理 PPI。
 *
 * 只收录能确认的目标机型。命中不了就退回兜底值并标记为「估算」，
 * 由界面如实告诉用户 —— 宁可说「估算」，也不要假装精确。
 */
const DEVICE_PPI: Readonly<Record<string, number>> = {
  // iPad mini 8.3"
  '744x1133': 326,
  // iPad 5/6 代 9.7"
  '768x1024': 264,
  // iPad 7/8/9 代 10.2"
  '810x1080': 264,
  // iPad Air 4/5 与 iPad 10 代 10.9"、iPad Air 11"(M2)
  '820x1180': 264,
  // iPad Air 3 / Pro 10.5"
  '834x1112': 264,
  // iPad Pro 11"
  '834x1194': 264,
  // iPad Pro 12.9" / iPad Pro 13"(M4)
  '1024x1366': 264,
};

/** 桌面浏览器在 dpr ≈ 1 时按 CSS 参考像素密度（96dpi）处理。 */
const DESKTOP_PPI = 96;
/** 兜底：绝大多数 iPad 都是 264 ppi。 */
const ASSUMED_PPI = 264;

export type PpiSource = 'device-table' | 'desktop' | 'assumed';

export interface DeviceMetrics {
  ppi: number;
  dpr: number;
  source: PpiSource;
}

export interface MetricsInput {
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
}

/**
 * 估算当前设备的 PPI。纯函数，便于单测覆盖各种机型。
 */
export function estimateDeviceMetrics(input: MetricsInput): DeviceMetrics {
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const short = Math.round(Math.min(input.screenWidth, input.screenHeight));
  const long = Math.round(Math.max(input.screenWidth, input.screenHeight));
  const key = `${short}x${long}`;

  const fromTable = DEVICE_PPI[key];
  if (fromTable !== undefined) {
    return { ppi: fromTable, dpr, source: 'device-table' };
  }
  // dpr 为 1 基本可以确定是没有高密度屏的桌面浏览器，按 96dpi 参考像素处理
  if (dpr === 1) {
    return { ppi: DESKTOP_PPI, dpr, source: 'desktop' };
  }
  return { ppi: ASSUMED_PPI, dpr, source: 'assumed' };
}

/** 读取当前窗口的设备信息（SSR / 测试环境下回退到桌面假设）。 */
export function readDeviceMetrics(): DeviceMetrics {
  if (typeof window === 'undefined' || typeof window.screen === 'undefined') {
    return { ppi: DESKTOP_PPI, dpr: 1, source: 'desktop' };
  }
  return estimateDeviceMetrics({
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio || 1,
  });
}

/** 毫米 → CSS px。 */
export function mmToCssPx(mm: number, metrics: DeviceMetrics): number {
  return (mm * metrics.ppi) / (25.4 * metrics.dpr);
}

/** CSS px → 毫米。 */
export function cssPxToMm(px: number, metrics: DeviceMetrics): number {
  return (px * 25.4 * metrics.dpr) / metrics.ppi;
}

export interface KeyWidthInput {
  /** 白键数量 */
  whiteCount: number;
  /** 键盘可用宽度（CSS px，已扣除页面内边距） */
  availablePx: number;
  metrics: DeviceMetrics;
  /** 目标白键宽度（mm），默认取真实钢琴尺寸 */
  targetMm?: number;
  /**
   * **允许键盘比可用宽度更宽**（默认 false = 放不下就压缩）。
   *
   * 打开后永不压缩：琴键保持真实钢琴尺寸，整块键盘可以宽出屏幕，
   * 由外层横向滚动 / 拖动来「选取区域」。
   *
   * 这一条解开了先前那个死结：**键宽真实** 与 **中央C 能在中间**
   * 在小屏上不可能同时满足（8 键真实尺寸时中央C 只能在最左，
   * 15 键居中就必须压缩键宽）。允许溢出之后两者可以兼得 ——
   * 键保持真实尺寸，中央C 靠滚动位置决定放在哪儿。
   */
  allowOverflow?: boolean;
}

export interface KeyWidthResult {
  /** 单个白键的实际 CSS px 宽度 */
  keyPx: number;
  /** 单个白键的实际物理宽度（mm） */
  keyMm: number;
  /** 实际宽度是否达到了真实钢琴尺寸 */
  isRealSize: boolean;
  /** 整块键盘的自然宽度（CSS px） */
  naturalPx: number;
  /** 键盘是否宽于可用宽度（需要横向滚动 / 拖动才能看到全部） */
  overflows: boolean;
}

/**
 * 解出白键宽度。
 *
 * 规则：**以真实钢琴尺寸为目标，放不下才压缩**（除非 `allowOverflow`）。
 *   - 放得下 → 就用 23.5mm，键盘居中，两侧留白（留白是内容，§55）
 *   - 放不下 → 默认压缩到刚好铺满，并把实际毫米数如实报出来；
 *     `allowOverflow: true` 时改为保持真实尺寸、允许宽出屏幕
 *
 * 绝不放得比真实尺寸更大 —— 那会让手指跨度超出真实钢琴，
 * 反而破坏「练习能迁移到真琴」这个目的。
 */
export function resolveWhiteKeyWidth(input: KeyWidthInput): KeyWidthResult {
  const { whiteCount, availablePx, metrics } = input;
  const targetMm = input.targetMm ?? REAL_WHITE_KEY_MM;
  const count = Math.max(1, whiteCount);
  const safeAvailable = Math.max(1, availablePx);

  const idealPx = mmToCssPx(targetMm, metrics);
  const fitPx = safeAvailable / count;

  const keyPx = input.allowOverflow ? idealPx : Math.min(idealPx, fitPx);
  const naturalPx = keyPx * count;

  return {
    keyPx,
    keyMm: cssPxToMm(keyPx, metrics),
    // 留 0.05mm 容差，避免浮点误差把「刚好放得下」判成没放满
    isRealSize: keyPx >= idealPx - mmToCssPx(0.05, metrics),
    naturalPx,
    overflows: naturalPx > safeAvailable + 1,
  };
}

/** 给界面看的一句话尺寸说明。 */
export function describeKeyWidth(result: KeyWidthResult, metrics: DeviceMetrics): string {
  const mm = result.keyMm.toFixed(1);
  const hint = result.overflows ? '，可左右拖动' : '';
  if (result.isRealSize) {
    return `白键 ${mm} mm（真实钢琴尺寸${hint}）`;
  }
  const precision = metrics.source === 'device-table' ? '' : '约 ';
  return `${precision}白键 ${mm} mm（屏幕所限，真实钢琴为 ${REAL_WHITE_KEY_MM} mm）`;
}
