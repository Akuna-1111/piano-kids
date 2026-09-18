// 按「选择器 → 属性」精确改 CSS 的工具。
// 用法：node scripts/css-edit.mjs scripts/typography-ops.json [--dry]
// 支持 set（写入/插入属性）、removeRule（删规则）、全局字重与行高归一。
import fs from 'node:fs';
import path from 'node:path';

const opsFile = process.argv[2] ?? 'scripts/typography-ops.json';
const dry = process.argv.includes('--dry');
const ops = JSON.parse(fs.readFileSync(opsFile, 'utf8'));

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
/** 选择器前常有注释，比较前先去掉（写回时保留注释）。 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** 把文件切成「顶层块」序列，保留原文以便精确写回。 */
function blocks(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1) {
      out.push({ type: 'text', text: src.slice(i) });
      break;
    }
    // 找配对的花括号（注释里不含花括号是前提，本仓库满足）
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const header = src.slice(i, open);
    const body = src.slice(open + 1, j);
    const nested = body.includes('{');
    if (nested) {
      out.push({ type: 'text', text: header + '{' });
      out.push({ type: 'inner', text: body, start: open + 1, end: j });
      out.push({ type: 'text', text: '}' });
    } else {
      out.push({ type: 'rule', header, body, text: src.slice(i, j + 1) });
    }
    i = j + 1;
  }
  return out;
}

const reports = [];

function editFile(file, mutators) {
  const abs = path.resolve(file);
  let src = fs.readFileSync(abs, 'utf8');
  const parts = blocks(src);
  let touched = 0;

  for (const mutator of mutators) {
    for (const part of parts) {
      if (part.type !== 'rule') continue;
      const sel = norm(stripComments(part.header));
      if (sel !== mutator.selector) continue;

      if (mutator.removeRule) {
        part.text = '';
        reports.push(`${file}  删除规则 ${mutator.selector}`);
        touched += 1;
        continue;
      }

      let body = part.body;
      for (const [prop, value] of Object.entries(mutator.set ?? {})) {
        const re = new RegExp(`(^|\\n)(\\s*)${prop}:\\s*([^;]+);`);
        const found = re.exec(body);
        if (found) {
          if (found[3].trim() === value) continue;
          reports.push(`${file}  ${mutator.selector}  ${prop}: ${found[3].trim()} → ${value}`);
          body = body.replace(re, `$1$2${prop}: ${value};`);
        } else {
          const indent = /\n(\s*)\S/.exec(body)?.[1] ?? '  ';
          reports.push(`${file}  ${mutator.selector}  ${prop}: （新增）→ ${value}`);
          body = body.replace(/\s*$/, '') + `\n${indent}${prop}: ${value};\n`;
        }
      }
      part.body = body;
      part.text = part.header + '{' + body + '}';
      touched += 1;
    }
  }

  // 重建：规则用改后的 text，其余原样
  let out = '';
  for (const part of parts) {
    if (part.type === 'rule') out += part.text;
    else out += part.text;
  }

  // 全局归一：数字字重 → token；原值行高 → token
  if (ops.global) {
      for (const [from, to] of Object.entries(ops.global.weight ?? {})) {
        const re = new RegExp(`font-weight:\\s*${from};`, 'g');
        const n = (out.match(re) ?? []).length;
        if (n) {
          out = out.replace(re, `font-weight: ${to};`);
          reports.push(`${file}  字重归一 ${from} → ${to}（${n} 处）`);
          touched += n;
        }
      }
      for (const [from, to] of Object.entries(ops.global.lineHeight ?? {})) {
        const re = new RegExp(`line-height:\\s*${from.replace('.', '\\.')};`, 'g');
        const n = (out.match(re) ?? []).length;
        if (n) {
          out = out.replace(re, `line-height: ${to};`);
          reports.push(`${file}  行高归一 ${from} → ${to}（${n} 处）`);
          touched += n;
        }
      }
  }

  if (touched && !dry) fs.writeFileSync(abs, out, 'utf8');
}

for (const [file, mutators] of Object.entries(ops.files)) editFile(file, mutators);

console.log(reports.length ? reports.join('\n') : '（没有任何改动）');
console.log(`\n共 ${reports.length} 处${dry ? '（dry-run，未写入）' : ''}`);
