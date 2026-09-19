import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 小屏适配的守卫（设计规范 §24 响应式 / §56 响应式优先级 / §25 触控）。
 *
 * 为什么需要它：小屏的问题**只在真实布局引擎里才暴露**，而 jsdom 没有布局引擎
 * （`getBoundingClientRect()` 恒为 0、媒体查询也不生效），所以单元测试天然看不见。
 * 这一层只能守着「那些让布局成立的关键声明还在不在」。
 *
 * 实测踩到的两类故障（都由这些声明修复）：
 *
 *   1. 小高度横屏（667×375 / 844×390）：`.chl` 是三行 grid，底栏放的是核心按钮不能删，
 *      舞台被挤到 219px 而内容要 383px → **纵向溢出 84px**，提示行被推出屏幕；
 *      同时 `.pk` 的 `min-height: 150px` 让它溢出容器被裁掉一截。
 *   2. 窄屏（320×568）：顶栏 `.pp__top-actions` 是 `flex: 0 0 auto`，
 *      把**整页最小宽度**顶到 540px → 页面被撑到 556px，
 *      「听一遍 / 速度档 / 开始跟弹 / 严格一点 / 清空成长数据」全被挤出屏幕，**点不到**。
 */
const SRC = resolve(__dirname, '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('小屏适配（§24 / §56）', () => {
  const challenges = read('features/challenges/challenges.css');
  const practice = read('features/practice/practice.css');
  const settings = read('features/settings/settings.css');
  const piano = read('features/piano/piano.css');

  it('装键盘的容器都声明了 min-width: 0（否则键盘会把整个页面撑宽）', () => {
    // flex / grid 子项的 min-width 默认是 auto：不肯收缩到比内容更窄，
    // 于是宽出屏幕的琴键会把**页面**拉宽（实测 1832px 键盘撑出 1038px 页面溢出）
    const offenders: string[] = [];
    const need: ReadonlyArray<readonly [string, string, string]> = [
      ['features/piano/piano.css', piano, '.pk-frame'],
      ['features/challenges/challenges.css', challenges, '.chl__stage'],
      ['features/challenges/challenges.css', challenges, '.chl__keyboard'],
      ['features/practice/practice.css', practice, '.pp__stage'],
      ['features/practice/practice.css', practice, '.pp__keyboard'],
    ];
    for (const [file, css, selector] of need) {
      const block = css.split(`${selector} {`)[1]?.split('}')[0] ?? '';
      if (!block.includes('min-width: 0')) offenders.push(`${file} 的 ${selector} 缺少 min-width: 0`);
    }
    expect(offenders).toEqual([]);
  });

  it('小高度（≤560px）有适配：顶栏收高、谱面改成高度驱动、键盘内层放开 150px 下限', () => {
    const block = challenges.split('@media (max-height: 560px)')[1]?.split('\n}')[0] ?? '';
    expect(block, 'challenges.css 缺少 @media (max-height: 560px) 小屏块').not.toBe('');

    // 谱面必须是「高度驱动」：width: auto 让 3.8:1 的比例决定宽度，
    // 否则 width: 100% + max-height 会把它压成一条细带（音符小到看不清）
    const staff = block.split('.chl__stage > .staff {')[1]?.split('}')[0] ?? '';
    expect(staff, '.chl__stage > .staff 在小屏块里缺少 height').toContain('height:');
    expect(staff, '.chl__stage > .staff 在小屏块里缺少 width: auto（高度驱动）').toContain('width: auto');

    // `.pk` 自带 min-height: 150px，容器更矮时必须放开，否则内层溢出容器、键被裁
    expect(block, '小屏块里缺少 .chl__keyboard .pk { min-height: 0 }').toMatch(
      /\.chl__keyboard\s+\.pk\s*\{[^}]*min-height:\s*0/,
    );

    // 顶栏收高（栏内控件仍是 44px，§25）
    expect(block, '小屏块里缺少 .chl__top 收高').toMatch(/\.chl__top\s*\{[^}]*min-height:\s*48px/);

    // 次级说明可以让位（§56 的「次要说明」），但当前任务与核心按钮不许删
    expect(block, '小屏块里应当让 .chl__sub 这类次级说明让位').toMatch(/\.chl__sub\s*\{[^}]*display:\s*none/);
    expect(block, '核心按钮所在的 .chl__bottom 不许在小屏块里被 display: none').not.toMatch(
      /\.chl__bottom\s*\{[^}]*display:\s*none/,
    );
  });

  it('窄屏（≤640px）顶栏与底栏可换行，且键宽读数允许收缩', () => {
    const block = practice.split('@media (max-width: 640px)')[1] ?? '';
    expect(block, 'practice.css 缺少 @media (max-width: 640px) 窄屏块').not.toBe('');

    expect(block, '.pp__top 需要 flex-wrap: wrap（否则整页最小宽度被顶到 540px）').toMatch(
      /\.pp__top\s*\{[^}]*flex-wrap:\s*wrap/,
    );
    // 只写 flex-wrap 不够：`.pp__stats` 自己是 flex: 0 0 auto，会按最大内容宽定宽
    expect(block, '.pp__stats 需要允许收缩（flex: 0 1 auto）才会换行').toMatch(
      /\.pp__stats\s*\{[^}]*flex:\s*0 1 auto/,
    );
    expect(block, '.pp__stats 需要 min-width: 0').toMatch(/\.pp__stats\s*\{[^}]*min-width:\s*0/);
  });

  it('设置页窄屏（≤480px）的行可以换行（否则档位按钮被挤出屏幕、点不到）', () => {
    const block = settings.split('@media (max-width: 480px)')[1] ?? '';
    expect(block, 'settings.css 缺少 @media (max-width: 480px) 窄屏块').not.toBe('');
    expect(block, '.settings__row 需要 flex-wrap: wrap').toMatch(/\.settings__row\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});
