// 排版映射：列出每个规则块的「选择器 → 字号 / 字重」，用来核对层级是否统一。
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

for (const file of walk('src')) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative('src', file).replace(/\\/g, '/');
  const rows = [];
  const extra = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) {
    const sel = m[1].trim().split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
    const body = m[2];
    const fs_ = /font-size:\s*([^;]+);/.exec(body);
    const fw = /font-weight:\s*([^;]+);/.exec(body);
    const lh = /line-height:\s*([^;]+);/.exec(body);
    const mw = /max-width:\s*([^;]+);/.exec(body);
    if (fs_ || fw) {
      rows.push(`${sel} → ${fs_ ? fs_[1].trim() : '—'} ${fw ? '/ w' + fw[1].trim() : ''}`);
    }
    if ((lh && !lh[1].trim().startsWith('var(')) || mw) {
      extra.push(`${rel}  ${sel} → ${lh ? 'lh ' + lh[1].trim() : ''} ${mw ? 'max-w ' + mw[1].trim() : ''}`);
    }
  }
  if (rows.length) {
    console.log(`\n### ${rel}`);
    for (const r of rows) console.log('  ' + r);
  }
  if (extra.length) {
    console.log(`\n--- ${rel} 行高/宽度 ---`);
    for (const r of extra) console.log('  ' + r);
  }
}
