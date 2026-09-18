import { describe, expect, it } from 'vitest';
import { NOTATION_GLYPHS } from './bravuraGlyphs';
import { isNoteOnKeyboard, KEYBOARD_SIZES } from '@/features/piano/pianoLayout';
import {
  BEGINNER_NOTES,
  LABEL_FONT_SIZE,
  MIDDLE_C,
  NOTATION_LEVELS,
  STAFF_CONTENT_MIN_STEP,
  STAFF_LINE_NOTES,
  STAFF_SPACE_NOTES,
  accidentalOf,
  createStaffGeometry,
  createStaffLabelLayout,
  createStaffViewBox,
  diatonicIndex,
  glyphScale,
  isLineStep,
  isOnStaff,
  ledgerSteps,
  levelForRound,
  noteValueForLevel,
  notesForLevel,
  placeGlyph,
  staffStep,
  type LabelMode,
} from './staffLayout';

describe('五线谱步数定位', () => {
  it('高音谱表 5 条线的步数是 0/2/4/6/8', () => {
    expect(STAFF_LINE_NOTES.map((note) => staffStep(note))).toEqual([0, 2, 4, 6, 8]);
  });

  it('高音谱表 4 个间位的步数是 1/3/5/7', () => {
    expect(STAFF_SPACE_NOTES.map((note) => staffStep(note))).toEqual([1, 3, 5, 7]);
  });

  it('线在偶数步、间在奇数步', () => {
    expect(isLineStep(staffStep('E4')!)).toBe(true);
    expect(isLineStep(staffStep('F4')!)).toBe(false);
  });

  it('中央 C（C4）在下加一线上，步数 -2', () => {
    expect(staffStep(MIDDLE_C)).toBe(-2);
    expect(isOnStaff(-2)).toBe(false);
  });

  it('升降号不改变五线谱位置（C#5 与 C5 同位置）', () => {
    expect(staffStep('C#5')).toBe(staffStep('C5'));
    expect(staffStep('Db4')).toBe(staffStep('D4'));
  });

  it('跨八度的步数连续（每上一个八度 +7 步）', () => {
    for (const letter of ['C', 'D', 'E', 'F', 'G', 'A', 'B']) {
      const low = staffStep(`${letter}4`);
      const high = staffStep(`${letter}5`);
      expect(high! - low!).toBe(7);
    }
  });

  it('非法音名返回 null 而不是抛错', () => {
    expect(staffStep('H4')).toBeNull();
    expect(staffStep('')).toBeNull();
    expect(accidentalOf('nonsense')).toBeNull();
  });

  it('diatonicIndex 与音名一致', () => {
    expect(diatonicIndex('C4')).toBe(28);
    expect(diatonicIndex('E4')).toBe(30);
    expect(diatonicIndex('F5')).toBe(38);
  });
});

describe('加线（ledger lines）', () => {
  it('谱表内的音不需要加线', () => {
    for (let step = 0; step <= 8; step += 1) {
      expect(ledgerSteps(step)).toEqual([]);
    }
  });

  it('中央 C 需要一条下加线（画在它自己身上）', () => {
    expect(ledgerSteps(staffStep('C4')!)).toEqual([-2]);
  });

  it('D4 紧贴谱表下方，**不需要**加线（它在谱表与 C4 加线之间的间位里）', () => {
    expect(staffStep('D4')).toBe(-1);
    expect(ledgerSteps(staffStep('D4')!)).toEqual([]);
  });

  it('B3 在 C4 加线下方，需要把它托住的那条加线', () => {
    expect(ledgerSteps(staffStep('B3')!)).toEqual([-2]);
  });

  it('A3 需要两条下加线', () => {
    expect(ledgerSteps(staffStep('A3')!)).toEqual([-2, -4]);
  });

  it('E3 在 F3 加线下方（间位），需要三条下加线', () => {
    // 自下而上：C4(-2) A3(-4) F3(-6) 是线；D4/B3/G3/E3 是间位
    expect(staffStep('E3')).toBe(-7);
    expect(ledgerSteps(staffStep('E3')!)).toEqual([-2, -4, -6]);
  });

  it('高音 G5 紧贴谱表上方，不需要加线', () => {
    expect(ledgerSteps(staffStep('G5')!)).toEqual([]);
  });

  it('A5 需要一条上加线', () => {
    expect(ledgerSteps(staffStep('A5')!)).toEqual([10]);
  });

  it('上加线每两度一条，且覆盖音符自身位置', () => {
    expect(ledgerSteps(14)).toEqual([10, 12, 14]);
    expect(ledgerSteps(13)).toEqual([10, 12]);
  });
});

