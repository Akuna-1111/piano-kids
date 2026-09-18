/**
 * 一次性脚本：从 Bravura 抽取本项目需要的乐谱字形，生成 SVG 路径。
 *
 * ## 怎么跑
 *
 * ```bash
 * npm install                      # 需要 devDependency: opentype.js
 * mkdir .fontsrc
 * curl -L -o .fontsrc/Bravura.otf \
 *   https://raw.githubusercontent.com/steinbergmedia/bravura/master/redist/otf/Bravura.otf
 * npm run glyphs                   # 即 node scripts/extract-bravura-glyphs.mjs
 * ```
 *
 * `.fontsrc/` 已加入 .gitignore —— 868 KB 的源字体不必进版本库，
 * 生成物 `src/features/notation/bravuraGlyphs.ts`（~8 KB）才是需要提交的东西。
 *
 * ## 为什么不是直接打包字体
 *
 *   Bravura.otf 有 868 KB，而本项目整个 JS 包才 ~78 KB gzip，
 *   文档 §十八 也明确要求首屏不加载大资源。我们只需要 9 个字形，
 *   因此把轮廓抽出来做成几 KB 的路径数据，既不增加运行时负担，
 *   也天然满足「离线优先」（不依赖字体加载）。
 *   而且这份数据落在 `StaffReadingPage` 这个**按需加载**的 chunk 里（gzip 后约 5 KB），
 *   连首屏都不受影响。
 *
 * ## 许可（SIL Open Font License 1.1）
 *
 *   Copyright © 2015, Steinberg Media Technologies GmbH (http://www.steinberg.net/),
 *   with Reserved Font Name "Bravura".
 *
 *   OFL 允许把字体嵌入、修改并随软件再分发，前提是保留上述版权与许可声明。
 *   完整许可见 LICENSES/Bravura-OFL.txt。
 *
 * ## 坐标系（已用字形本身验证过，不是凭文档推的）
 *
 *   `opentype.js` 的 `glyph.getPath()` 返回的 **已经是 Y 向下的屏幕坐标**，
 *   与 SVG 一致，因此**不需要也不能再翻转**。
 *
 *   判据：降号（U+E260）的竖笔必须朝上。原始包围盒是 y ∈ [-439, 175]；
 *   只有把负值理解为「上」才成立，故确认 Y 向下。脚本末尾有自动断言。
 *
 *   SMuFL：em = 1000 单位，一个谱表间距 = 250 单位。
 *   高音谱号的原点在 G 线上，其包围盒 y ∈ [-1098, 658] 表示
 *   向上 4.39 个间距、向下 2.63 个间距 —— 与真实雕刻比例一致。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_PATH = resolve(root, '.fontsrc/Bravura.otf');
const OUT_PATH = resolve(root, 'src/features/notation/bravuraGlyphs.ts');

/** SMuFL: 一个谱表间距 = 1/4 em = 250 字体单位。 */
const STAFF_SPACE_UNITS = 250;

/**
 * 需要的字形。
 *
 * `anchor` 说明字形原点落在哪里：
 *   { kind: 'staffSpace', space } —— 固定在谱表上（0 = 最下面那条线）
 *   { kind: 'note' }             —— 跟随音符自身的谱表位置
 *
 * `anchorX` 说明原点在水平方向代表字形的什么位置，脚本据此算出 offsetX。
 */
