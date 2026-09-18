import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LABEL_FONT_SIZE } from './staffLayout';
import { StaffNote, type NoteValue } from './StaffNote';

/**
 * 谱面渲染的可见规则。
 *
 * 这里守住的是**教学约定**，不是像素：
 *   · 初学识谱用全音符 —— 没有符干也没有符尾，注意力只在「音在哪个位置」
 *   · 简谱数字与唱名拼音必须和音符头**同一个 x**，竖着读下来就能对上
 */

function textX(container: HTMLElement, selector: string): number {
  const node = container.querySelector(selector) as SVGTextElement | null;
  if (!node) throw new Error(`找不到 ${selector}`);
  return Number(node.getAttribute('x'));
}

describe('五线谱音符：时值', () => {
  it('默认是全音符：没有符干也没有符尾', () => {
    const { container } = render(<StaffNote note="G4" />);
    expect(container.querySelector('.staff__stem')).toBeNull();
  });

  it('二分 / 四分音符才画出符干', () => {
    for (const value of ['half', 'quarter'] satisfies NoteValue[]) {
      const { container } = render(<StaffNote note="G4" noteValue={value} />);
      expect(container.querySelector('.staff__stem'), value).not.toBeNull();
    }
  });

  it('音符头始终存在（全音符用 whole 字形，有符干时用 half / black 字形）', () => {
    for (const value of ['whole', 'half', 'quarter'] satisfies NoteValue[]) {
      const { container } = render(<StaffNote note="C5" noteValue={value} />);
      const glyphs = container.querySelectorAll('.staff__glyph path');
      // 谱号 + 音符头
      expect(glyphs.length, value).toBe(2);
    }
  });

  it('符干方向由音高位置决定：三线以下朝上，三线以上朝下', () => {
    const stemTips = (note: string) => {
      const { container } = render(<StaffNote note={note} noteValue="half" />);
      const stem = container.querySelector('.staff__stem')!;
      return {
        head: Number(stem.getAttribute('y1')),
        tip: Number(stem.getAttribute('y2')),
      };
    };

    // A4 在三线（B4）以下 → 符干朝上（tip 在音符头上方，y 更小）
    expect(stemTips('A4').tip).toBeLessThan(stemTips('A4').head);
    // C5 在三线以上 → 符干朝下
    expect(stemTips('C5').tip).toBeGreaterThan(stemTips('C5').head);
  });

  it('同一形态下不同音高的音符头位置不同 —— 位置才是答案', () => {
    const headY = (note: string) => {
      const { container } = render(<StaffNote note={note} noteValue="whole" />);
      const groups = container.querySelectorAll('.staff__glyph');
      const transform = groups[groups.length - 1].querySelector('path')!.getAttribute('transform')!;
      return Number(/^translate\([-\d.]+ ([-\d.]+)\)/.exec(transform)![1]);
    };
    expect(headY('C5')).toBeLessThan(headY('A4'));
  });

  it('非法音名不画音符，但谱表与谱号照常渲染（页面不会整块塌掉）', () => {
    const { container } = render(<StaffNote note="H9" />);
    expect(container.querySelectorAll('.staff__lines line')).toHaveLength(5);
    expect(container.querySelectorAll('.staff__glyph path')).toHaveLength(1); // 只有谱号
  });
});

describe('五线谱音符：简谱数字与唱名拼音', () => {
  it('默认都不显示，谱面保持干净', () => {
    const { container } = render(<StaffNote note="E4" />);
    expect(container.querySelector('.staff__labels')).toBeNull();
    expect(container.querySelector('.staff__label-solfege')).toBeNull();
    expect(container.querySelector('.staff__label-pinyin')).toBeNull();
  });

  it('打开数字简谱：音符正下方是简谱数字', () => {
    const { container } = render(<StaffNote note="E4" showSolfege />);
    expect(container.querySelector('.staff__label-solfege')?.textContent).toBe('3');
    expect(container.querySelector('.staff__label-pinyin')).toBeNull();
  });

  it('打开唱名拼音：音符正下方是 do re mi', () => {
    const { container } = render(<StaffNote note="G4" showPinyin />);
    expect(container.querySelector('.staff__label-pinyin')?.textContent).toBe('sol');
    expect(container.querySelector('.staff__label-solfege')).toBeNull();
  });

  it('同时打开时数字在上、拼音在下', () => {
    const { container } = render(<StaffNote note="C5" showSolfege showPinyin />);
    const solfege = container.querySelector('.staff__label-solfege') as SVGTextElement;
    const pinyin = container.querySelector('.staff__label-pinyin') as SVGTextElement;
    expect(solfege.textContent).toBe('1');
    expect(pinyin.textContent).toBe('do');
    expect(Number(solfege.getAttribute('y'))).toBeLessThan(Number(pinyin.getAttribute('y')));
    // 竖着排在同一个 x 上
    expect(Number(solfege.getAttribute('x'))).toBeCloseTo(Number(pinyin.getAttribute('x')), 6);
  });

  it('标签的 x 与音符头严格对齐', () => {
    const { container } = render(<StaffNote note="A4" showSolfege showPinyin />);
    // 自然音不会有临时记号，因此最后一个绘制组就是音符头
    const groups = container.querySelectorAll('.staff__glyph');
    const headTransform = groups[groups.length - 1].querySelector('path')!.getAttribute('transform')!;
    const headX = Number(/^translate\(([-\d.]+) [-\d.]+\)/.exec(headTransform)![1]);

    expect(textX(container, '.staff__label-solfege')).toBeCloseTo(headX, 1);
    expect(textX(container, '.staff__label-pinyin')).toBeCloseTo(headX, 1);
  });

  it('字母音名不会被当成简谱数字混进唱名里', () => {
    const { container } = render(<StaffNote note="B4" showSolfege showPinyin />);
    expect(container.querySelector('.staff__label-solfege')?.textContent).toBe('7');
    expect(container.querySelector('.staff__label-pinyin')?.textContent).toBe('si');
  });

  it('字号由几何常量给出，而不是 CSS 字面值', () => {
    // CSS 里的 font-size 会**盖住** SVG 表现属性（表现属性优先级最低），
    // 两边一旦不一致，文字就会跑出计算好的盒子 —— 那正是「拼音被遮挡」的成因。
    const { container } = render(<StaffNote note="E4" showSolfege showPinyin />);
    expect(container.querySelector('.staff__label-solfege')?.getAttribute('font-size')).toBe(
      String(LABEL_FONT_SIZE.solfege),
    );
    expect(container.querySelector('.staff__label-pinyin')?.getAttribute('font-size')).toBe(
      String(LABEL_FONT_SIZE.pinyin),
    );
  });

  it('标签的 y 来自标签版式（盒中心 + 0.35em），不是固定间距', () => {
    const { container } = render(<StaffNote note="C4" showSolfege showPinyin />);
    const svg = container.querySelector('.staff')!;
    const [, viewY, , viewH] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const solfege = container.querySelector('.staff__label-solfege') as SVGTextElement;
    const pinyin = container.querySelector('.staff__label-pinyin') as SVGTextElement;
    const solfegeY = Number(solfege.getAttribute('y'));
    const pinyinY = Number(pinyin.getAttribute('y'));

    // 都在 viewBox 内，且拼音在数字下方
    expect(solfegeY).toBeGreaterThan(viewY);
    expect(pinyinY).toBeLessThan(viewY + viewH);
    expect(pinyinY).toBeGreaterThan(solfegeY);
  });
});
