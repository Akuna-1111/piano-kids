// 扫描「选择器列表里夹着注释」这种静默截断：
// 批量脚本删掉某条规则的声明块时，会留下 `选择器,` + 注释 + 下一条规则，
// 于是它们被 CSS 合并成一条规则 —— 语法完全合法，esbuild 不会报警。
// 这个仓库从不把注释写进选择器列表，所以「注释前面还有选择器文本」= 损坏。
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.name.endsWith('.css')) out.push(f);
  }
  return out;
};

let hits = 0;
for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative('src', file).replace(/\\/g, '/');
  // 逐块扫描：header 是上一个 } 到 { 之间的文本
  let index = 0;
  const re = /([^{}]*)\{/g;
  let m;
  while ((m = re.exec(src))) {
    const header = m[1];
    const commentAt = header.lastIndexOf('/*');
    if (commentAt === -1) continue;
    // 把最后一段注释之前的文本里的所有注释去掉；若还剩选择器文本，才是损坏。
    // （否则「文件头注释 + 区块注释 + 选择器」这种正常写法会被误报）
    const beforeComment = header.slice(0, commentAt).replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (!beforeComment) continue;
    // 注释前面还有选择器文本 → 可疑：说明有一条规则的声明块被删了
    const selectors = beforeComment
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    hits += 1;
    const line = src.slice(0, m.index).split('\n').length;
    console.log(`${rel}:${line}  选择器列表里夹着注释`);
    console.log(`   被吞掉的选择器：${selectors.join(' , ')}`);
    const after = header.slice(commentAt).replace(/\s+/g, ' ').trim();
    console.log(`   注释之后又被并进来的规则：${after.slice(0, 80)}`);
    console.log('');
  }
}
console.log(hits === 0 ? '没有发现这种损坏' : `发现 ${hits} 处`);