describe('临时记号识别', () => {
  it('识别升号', () => {
    expect(accidentalOf('C#4')).toBe('#');
    expect(accidentalOf('F#5')).toBe('#');
  });

  it('识别降号', () => {
    expect(accidentalOf('Db4')).toBe('b');
    expect(accidentalOf('Bb3')).toBe('b');
  });

  it('自然音没有临时记号', () => {
    for (const note of BEGINNER_NOTES) {
      expect(accidentalOf(note), note).toBeNull();
    }
  });
});

describe('谱表几何', () => {
  const geo = createStaffGeometry({ lineGap: 14, width: 320, gutter: 44 });

  it('第 1 线在最下方，步数每 +1 上移半个线距', () => {
    const y0 = geo.yForStep(0);
    const y1 = geo.yForStep(1);
    const y2 = geo.yForStep(2);
    expect(y0).toBeGreaterThan(y1);
    expect(y1).toBeGreaterThan(y2);
    expect(y0 - y1).toBeCloseTo(geo.lineGap / 2, 6);
  });

  it('相邻两条线正好相隔一个线距', () => {
    expect(geo.yForStep(0) - geo.yForStep(2)).toBeCloseTo(geo.lineGap, 6);
    expect(geo.yForStep(2) - geo.yForStep(4)).toBeCloseTo(geo.lineGap, 6);
  });

  it('中央 C 落在第 1 线下方一个线距处', () => {
    expect(geo.yForStep(-2)).toBeCloseTo(geo.bottomY + geo.lineGap, 6);
  });

  it('音符横向位置在谱表之内', () => {
    expect(geo.noteX).toBeGreaterThan(geo.left);
    expect(geo.noteX).toBeLessThan(geo.right);
  });

  it('谱号画在左侧留白里，不压住谱表', () => {
    expect(geo.clefX).toBeLessThan(geo.left);
  });
});


