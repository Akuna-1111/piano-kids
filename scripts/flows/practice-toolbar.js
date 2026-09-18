/**
 * 练习页顶栏检查：新增的「音区」分段控件会不会把顶栏挤溢出、按钮是否可命中。
 *
 * 同时验证行为本身：**8 键下不该出现这个控件**（实测没有第二个可行音区），
 * 切到 15 键之后才应该出现。
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --script scripts/flows/practice-toolbar.js
 *      npm run shot -- "#/practice/mary-lamb" --script scripts/flows/practice-toolbar.js --width 1080 --height 810
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

await waitFor('.pp__top');

const text = (el) => (el?.textContent ?? '').trim();
const box = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    right: Math.round(r.right),
  };
};

/** 每个按钮：宽度、文字有没有被挤掉、中心点上命中的是不是它自己 */
const probeButtons = (group) =>
  [...group.querySelectorAll('button')].map((button) => {
    const r = button.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      label: text(button),
      w: Math.round(r.width),
      clipped: button.scrollWidth > button.clientWidth + 1,
      hit: button === at || button.contains(at),
    };
  });

const eightKeys = {
  octaveVisible: Boolean(document.querySelector('.pp__octave')),
};

const sizeButton = [...document.querySelectorAll('.pp__sizes button')].find((b) =>
  text(b).startsWith('15'),
);
if (!sizeButton) throw new Error('找不到 15 键档位按钮');
sizeButton.click();
await sleep(400);
await waitFor('.pp__octave');

const topBar = document.querySelector('.pp__top');
const actions = document.querySelector('.pp__top-actions');
const octave = document.querySelector('.pp__octave');
const tempo = document.querySelector('.pp__tempo');
const title = document.querySelector('.pp__title-name');

const topBox = box(topBar);
const actionsBox = box(actions);

return JSON.stringify(
  {
    viewport: { w: innerWidth, h: innerHeight },
    eightKeys,
    fifteenKeys: {
      octaveButtons: probeButtons(octave),
      tempoButtons: probeButtons(tempo),
      octave: box(octave),
      tempo: box(tempo),
      activeOctave: text(octave.querySelector('.is-active')),
    },
    topBar: { ...topBox, overflowsViewport: topBox.right > innerWidth + 1 },
    actions: {
      ...actionsBox,
      overflowsViewport: actionsBox.right > innerWidth + 1,
      children: [...actions.children].map((el) => ({ cls: el.className, ...box(el) })),
    },
    title: title
      ? { ...box(title), clipped: title.scrollWidth > title.clientWidth + 1 }
      : null,
  },
  null,
  2,
);
