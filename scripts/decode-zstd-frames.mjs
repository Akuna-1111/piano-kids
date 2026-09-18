/**
 * 把多帧拼接的 zstd 文件解开（Node 的 zstd 解码器只吃第一帧）。
 *
 * DSH 的会话记录 `session.jsonl.zstd` 是**追加写**的：每追加一批就压成一个新帧，
 * 于是整个文件是「帧 + 帧 + 帧…」。Node 的 `zstdDecompressSync` / 流式解码器
 * 都只解第一帧（10.7MB 的文件只解出 174 字节），所以这里自己按帧魔数切分。
 *
 * 用法：node scripts/decode-zstd-frames.mjs <输入> <输出>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function findFrameStarts(input) {
  const starts = [];
  for (let offset = 0; offset + 4 <= input.length; offset += 1) {
    if (
      input[offset] === MAGIC[0] &&
      input[offset + 1] === MAGIC[1] &&
      input[offset + 2] === MAGIC[2] &&
      input[offset + 3] === MAGIC[3]
    ) {
      starts.push(offset);
    }
  }
  return starts;
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('用法：node scripts/decode-zstd-frames.mjs <输入> <输出>');
  process.exit(2);
}

const input = readFileSync(inputPath);
const starts = findFrameStarts(input);

const parts = [];
let failed = 0;
for (let i = 0; i < starts.length; i += 1) {
  const slice = input.subarray(starts[i], starts[i + 1] ?? input.length);
  try {
    parts.push(zstdDecompressSync(slice));
  } catch {
    // 魔数也可能碰巧出现在压缩数据内部 —— 那就把这一帧并进下一帧重试
    failed += 1;
    const next = starts[i + 2] ?? input.length;
    try {
      parts.push(zstdDecompressSync(input.subarray(starts[i], next)));
      i += 1;
    } catch {
      /* 实在解不开就跳过，不能因此丢掉后面的帧 */
    }
  }
}

const output = Buffer.concat(parts);
writeFileSync(outputPath, output);
console.log(`输入 ${input.length} 字节 → 帧数 ${starts.length}（重试 ${failed}）→ 输出 ${output.length} 字节`);
