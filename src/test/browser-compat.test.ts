import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 浏览器兼容性守卫。
 *
 * ## 为什么需要
 *
 * 一个真实故障：iPad 第 7 代上打开应用是**一片空白**。
 * 两类原因都可能，而且都不会给出任何有用提示：
 *
 *   1. **CSS 用了目标 Safari 不支持的函数** —— 例如 `color-mix()` 需要 Safari 16.2+，
 *      而 iPad 第 7 代可能停在 iPadOS 15 / 16.0。不支持时整条声明失效
 *      （结算遮罩会没有背景色、进度条轨道会消失）。
 *   2. **JS 用了更新的语法**，模块直接 SyntaxError，React 根本没机会挂载 → 白屏。
 *      第 2 类由 `vite.config.ts` 的 `esbuild.target` 负责降级；
 *      但**新语法可以靠构建降级，新 API 不能** —— 所以 API 只能在这里拦。
 *
 * 目标下限：**Safari 15 / iPadOS 15**（iPad 第 7 代能升级到的最低版本之一）。
 * 需要更高版本的特性一律禁止，除非有明确理由并在此处登记。
 */

const SRC = resolve(__dirname, '..');

interface Blocked {
  /** 正则片段 */
  pattern: RegExp;
  /** 需要的最低 Safari 版本 */
  since: string;
  label: string;
}

const BLOCKED: readonly Blocked[] = [
  // ---- CSS ----
  { pattern: /color-mix\(/, since: 'Safari 16.2', label: '改用显式 Token（见 tokens.css 的派生色）' },
  { pattern: /\b\d+(\.\d+)?(dvh|svh|lvh)\b/, since: 'Safari 15.4', label: '改用 vh + env(safe-area-inset-*)' },
  { pattern: /:has\(/, since: 'Safari 15.4', label: '改用显式状态 class' },
  { pattern: /\b(oklch|oklab|color-display-p3)\(/, since: 'Safari 15.4', label: '改用 sRGB 十六进制' },
  { pattern: /@container/, since: 'Safari 16.0', label: '改用媒体查询' },
  { pattern: /text-wrap:\s*balance/, since: 'Safari 17.5', label: '改用 text-wrap: pretty 或不用' },
  { pattern: /@starting-style/, since: 'Safari 17.5', label: '改用 keyframes' },
  { pattern: /(^|[^-\w])popover\s*[=:]/, since: 'Safari 17.0', label: '改用自绘浮层' },
  // ---- JS API（构建无法降级）----
  { pattern: /\.at\(\s*-?\d/, since: 'Safari 15.4', label: '改用索引访问 arr[arr.length - 1]' },
  { pattern: /\.findLast(Index)?\(/, since: 'Safari 15.4', label: '改用反向 for 循环' },
  { pattern: /structuredClone\(/, since: 'Safari 15.4', label: '改用 JSON 深拷贝或手写' },
  { pattern: /\.toSorted\(|\.toReversed\(|\.with\(/, since: 'Safari 16.0', label: '改用 [...arr].sort()' },
  { pattern: /Object\.groupBy\(|Map\.groupBy\(/, since: 'Safari 17.4', label: '改用手写分组' },
  { pattern: /Array\.fromAsync\(/, since: 'Safari 16.4', label: '改用 Promise.all' },
];

/** 扫描范围：所有会进产物的源码。测试文件与守卫自身排除。 */
function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    acc.push(full);
  }
  return acc;
}

/** 去掉注释：注释里举例说明被禁特性是合理的，不该被判违规。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('浏览器兼容性守卫（目标下限 Safari 15 / iPadOS 15）', () => {
  const files = collectFiles(SRC);

  it('扫描范围覆盖到全部源码', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('没有使用需要更新 Safari 的 CSS 特性或 JS API（这些在白屏故障里无法自证）', () => {
    const violations: string[] = [];

    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      const lines = source.split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const rule of BLOCKED) {
          if (rule.pattern.test(line)) {
            violations.push(
              `${relative(SRC, file)}:${index + 1}  需要 ${rule.since} —— ${rule.label}\n      ${line.trim()}`,
            );
          }
        }
      });
    }

    expect(
      violations,
      `\n发现 ${violations.length} 处超出兼容下限：\n${violations.join('\n')}\n`,
    ).toEqual([]);
  });

  it('esbuild 与 build 的降级目标保持一致（dev 不降级会让老设备白屏）', () => {
    const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    // 必须同时设置 esbuild.target 与 build.target
    expect(config).toMatch(/esbuild:\s*\{[\s\S]*?target:/);
    expect(config).toMatch(/build:\s*\{[\s\S]*?target:/);
    const targets = [...config.matchAll(/target:\s*(BROWSER_TARGET|'[^']*')/g)].map((m) => m[1]);
    expect(new Set(targets).size, `发现不一致的 target：${targets.join(' / ')}`).toBe(1);
  });

  it('index.html 带白屏兜底：崩溃时必须给出可读信息，而不是一片空白', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    expect(html).toContain('__pianoShowError');
    expect(html).toMatch(/addEventListener\('error'/);
    expect(html).toMatch(/addEventListener\('unhandledrejection'/);
    // 模块加载失败不会走 error 事件，必须有超时兜底
    expect(html).toMatch(/setTimeout\(/);
  });

  it('长按完全属于应用：文档根节点禁用文字选择与长按菜单（AGENTS.md §8）', () => {
    // 又一个「只在真机上才看得见」的故障：iPad 上按住琴键不放，
    // iOS 会进入文字选择模式、弹出放大镜，并把后续 pointer 事件吃掉 ——
    // 表现是「按着按着音就哑了」。jsdom 永远不会复现，所以只能在这里守住。
    const base = stripComments(readFileSync(resolve(SRC, 'styles', 'base.css'), 'utf8'));

    // user-select 是继承属性，必须写在文档根节点上才覆盖所有文字节点
    const rootBlocks = base.match(/html,\s*body,\s*#root\s*\{[^}]*\}/g) ?? [];
    const selectBlock = rootBlocks.find((text) => text.includes('user-select')) ?? '';

    expect(selectBlock, 'base.css 里没有给 html/body/#root 加 user-select').not.toBe('');
    expect(selectBlock).toContain('user-select: none');
    expect(selectBlock).toContain('-webkit-user-select: none');
    expect(selectBlock).toContain('-webkit-touch-callout: none');

    // 留了逃生口，而不是让人直接把上面这条规则删掉
    expect(base).toMatch(/\.is-selectable\s*\{[^}]*user-select:\s*text/);
  });

  it('没有任何样式重新打开文字选择（否则长按又会被系统抢走）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.css')) continue;
      if (file.endsWith('base.css')) continue;
      const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/);
      lines.forEach((line, index) => {
        if (/user-select:\s*(text|auto|all)/.test(line)) {
          offenders.push(`${relative(SRC, file)}:${index + 1}  ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `\n这些地方重新允许了文字选择，长按会被系统抢走（要恢复请用 .is-selectable）：\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});
