/**
 * 从 DSH 会话记录里重放某个文件的历史，恢复出损坏前的内容。
 *
 * ## 背景
 *
 * `docs/开发进度与验收.md` 被一次「用 PowerShell 的 Get-Content/Set-Content 做正则替换」
 * 写坏了（1381 个字符变成 `\uFFFD?`）。仓库**不是 git 仓库**，没有别的副本。
 *
 * 但 DSH 的会话记录是**追加写**的 JSONL，里面有本会话每一次工具调用：
 *   · `write` 带上完整 `content`
 *   · `edit` 带上 `old_string` / `new_string`
 * 所以只要按顺序重放，就能还原出损坏前的字节。
 *
 * 用法：node scripts/replay-file-history.mjs <session.jsonl> <目标文件路径片段> <输出路径>
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [sessionPath, pathFragment, outputPath] = process.argv.slice(2);
if (!sessionPath || !pathFragment || !outputPath) {
  console.error('用法：node scripts/replay-file-history.mjs <session.jsonl> <路径片段> <输出路径>');
  process.exit(2);
}

const records = readFileSync(sessionPath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));

function parseArgs(call) {
  const raw = call.arguments ?? call.args ?? call.input ?? {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }
  return raw;
}

const operations = [];
for (const record of records) {
  if (record.type !== 'tool/call') continue;
  const data = record.data ?? {};
  const name = data.name ?? data.tool ?? data.toolName;
  if (name !== 'write' && name !== 'edit') continue;
  const args = parseArgs(data);
  if (typeof args.file_path !== 'string' || !args.file_path.includes(pathFragment)) continue;
  operations.push({ name, args });
}

let content = null;
const log = [];
let failures = 0;

for (const { name, args } of operations) {
  if (name === 'write') {
    content = args.content;
    log.push(`write            → ${content.length} 字符`);
    continue;
  }

  if (content === null) {
    log.push('edit             → 跳过（此前没有 write，拿不到初始内容）');
    failures += 1;
    continue;
  }

  const { old_string: before, new_string: after, replace_all: replaceAll } = args;
  const occurrences = before === '' ? 0 : content.split(before).length - 1;

  if (occurrences === 0) {
    log.push(
      `edit             → ❌ old_string 找不到，跳过（${before.length} 字符）：${JSON.stringify(before.slice(0, 60))}`,
    );
    failures += 1;
    continue;
  }
  if (occurrences > 1 && !replaceAll) {
    log.push(`edit             → ⚠️ old_string 出现 ${occurrences} 次，按首次替换`);
  }

  content = replaceAll
    ? content.split(before).join(after)
    : content.replace(before, after);
  log.push(`edit             → ✅ ${content.length} 字符（原串出现 ${occurrences} 次）`);
}

if (content === null) {
  console.error('❌ 没有找到 write 记录，无法重放');
  process.exit(1);
}

writeFileSync(outputPath, content);
console.log(log.join('\n'));
console.log(`\n共 ${operations.length} 次操作，失败跳过 ${failures} 次`);
console.log(`输出 ${outputPath}：${content.length} 字符 / ${content.split('\n').length} 行`);
