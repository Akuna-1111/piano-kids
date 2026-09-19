/**
 * 小挑战布局探针：谱面有没有被挡住 / 键盘还剩多少。
 *
 * 决定性的一招是 `elementFromPoint`：在谱面中心、谱面四角做命中测试，
 * 直接问浏览器「这个位置上最上面的是谁」—— 比读 CSS 猜靠谱得多。
 *
 * 用法：
 *   npm run shot -- "#/challenges/staff" --click 开始 --script scripts/flows/challenge-layout.js
 *   npm run shot -- "#/challenges/staff" --click 开始 --script scripts/flows/challenge-layout.js --width 375 --height 667
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

await waitFor('.chl__stage');
await sleep(600);

const rect = (el) => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.width),
    h: Math.round(r.height),
    bottom: Math.round(r.bottom),
  };
};

const name = (el) => {
  if (!el) return null;
  const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).join('.') : el.tagName.toLowerCase();
  return `${el.tagName.toLowerCase()}.${cls}`;
};

const staff = document.querySelector('.staff');
const staffRect = rect(staff);

/** 在谱面上取 5 个点做命中测试，看最上面的是不是谱面自己。 */
const hits = [];
if (staff && staffRect) {
  const points = [
    ['中心', staffRect.x + staffRect.w / 2, staffRect.y + staffRect.h / 2],
    ['左上', staffRect.x + 6, staffRect.y + 6],
    ['右上', staffRect.x + staffRect.w - 6, staffRect.y + 6],
    ['左下', staffRect.x + 6, staffRect.bottom - 6],
    ['右下', staffRect.x + staffRect.w - 6, staffRect.bottom - 6],
  ];
  for (const [where, x, y] of points) {
    const el = document.elementFromPoint(x, y);
    const inside = staff.contains(el);
    hits.push({
      位置: where,
      最上面: name(el),
      属于谱面: inside,
    });
  }
}

// 谱面在容器里有没有被裁掉：scrollHeight 与 clientHeight 的差
const staffBox = staff ? { client: staff.clientHeight, scroll: staff.scrollHeight } : null;
const svg = staff?.querySelector('svg');
let svgBox = null;
if (svg) {
  const b = svg.getBBox ? svg.getBBox() : null;
  svgBox = b ? { bbox: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`, viewBox: svg.getAttribute('viewBox') } : null;
}

const stage = document.querySelector('.chl__stage');
const parts = {};
for (const sel of ['.chl__prompt', '.chl__top', '.staff', '.pk-frame', '.pk', '.chl__hint', '.chl__target-hint']) {
  const el = document.querySelector(sel);
  if (el) parts[sel] = rect(el);
}

const overlaps = (a, b) => Boolean(a && b) && a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
const collisions = [];
const entries = Object.entries(parts);
for (let i = 0; i < entries.length; i += 1) {
  for (let j = i + 1; j < entries.length; j += 1) {
    if (overlaps(entries[i][1], entries[j][1])) collisions.push(`${entries[i][0]}×${entries[j][0]}`);
  }
}

const offscreen = [...document.querySelectorAll('button')]
  .map((b) => ({ b, r: b.getBoundingClientRect() }))
  .filter(({ r }) => r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1 || r.bottom > window.innerHeight + 1 || r.top < -1))
  .map(({ b }) => name(b));

const frame = document.querySelector('.pk-frame');
const firstKey = document.querySelector('.pk-key--white');
const keyRect = rect(firstKey);

return JSON.stringify(
  {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    route: location.hash,
    stage: rect(stage),
    parts,
    collisions,
    staff: staffRect
      ? {
          ...staffRect,
          容器高: staffBox,
          svg: svgBox,
          // 谱面顶部在舞台内是否还有空间；为负说明被推出去了
          舞台内余量: staffRect.y - (rect(stage)?.y ?? 0),
        }
      : null,
    命中测试: hits,
    keyboard: {
      height: rect(document.querySelector('.pk'))?.h ?? null,
      keyWidth: keyRect?.w ?? null,
      scrollable: frame ? frame.scrollWidth - frame.clientWidth : null,
    },
    overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    overflowY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    offscreenButtons: offscreen,
  },
  null,
  2,
);