describe('乐谱字形摆放（Bravura）', () => {
  it('缩放比 = 线距 ÷ 250（SMuFL 一个谱表间距的字体单位数）', () => {
    expect(glyphScale(12)).toBeCloseTo(12 / 250, 9);
    expect(glyphScale(25)).toBeCloseTo(0.1, 9);
  });

  it('谱号原点落在 G 线（从下往上第 2 条）上', () => {
    const geo = createStaffGeometry({ lineGap: 12, width: 152, gutter: 36 });
    const transform = placeGlyph(NOTATION_GLYPHS.gClef, {
      lineGap: 12,
      bottomY: geo.bottomY,
      x: 7,
      noteY: 0,
    });
    // bottomY - 1 个线距 = G 线
    const expectedY = geo.bottomY - 12;
    expect(transform).toContain(`translate(7 ${expectedY})`);
    expect(transform).toContain('scale(0.048)');
  });

  it('跟随音符的字形（音符头 / 临时记号）用音符自身的 y', () => {
    const geo = createStaffGeometry({ lineGap: 12, width: 152, gutter: 36 });
    const noteY = geo.yForStep(3); // A4
    const transform = placeGlyph(NOTATION_GLYPHS.noteheadBlack, {
      lineGap: 12,
      bottomY: geo.bottomY,
      x: 100,
      noteY,
    });
    expect(transform).toContain(`translate(100 ${noteY})`);
  });

  it('居中类字形带水平预偏移，左缘类字形不带', () => {
    expect(NOTATION_GLYPHS.noteheadBlack.offsetX).toBeCloseTo(-147.5, 1);
    expect(NOTATION_GLYPHS.noteheadWhole.offsetX).toBeCloseTo(-211, 1);
    expect(NOTATION_GLYPHS.gClef.offsetX).toBeCloseTo(0, 1);
  });

  it('transform 里没有 NaN / undefined', () => {
    const geo = createStaffGeometry({ lineGap: 12, width: 152, gutter: 36 });
    for (const glyph of Object.values(NOTATION_GLYPHS)) {
      const transform = placeGlyph(glyph, {
        lineGap: 12,
        bottomY: geo.bottomY,
        x: 50,
        noteY: geo.yForStep(4),
      });
      expect(transform).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('Bravura 字形数据（自动生成）', () => {
  const glyphs = Object.values(NOTATION_GLYPHS);

  it('每个字形都有非空路径，且坐标全为有限数', () => {
    for (const glyph of glyphs) {
      expect(glyph.path.length).toBeGreaterThan(20);
      expect(glyph.path).not.toMatch(/NaN|undefined|Infinity/);
      const numbers = glyph.path.match(/-?\d+(\.\d+)?/g) ?? [];
      expect(numbers.length).toBeGreaterThan(4);
      for (const n of numbers) expect(Number.isFinite(Number(n))).toBe(true);
    }
  });

  it('路径命令只使用 SVG 允许的字母', () => {
    for (const glyph of glyphs) {
      const commands = glyph.path.match(/[A-Za-z]/g) ?? [];
      for (const cmd of commands) expect('MLCQZ').toContain(cmd);
    }
  });

  it('坐标是 Y 向下：降号的竖笔朝上（包围盒负值方向）', () => {
    // 这是抽取脚本的自检条件，在这里再钉一次，防止有人改回翻转版本
    const flat = NOTATION_GLYPHS.accidentalFlat.path;
    const ys = [...flat.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1]));
    const min = Math.min(...ys);
    const max = Math.max(...ys);
    // 降号向上 ≈ 1.76 间距、向下 ≈ 0.70 间距 → |min| 明显大于 |max|
    expect(Math.abs(min)).toBeGreaterThan(Math.abs(max) * 2);
  });

  it('高音谱号向上（4.39 间距）明显多于向下（2.63 间距）', () => {
    const clef = NOTATION_GLYPHS.gClef.path;
    const ys = [...clef.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1]));
    const up = -Math.min(...ys);
    const down = Math.max(...ys);
    expect(up / 250).toBeCloseTo(4.39, 1);
    expect(down / 250).toBeCloseTo(2.63, 1);
    expect(up).toBeGreaterThan(down);
  });

  it('音符头是 1.18 × 1 个谱表间距（真实雕刻比例）', () => {
    const head = NOTATION_GLYPHS.noteheadBlack.path;
    const xs = [...head.matchAll(/([-\d.]+) [-\d.]+/g)].map((m) => Number(m[1]));
    const ys = [...head.matchAll(/[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1]));
    expect((Math.max(...xs) - Math.min(...xs)) / 250).toBeCloseTo(1.18, 1);
    expect((Math.max(...ys) - Math.min(...ys)) / 250).toBeCloseTo(1, 1);
  });
});

describe('初学者音域', () => {
  it('从中央 C 到高音 G，全部是自然音', () => {
    expect(BEGINNER_NOTES[0]).toBe('C4');
    expect(BEGINNER_NOTES[BEGINNER_NOTES.length - 1]).toBe('G5');
    for (const note of BEGINNER_NOTES) {
      expect(accidentalOf(note), note).toBeNull();
    }
  });

  it('音域内每个音都能定位，且步数严格递增', () => {
    const steps = BEGINNER_NOTES.map((note) => staffStep(note)!);
    expect(steps.every((step) => Number.isFinite(step))).toBe(true);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBe(steps[i - 1] + 1);
    }
  });
});

