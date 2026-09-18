/**
 * 皮肤的对比度约束（设计规范 §47 Skin Contrast Rule）。
 *
 * 规范原文：
 *   无论任何皮肤：音名可读 / 黑白键关系可辨 / 高亮状态明确 / 按下状态可见。
 *   皮肤绝不能为了「主题感」降低钢琴操作效率。
 *   优先级永远是：可弹 > 可辨 > 可学 > 好看。
 *
 * 这是少数可以**用数学验证**的设计规则，因此把它实现出来并由单测强制执行 ——
 * 这样「为了主题感牺牲可读性」在测试阶段就会被拦住，而不是等到孩子看不清琴键才发现。
 */

/** sRGB 通道（0–255）线性化。 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 解析 #rgb / #rrggbb。解析失败返回 null（让调用方自己决定如何处理）。 */
export function parseHex(input: string): Rgb | null {
  const value = input.trim().replace(/^#/, '');
  if (value.length === 3) {
    const [r, g, b] = value.split('');
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }
  if (value.length === 6) {
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }
  return null;
}

/** WCAG 相对亮度。 */
export function relativeLuminance(color: Rgb): number {
  return (
    0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b)
  );
}

/** WCAG 对比度（1:1 – 21:1）。 */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastHex(a: string, b: string): number | null {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return null;
  return contrastRatio(ra, rb);
}

/**
 * 取出 `linear-gradient(180deg, #aaa 0%, #bbb 100%)` 里的两个色标。
 * 用于校验「极轻微纵向明暗变化」而不是「明显玻璃渐变」（§10.2）。
 */
export function gradientStops(value: string): string[] {
  return Array.from(value.matchAll(/#[0-9a-fA-F]{3,6}/g)).map((match) => match[0]);
}

/** 取一个颜色值（可能是纯色，也可能是渐变）的代表色 —— 用最亮的一个。 */
export function dominantHex(value: string): string | null {
  const stops = gradientStops(value);
  if (stops.length === 0) return parseHex(value) ? value : null;
  let best = stops[0];
  let bestLum = -1;
  for (const stop of stops) {
    const rgb = parseHex(stop);
    if (!rgb) continue;
    const lum = relativeLuminance(rgb);
    if (lum > bestLum) {
      bestLum = lum;
      best = stop;
    }
  }
  return best;
}
