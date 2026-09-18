// 找出 CSS 里已经没有任何 TSX/TS 引用的类名（排版统一时顺手清死代码）。
import fs from 'node:fs';
import path from 'node:path';

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
};

const all = walk('src');
const css = all.filter((f) => f.endsWith('.css'));
const code = all.filter((f) => /\.(tsx?|ts)$/.test(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

for (const file of css) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative('src', file).replace(/\\/g, '/');
  // 去掉注释再找类名
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const m of clean.matchAll(/\.([a-zA-Z][\w-]*)/g)) names.add(m[1]);
  const dead = [...names].filter((n) => !code.includes(n));
  if (dead.length) console.log(`${rel}: ${dead.join(' ')}`);
}
