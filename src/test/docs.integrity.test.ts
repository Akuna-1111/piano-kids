import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 文档完整性守卫。
 *
 * ## 这条测试的由来（一次真实事故）
 *
 * `docs/开发进度与验收.md` 被一条 PowerShell 命令写坏了：
 * `(Get-Content $f -Raw) -replace ... | Set-Content $f -NoNewline`
 * 在中文内容上把 1381 个字符变成了 `\uFFFD?`，462 / 793 行受影响。
 * 而这个仓库**不是 git 仓库**，没有第二份副本 ——
 * 最后是靠重放 DSH 会话记录才救回来的（见 `AGENTS.md` §11）。
 *
 * 事后能留下的最有价值的东西不是那次恢复，而是**下次能立刻发现**：
 * 这类损坏的两个特征都能机械地查出来 ——
 *
 *   1. `\uFFFD`（替换字符）——编码坏掉的直接证据，正常中文文档里不该出现
 *   2. 代码围栏**成对**——损坏会吃掉行尾字符，` ``` ` 首当其冲，围栏一乱整篇排版就崩
 */

const ROOT = resolve(__dirname, '..', '..');

function collectMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.shots' || entry === '.fontsrc') {
      continue;
    }
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectMarkdown(full, acc);
      continue;
    }
    if (entry.endsWith('.md')) acc.push(full);
  }
  return acc;
}

describe('文档完整性（编码损坏与代码围栏）', () => {
  const files = collectMarkdown(ROOT);

  it('扫描范围覆盖到全部 Markdown', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it('没有任何 \uFFFD 替换字符（编码坏掉的直接证据）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const count = [...text].filter((ch) => ch.charCodeAt(0) === 0xfffd).length;
      if (count > 0) offenders.push(`${relative(ROOT, file)}：${count} 处`);
    }
    expect(
      offenders,
      `\n这些文档里有替换字符，说明某次写入用了错的编码（见 AGENTS.md §11）：\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });

  it('代码围栏成对（围栏被吃掉会让整篇排版崩掉）', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const fences = text
        .split('\n')
        .filter((line) => line.trimStart().startsWith('```')).length;
      if (fences % 2 !== 0) {
        offenders.push(`${relative(ROOT, file)}：${fences} 个 \`\`\`（奇数）`);
      }
    }
    expect(
      offenders,
      `\n这些文档的代码围栏数量是奇数，说明有围栏被吃掉或漏写：\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});