describe('出题音域分档（按水平出题）', () => {
  it('三档音域逐级变宽，且后一档包含前一档', () => {
    expect(NOTATION_LEVELS).toHaveLength(3);
    for (let i = 1; i < NOTATION_LEVELS.length; i += 1) {
      const previous = NOTATION_LEVELS[i - 1].notes;
      const current = NOTATION_LEVELS[i].notes;
      expect(current.length).toBeGreaterThan(previous.length);
      for (const note of previous) expect(current).toContain(note);
    }
  });

  it('第 1 档只在谱表的线与间之内，不含任何加线音', () => {
    for (const note of notesForLevel(1)) {
      expect(isOnStaff(staffStep(note)!), note).toBe(true);
    }
  });

  it('第 2 档才引入下加一线的中央 C，第 3 档扩展到高音 G', () => {
    expect(notesForLevel(1)).not.toContain(MIDDLE_C);
    expect(notesForLevel(2)).toContain(MIDDLE_C);
    expect(notesForLevel(3)).toContain('G5');
  });

  it('每档都是连续的自然音，没有跳过一个音级', () => {
    for (const level of NOTATION_LEVELS) {
      const steps = level.notes.map((note) => staffStep(note)!);
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i], `${level.name} 的 ${level.notes[i]}`).toBe(steps[i - 1] + 1);
      }
    }
  });

  it('越界的档位被夹到合法范围，不会返回 undefined', () => {
    expect(notesForLevel(0)).toEqual(notesForLevel(1));
    expect(notesForLevel(99)).toEqual(notesForLevel(3));
    expect(notesForLevel(2.4)).toEqual(notesForLevel(2));
  });

  it('6 个音分三档：第 1–2 题第 1 档，第 3–4 题第 2 档，第 5–6 题第 3 档', () => {
    expect([0, 1, 2, 3, 4, 5].map((round) => levelForRound(round, 6))).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('题量再少也会走完三档，难度只升不降', () => {
    const levels = [0, 1, 2].map((round) => levelForRound(round, 3));
    expect(levels).toEqual([1, 2, 3]);
    const many = Array.from({ length: 12 }, (_, round) => levelForRound(round, 12));
    for (let i = 1; i < many.length; i += 1) expect(many[i]).toBeGreaterThanOrEqual(many[i - 1]);
    expect(many[many.length - 1]).toBe(3);
  });

  it('每一档和每一档键盘的交集都非空 —— 出的题一定弹得到', () => {
    // 这是曾经的隐患：8 键键盘只覆盖 C4–C5，第 1 档里的 D5/E5/F5 它根本弹不到。
    for (const size of KEYBOARD_SIZES) {
      for (const level of NOTATION_LEVELS) {
        const playable = level.notes.filter((note) => isNoteOnKeyboard(size, note));
        expect(playable.length, `${size} 键 × ${level.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('8 键键盘下第 1 档恰好落在 C4–C5 以内', () => {
    const playable = notesForLevel(1).filter((note) => isNoteOnKeyboard(8, note));
    expect(playable).toEqual(['E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  });
});

describe('谱面纵向版式与标签块（「拼音被遮挡」的根因）', () => {
  const view = (labelMode: LabelMode) =>
    createStaffViewBox({ lineGap: 12, width: 152, gutter: 36, labelMode });
  const geo = createStaffGeometry({ lineGap: 12, width: 152, gutter: 36 });

  /** 文字墨迹的保守估界（相对基线，单位 em）。真实字体不会超出这个范围。 */
  const INK_ABOVE_EM = 0.75;
  const INK_BELOW_EM = 0.25;

  it('每个标签占一个固定高度的盒子，基线由盒中心 + 0.35em 算出', () => {
    const layout = createStaffLabelLayout('both', 100);
    expect(layout.solfege).not.toBeNull();
    expect(layout.pinyin).not.toBeNull();
    expect(layout.solfege!.baseline).toBeCloseTo(
      layout.solfege!.y + layout.solfege!.h / 2 + LABEL_FONT_SIZE.solfege * 0.35,
      6,
    );
    expect(layout.pinyin!.baseline).toBeCloseTo(
      layout.pinyin!.y + layout.pinyin!.h / 2 + LABEL_FONT_SIZE.pinyin * 0.35,
      6,
    );
  });

  it('两个标签上下相接，不重叠', () => {
    const layout = createStaffLabelLayout('both', 0);
    expect(layout.pinyin!.y).toBeCloseTo(layout.solfege!.y + layout.solfege!.h, 6);
  });

  it('**文字墨迹完全落在 viewBox 之内**（不再依赖 overflow: visible）', () => {
    // 这是根因：之前标签按加线空间算出的固定 y 摆放，
    // 拼音的字形盒比 viewBox 底边还低 0.84 单位 ——
    // 在会裁切 viewport 的浏览器上看起来就是「拼音被切掉/被遮挡」。
    for (const mode of ['solfege', 'pinyin', 'both'] satisfies LabelMode[]) {
      const v = view(mode);
      const boxes: Array<[typeof v.labels extends null ? never : NonNullable<typeof v.labels>['solfege'], number]> = [
        [v.labels!.solfege, LABEL_FONT_SIZE.solfege],
        [v.labels!.pinyin, LABEL_FONT_SIZE.pinyin],
      ];
      for (const [box, size] of boxes) {
        if (!box) continue;
        const inkTop = box.baseline - size * INK_ABOVE_EM;
        const inkBottom = box.baseline + size * INK_BELOW_EM;
        expect(inkTop, `${mode} 标签上缘`).toBeGreaterThanOrEqual(v.y);
        expect(inkBottom, `${mode} 标签下缘`).toBeLessThanOrEqual(v.y + v.height);
        // 盒本身也要在 viewBox 内
        expect(box.y).toBeGreaterThanOrEqual(v.y);
        expect(box.y + box.h).toBeLessThanOrEqual(v.y + v.height);
      }
    }
  });

  it('标签块整个在最低内容之下，不与谱表/加线重叠', () => {
    const v = view('both');
    expect(v.labels!.top).toBeGreaterThan(v.contentBottom);
  });

  it('viewBox 只取决于线距与标签开关 —— 同一开关下恒定，所以每题比例不跳（§53）', () => {
    expect(view('both')).toEqual(view('both'));
    expect(view('none')).toEqual(view('none'));
  });

  it('关掉标签时不留标签空间（谱面更大）', () => {
    expect(view('none').height).toBeLessThan(view('solfege').height);
    expect(view('solfege').height).toBeLessThan(view('both').height);
  });

  it('每一档出题音域里的每个音（含它的加线）都落在 viewBox 内', () => {
    // 这条把「组件支持的音域」和「练习实际出的题」钉在一起：
    // 以后往 NOTATION_LEVELS 里加更低的音，这里会失败，提醒同步 STAFF_CONTENT_MIN_STEP。
    const v = view('both');
    const bottom = v.y + v.height;
    for (const level of NOTATION_LEVELS) {
      for (const note of level.notes) {
        const step = staffStep(note);
        expect(step, `${level.name} / ${note}`).not.toBeNull();
        const noteY = geo.yForStep(step!);
        expect(noteY, `${level.name} / ${note} 的音符`).toBeGreaterThanOrEqual(v.y);
        expect(noteY, `${level.name} / ${note} 的音符`).toBeLessThanOrEqual(bottom);
        for (const ledgerStep of ledgerSteps(step!)) {
          const ledgerY = geo.yForStep(ledgerStep);
          expect(ledgerY, `${level.name} / ${note} 的加线`).toBeGreaterThanOrEqual(v.y);
          expect(ledgerY, `${level.name} / ${note} 的加线`).toBeLessThanOrEqual(bottom);
        }
      }
    }
  });

  it('最低的加线位置刚好被覆盖到（不退让也不浪费）', () => {
    const v = view('both');
    // 中央 C 的加线在内容底边之内
    expect(geo.yForStep(STAFF_CONTENT_MIN_STEP)).toBeLessThanOrEqual(v.contentBottom);
    // 内容底边与标签之间有明确空隙，不会贴在一起
    expect(v.labels!.top - v.contentBottom).toBeGreaterThan(4);
  });
});

describe('音符形态随档位迁移（不是时值教学）', () => {
  it('前两档是全音符（没有符干），第 3 档才是二分音符', () => {
    expect(NOTATION_LEVELS.map((level) => level.noteValue)).toEqual(['whole', 'whole', 'half']);
    expect(noteValueForLevel(3)).toBe('half');
  });

  it('形态不改变音域 —— 难度只有音域一个变量', () => {
    // 同一批音在任何一个形态下，位置和步数都不变，因此「该按哪个键」的答案不变
    for (const level of NOTATION_LEVELS) {
      const steps = level.notes.map((note) => staffStep(note)!);
      for (let i = 1; i < steps.length; i += 1) {
        expect(steps[i], `${level.name}/${level.noteValue}`).toBe(steps[i - 1] + 1);
      }
    }
  });

  it('noteValueForLevel 的越界处理与 notesForLevel 一致', () => {
    expect(noteValueForLevel(0)).toBe(noteValueForLevel(1));
    expect(noteValueForLevel(99)).toBe(noteValueForLevel(3));
    expect(noteValueForLevel(2.6)).toBe(noteValueForLevel(3));
  });
});
