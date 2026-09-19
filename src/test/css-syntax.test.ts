/**
 * @vitest-environment node
 *
 * 必须跑在 node 环境：jsdom 的 `TextEncoder` 属于另一个 realm，
 * esbuild 会因此报 `Invariant violation: ... instanceof Uint8Array`。
 * 本文件只读源码、不碰 DOM，跑在 node 下没有任何损失。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * CSS 语法守卫 —— 防的是「样式被静默截断」。
 *
 * 这一条来自一次真实事故：一个批量改样式的脚本把
 * `src/features/tuning/tuning.css` 结尾的
 * `.tune__keys, .tune__sizes { grid-column: 1 / -1; }` 削掉了一半，
 * 只剩下一个孤立的 `.tune__keys,`。
 *
 * 后果是**静默的**：
 *   - 括号数仍然平衡（`}` 数量对得上），所以「数括号」的检查抓不到
 *   - 页面不报错、测试全绿，只是宽屏下键盘不再横跨两列
 *   - 唯一的信号是 `npm run build` 里一行 `▲ [WARNING] Unexpected "}"`
 *
 * 注意它检测的是**语法**，不是**意图**：脚本删掉一整条本来有用的规则、
 * 而且删得干干净净（括号仍然配平）时这里也抓不到 ——
 * 那种情况只能靠 §11 的规矩（批量改样式一律用 `edit` / Node 脚本，
 * 不要用带正则的 shell 管道）来避免。
 */
const SRC = resolve(__dirname, '..');

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) cssFiles(full, out);
    else if (entry.endsWith('.css')) out.push(full);
  }
  return out;
}

describe('CSS 语法（防静默截断）', () => {
  const files = cssFiles(SRC);

  it('扫描到了全部样式文件（守卫本身没失效）', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('每个样式文件都能被解析，没有孤立的选择器或多余的 }', () => {
    const problems: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const { warnings } = transformSync(source, { loader: 'css' });
      const where = relative(SRC, file);

      for (const warning of warnings) {
        const line = warning.location ? `:${warning.location.line}` : '';
        problems.push(`${where}${line} ${warning.text}`);
      }

      // 括号配平（esbuild 的警告已经覆盖，这里留一条更直白的读数）
      let depth = 0;
      let balanced = true;
      for (const ch of source) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
        if (depth < 0) balanced = false;
      }
      if (!balanced || depth !== 0) problems.push(`${where} 花括号不配平（结尾 depth=${depth}）`);
    }

    expect(problems).toEqual([]);
  });

  /**
   * 静默截断的签名：**注释出现在选择器列表中间**。
   *
   * 批量脚本删掉一条规则的声明块时，会留下「选择器, 换行 选择器, 换行 + 下一条规则的注释」，
   * 于是这些选择器被 CSS 合并进**下一条规则**：
   *
   * ```css
   * /* 速度档的分段控件 *\/
   * .pp__tempo,
   *
   * .pp__tempo-btn,
   *
   * .pp__tempo-btn.is-active,
   *
   * /* ---------------- 舞台 ---------------- *\/
   * .pp__stage { display: grid; ... }     ← 速度档被套上了舞台的 grid
   * ```
   *
   * 实测后果：练习页的速度档变成**竖排 3 行**，顶栏被撑高 110px，键盘少了 110px 高。
   * 而它**语法完全合法** —— esbuild 不报警、括号也配平，页面不报错、测试全绿。
   *
   * 这个仓库从不把注释写进选择器列表，所以「注释之前还剩下真正的选择器文本」即损坏。
   * （文件头注释 + 区块注释 + 选择器是正常写法，所以要先剥掉注释再判断。）
   */
  it('选择器列表里不夹注释（声明块被静默删掉会留下这个签名）', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const where = relative(SRC, file);
      const re = /([^{}]*)\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source))) {
        const header = m[1];
        const commentAt = header.lastIndexOf('/*');
        if (commentAt === -1) continue;
        const beforeComment = header.slice(0, commentAt).replace(/\/\*[\s\S]*?\*\//g, '').trim();
        if (!beforeComment) continue;
        const line = source.slice(0, m.index).split('\n').length;
        offenders.push(`${where}:${line} 选择器「${beforeComment.split('\n').map((s) => s.trim()).filter(Boolean).join(' ')}」后面夹着注释 —— 声明块可能被删了`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