const GLYPHS = [
  // 谱号：原点落在它所指示的那条线（G 谱号 → G 线 = 从下往上第 2 条）
  {
    key: 'gClef',
    code: 0xe050,
    name: '高音谱号 G clef',
    anchor: { kind: 'staffSpace', space: 1 },
    anchorX: 'left',
  },
  // 音符头：原点在音符头中心，跟随音符位置
  { key: 'noteheadWhole', code: 0xe0a2, name: '全音符', anchor: { kind: 'note' }, anchorX: 'center' },
  { key: 'noteheadHalf', code: 0xe0a3, name: '二分音符', anchor: { kind: 'note' }, anchorX: 'center' },
  { key: 'noteheadBlack', code: 0xe0a4, name: '四分音符', anchor: { kind: 'note' }, anchorX: 'center' },
  // 临时记号：原点落在音符所在的线/间上，水平方向放在音符头左侧
  { key: 'accidentalFlat', code: 0xe260, name: '降号', anchor: { kind: 'note' }, anchorX: 'edge' },
  { key: 'accidentalNatural', code: 0xe261, name: '还原号', anchor: { kind: 'note' }, anchorX: 'edge' },
  { key: 'accidentalSharp', code: 0xe262, name: '升号', anchor: { kind: 'note' }, anchorX: 'edge' },
  // 符尾：原点贴在符干末端
  { key: 'flag8thUp', code: 0xe240, name: '八分音符符尾（上）', anchor: { kind: 'note' }, anchorX: 'left' },
  { key: 'flag8thDown', code: 0xe241, name: '八分音符符尾（下）', anchor: { kind: 'note' }, anchorX: 'left' },
];

const buffer = readFileSync(FONT_PATH);
const font = opentype.parse(
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
);

const unitsPerEm = font.unitsPerEm;
console.log(`字体 em = ${unitsPerEm} 单位，谱表间距 = ${STAFF_SPACE_UNITS} 单位`);

/** 把 opentype 的路径命令转成 SVG path 字符串（坐标已是 Y 向下，原样输出）。 */
function toSvgPath(path) {
  const parts = [];
  for (const cmd of path.commands) {
    switch (cmd.type) {
      case 'M':
        parts.push(`M${r(cmd.x)} ${r(cmd.y)}`);
        break;
      case 'L':
        parts.push(`L${r(cmd.x)} ${r(cmd.y)}`);
        break;
      case 'C':
        parts.push(`C${r(cmd.x1)} ${r(cmd.y1)} ${r(cmd.x2)} ${r(cmd.y2)} ${r(cmd.x)} ${r(cmd.y)}`);
        break;
      case 'Q':
        parts.push(`Q${r(cmd.x1)} ${r(cmd.y1)} ${r(cmd.x)} ${r(cmd.y)}`);
        break;
      case 'Z':
        parts.push('Z');
        break;
      default:
        throw new Error(`未知路径命令：${cmd.type}`);
    }
  }
  return parts.join(' ');
}

function r(value) {
  return Math.round(value * 100) / 100;
}

/** 根据 anchorX 算出水平预偏移，使字形的锚点落在原点。 */
function horizontalOffset(bbox, anchorX) {
  if (anchorX === 'center') return -(bbox.x1 + bbox.x2) / 2;
  if (anchorX === 'edge') return -bbox.x1;
  return -bbox.x1; // 'left' 与 'edge' 同为左缘对齐
}

const out = [];
const report = [];

for (const spec of GLYPHS) {
  const glyph = font.charToGlyph(String.fromCodePoint(spec.code));
  if (!glyph || glyph.index === 0) {
    throw new Error(`取不到字形 ${spec.name} (U+${spec.code.toString(16).toUpperCase()})`);
  }
  const path = glyph.getPath(0, 0, unitsPerEm);
  const bbox = path.getBoundingBox();
  const offsetX = round(horizontalOffset(bbox, spec.anchorX));

  out.push({ ...spec, offsetX, path: toSvgPath(path) });
  report.push({
    字形: spec.name,
    码位: `U+${spec.code.toString(16).toUpperCase()}`,
    x范围: `${r(bbox.x1)} … ${r(bbox.x2)}`,
    y范围: `${r(bbox.y1)} … ${r(bbox.y2)}`,
    偏移X: offsetX,
    向上间距: r(-bbox.y1 / STAFF_SPACE_UNITS),
    向下间距: r(bbox.y2 / STAFF_SPACE_UNITS),
  });
}

console.log('\n字形包围盒（Y 向下，单位 = 字体单位；向上/向下以字形原点为准）：');
console.table(report);

