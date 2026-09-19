// 汇总小挑战布局探针的多个尺寸读数（scripts/flows/challenge-layout.js 的输出）
import fs from 'node:fs';

const readText = (file) => {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
};

const rows = [];
for (const f of fs.readdirSync('.shots').filter((n) => n.startsWith('chl-') && n.endsWith('.log'))) {
  const txt = readText('.shots/' + f);
  const start = txt.indexOf('{');
  if (start === -1) {
    rows.push({ file: f, note: '（无 JSON）' });
    continue;
  }
  let j;
  try {
    j = JSON.parse(txt.slice(start, txt.lastIndexOf('}') + 1));
  } catch {
    rows.push({ file: f, note: '（JSON 解析失败）' });
    continue;
  }
  const covered = (j.命中测试 ?? []).filter((h) => !h.属于谱面);
  rows.push({
    file: f,
    viewport: j.viewport,
    route: j.route,
    staff: j.staff ? `y=${j.staff.y} h=${j.staff.h}` : '（无谱面）',
    谱面被挡: covered.length ? covered.map((c) => `${c.位置}:${c.最上面}`).join(' ') : '否',
    键盘高: j.keyboard?.height,
    键宽: j.keyboard?.keyWidth,
    碰撞: (j.collisions ?? []).join(','),
    溢出: `${j.overflowX}/${j.overflowY}`,
    越界按钮: (j.offscreenButtons ?? []).join(',') || '-',
  });
}

rows.sort((a, b) => (a.viewport ?? '').localeCompare(b.viewport ?? ''));
for (const r of rows) {
  console.log(
    `${(r.viewport ?? '?').padEnd(10)} ${(r.route ?? '').padEnd(24)} 谱面 ${(r.staff ?? '').padEnd(16)} 被挡=${(r.谱面被挡 ?? '').padEnd(28)} 键盘高=${String(r.键盘高 ?? '-').padEnd(5)} 键宽=${String(r.键宽 ?? '-').padEnd(5)} 碰撞=${(r.碰撞 ?? '').padEnd(20)} 溢出=${r.溢出} 越界按钮=${r.越界按钮} ${r.note ?? ''}`,
  );
}
