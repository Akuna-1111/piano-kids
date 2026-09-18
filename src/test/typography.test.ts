import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 排版层级的守卫（设计规范 §6.3 字号层级 / §6.4 字重 / §6.5 排版原则 / §4.2 空间）。
 *
 * 它守三件事：
 *
 * 一、**字号只能来自 `tokens.css` 的 7 档**。
 *     「先写 15px 试试」是排版失控的起点 —— 一旦每个页面都自己定字号，
 *     屏幕上就会出现十几档似是而非的大小，而这些差异传达不出任何信息。
 *
 * 二、**引用的 token 必须真的存在**。
 *     这条来自一个真实缺陷：`challenges.css` 里写着 `var(--font-size-title)`，
 *     但 `tokens.css` 从未定义过它 —— 于是那条声明整条失效、字号靠继承，
 *     页面不报错、测试也不失败，只有肉眼看「这两个数字大小怪怪的」。
 *
 * 三、**同一层级在不同页面必须是同一个 token**（下面那张角色表）。
 *     层级由「它在页面任务里排第几」决定，不由「它是个标题还是个按钮」决定：
 *     自检页的面板标题与设置页的分组标题都是区块标题，就必须一样大。
 */

const SRC = resolve(__dirname, '..');
const TOKENS = join(SRC, 'styles', 'tokens.css');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

/** 取出某个选择器在某个文件里的声明（选择器按「空白折叠」比较，忽略前置注释）。
 *  选择器列表（`.a, .b {}`）按逗号拆开后逐项比较，所以列出 `.b` 也能命中。 */
function propsOf(file: string, selector: string): Record<string, string> {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const parts = norm(m[1]).split(',').map((s) => s.trim());
    if (!parts.includes(selector)) continue;
    const props: Record<string, string> = {};
    for (const decl of m[2].matchAll(/([\w-]+):\s*([^;]+);/g)) props[decl[1]] = decl[2].trim();
    return props;
  }
  return {};
}

const files = cssFiles(SRC);
const tokensSrc = readFileSync(TOKENS, 'utf8');
const defined = new Set([...tokensSrc.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));

