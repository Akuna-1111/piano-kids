import { useMemo } from 'react';
import { noteLetter, noteToPinyin, noteToSolfege } from '@/core/audio/notes';
import { cx } from '@/shared/utils/cx';
import { NOTATION_GLYPHS } from './bravuraGlyphs';
import {
  LABEL_BOX_WIDTH,
  LABEL_FONT_SIZE,
  STAFF_LINE_NOTES,
  accidentalOf,
  createStaffGeometry,
  createStaffViewBox,
  glyphScale,
  ledgerSteps,
  placeGlyph,
  staffStep,
  type LabelMode,
  type NoteValue,
  type StaffLabelLayout,
} from './staffLayout';
import './staff.css';

/**
 * 五线谱音符。
 *
 * 字形来自 **Bravura**（SMuFL 参考字体，SIL OFL 1.1）——
 * 不是手绘近似。谱号、音符头、临时记号、符尾都是真正的雕刻字形轮廓，
 * 抽取成 SVG 路径后只有几 KB，因此既专业又不增加运行时负担（不加载字体文件）。
 *
 * 本组件只负责画：5 条线 + 高音谱号 + 加线 + 音符 + 临时记号（+ 可选音名参考）。
 * 不含出题、判定或音频逻辑。
 */

/** viewBox 里使用的线距单位。实际显示尺寸由 CSS 决定，所以这只是比例。 */
const G = 12;
/** 谱号占用的左侧留白。 */
const STAFF_LEFT = 36;
/**
 * 谱面横向画多宽（viewBox 单位）。
 *
 * 谱面是**横向**的，不是一个小方块 —— 真实乐谱总是一行一行横向铺开。
 * 而且这个宽度决定了整块谱面的缩放：它铺满可用宽度时，
 * 音符、谱号、数字简谱、唱名拼音会**一起变大**，而不是只把空白拉长。
 *
 * 配合纵向的 130.8 单位，viewBox 长宽比约为 3.8 : 1（一行乐谱的比例）。
 */
const STAFF_WIDTH = 478;

const geometry = createStaffGeometry({ lineGap: G, width: STAFF_WIDTH, gutter: STAFF_LEFT });

/**
 * viewBox 只算一次 —— 它只取决于线距与标签开关，**与当前是哪个音无关**，
 * 所以每道题之间谱面比例恒定，不会跳动（§53 布局稳定性）。
 *
 * 「数字简谱 / 唱名拼音」的标签块被完整包含在 viewBox 之内，
 * 不依赖 `overflow: visible` 才能显示（那条路在 iOS 上不可靠：
 * 文字如果落在 viewBox 之外，看起来就是「拼音被切掉/被遮挡」）。
 */
const viewBoxWithLabels = createStaffViewBox({
  lineGap: G,
  width: STAFF_WIDTH,
  gutter: STAFF_LEFT,
  labelMode: 'both',
});
const viewBoxWithoutLabels = createStaffViewBox({
  lineGap: G,
  width: STAFF_WIDTH,
  gutter: STAFF_LEFT,
  labelMode: 'none',
});

export type { NoteValue };

export interface StaffNoteProps {
  /** 要显示的音名，例如 "C5" / "F#4" */
  note: string;
  /**
   * 音符时值。
   *
   * 默认 **全音符（whole）** —— 初学识谱的教材都是全音符：
   * 只有一个椭圆、没有符干也没有符尾，孩子的注意力全部落在「音在哪个位置」上，
   * 不会被时值信息干扰。认音高稳定之后再引入二分 / 四分音符。
   */
  noteValue?: NoteValue;
  /** 是否在谱表右侧显示各线音名（学习参考） */
  showReference?: boolean;
  /** 是否在音符正下方显示数字简谱（1=do 2=re …） */
  showSolfege?: boolean;
  /** 是否在数字下方显示唱名拼音（do re mi …） */
  showPinyin?: boolean;
  className?: string;
  /** 无障碍标签；不传则按纯图形隐藏 */
  label?: string;
}

