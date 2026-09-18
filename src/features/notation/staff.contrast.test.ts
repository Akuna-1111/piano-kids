import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 谱面在舞台底色上的对比度守卫。
 *
 * ## 为什么需要
 *
 * 去掉谱面的卡片外壳之后，谱线、线音名、简谱方框、拼音都**直接画在舞台底色上**，
 * 没有白色卡面兜底了。这类问题在 jsdom 里完全看不出来（没有渲染就没有颜色），
 * 在真机上也很容易被「看起来还行」放过，但它是有客观判据的：
 *
 *   · 谱线 / 线音名 / 简谱方框 —— WCAG 1.4.11「理解内容所必需的图形」→ 3:1
 *     （谱线承载「音符落在第几条线上」这个信息，去掉它这个练习就不成立了）
 *   · 简谱数字 / 唱名拼音 / 线音名 —— 文字 → 4.5:1
 *
 * 与 `skins.contrast.test.ts` 同一个思路：把「好看」变成「算得出来」。
 *
 * ## 这个测试到底在测什么
 *
 * 它**从 staff.css 里读出实际用的变量名，再去 tokens.css 解析出颜色值**，
 * 而不是把颜色抄一份进来 —— 否则改了 CSS、测试还照样绿。
 */

const TOKENS = readFileSync(resolve(__dirname, '..', '..', 'styles', 'tokens.css'), 'utf8');
const STAFF = readFileSync(resolve(__dirname, 'staff.css'), 'utf8');

/* ---------------- 颜色工具 ---------------- */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 从 tokens.css 解析某个语义变量的十六进制值。 */
function token(name: string): string {
  const match = new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(TOKENS);
  if (!match) throw new Error(`tokens.css 里找不到 --${name} 的十六进制值`);
  return match[1];
}

/**
 * 读出 staff.css 里某条规则某个属性实际引用的 token 名。
 * 这样测试跟着 CSS 走，而不是跟着一份抄来的颜色走。
 */
function tokenUsedBy(pattern: RegExp, prop: string, label: string): string {
  const rule = pattern.exec(STAFF)?.[1];
  if (rule === undefined) throw new Error(`staff.css 里找不到 ${label} 的规则`);
  const match = new RegExp(`${prop}\\s*:\\s*var\\(--([\\w-]+)\\)`).exec(rule);
  if (!match) throw new Error(`${label} 的 ${prop} 没有用 var(--…)`);
  return match[1];
}

/** 舞台底色的两端（径向渐变），两端都要满足才算过。 */
const STAGE_STOPS = (() => {
  const declaration = /--skin-stage-bg\s*:([^;]*);/.exec(TOKENS)?.[1];
  if (!declaration) throw new Error('tokens.css 里找不到 --skin-stage-bg');
  const hexes = declaration.match(/#[0-9a-fA-F]{6}/g) ?? [];
  if (hexes.length < 2) throw new Error('--skin-stage-bg 里没有解析到两个颜色停靠点');
  return hexes;
})();

/** 最差的一端（对比度最低的那个背景）。 */
function worstAgainstStage(color: string): number {
  return Math.min(...STAGE_STOPS.map((stop) => contrast(color, stop)));
}

interface Check {
  label: string;
  /** 从 staff.css 取色的方式 */
  tokenName: string;
  /** 最低要求 */
  need: number;
}

describe('谱面在舞台底色上的对比度（去掉卡片之后由谱面自己承担）', () => {
  it('舞台底色解析出了两个停靠点', () => {
    expect(STAGE_STOPS.length).toBeGreaterThanOrEqual(2);
  });

  const checks: Check[] = [
    {
      label: '谱线',
      tokenName: tokenUsedBy(/\.staff__lines line,\s*\.staff__ledger\s*\{([^}]*)\}/, 'stroke', '谱线'),
      need: 3,
    },
    {
      label: '线音名',
      tokenName: tokenUsedBy(/\.staff__reference text\s*\{([^}]*)\}/, 'fill', '线音名'),
      need: 3,
    },
    {
      label: '简谱数字的方框',
      tokenName: tokenUsedBy(/\.staff__label-box\s*\{([^}]*)\}/, 'stroke', '简谱方框'),
      need: 3,
    },
    {
      label: '简谱数字',
      tokenName: tokenUsedBy(/\.staff__label-solfege\s*\{([^}]*)\}/, 'fill', '简谱数字'),
      need: 4.5,
    },
    {
      label: '唱名拼音',
      tokenName: tokenUsedBy(/\.staff__label-pinyin\s*\{([^}]*)\}/, 'fill', '唱名拼音'),
      need: 4.5,
    },
    {
      label: '音符与谱号',
      tokenName: tokenUsedBy(/\.staff__glyph path\s*\{([^}]*)\}/, 'fill', '音符与谱号'),
      need: 3,
    },
  ];

  it.each(checks)('$label 在最差的一端仍达到 $need:1', ({ label, tokenName, need }) => {
    const value = token(tokenName);
    const ratio = worstAgainstStage(value);
    expect(
      ratio,
      `${label} 用 --${tokenName}（${value}）在舞台底色上最差只有 ${ratio.toFixed(2)}:1，需要 ${need}:1`,
    ).toBeGreaterThanOrEqual(need);
  });

  it('谱线不再使用 --color-border-strong（那只有约 1.2–1.5:1）', () => {
    expect(tokenUsedBy(/\.staff__lines line,\s*\.staff__ledger\s*\{([^}]*)\}/, 'stroke', '谱线')).not.toBe(
      'color-border-strong',
    );
  });

  it('拼音用的是「当文字用」的深一档 accent，而不是 --color-accent 本身', () => {
    const name = tokenUsedBy(/\.staff__label-pinyin\s*\{([^}]*)\}/, 'fill', '唱名拼音');
    expect(name).toBe('color-accent-strong');
    // 原色确实不够 —— 说明这个区分不是多余的
    expect(worstAgainstStage(token('color-accent'))).toBeLessThan(4.5);
  });
});
