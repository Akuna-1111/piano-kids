/**
 * 生成 PWA 图标（纯 Node，无第三方依赖）。
 *
 *   node scripts/generate-icons.mjs
 *
 * 输出：public/icons/icon-192.png、icon-512.png、icon-maskable-512.png
 * 画的是「键盘条 + 一颗星星」，不依赖任何设计资源，构建可复现。
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');

// ---------------------------------------------------------------- PNG 编码

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 绘制

const BG_TOP = [124, 150, 255];
const BG_BOTTOM = [76, 111, 255];
const WHITE_KEY = [255, 255, 255];
const WHITE_KEY_SHADOW = [226, 232, 248];
const BLACK_KEY = [35, 40, 58];
const STAR = [255, 214, 106];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** 带抗锯齿的圆角矩形覆盖率。 */
function roundedRectCoverage(x, y, left, top, right, bottom, radius) {
  const sample = (px, py) => {
    if (px < left || px > right || py < top || py > bottom) return 0;
    const cx = Math.min(Math.max(px, left + radius), right - radius);
    const cy = Math.min(Math.max(py, top + radius), bottom - radius);
    const dx = px - cx;
    const dy = py - cy;
    return dx * dx + dy * dy <= radius * radius ? 1 : 0;
  };
  // 2x2 超采样
  return (
    (sample(x - 0.25, y - 0.25) +
      sample(x + 0.25, y - 0.25) +
      sample(x - 0.25, y + 0.25) +
      sample(x + 0.25, y + 0.25)) /
    4
  );
}

function drawIcon(size, { maskable }) {
  const buffer = Buffer.alloc(size * size * 4, 0);
  const scale = size / 512;

  // maskable 图标需要留出安全区（内容缩到 78% 并缩小圆角背景）
  const contentScale = maskable ? 0.78 : 1;
  const offset = (1 - contentScale) / 2;

  const bgRadius = maskable ? 0 : 104 * scale;
  const bgLeft = maskable ? 0 : 24 * scale;
  const bgRight = maskable ? size : size - 24 * scale;
  const bgTop = maskable ? 0 : 24 * scale;
  const bgBottom = maskable ? size : size - 24 * scale;

  const kx = (v) => (offset + (v / 512) * contentScale) * size;
  const ky = (v) => (offset + (v / 512) * contentScale) * size;

  // 键盘条几何
  const keyLeft = kx(96);
  const keyRight = kx(416);
  const keyTop = ky(268);
  const keyBottom = ky(392);
  const keyRadius = 14 * scale * contentScale;
  const whiteCount = 5;
  const whiteWidth = (keyRight - keyLeft) / whiteCount;

  const blackLayout = [
    { index: 0, offset: 0.68 },
    { index: 1, offset: 0.68 },
    { index: 3, offset: 0.68 },
  ];
  const blackWidth = whiteWidth * 0.58;
  const blackTop = keyTop;
  const blackBottom = keyTop + (keyBottom - keyTop) * 0.62;

  // 星星（五角星用极坐标判定）
  const starCx = kx(256);
  const starCy = ky(168);
  const starOuter = 74 * scale * contentScale;
  const starInner = starOuter * 0.46;

  const starPoints = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? starOuter : starInner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    starPoints.push([starCx + Math.cos(angle) * radius, starCy + Math.sin(angle) * radius]);
  }

  const inStar = (x, y) => {
    let inside = false;
    for (let i = 0, j = starPoints.length - 1; i < starPoints.length; j = i, i += 1) {
      const [xi, yi] = starPoints[i];
      const [xj, yj] = starPoints[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const bgCoverage = roundedRectCoverage(px, py, bgLeft, bgTop, bgRight, bgBottom, bgRadius);
      if (bgCoverage <= 0) continue;

      const gradient = mix(BG_TOP, BG_BOTTOM, (py - bgTop) / Math.max(1, bgBottom - bgTop));
      let color = gradient;

      // 键盘底板
      const boardCoverage = roundedRectCoverage(
        px,
        py,
        keyLeft - 8 * scale,
        keyTop - 8 * scale,
        keyRight + 8 * scale,
        keyBottom + 8 * scale,
        18 * scale * contentScale,
      );
      if (boardCoverage > 0) {
        color = mix(color, [16, 20, 44], boardCoverage * 0.35);
      }

      // 白键
      const whiteCoverage = roundedRectCoverage(px, py, keyLeft, keyTop, keyRight, keyBottom, keyRadius);
      if (whiteCoverage > 0) {
        const relative = (px - keyLeft) / whiteWidth;
        const inGap = Math.abs(relative - Math.round(relative)) < 0.012 && relative > 0.02 && relative < whiteCount - 0.02;
        const keyColor = inGap ? WHITE_KEY_SHADOW : WHITE_KEY;
        color = mix(color, keyColor, whiteCoverage);
      }

      // 黑键
      for (const black of blackLayout) {
        const left = keyLeft + whiteWidth * (black.index + black.offset);
        const coverage = roundedRectCoverage(
          px,
          py,
          left,
          blackTop,
          left + blackWidth,
          blackBottom,
          7 * scale * contentScale,
        );
        if (coverage > 0) color = mix(color, BLACK_KEY, coverage);
      }

      // 星星
      if (inStar(px, py)) color = mix(color, STAR, 0.97);

      const index = (y * size + x) * 4;
      buffer[index] = color[0];
      buffer[index + 1] = color[1];
      buffer[index + 2] = color[2];
      buffer[index + 3] = Math.round(255 * bgCoverage);
    }
  }

  return encodePng(size, size, buffer);
}

mkdirSync(outDir, { recursive: true });

const outputs = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

for (const [name, size, options] of outputs) {
  const png = drawIcon(size, options);
  writeFileSync(resolve(outDir, name), png);
  console.log(`✓ ${name} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
