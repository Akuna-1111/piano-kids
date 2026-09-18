/**
 * 完成页上到底有什么（用来核对「精简」是否到位，以及有没有多余元素）。
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --script scripts/flows/dump-result-card.js
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

const clickText = (text) => {
  const el = [...document.querySelectorAll('button, a')].find((node) =>
    (node.textContent ?? '').includes(text),
  );
  if (!el) throw new Error(`找不到「${text}」`);
  el.click();
};

const pressKey = (note) => {
  const container = document.querySelector('.pk');
  const key = document.querySelector(`[data-note="${note}"]`);
  const box = key.getBoundingClientRect();
  const options = {
    pointerId: 1,
    pointerType: 'touch',
    clientX: box.x + box.width / 2,
    clientY: box.y + box.height * 0.8,
    bubbles: true,
    cancelable: true,
  };
  container.dispatchEvent(new PointerEvent('pointerdown', options));
  container.dispatchEvent(new PointerEvent('pointerup', options));
};

const MARY_LAMB = [
  'E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4',
  'D4', 'D4', 'D4',
  'E4', 'G4', 'G4',
  'E4', 'D4', 'C4', 'D4', 'E4', 'E4', 'E4',
  'E4', 'D4', 'D4', 'E4', 'D4', 'C4',
];

clickText('开始跟弹');
await waitFor('.pp__note-card');
for (const note of MARY_LAMB) {
  pressKey(note);
  await sleep(30);
}
await waitFor('.pp-result');
await sleep(1200); // 等星星逐颗点亮的动画走完

const card = document.querySelector('.pp-result__card');
const children = [...card.children].map((node) => ({
  cls: node.getAttribute('class') ?? node.tagName,
  text: (node.textContent ?? '').trim().slice(0, 60),
}));

return JSON.stringify(
  {
    cardText: (card.innerText ?? '').split('\n').filter((line) => line.trim()),
    children,
    childCount: card.children.length,
  },
  null,
  2,
);
