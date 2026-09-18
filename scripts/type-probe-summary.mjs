// 汇总排版探针结果（scripts/flows/typography.js 的输出）
import fs from 'node:fs';

const dir = '.shots';

/** PowerShell 的 `*>` 重定向会写成 UTF-16LE，所以按 BOM 自适应解码。 */
const readText = (file) => {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^\uFEFF/, '');
  return buf.toString('utf8').replace(/^\uFEFF/, '');
};

for (const f of fs.readdirSync(dir).filter((n) => n.startsWith('type-') && n.endsWith('.log'))) {
  const txt = readText(dir + '/' + f);
  const line = txt.split(/\r?\n/).find((l) => l.trim().startsWith('{"route"'));
  if (!line) {
    console.log(f, '（无 JSON 输出）');
    continue;
  }
  const j = JSON.parse(line.trim());
  const t = j.texts;
  const fmt = (k) => {
    const v = t[k];
    return v ? `${v.fontSize}px/${v.lineHeight} w${v.weight}` : '—';
  };
  const bars = Object.entries(j.bars)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v.h}`)
    .join(' ');
  console.log(`## ${j.route}  ${j.viewport}`);
  console.log(`   页面标题 ${fmt('.page__title')} | 首页品牌 ${fmt('.home__brand-name')} | 练习歌名 ${fmt('.pp__title-name')}`);
  console.log(
    `   挑战/自检 ${fmt('.chl__title')} ${fmt('.tune__title')} | 区块标题 ${fmt('.settings__group-title')} ${fmt('.tune__panel-title')} ${fmt('.im__heading')} ${fmt('.wardrobe__preview-title')}`,
  );
  console.log(`   数字 ${fmt('.chl__combo-value')} ${fmt('.wardrobe__growth-value')} | 正文 ${fmt('.settings__label')} | 辅助 ${fmt('.settings__note')}`);
  console.log(`   顶栏高度 ${bars || '—'} | 列 ${JSON.stringify(j.column)} | 溢出 ${j.overflowX} | 裁切 ${j.clippedCount}`);
  for (const [sel, kids] of Object.entries(j.barChildren ?? {})) {
    console.log(`   ${sel} 内高子元素 ${JSON.stringify(kids)}`);
  }
  if (j.clippedCount) console.log('   裁切明细', JSON.stringify(j.clipped));
}
