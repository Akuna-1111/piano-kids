import { parseNote } from '@/core/audio/notes';
import { STAFF_SPACE_UNITS, type NotationGlyph } from './bravuraGlyphs';

/**
 * 五线谱排版几何（纯计算，不含 DOM）。
 *
 * ## 坐标模型
 *
 * 高音谱表（G 谱表）的 5 条线，从下到上依次是 E4 / G4 / B4 / D5 / F5。
 * 用「级进步数」描述音高位置，**每个自然音级 = 半步**：
 *
 * ```
 *   step 8 ─── F5   (第 5 线)
 *   step 7 ─── E5
 *   step 6 ─── D5   (第 4 线)
 *   step 5 ─── C5
 *   step 4 ─── B4   (第 3 线)
 *   step 3 ─── A4
 *   step 2 ─── G4   (第 2 线 = G 谱号锚定的那条线)
 *   step 1 ─── F4
 *   step 0 ─── E4   (第 1 线)
 * ```
 *
 * 用「自然音级」而不是半音来定位，因为五线谱的位置本来就只由音名决定 ——
 * 升号降号只改变同一个位置的记号（♂ 这就是为什么 C#5 和 C5 在同一位置）。
 * 半音数只用于与键盘对应。
 */

/** 谱表下加一线的中央 C。初学者一律从这里开始。 */
export const MIDDLE_C = 'C4';

/** 高音谱表 5 条线的自然音级（下 → 上）。 */
export const STAFF_LINE_NOTES = ['E4', 'G4', 'B4', 'D5', 'F5'] as const;

/** 高音谱表 4 个间位的自然音级（下 → 上）。 */
export const STAFF_SPACE_NOTES = ['F4', 'A4', 'C5', 'E5'] as const;

/** 谱表覆盖的步数范围（含首尾）。 */
export const STAFF_MIN_STEP = 0;
export const STAFF_MAX_STEP = 8;

const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

/** 每个音名字母对应的自然音高类别（C=0, D=2, E=4, F=5, G=7, A=9, B=11）。 */
const LETTER_PITCH_CLASS = [0, 2, 4, 5, 7, 9, 11];

export interface WrittenNote {
  /** 音名首字母（大写） */
  letter: string;
  /** 写在谱面上的临时记号 */
  accidental: '#' | 'b' | null;
  octave: number;
  midi: number;
}

/**
 * 解析**谱面上写出来的**音名。
 *
 * ⚠️ 不能直接用 `parseNote().name`：它会把降号统一归一成升号
 * （`Db4` → `C#4`），五线谱位置和临时记号都会因此算错。
 * 这里保留原始字母，只用 parseNote 做合法性校验与取 MIDI。
 */
