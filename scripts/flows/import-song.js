/**
 * 内容包完整流程（真人操作路径）：
 * `#/import` 贴简谱 → 检查 → 保存 → 去曲库确认出现。
 *
 * 为什么要跑这一趟：这条链上有三处只有真实浏览器能验的东西 ——
 * 受控输入（React 的 value 要经过原生 setter 才认）、localStorage 的写读往返、
 * 以及曲库页真的会去读内容包。
 *
 * 用法：npm run shot -- "#/import" --script scripts/flows/import-song.js
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (selector, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (document.querySelector(selector)) return;
    await sleep(80);
  }
  throw new Error(`等不到 ${selector}`);
};

const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';

/** React 受控输入：必须走原生 setter 再派发 input 事件 */
function setInput(el, value) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const clickByText = (label) => {
  const button = [...document.querySelectorAll('button')].find((item) =>
    (item.textContent ?? '').includes(label),
  );
  if (!button) throw new Error(`找不到按钮：${label}`);
  button.click();
};

await waitFor('.im__textarea');
await sleep(200);

// 贴一首 8 小节的简谱（都用 1=C 的白键音，保证不需要吸附）
setInput(document.querySelector('.im__textarea'), '1=C 4/4\n1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 - |');
const inputs = [...document.querySelectorAll('.im__input')];
setInput(inputs[0], '自测包');
setInput(inputs[1], '自测小曲');
await sleep(120);

clickByText('检查');
// 等**结论**（通过或错误都算结论）—— 只等通过会掩盖「校验没过」这种情况
const waitReport = async (timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const report = document.querySelector('.im__report');
    if (report && (report.querySelector('.im__ok') || report.querySelector('.im__error'))) return report;
    await sleep(80);
  }
  throw new Error('点了检查也没有出现结论；页面文本：' + document.body.innerText.slice(0, 240));
};

const firstReport = await waitReport();
const checkText =
  text('.im__ok') || `❌ ${text('.im__error')} / 警告：${text('.im__warn')}`;
const reportKind = firstReport.querySelector('.im__ok') ? '通过' : '被拒';

if (reportKind === '被拒') {
  return `检查被拒：${document.querySelector('.im__report')?.innerText ?? ''}`.slice(0, 300);
}

clickByText('保存到我的曲目');
await sleep(500);
const savedText = text('.im__ok');

const packListed = (text('.im__packs') || '').includes('自测包');

// 去曲库看它是否真的出现了
location.hash = '#/songs';
await waitFor('.song-card', 8000);
await sleep(300);
const cards = [...document.querySelectorAll('.song-card')].map((el) =>
  (el.textContent ?? '').trim().slice(0, 20),
);
const filterLabels = [...document.querySelectorAll('.songs__filter')].map((el) =>
  (el.textContent ?? '').trim(),
);
const stored = localStorage.getItem('piano_app_packs_v1') ?? '';

return (
  `检查：${checkText} | 保存：${savedText} | 包已列出=${packListed} | ` +
  `曲库卡片数=${cards.length} 含「自测小曲」=${cards.some((item) => item.includes('自测小曲'))} | ` +
  `有「我的曲目」筛选=${filterLabels.some((item) => item.includes('我的曲目'))} | ` +
  `localStorage 有包=${stored.includes('自测包')}`
);
