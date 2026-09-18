// 逐个 CSS 交给 esbuild 压缩，复现 Vite 的 css-syntax-error 警告并定位到文件。
import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';

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
  const res = await esbuild.transform(src, { loader: 'css', minify: true });
  const warns = res.warnings.filter((w) => w.text.includes('Unexpected'));
  if (warns.length) {
    hits += 1;
    console.log(`${file}:`);
    for (const w of warns) {
      console.log(`   ${w.text}  @ ${JSON.stringify(w.location)}`);
    }
    const lines = src.split(/\r?\n/);
    for (const w of warns) {
      const ln = w.location?.line;
      if (ln) {
        console.log('   上下文:');
        for (let i = Math.max(1, ln - 4); i <= Math.min(lines.length, ln + 2); i++) {
          console.log(`      ${i}: ${lines[i - 1]}`);
        }
      }
    }
  }
}
console.log(hits === 0 ? '没有 CSS 语法警告' : `${hits} 个文件有警告`);