export function parseWrittenNote(note: string): WrittenNote | null {
  const parsed = parseNote(note);
  if (!parsed) return null;
  const match = /^\s*([A-Ga-g])\s*([#♯b♭]?)/.exec(note);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const rawAccidental = match[2];
  const accidental =
    rawAccidental === '#' || rawAccidental === '♯'
      ? '#'
      : rawAccidental === 'b' || rawAccidental === '♭'
        ? 'b'
        : null;

  return {
    letter,
    accidental,
    octave: Number(parsed.name.slice(-1)),
    midi: parsed.midi,
  };
}

/**
 * 自然音级序号：八度 × 7 + 音名字母序号。
 * C4 = 28，E4 = 30，F5 = 38。升降号不影响它。
 */
export function diatonicIndex(note: string): number | null {
  const written = parseWrittenNote(note);
  if (!written) return null;
  const index = LETTER_INDEX[written.letter];
  if (index === undefined) return null;
  return written.octave * 7 + index;
}

/** 相对高音谱表第 1 线（E4）的级进步数。 */
export function staffStep(note: string): number | null {
  const index = diatonicIndex(note);
  const base = diatonicIndex('E4');
  if (index === null || base === null) return null;
  return index - base;
}

/** 某个步数是否落在谱表的 5 条线或 4 个间位之内。 */
export function isOnStaff(step: number): boolean {
  return step >= STAFF_MIN_STEP && step <= STAFF_MAX_STEP;
}

/** 该步数是否正好落在一条线上（偶数步 = 线，奇数步 = 间）。 */
export function isLineStep(step: number): boolean {
  return step % 2 === 0;
}

/**
 * 需要画的加线（ledger lines）的步数。
 *
 * 下加线从 -2（中央 C）向外每两度一条；上加线从 10（A5）向外每两度一条。
 * 注意：音**落在**间位时，仍然要画它下方/上方紧邻的那条加线。
 */
export function ledgerSteps(step: number): number[] {
  const result: number[] = [];
  if (step < STAFF_MIN_STEP) {
    for (let s = -2; s >= step; s -= 2) result.push(s);
  } else if (step > STAFF_MAX_STEP) {
    for (let s = 10; s <= step; s += 2) result.push(s);
  }
  return result;
}

export interface StaffGeometry {
  /** 两条线之间的距离（px） */
  lineGap: number;
  /** 谱表左边缘 */
  left: number;
  /** 谱表右边缘 */
  right: number;
  /** 第 1 线（最下面那条）的 y */
  bottomY: number;
  /** 步数 → y 坐标 */
  yForStep: (step: number) => number;
  /** 音符头中心的 x */
  noteX: number;
  /** 谱号的 x */
  clefX: number;
}

export interface StaffGeometryInput {
  lineGap: number;
  /** 整个 SVG 的宽度 */
  width: number;
  /** 谱号占据的左侧留白 */
  gutter: number;
}

export function createStaffGeometry(input: StaffGeometryInput): StaffGeometry {
  const { lineGap, width, gutter } = input;
  const bottomY = lineGap * 4;
  const left = gutter;
  const right = width - lineGap * 0.6;

  return {
    lineGap,
    left,
    right,
    bottomY,
    // 步数每 +1 = 上移半个线距
    yForStep: (step: number) => bottomY - (step * lineGap) / 2,
    noteX: (left + right) / 2 + lineGap,
    clefX: gutter * 0.5,
  };
}

/**
 * 把一个乐谱字形摆到谱面上，返回 SVG transform。
 *
 * 变换按「先应用 offsetX（字体单位）→ 再缩放 → 最后移到锚点」的顺序组合，
 * 因此组件只需给出锚点位置，不用关心字体单位与缩放。
 *
 * @param glyph  来自 bravuraGlyphs（自动生成）
 * @param ctx    lineGap 线距 / bottomY 第 1 线的 y / x 水平位置 / noteY 音符所在的 y
 */
export function placeGlyph(
  glyph: NotationGlyph,
  ctx: { lineGap: number; bottomY: number; x: number; noteY: number },
): string {
  const scale = ctx.lineGap / STAFF_SPACE_UNITS;
  const anchorY =
    glyph.anchor.kind === 'staffSpace'
      ? ctx.bottomY - glyph.anchor.space * ctx.lineGap
      : ctx.noteY;
  return `translate(${round(ctx.x)} ${round(anchorY)}) scale(${round(scale, 6)}) translate(${glyph.offsetX} 0)`;
}

/** 字形缩放比：线距 ÷ 250（1 个谱表间距的字体单位数）。 */
export function glyphScale(lineGap: number): number {
  return lineGap / STAFF_SPACE_UNITS;
}

/* ============================================================
   谱面的纵向版式（viewBox 与标签块）
   ============================================================ */

/**
 * 谱面下方要支持到的最低音：**中央 C（步数 -2）**。
 *
 * 出题音域的最低音就是中央 C（见 `NOTATION_LEVELS`），所以 viewBox 只需要覆盖到它。
 * 早先按 A3（步数 -4）预留，结果是谱表下方堆了一大片空白 ——
 * 标签被推到卡片底边、还被挤出 viewBox（见下）。
 *
 * 如果以后有音域更低的练习，这个常量要跟着改，
 * `staffLayout.test.ts` 里有一条断言「每一档的每个音都落在 viewBox 内」会拦住遗漏。
 */
export const STAFF_CONTENT_MIN_STEP = -2;

/** 上方要支持到的最高音：高音 A5（步数 10），比出题最高的 G5 再高一条线。 */
const STAFF_CONTENT_MAX_STEP = 10;

/** 数字简谱与唱名拼音的字号（**viewBox 单位**，不是 CSS px）。 */
export const LABEL_FONT_SIZE = { solfege: 13, pinyin: 10 } as const;

/**
 * 基线相对「盒中心」的偏移，单位 em。
 *
 * 0.35em 是 x-height/2 的常用近似，跨字体足够稳定。
 * **刻意不用 `dominant-baseline`**：各浏览器/字体对 `central` / `middle` 的解释不一致，
 * 而这个练习的标签必须与音符头严格对齐。
 */
const BASELINE_FROM_CENTER_EM = 0.35;

const SOLFEGE_BOX = { w: 18, h: 20 } as const;
const PINYIN_BOX_H = 16;
/** 数字外面那个小方框的宽度（简谱的书写习惯）。 */
export const LABEL_BOX_WIDTH = SOLFEGE_BOX.w;
/** 最低内容与标签块之间的空隙。 */
const LABEL_GAP = 8;
/** 标签块下缘与 viewBox 底边之间的余量 —— 留出来才不会「看起来被切了」。 */
const LABEL_PAD = 4;
/** 没有标签时，谱表下方留一点边距即可。 */
const CONTENT_PAD_RATIO = 0.9;

export type LabelMode = 'none' | 'solfege' | 'pinyin' | 'both';

export interface LabelBox {
  /** 盒顶 y */
  y: number;
  /** 盒高 */
  h: number;
  /** 文字基线 y（由盒中心 + 0.35em 算出，不依赖字体度量） */
  baseline: number;
}

export interface StaffLabelLayout {
  /** 标签块顶部 y */
  top: number;
  solfege: LabelBox | null;
  pinyin: LabelBox | null;
  /** 标签块的底（最后一个盒的下缘） */
  bottom: number;
}

function boxAt(y: number, h: number, fontSize: number): LabelBox {
  return { y, h, baseline: y + h / 2 + fontSize * BASELINE_FROM_CENTER_EM };
}

/**
 * 数字简谱 + 唱名拼音的版式。纯函数，`top` 由调用方给出。
 *
 * 每个标签占一个**固定高度的盒**，文字在盒内居中 ——
 * 这样几何完全由常量决定，跟浏览器用什么字体无关。
 */
export function createStaffLabelLayout(mode: LabelMode, top: number): StaffLabelLayout {
  const showSolfege = mode === 'solfege' || mode === 'both';
  const showPinyin = mode === 'pinyin' || mode === 'both';

  const solfege = showSolfege
    ? boxAt(top, SOLFEGE_BOX.h, LABEL_FONT_SIZE.solfege)
    : null;
  const pinyinTop = top + (solfege ? SOLFEGE_BOX.h : 0);
  const pinyin = showPinyin ? boxAt(pinyinTop, PINYIN_BOX_H, LABEL_FONT_SIZE.pinyin) : null;

  const bottom = pinyin ? pinyin.y + pinyin.h : solfege ? solfege.y + solfege.h : top;
  return { top, solfege, pinyin, bottom };
}

export interface StaffViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 标签块（含下缘余量）的底 —— 供测试断言用 */
  contentBottom: number;
  labels: StaffLabelLayout | null;
}

/**
 * 谱面的 viewBox。
 *
 * 它是**常量**（只取决于线距与标签开关），所以每道题之间谱面比例不会跳动（§53）。
 * 标签块被完整包含在内，`overflow` 不参与正确性 —— 不依赖 `overflow: visible`，
 * 也就不会在「外层 svg 会裁切 viewport」的浏览器上把拼音切掉。
 */
export function createStaffViewBox(options: {
  lineGap: number;
  width: number;
  gutter: number;
  labelMode: LabelMode;
}): StaffViewBox {
  const { lineGap: G, width, gutter, labelMode } = options;
  const geometry = createStaffGeometry({ lineGap: G, width, gutter });

  const top = geometry.yForStep(STAFF_CONTENT_MAX_STEP) - G * CONTENT_PAD_RATIO;
  const contentBottom = geometry.yForStep(STAFF_CONTENT_MIN_STEP);

  const labels =
    labelMode === 'none' ? null : createStaffLabelLayout(labelMode, contentBottom + LABEL_GAP);
  const bottom = labels
    ? labels.bottom + LABEL_PAD
    : contentBottom + G * CONTENT_PAD_RATIO;

  return {
    x: -G * 0.6,
    y: top,
    width: width + G * 1.6,
    height: bottom - top,
    contentBottom,
    labels,
  };
}

function round(value: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

/** 音名里的临时记号（升 / 降），用于在音符左侧画记号。
 * 同样基于**写出来的**音名，否则 `Db4` 会被归一成 `C#4` 而误判为升号。
 */
export function accidentalOf(note: string): '#' | 'b' | null {
  const written = parseWrittenNote(note);
  if (!written) return null;

  const letterIndex = LETTER_INDEX[written.letter];
  if (letterIndex === undefined) return null;

  const natural = LETTER_PITCH_CLASS[letterIndex];
  const actual = ((written.midi % 12) + 12) % 12;
  const diff = ((actual - natural) % 12 + 12) % 12;
  if (diff === 1) return '#';
  if (diff === 11) return 'b';
  return null;
}

/**
 * 音符时值的书写形态。
 *
 * ⚠️ 在这个练习里它**不是时值教学**，只是形态迁移。
 * 「音高只由音符头落在哪条线/哪个间决定」，符干和符尾不影响该按哪个键 ——
 * 所以形态变化不会给「看谱找键」增加任何需要判断的信息（见各档的 noteValue）。
 */
export type NoteValue = 'whole' | 'half' | 'quarter';

/**
 * 出题音域分档（文档「考虑水平来出练习题」）。
 *
 * 认谱的难度主要由**音域**决定：先认谱表以内，再认下加一线的中央 C，
 * 最后才扩展到更外的加线。这样每一档只增加一个新位置，孩子不会一次面对太多信息。
 *
 * 难度只有**音域**这一个变量 —— 形态（noteValue）不构成难度，
 * 所以同一个练习里升降档位时，孩子失败的原因是唯一的。
 */
export interface NotationLevel {
  /** 1 起 */
  level: 1 | 2 | 3;
  name: string;
  /** 该档覆盖的音（自然音，不含升降号），由低到高 */
  notes: readonly string[];
  /** 给界面看的一句话说明 */
  hint: string;
  /**
   * 该档音符的书写形态。
   *
   * 第 1–2 档是**全音符**：只有一个椭圆，没有符干也没有符尾，
   * 孩子的注意力全部落在「音在五线谱的哪个位置」上。
   *
   * 第 3 档换成**二分音符**（空心头 + 符干）。这**不是**要教时值 ——
   * 而是补掉一个真实落差：只见过全音符的孩子翻开《小汤》会看到带符干的谱子。
   * 符干方向由音高位置决定（三线以上朝下），不需要额外判断，认知负担几乎为零。
   */
  noteValue: NoteValue;
}

/** 第 1 档：只在谱表的 5 线 4 间以内（E4–F5），先把线与间认熟。 */
const LEVEL_1_NOTES = ['E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5'] as const;

/** 第 2 档：加入下加一线的中央 C（C4–F5）。 */
const LEVEL_2_NOTES = ['C4', 'D4', ...LEVEL_1_NOTES] as const;

/** 第 3 档：扩展到高音 G（C4–G5），加线位置也进入范围。 */
const LEVEL_3_NOTES = [...LEVEL_2_NOTES, 'G5'] as const;

export const NOTATION_LEVELS: readonly NotationLevel[] = [
  {
    level: 1,
    name: '谱表以内',
    notes: LEVEL_1_NOTES,
    hint: '先认谱表里的线和间',
    noteValue: 'whole',
  },
  {
    level: 2,
    name: '加上中央 C',
    notes: LEVEL_2_NOTES,
    hint: '中央 C 在下加一线上',
    noteValue: 'whole',
  },
  {
    level: 3,
    name: '完整音域',
    notes: LEVEL_3_NOTES,
    hint: '中央 C 到高音 G',
    noteValue: 'half',
  },
];

/** 把越界（例如 0 或 9）或小数的档位夹到合法范围。 */
function clampLevel(level: number): 1 | 2 | 3 {
  return Math.max(1, Math.min(NOTATION_LEVELS.length, Math.round(level))) as 1 | 2 | 3;
}

/** 取某一档的可出题音。越界会被夹到合法档位。 */
export function notesForLevel(level: number): readonly string[] {
  return NOTATION_LEVELS[clampLevel(level) - 1].notes;
}

/** 取某一档的音符书写形态。越界会被夹到合法档位。 */
export function noteValueForLevel(level: number): NoteValue {
  return NOTATION_LEVELS[clampLevel(level) - 1].noteValue;
}

/**
 * 按「第几个音 / 一共几个音」决定这一题用哪一档 —— 难度随进度自动上升。
 * 例如 6 个音、3 档 → 第 1–2 题第 1 档，第 3–4 题第 2 档，第 5–6 题第 3 档。
 */
export function levelForRound(round: number, totalRounds: number): 1 | 2 | 3 {
  const levels = NOTATION_LEVELS.length;
  const perLevel = Math.max(1, Math.ceil(totalRounds / levels));
  const raw = Math.floor(round / perLevel) + 1;
  return Math.max(1, Math.min(levels, raw)) as 1 | 2 | 3;
}

/** 初学者音域（第 3 档，完整）。保留为整体上限。 */
export const BEGINNER_NOTES = LEVEL_3_NOTES;
