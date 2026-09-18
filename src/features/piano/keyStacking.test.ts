import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 键盘的**层叠不变量**（纯 CSS，jsdom 测不出来，所以直接读样式文件断言）。
 *
 * ## 这条为什么值得一个测试
 *
 * 真实钢琴上黑键**永远**在白键之上（黑键离眼睛更近）。这个仓库曾经踩过：
 * 引导样式 `.pk-key.is-guide` 给键加了 `z-index: 3`，而黑键自己是 `z-index: 2` ——
 * 于是**被引导的白键翻到了黑键上面**：黑键被白键键体切掉一半（看起来「黑白交叉」），
 * 而且那个黑键还按不下去（`elementFromPoint` 命中被白键抢走）。
 *
 * 根因不是某个 z-index 写错了，而是**层的 z-index 缺失**：
 * 只要两层没有各自的层叠上下文，键级别的 z-index 就会跨层竞争。
 * 所以这里断言的是层的顺序，而不是某个键的数值 —— 改键的样式不该破坏这条。
 */

// 与 docs.integrity.test.ts 同一套读法（__dirname 在 vitest 里可用）
const css = readFileSync(resolve(__dirname, 'piano.css'), 'utf8');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`piano.css 里找不到规则：${selector}`);
  return match[1];
}

function numberIn(body: string, property: string): number | null {
  const match = new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)%?`).exec(body);
  return match ? Number(match[1]) : null;
}

describe('键盘层叠（黑白键谁在上）', () => {
  it('两层各自有 z-index，且黑键层在白键层之上', () => {
    const whites = ruleBody('.pk__whites');
    const blacks = ruleBody('.pk__blacks');
    const whiteZ = numberIn(whites, 'z-index');
    const blackZ = numberIn(blacks, 'z-index');

    expect(whiteZ, '.pk__whites 必须有 z-index（否则引导键会跨层翻上去）').not.toBeNull();
    expect(blackZ, '.pk__blacks 必须有 z-index').not.toBeNull();
    expect(blackZ!).toBeGreaterThan(whiteZ!);
    // 两层都要能定位，z-index 才生效
    expect(whites).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
    expect(blacks).toMatch(/position:\s*(relative|absolute|fixed|sticky)/);
  });

  it('抬升只发生在引导态，而且只是「同层内高于其他白键」', () => {
    const guideZ = numberIn(ruleBody('.pk-key.is-guide'), 'z-index');
    // 允许不写；写了就必须 ≥ 1（否则描边会被后面的白键盖住）
    if (guideZ !== null) expect(guideZ).toBeGreaterThanOrEqual(1);
    // 白键自己不该设置 z-index：白键的抬升只由引导态触发。
    // （层隔离之后，这个数值再大也翻不出白键层 —— 那条由上面的层断言守住。）
    expect(/z-index/.test(ruleBody('.pk-key--white'))).toBe(false);
  });

  it('白键的引导提示点必须落在黑键带下方 —— 按**最矮**的键盘算，不是按当前这屏', () => {
    const blackBandHeightPercent = numberIn(ruleBody('.pk-key--black'), 'height') ?? 62;
    const finger = ruleBody('.pk-key__finger');
    const bottomRaw = /bottom:\s*([^;]+);/.exec(finger)?.[1]?.trim();
    const dotHeightPx = Number(/height:\s*([\d.]+)px/.exec(finger)?.[1] ?? '0');
    expect(bottomRaw, '.pk-key__finger 必须有 bottom').toBeTruthy();
    expect(dotHeightPx).toBeGreaterThan(0);

    // 只支持两种写法：百分比，或 calc(100% - X%)（后者表示「距顶部 X%」，在黑键带里，是错的）
    let bottomPercent: number;
    const calc = /calc\(\s*100%\s*-\s*([\d.]+)%\s*\)/.exec(bottomRaw!);
    if (calc) bottomPercent = 100 - Number(calc[1]);
    else bottomPercent = Number(bottomRaw!.replace('%', ''));
    expect(Number.isFinite(bottomPercent)).toBe(true);

    // 提示点是固定像素高，所以最危险的时刻是键盘最矮的时候必须整块落在黑键带下方。
    // 键盘最矮的高度来自 .pk 的 min-height（找不到就用 AGENTS §9 里的基线 150px）。
    const minKeyboardPx = numberIn(ruleBody('.pk'), 'min-height') ?? 150;
    const dotPercentAtShortest = (dotHeightPx / minKeyboardPx) * 100;

    expect(
      bottomPercent + dotPercentAtShortest + blackBandHeightPercent,
      `最矮键盘（${minKeyboardPx}px）下，提示点会顶进黑键带`,
    ).toBeLessThanOrEqual(100);
  });
});

/**
 * 琴键的**材质**读数。
 *
 * 起因是产品侧反馈「阴影和间距看起来太细太窄」：真琴白键之间有约 1mm（≈3px）的缝、
 * 前端还有一个比顶面暗的「前脸」，而我们当时是 1px 发丝线 + 4px 细边。
 * 这条守住改后的下限，避免以后又滑回「细线平铺」的观感。
 */
describe('琴键材质（缝隙与前脸要有实体感）', () => {
  const pxIn = (body: string, property: string): number | null => {
    const match = new RegExp(`${property}:\\s*([\\d.]+)px`).exec(body);
    return match ? Number(match[1]) : null;
  };

  it('白键的缝不是发丝线（≥2px），前脸要有可见厚度（≥6px）', () => {
    const white = ruleBody('.pk-key--white');
    expect(pxIn(white, 'border-right')).toBeGreaterThanOrEqual(2);
    expect(pxIn(white, 'border-bottom')).toBeGreaterThanOrEqual(6);
  });

  it('阴影只来自皮肤变量 —— 不硬编码颜色、不用彩色发光（§33 / §7.3）', () => {
    for (const selector of ['.pk-key--white', '.pk-key--black']) {
      const body = ruleBody(selector);
      const shadow = /box-shadow:\s*([^;]+);/.exec(body)?.[1] ?? '';
      expect(shadow, `${selector} 的阴影应使用皮肤变量`).toContain('var(--skin-key-shadow)');
      // 叠多层阴影的写法长这样：`rgba(...) 0 2px 2px, rgba(...) 0 4px 3px`
      expect(shadow, `${selector} 不该叠多层阴影`).not.toMatch(/\),\s/);
      // 硬编码的颜色（#hex / rgb( / 具名色）都不允许
      expect(shadow, `${selector} 的阴影不该硬编码颜色`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });

  it('黑键比白键「更厚」：接触阴影的偏移必须大于白键', () => {
    const offsetOf = (body: string) => {
      const shadow = /box-shadow:\s*([^;]+);/.exec(body)?.[1] ?? '';
      const match = /var\(--skin-key-shadow\)|(\d+)px\s+(\d+)px/.exec(shadow);
      return match?.[2] ? Number(match[2]) : 0;
    };
    expect(offsetOf(ruleBody('.pk-key--black'))).toBeGreaterThan(
      offsetOf(ruleBody('.pk-key--white')),
    );
  });
});
