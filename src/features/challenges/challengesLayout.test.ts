import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 挑战页布局不变量。
 *
 * ## 为什么是「扫 CSS 源码」这种笨办法
 *
 * 这里要守的是一个**真实故障**：iPad 上「看谱找键」的琴键变得非常矮。
 *
 * 根因是 `.chl__stage` 用 `grid-template-rows` 按**子元素顺序**分行，
 * 而舞台里的谱面与「刚才的音」都是**条件渲染**的：
 * 多出一个谱面，键盘就从原本的 `1fr` 行被挤到 `auto` 行；
 * `auto` 行高度不确定 → `.pk-frame { height: 100% }` 无法解析
 * → 琴键退回 `.pk` 的 `min-height: 150px`。
 * 听音找键没有谱面，键盘恰好落在 `1fr` 行，所以只有看谱找键出问题。
 *
 * jsdom 没有布局引擎，`getBoundingClientRect()` 恒为 0，
 * 所以这件事**没法用渲染测试断言**（渲染能过、真机上才是坏的）。
 * 能守住的就是「结构上谁拿剩余空间」这条不变量本身。
 */

const CSS = readFileSync(
  resolve(__dirname, '..', '..', '..', 'src', 'features', 'challenges', 'challenges.css'),
  'utf8',
);

function block(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(CSS);
  if (!match) throw new Error(`challenges.css 里找不到 ${selector} 的规则`);
  return match[1];
}

/** 去掉注释：注释里提到被删掉的类名是正常的，不该被判违规。 */
const CSS_WITHOUT_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

describe('挑战页舞台布局（看谱找键的琴键高度）', () => {
  it('舞台不再按子元素序号分行（那是琴键变矮的根因）', () => {
    expect(block('.chl__stage')).not.toContain('grid-template-rows');
  });

  it('舞台是纵向 flex，剩余空间由 flex-grow 决定，与子元素个数无关', () => {
    const stage = block('.chl__stage');
    expect(stage).toContain('display: flex');
    expect(stage).toContain('flex-direction: column');
    // min-height: 0 —— 否则 flex 子项无法收缩，谱面会把键盘顶出去
    expect(stage).toContain('min-height: 0');
  });

  it('键盘是唯一拿走剩余空间的元素，且有下限', () => {
    const keyboard = block('.chl__keyboard');
    // flex: <grow> <shrink> <basis> —— grow=1 拿剩余
    expect(keyboard).toMatch(/flex:\s*1\s+1\s+150px/);
    expect(keyboard).toContain('min-height: 150px');
  });

  it('谱面横向铺满，竖向有上限（不许把琴键饿死）', () => {
    const staff = block('.chl__stage > .staff');
    // 横向铺满：谱面是横的，铺满宽度时音符与标签一起变大
    expect(staff).toContain('width: 100%');
    // 上限才是这次改版的重点：横屏 iPad 上谱面按比例会把琴键压到很矮
    expect(staff).toMatch(/max-height:\s*\d+%/);
    expect(staff).toMatch(/flex:\s*0\s+1\s+auto/);
  });

  it('剩下的竖向空间留给键盘的比谱面多（键盘是作答的地方）', () => {
    const cap = Number(/max-height:\s*(\d+)%/.exec(block('.chl__stage > .staff'))?.[1]);
    expect(cap).toBeLessThanOrEqual(40);
  });

  it('谱面没有卡片外壳（不要给每个模块都套一块填充色块，§3.3）', () => {
    // 谱面直接铺在舞台底色上：它自己就是内容，不需要卡片
    expect(CSS_WITHOUT_COMMENTS).not.toMatch(/\.staff-panel/);
  });

  it('其余元素既不伸也不缩，按内容高度排布', () => {
    expect(block('.chl__stage > *')).toMatch(/flex:\s*0\s+0\s+auto/);
  });
});
