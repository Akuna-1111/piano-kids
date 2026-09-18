import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 设计规范 §3.2 / §8.1 / §11.3 的自动化守卫：
 *
 *   §3.2 任何 UI、按钮、卡片、状态、奖励、皮肤、导航、空状态、数据字段都禁止使用 Emoji
 *   §8.1 图标统一使用 SVG / CSS 图形 / 自绘 Icon；**禁止字符号代替图标**
 *   §11.3 皮肤装饰禁止使用 Emoji
 *
 * 这一条只能靠源码扫描守住 —— 它防的不是「渲染错」，而是「有人顺手又加了一个 Emoji」。
 */

const SRC = resolve(__dirname, '..');

/** 违规：Emoji 与「用字符号当图标」的符号区段。 */
const FORBIDDEN_RANGES: ReadonlyArray<readonly [number, number, string]> = [
  [0x1f300, 0x1faff, 'Emoji（杂项符号与象形文字）'],
  [0x1f000, 0x1f2ff, 'Emoji（麻将/扑克/括符）'],
  [0x2600, 0x27bf, 'Emoji 与装饰性符号'],
  [0x2b00, 0x2bff, 'Emoji 与箭头变体'],
  [0x2190, 0x21ff, '箭头（不可当作图标）'],
  [0x25a0, 0x25ff, '几何图形（不可当作图标）'],
  [0xfe0f, 0xfe0f, '变体选择符（Emoji 呈现）'],
];

/**
 * 允许保留的例外，都是**文字内容本身**而非图标：
 *   ♯ ♭ ♮  升降还原号 —— 乐理符号，属于音名/简谱文本
 *   × ÷ ± － 数学与排版符号（目前未使用，留给文案）
 */
const ALLOWED = new Set(['♯', '♭', '♮', '×', '÷', '±']);

/** 扫描范围：UI 源码。测试文件本身会内联期望值，排除掉；本文件自身也排除。 */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

/** 去掉注释，避免文档性文字里的符号被误判（它们不是 UI）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function isForbidden(char: string): string | null {
  if (ALLOWED.has(char)) return null;
  const code = char.codePointAt(0);
  if (code === undefined) return null;
  for (const [start, end, label] of FORBIDDEN_RANGES) {
    if (code >= start && code <= end) return label;
  }
  return null;
}

describe('设计规范守卫：UI 源码禁止 Emoji 与字符号图标', () => {
  const files = collectSourceFiles(SRC);

  it('扫描范围覆盖到全部 UI 源码', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('没有任何 Emoji 或「字符号代替图标」（§3.2 / §8.1 / §11.3）', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const char of line) {
          const label = isForbidden(char);
          if (label) {
            const code = char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
            violations.push(
              `${relative(SRC, file)}:${index + 1}  U+${code} 「${char}」 — ${label}`,
            );
          }
        }
      });
    }

    expect(violations, `\n发现 ${violations.length} 处违规：\n${violations.join('\n')}\n`).toEqual(
      [],
    );
  });

  it('图标一律走自绘 Icon 组件，不直接内联 <svg> 到业务组件', () => {
    // 例外：**专职绘制的组件**。它们的职责就是产出图形，不是「业务组件里随手画个图标」。
    // 目前只有两个，且都必须在这里显式登记，避免变成随手开的口子。
    const DRAWING_COMPONENTS = [
      join('shared', 'ui', 'Icon.tsx'), // 图标库本身
      join('features', 'notation', 'StaffNote.tsx'), // 五线谱谱面
    ];

    const offenders: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.tsx')) continue;
      if (DRAWING_COMPONENTS.some((suffix) => file.endsWith(suffix))) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      if (/<svg[\s>]/.test(source)) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(
      offenders,
      `\n这些文件内联了 <svg>，应当改用 <Icon />（若确为专职绘制组件，请登记到 DRAWING_COMPONENTS）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