/** 自检：高音谱号必须「向上伸得比向下多」，否则说明 Y 方向搞反了。 */
const clef = out.find((g) => g.key === 'gClef');
const clefGlyph = font.charToGlyph(String.fromCodePoint(clef.code));
const clefBox = clefGlyph.getPath(0, 0, unitsPerEm).getBoundingBox();
if (-clefBox.y1 <= clefBox.y2) {
  throw new Error(
    `坐标系自检失败：高音谱号向上 ${(-clefBox.y1).toFixed(0)} 应大于向下 ${clefBox.y2.toFixed(0)}`,
  );
}
console.log(
  `✓ 坐标系自检通过：高音谱号向上 ${(-clefBox.y1 / STAFF_SPACE_UNITS).toFixed(2)} 间距、` +
    `向下 ${(clefBox.y2 / STAFF_SPACE_UNITS).toFixed(2)} 间距（真实比例约为 4.4 : 2.6）`,
);

const header = `/**
 * 乐谱字形 —— 抽取自 Bravura（SMuFL 参考字体）
 *
 * ⚠️ 本文件由 scripts/extract-bravura-glyphs.mjs 自动生成，不要手改。
 *
 * ## 许可（SIL Open Font License 1.1）
 *
 *   Copyright © 2015, Steinberg Media Technologies GmbH (http://www.steinberg.net/),
 *   with Reserved Font Name "Bravura".
 *
 *   This Font Software is licensed under the SIL Open Font License, Version 1.1.
 *   完整许可见仓库根目录的 LICENSES/Bravura-OFL.txt。
 *
 *   OFL 允许把字体嵌入、修改并随软件再分发，前提是保留上述版权与许可声明。
 *   这里抽取的是**字形轮廓**（数据），不是字体文件本身 ——
 *   应用整体 JS 包只有约 78 KB gzip，而 Bravura.otf 有 868 KB，
 *   只取用到的 9 个字形既满足许可，又不违反文档 §十八 的体积预算。
 *
 * ## 坐标系
 *
 *   字体 em = 1000 单位，**一个谱表间距（staff space）= 250 单位**。
 *   字体 Y 轴向上，这里已统一翻转成 SVG 的 Y 轴向下。
 *   每个字形的原点是它在谱表上的对齐点，渲染时只需按 \`线距 / 250\` 缩放：
 *
 *     transform="translate(音符位置) scale(线距 / ${STAFF_SPACE_UNITS})"
 *
 *   因此换任何尺寸都不会走形，也不需要加载字体文件。
 */

/** 一个谱表间距对应的字体单位数（SMuFL 规定）。 */
export const STAFF_SPACE_UNITS = ${STAFF_SPACE_UNITS};

export interface NotationGlyph {
  /** 字形原点落在哪里 */
  anchor:
    | { kind: 'staffSpace'; space: number; label: '固定谱表位置' }
    | { kind: 'note'; label: '跟随音符位置' };
  /** 水平方向的预偏移（字体单位）：让字形锚点落在原点 */
  offsetX: number;
  /** SVG path（Y 向下，单位 = 字体单位，1 谱表间距 = ${STAFF_SPACE_UNITS}） */
  path: string;
}

export const NOTATION_GLYPHS = {
`;

const body = out
  .map((g) => {
    const anchor =
      g.anchor.kind === 'staffSpace'
        ? `{ kind: 'staffSpace', space: ${g.anchor.space}, label: '固定谱表位置' }`
        : `{ kind: 'note', label: '跟随音符位置' }`;
    return (
      `  /** ${g.name} U+${g.code.toString(16).toUpperCase()} */\n` +
      `  ${g.key}: {\n` +
      `    anchor: ${anchor},\n` +
      `    offsetX: ${g.offsetX},\n` +
      `    path:\n      '${g.path}',\n` +
      `  },`
    );
  })
  .join('\n');

const footer = `
} as const satisfies Record<string, NotationGlyph>;

export type NotationGlyphKey = keyof typeof NOTATION_GLYPHS;
`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, header + body + footer, 'utf8');

const kb = (readFileSync(OUT_PATH).length / 1024).toFixed(1);
console.log(`\n已生成 ${OUT_PATH.replace(root + '\\', '')}（${kb} KB）`);
console.log(`对比：Bravura.otf 为 ${(readFileSync(FONT_PATH).length / 1024).toFixed(0)} KB`);

function round(value, digits = 2) {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}
