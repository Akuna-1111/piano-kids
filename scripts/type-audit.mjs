// 排版审计：盘出每个 CSS 文件实际用的字号 / 字重 / 行高，找出偏离 token 的硬编码。
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

const files = walk('src');
const fontSize = new Map(); // value -> [file:count]
const fontWeight = new Map();
const hardPx = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative('src', file).replace(/\\/g, '/');
  for (const m of src.matchAll(/font-size:\s*([^;]+);/g)) {
    const v = m[1].trim();
    if (!fontSize.has(v)) fontSize.set(v, new Map());
    const per = fontSize.get(v);
    per.set(rel, (per.get(rel) ?? 0) + 1);
    if (/^\d/.test(v) && /px$/.test(v)) hardPx.push(`${rel}: font-size: ${v}`);
  }
  for (const m of src.matchAll(/font-weight:\s*([^;]+);/g)) {
    const v = m[1].trim();
    if (!fontWeight.has(v)) fontWeight.set(v, new Map());
    const per = fontWeight.get(v);
    per.set(rel, (per.get(rel) ?? 0) + 1);
  }
}

const show = (title, map, numeric = false) => {
  console.log(`\n=== ${title} ===`);
  const rows = [...map.entries()].map(([v, per]) => ({
    v,
    total: [...per.values()].reduce((a, b) => a + b, 0),
    where: [...per.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f}×${c}`).join(' '),
  }));
  rows.sort((a, b) => (numeric ? parseFloat(b.v) - parseFloat(a.v) || b.total - a.total : a.v.localeCompare(b.v)));
  for (const r of rows) console.log(`${r.v.padEnd(34)} ${String(r.total).padStart(3)}  ${r.where}`);
};

show('字号（font-size）', fontSize, false);
show('字重（font-weight）', fontWeight, true);

console.log('\n=== 硬编码 px 字号（应当全部换 token） ===');
console.log(hardPx.length ? hardPx.join('\n') : '（无）');

const collect = (prop) => {
  const map = new Map();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative('src', file).replace(/\\/g, '/');
    for (const m of src.matchAll(new RegExp(`${prop}:\\s*([^;]+);`, 'g'))) {
      const v = m[1].trim();
      if (!map.has(v)) map.set(v, new Map());
      const per = map.get(v);
      per.set(rel, (per.get(rel) ?? 0) + 1);
    }
  }
  return map;
};

// 只看非 var() 的原值：用了 token 的说明已经统一
const nonToken = (map) => {
  const out = new Map();
  for (const [v, per] of map) if (!v.startsWith('var(')) out.set(v, per);
  return out;
};

show('行高（line-height，仅原值）', nonToken(collect('line-height')), false);
show('内容最大宽度（max-width，仅原值）', nonToken(collect('max-width')), false);
