/**
 * 校验重放恢复出来的内容是否可信。
 *
 * 思路：损坏只**替换**字符，不删行。所以被损坏文件里**没有损坏标记**的行，
 * 应当能在恢复结果里找到**一模一样**的一行。若有缺失，说明重放漏了内容。
 *
 * 用法：node scripts/verify-restored-doc.mjs <恢复结果> <损坏副本>
 */

import { readFileSync } from 'node:fs';

const [restoredPath, corruptedPath, ...rest] = process.argv.slice(2);
if (!restoredPath || !corruptedPath || rest.length > 0) {
  console.error('用法：node scripts/verify-restored-doc.mjs <恢复结果> <损坏副本>');
  process.exit(2);
}

const restored = readFileSync(restoredPath, 'utf8').split('\n');
const corrupted = readFileSync(corruptedPath, 'utf8').split('\n');
const restoredSet = new Set(restored);

const undamaged = corrupted.filter((line) => !line.includes('\uFFFD'));
const missing = undamaged.filter((line) => line.trim() !== '' && !restoredSet.has(line));

console.log('损坏文件行数              :', corrupted.length);
console.log('  其中未损坏的行          :', undamaged.length);
console.log('恢复结果行数              :', restored.length);
console.log('未损坏却在恢复结果里找不到:', missing.length);

for (const line of missing.slice(0, 10)) {
  console.log('  缺失: ' + JSON.stringify(line.slice(0, 110)));
}

if (missing.length === 0) {
  console.log('\n✅ 恢复成功：损坏文件里所有未损坏的行都能在恢复结果里逐行找到');
} else {
  console.log('\n❌ 恢复不完整，重放漏了内容');
  process.exitCode = 1;
}