export function StaffNote({
  note,
  noteValue = 'whole',
  showReference = false,
  showSolfege = false,
  showPinyin = false,
  className,
  label,
}: StaffNoteProps) {
  const step = staffStep(note);
  const accidental = accidentalOf(note);
  const ledgers = useMemo(() => (step === null ? [] : ledgerSteps(step)), [step]);

  const labelMode: LabelMode =
    showSolfege && showPinyin
      ? 'both'
      : showSolfege
        ? 'solfege'
        : showPinyin
          ? 'pinyin'
          : 'none';
  // 标签开关只在「设置」里改，所以这个切换不会在答题过程中发生
  const view = labelMode === 'none' ? viewBoxWithoutLabels : viewBoxWithLabels;
  const viewBox = `${view.x} ${view.y} ${view.width} ${view.height}`;
  const labels = view.labels;
  const scale = glyphScale(G);

  if (step === null) {
    // 非法音名：保留谱表结构但不画音符，避免整页崩掉
    return (
      <svg
        className={cx('staff', className)}
        viewBox={viewBox}
        role="img"
        aria-label={label ?? '五线谱'}
      >
        <StaffLines />
        <Clef />
      </svg>
    );
  }

  const y = geometry.yForStep(step);
  const hasStem = noteValue !== 'whole';
  const filledHead = noteValue === 'quarter';
  const headGlyph = hasStem
    ? filledHead
      ? NOTATION_GLYPHS.noteheadBlack
      : NOTATION_GLYPHS.noteheadHalf
    : NOTATION_GLYPHS.noteheadWhole;
  const headHalfWidth = (filledHead || hasStem ? 147.5 : 211) * scale;
  // 符干方向：三线（B4，step 4）以下朝上，以上朝下
  const stemUp = step < 4;
  const stemX = stemUp ? geometry.noteX + headHalfWidth * 0.86 : geometry.noteX - headHalfWidth * 0.86;
  const stemTipY = stemUp ? y - G * 3.5 : y + G * 3.5;

  return (
    <svg
      className={cx('staff', className)}
      viewBox={viewBox}
      role="img"
      aria-label={label ?? `五线谱上的 ${noteLetter(note)}`}
    >
      <StaffLines />

      {showReference ? <StaffReference /> : null}

      <Clef />

      {/* 加线：先画，让音符头压在上面 */}
      {ledgers.map((ledgerStep) => (
        <line
          key={ledgerStep}
          className="staff__ledger"
          x1={geometry.noteX - G * 0.95}
          x2={geometry.noteX + G * 0.95}
          y1={geometry.yForStep(ledgerStep)}
          y2={geometry.yForStep(ledgerStep)}
        />
      ))}

      {/* 符干（仅二分 / 四分音符；全音符没有符干） */}
      {hasStem ? <line className="staff__stem" x1={stemX} x2={stemX} y1={y} y2={stemTipY} /> : null}

      {/* 音符头 */}
      <g className="staff__glyph">
        <path
          d={headGlyph.path}
          transform={placeGlyph(headGlyph, {
            lineGap: G,
            bottomY: geometry.bottomY,
            x: geometry.noteX,
            noteY: y,
          })}
        />
      </g>

      {/* 临时记号：放在音符头左侧 */}
      {accidental ? <Accidental kind={accidental} y={y} /> : null}

      {/* 数字简谱 + 唱名拼音：正对音符下方，建立「位置 → 数字 → 读音」的对应 */}
      {labels ? (
        <NoteLabels
          x={geometry.noteX}
          labels={labels}
          solfege={showSolfege ? noteToSolfege(note) : null}
          pinyin={showPinyin ? noteToPinyin(note) : null}
        />
      ) : null}
    </svg>
  );
}

function StaffLines() {
  return (
    <g className="staff__lines">
      {[0, 1, 2, 3, 4].map((index) => (
        <line
          key={index}
          x1={geometry.left}
          x2={geometry.right}
          y1={geometry.yForStep(index * 2)}
          y2={geometry.yForStep(index * 2)}
        />
      ))}
    </g>
  );
}

function Clef() {
  const glyph = NOTATION_GLYPHS.gClef;
  return (
    <g className="staff__glyph">
      <path
        d={glyph.path}
        transform={placeGlyph(glyph, {
          lineGap: G,
          bottomY: geometry.bottomY,
          x: G * 0.6,
          noteY: 0,
        })}
      />
    </g>
  );
}

function Accidental({ kind, y }: { kind: '#' | 'b'; y: number }) {
  const glyph =
    kind === '#' ? NOTATION_GLYPHS.accidentalSharp : NOTATION_GLYPHS.accidentalFlat;
  return (
    <g className="staff__glyph">
      <path
        d={glyph.path}
        transform={placeGlyph(glyph, {
          lineGap: G,
          bottomY: geometry.bottomY,
          x: geometry.noteX - G * 2.1,
          noteY: y,
        })}
      />
    </g>
  );
}

/** 右侧的线音名参考。只标 5 条线（E G B D F），这是最经典的锚点记忆法。 */
function StaffReference() {
  return (
    <g className="staff__reference">
      {STAFF_LINE_NOTES.map((name, index) => (
        <text key={name} x={geometry.right + G * 0.2} y={geometry.yForStep(index * 2) + G * 0.34}>
          {name.replace(/\d/g, '')}
        </text>
      ))}
    </g>
  );
}

/**
 * 音符正下方的两个标签：数字简谱 + 唱名拼音。
 *
 * 水平位置与音符头严格对齐（同一个 x），这样孩子的视线从音符垂直往下就能读到 ——
 * 「这个位置 = 这个数字 = 这个读音」的对应关系靠空间对齐建立，比放在角落里有效得多。
 *
 * 纵向位置来自 `createStaffLabelLayout`：每个标签占一个**固定高度的盒**，
 * 文字用「盒中心 + 0.35em」定位基线。字号也由几何常量给定（不是 CSS 里的字面值），
 * 所以**基线位置与字体度量无关** —— 换成 iOS 的字体也不会跑出盒外。
 */
function NoteLabels({
  x,
  labels,
  solfege,
  pinyin,
}: {
  x: number;
  labels: StaffLabelLayout;
  solfege: string | null;
  pinyin: string | null;
}) {
  return (
    <g className="staff__labels">
      {solfege && labels.solfege ? (
        <g>
          {/* 简谱数字外面加一个小方框，和简谱的书写习惯一致 */}
          <rect
            className="staff__label-box"
            x={x - LABEL_BOX_WIDTH / 2}
            y={labels.solfege.y}
            width={LABEL_BOX_WIDTH}
            height={labels.solfege.h}
            rx={G * 0.22}
          />
          <text
            className="staff__label-solfege"
            x={x}
            y={labels.solfege.baseline}
            fontSize={LABEL_FONT_SIZE.solfege}
          >
            {solfege}
          </text>
        </g>
      ) : null}
      {pinyin && labels.pinyin ? (
        <text
          className="staff__label-pinyin"
          x={x}
          y={labels.pinyin.baseline}
          fontSize={LABEL_FONT_SIZE.pinyin}
        >
          {pinyin}
        </text>
      ) : null}
    </g>
  );
}
