/**
 * 黑键几何与命中检查。
 *
 * 加黑键的风险不在「画不出来」，而在两件事：
 *   1. 黑键所在的那一层会不会被白键层挡住 → 点下去命中不到（`elementFromPoint` 拿不到它）
 *   2. 黑键是否**叠**在白键上，而不是把白键挤窄 —— 白键宽度必须还是 97.3px（真实尺寸不变）
 *
 * 用法：npm run shot -- "#/free" --script scripts/flows/black-keys.js
 *      npm run shot -- "#/free" --script scripts/flows/black-keys.js --width 1080 --height 810
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100 && !document.querySelector('.pk'); i += 1) await sleep(100);

const container = document.querySelector('.pk');
if (!container) throw new Error('找不到 .pk 键盘');

const box = (el) => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
};

const whites = [...container.querySelectorAll('.pk-key--white')];
const blacks = [...container.querySelectorAll('.pk-key--black')];

const blackInfo = blacks.map((el) => {
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return {
    note: el.dataset.note,
    centerX: Math.round(r.x + r.width / 2),
    w: Math.round(r.width),
    h: Math.round(r.height),
    hit: el === at || el.contains(at),
  };
});

// 每个黑键的中心 should 落在两个白键的分界线上
const boundaries = whites
  .slice(0, -1)
  .map((el) => Math.round(el.getBoundingClientRect().right));
const maxOffset = blackInfo.length
  ? Math.max(...blackInfo.map((b) => Math.min(...boundaries.map((x) => Math.abs(x - b.centerX)))))
  : null;

return JSON.stringify(
  {
    size: container.dataset.keyboardSize,
    keyboard: box(container),
    whiteCount: whites.length,
    blackCount: blacks.length,
    whiteNotes: whites.map((el) => el.dataset.note),
    blackNotes: blackInfo.map((b) => b.note),
    whiteKeyWidth: box(whites[0]).w,
    blackKeyWidth: blackInfo[0]?.w ?? null,
    blackKeyHeight: blackInfo[0]?.h ?? null,
    whiteKeyHeight: box(whites[0]).h,
    blackAllHittable: blackInfo.every((b) => b.hit),
    blackCenteredOnBoundaryMaxOffsetPx: maxOffset,
    blackDetails: blackInfo,
  },
  null,
  1,
);