describe('字号与排版层级', () => {
  it('所有字号 / 行高 / 字重 token 引用都有定义（失效引用会让整条声明静默作废）', () => {
    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = relative(SRC, file);
      for (const m of src.matchAll(/var\((--(?:font-size|line-height|font-weight)[\w-]*)\)/g)) {
        if (!defined.has(m[1])) missing.push(`${rel}: var(${m[1]}) 未在 tokens.css 定义`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('tokens.css 之外不得出现自造字号（font-size 只能引用 token）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === TOKENS) continue;
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      const rel = relative(SRC, file);
      for (const m of src.matchAll(/font-size:\s*([^;]+);/g)) {
        const value = m[1].trim();
        if (!value.startsWith('var(--font-size-')) offenders.push(`${rel}: font-size: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('不得出现数字字重与原值行高（§6.4 只用 400/500/600，且必须走 token）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === TOKENS) continue;
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
      const rel = relative(SRC, file);
      for (const m of src.matchAll(/font-weight:\s*([^;]+);/g)) {
        if (!m[1].trim().startsWith('var(--font-weight-')) offenders.push(`${rel}: font-weight: ${m[1].trim()}`);
      }
      for (const m of src.matchAll(/line-height:\s*([^;]+);/g)) {
        if (!m[1].trim().startsWith('var(--line-height-')) offenders.push(`${rel}: line-height: ${m[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 角色表：层级 → 选择器 → 期望字号。
   * 新增页面时**先在这里登记**：写不出属于哪一层，就说明这个元素还没有明确的层级。
   */
  const PAGE = (name: string) => join(SRC, 'features', name);

  const roleTable: ReadonlyArray<{
    role: string;
    token: string;
    entries: ReadonlyArray<readonly [string, string]>;
  }> = [
    {
      role: '一级 · 页面核心标题（唯一主角）',
      token: 'var(--font-size-display)',
      entries: [
        [PAGE('practice/practice.css'), '.pp-result__title'],
        [PAGE('practice/practice.css'), '.pp-result__stars'],
      ],
    },
    {
      role: '一级 · 页面标题',
      token: 'var(--font-size-h1)',
      entries: [
        [join(SRC, 'app', 'app.css'), '.page__title'],
        [PAGE('home/home.css'), '.home__brand-name'],
        [PAGE('practice/practice.css'), '.pp__title-name'],
        [PAGE('challenges/challenges.css'), '.chl__title'],
        [PAGE('tuning/tuning.css'), '.tune__title'],
      ],
    },
    {
      role: '二级 · 主要状态数字',
      token: 'var(--font-size-metric)',
      entries: [
        [PAGE('challenges/challenges.css'), '.chl__combo-value'],
        [PAGE('challenges/challenges.css'), '.chl__result-value'],
        [PAGE('skins/skins.css'), '.wardrobe__growth-value'],
      ],
    },
    {
      role: '二级 · 区块标题',
      token: 'var(--font-size-h2)',
      entries: [
        [PAGE('settings/settings.css'), '.settings__group-title'],
        [PAGE('tuning/tuning.css'), '.tune__panel-title'],
        [PAGE('import/import.css'), '.im__heading'],
        [PAGE('skins/skins.css'), '.wardrobe__preview-title'],
      ],
    },
  ];

  it('同一层级在不同页面用的是同一个字号 token', () => {
    const wrong: string[] = [];
    for (const { role, token, entries } of roleTable) {
      for (const [file, selector] of entries) {
        const value = propsOf(file, selector)['font-size'];
        if (value !== token) {
          wrong.push(`${role}：${relative(SRC, file)} 的 ${selector} 是 ${value ?? '（无 font-size）'}，应为 ${token}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('顶栏高度全站统一为 64px，正文列分区间距统一（§4.2 空间系统）', () => {
    const bars: ReadonlyArray<readonly [string, string]> = [
      [join(SRC, 'app', 'app.css'), '.page__bar'],
      [PAGE('home/home.css'), '.home__bar'],
      [PAGE('practice/practice.css'), '.pp__top'],
      [PAGE('challenges/challenges.css'), '.chl__top'],
      [PAGE('tuning/tuning.css'), '.tune__top'],
    ];
    const wrong: string[] = [];
    for (const [file, selector] of bars) {
      const value = propsOf(file, selector)['min-height'];
      if (value !== '64px') wrong.push(`${relative(SRC, file)} 的 ${selector} 顶栏高度是 ${value ?? '（无）'}，应为 64px`);
    }

    // 光写 64px 不够：栏里的 56px 按钮会把它实际撑到 80px（实测过）
    const barButton = propsOf(join(SRC, 'app', 'app.css'), '.page__bar .ui-btn')['min-height'];
    if (barButton !== 'var(--tap-target-compact)') {
      wrong.push(`顶栏里的按钮是 ${barButton ?? '（无）'}，应为 var(--tap-target-compact)（44px），否则顶栏会变成 80px`);
    }

    // 栏自身的内边距也要一致：12px 内边距 + 44px 控件 = 68px，又比首页高 4px（实测过）
    const paddedBars: ReadonlyArray<readonly [string, string]> = [
      [join(SRC, 'app', 'app.css'), '.page__bar'],
      [PAGE('home/home.css'), '.home__bar'],
      [PAGE('tuning/tuning.css'), '.tune__top'],
    ];
    for (const [file, selector] of paddedBars) {
      const value = propsOf(file, selector)['padding'];
      if (value !== 'var(--space-2) var(--space-4)') {
        wrong.push(`${relative(SRC, file)} 的 ${selector} 内边距是 ${value ?? '（无）'}，应为 var(--space-2) var(--space-4)`);
      }
    }

    const columns: ReadonlyArray<readonly [string, string]> = [
      [PAGE('settings/settings.css'), '.settings__body'],
      [PAGE('import/import.css'), '.im'],
      [PAGE('tuning/tuning.css'), '.tune__body'],
      [PAGE('skins/skins.css'), '.wardrobe__body'],
    ];
    for (const [file, selector] of columns) {
      const value = propsOf(file, selector)['gap'];
      if (value !== 'var(--space-4)') wrong.push(`${relative(SRC, file)} 的 ${selector} 分区间距是 ${value ?? '（无）'}，应为 var(--space-4)`);
    }
    expect(wrong).toEqual([]);
  });

  it('标题用紧行高，正文才用 1.5（否则标题四周会散开，层级看不出来）', () => {
    const titles: ReadonlyArray<readonly [string, string]> = [
      [join(SRC, 'app', 'app.css'), '.page__title'],
      [PAGE('home/home.css'), '.home__brand-name'],
      [PAGE('practice/practice.css'), '.pp__title-name'],
      [PAGE('challenges/challenges.css'), '.chl__title'],
      [PAGE('tuning/tuning.css'), '.tune__title'],
      [PAGE('settings/settings.css'), '.settings__group-title'],
      [PAGE('tuning/tuning.css'), '.tune__panel-title'],
      [PAGE('import/import.css'), '.im__heading'],
      [PAGE('skins/skins.css'), '.wardrobe__preview-title'],
    ];
    const wrong: string[] = [];
    for (const [file, selector] of titles) {
      const value = propsOf(file, selector)['line-height'];
      if (value !== 'var(--line-height-tight)') {
        wrong.push(`${relative(SRC, file)} 的 ${selector} 行高是 ${value ?? '（无）'}，应为 var(--line-height-tight)`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
