/**
 * 练习页「待机 / 顶栏」几何探针。
 *
 * 要回答的问题：`开始跟弹`（舞台待机块）与 `听一遍`（顶栏 actions）**有没有错位**：
 *   1. 顶栏里的三块（退出 / 标题 / actions）是否互相重叠、是否溢出栏外
 *   2. `听一遍` 与速度档位是否被挤到换行、或挤成一列
 *   3. 舞台待机块（`准备好了吗？` + `开始跟弹`）与谱面/键盘是否重叠、是否被推出视口
 *   4. 有没有元素超出视口（点不到）
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --script scripts/flows/practice-idle.js
 *      npm run shot -- "#/practice/mary-lamb" --script scripts/flows/practice-idle.js --width 1080 --height 810
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (selector, timeout = 12000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (document.querySelector(selector)) return true;
    await sleep(80);
  }
  return false;
};

await waitFor('.pp__top');
await sleep(500);

const rect = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
  };
};

const label = (el) => {
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className : '';
  const text = (el.textContent ?? '').trim().slice(0, 12);
  return `${el.tagName.toLowerCase()}.${cls.split(' ').filter(Boolean).join('.')}「${text}」`;
};

/** 两个矩形是否相交（含 1px 容差）。 */
const overlaps = (a, b) => Boolean(a && b) && a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;

const top = document.querySelector('.pp__top');
const back = document.querySelector('.pp__back');
const title = document.querySelector('.pp__title');
const actions = document.querySelector('.pp__top-actions');
const listen = document.querySelector('.pp__listen');
const tempo = document.querySelector('.pp__tempo');
const tempoButtons = [...document.querySelectorAll('.pp__tempo-btn')];

const topRect = rect(top);
const parts = { 退出: rect(back), 标题: rect(title), actions: rect(actions) };

// 顶栏内部：是不是有人跑出栏外 / 互相压住
const outOfBar = Object.entries(parts)
  .filter(([, r]) => r && (r.bottom > topRect.bottom + 1 || r.right > topRect.right + 1))
  .map(([name]) => name);

const collisions = [];
for (const [aName, aRect] of Object.entries(parts)) {
  for (const [bName, bRect] of Object.entries(parts)) {
    if (aName >= bName) continue;
    if (overlaps(aRect, bRect)) collisions.push(`${aName}×${bName}`);
  }
}

// actions 内部：听一遍 与 速度档位 的关系
const listenRect = rect(listen);
const tempoRect = rect(tempo);
const tempoRows = new Set(tempoButtons.map((b) => Math.round(b.getBoundingClientRect().y)));
const actionsWrap = Boolean(listenRect && tempoRect) && Math.abs(listenRect.y - tempoRect.y) > 4;

// 舞台待机块
const idleMain = document.querySelector('.pp__idle-main');
const idleSub = document.querySelector('.pp__idle-sub');
const startBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('开始跟弹'));
const stage = document.querySelector('.pp__stage');
const prompt = document.querySelector('.pp__prompt');
const keyboard = document.querySelector('.pk');
const frame = document.querySelector('.pk-frame');

const idleRect = rect(startBtn);
const hintRect = rect(idleMain);

// 待机块 vs 键盘 / 谱面 是否压在一起
const staff = document.querySelector('.pp__staff');
const stageParts = {
  待机提示: hintRect,
  开始跟弹: idleRect,
  谱面: rect(staff),
  键盘: rect(keyboard),
};
const stageCollisions = [];
for (const [aName, aRect] of Object.entries(stageParts)) {
  for (const [bName, bRect] of Object.entries(stageParts)) {
    if (aName >= bName) continue;
    if (overlaps(aRect, bRect)) stageCollisions.push(`${aName}×${bName}`);
  }
}

// 有没有按钮被挤出视口
const offscreen = [...document.querySelectorAll('button')]
  .map((b) => ({ el: b, r: b.getBoundingClientRect() }))
  .filter(({ r }) => r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1))
  .map(({ el }) => label(el));

return JSON.stringify(
  {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    top: {
      bar: topRect,
      children: parts,
      outOfBar,
      collisions,
      actions: {
        wrap: actionsWrap,
        listen: listenRect,
        tempo: tempoRect,
        tempoRows: tempoRows.size,
        tempoButtonCount: tempoButtons.length,
      },
    },
    stage: {
      stage: rect(stage),
      prompt: rect(prompt),
      children: stageParts,
      collisions: stageCollisions,
      keyboardFrame: frame ? { w: Math.round(frame.clientWidth), scroll: frame.scrollWidth } : null,
    },
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    overflowY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    offscreenButtons: offscreen,
  },
  null,
  2,
);
