/**
 * 页面体检：在 iPad 的真实视口下量「有没有被挤坏」。
 *
 * 只回答四个会真正伤到孩子的问题：
 *   1. 有没有横向溢出（页面被撑宽 → 出现横向滚动，琴键会被推出屏幕）
 *   2. 键盘还在不在、还剩多高（「琴键变得很矮」是这个项目吃过三次亏的故障）
 *   3. 黑键还在不在（8 键含 5 个黑键，中央C 靠它定位）
 *   4. 可点的按钮有没有被挤出视口（按钮被裁掉 = 点不到）
 *
 * 用法：npm run shot -- "#/free" --script scripts/flows/layout-health.js
 *      npm run shot -- "#/free" --script scripts/flows/layout-health.js --width 1080 --height 810
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitForAny = async (selectors, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      if (document.querySelector(selector)) return selector;
    }
    await sleep(80);
  }
  return null;
};

const mounted = await waitForAny(['.app', '.page', '.chl', '.free', '.pk']);
await sleep(350); // 让懒加载的模块与首帧布局稳定

// 如果页面上有主操作按钮（开始 / 开始跟弹），点进「孩子真正在用的那个状态」再量 ——
// 历史上「琴键变矮」「键盘被挤到一边」都只出现在点开始之后。
const startButton = document.querySelector('.ui-btn--primary');
if (startButton && /开始/.test(startButton.textContent ?? '')) {
  startButton.click();
  await sleep(1100);
}

const viewport = { w: innerWidth, h: innerHeight };
const doc = document.documentElement;

/** 元素的矩形（整数） */
const rectOf = (el) => {
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

// 1) 横向溢出
const horizontalOverflow = Math.max(doc.scrollWidth, document.body.scrollWidth) - viewport.w;

// 2) 键盘
const keyboard = document.querySelector('.pk');
const whiteKeys = keyboard ? [...keyboard.querySelectorAll('.pk-key--white')] : [];
const blackKeys = keyboard ? [...keyboard.querySelectorAll('.pk-key--black')] : [];

/** 在可滚动的祖先里 = 滚出去是正常的，不算被裁 */
const inScrollableAncestor = (el) => {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) || /(auto|scroll)/.test(style.overflowX)) return true;
    node = node.parentElement;
  }
  return false;
};

// 3) 按钮是否被裁掉（只算真正可见、且不在滚动容器里的按钮）
const clippedButtons = [...document.querySelectorAll('button')]
  .filter((button) => {
    const r = button.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  })
  .filter((button) => !inScrollableAncestor(button))
  .filter((button) => {
    const r = button.getBoundingClientRect();
    return r.left < -1 || r.top < -1 || r.right > viewport.w + 1 || r.bottom > viewport.h + 1;
  })
  .map((button) => (button.textContent ?? '').trim().slice(0, 12));

// 4) 关键操作按钮（有的话）：它必须在视口内
const primary = document.querySelector('.ui-btn--primary');
const primaryText = primary ? (primary.textContent ?? '').trim().slice(0, 12) : '';
const primaryInside = primary
  ? (() => {
      const r = primary.getBoundingClientRect();
      return r.left >= -1 && r.top >= -1 && r.right <= viewport.w + 1 && r.bottom <= viewport.h + 1;
    })()
  : null;

// 返回**一行**摘要（明细仍在 .shots/shot.json 里），这样一次扫十几个路由也不会刷屏
const whiteKeyWidth = whiteKeys[0] ? rectOf(whiteKeys[0]).w : null;
const whiteKeyHeight = whiteKeys[0] ? rectOf(whiteKeys[0]).h : null;
const keyboardRect = keyboard ? rectOf(keyboard) : null;
const frame = document.querySelector('.pk-frame');

// 「真实尺寸 + 可拖动」模式下键盘会比屏幕宽，所以这里改报**溢出宽度**与
// **中央C 离视窗中心有多远**（0 = 正好居中，这是产品要的效果）
const overflowX = frame ? Math.max(0, frame.scrollWidth - frame.clientWidth) : 0;
const middleC = keyboard?.querySelector('[data-note="C4"]');
const middleCOffset = middleC
  ? Math.round(
      middleC.getBoundingClientRect().x +
        middleC.getBoundingClientRect().width / 2 -
        viewport.w / 2,
    )
  : null;

/** 键的材质读数：缝隙（边框）、前脸（下边框）、接触阴影 —— 用来核对「看起来太细太窄」这类改动 */
const materialOf = (el) => {
  if (!el) return '无';
  const style = getComputedStyle(el);
  return `缝${style.borderRightWidth} 前脸${style.borderBottomWidth} 圆角${style.borderBottomLeftRadius} 阴影${style.boxShadow.slice(0, 34)}`;
};
const materialText = keyboard
  ? `白键[${materialOf(whiteKeys[0])}] 黑键[${materialOf(blackKeys[0])}]`
  : '无键盘';

const keyboardText = keyboard
  ? `键盘x${keyboardRect.x} ${keyboardRect.w}x${keyboardRect.h} 可拖动${overflowX} 中央C偏移${middleCOffset} 白${whiteKeys.length}(宽${whiteKeyWidth} 高${whiteKeyHeight}) 黑${blackKeys.length}`
  : '无键盘';

/** 键盘宽出屏幕时，祖先链上必须有人能「收缩」与「滚动」——否则撑宽的是整个页面 */
const ancestorChain = frame
  ? (() => {
      const rows = [];
      let node = frame;
      for (let i = 0; i < 4 && node; i += 1) {
        const style = getComputedStyle(node);
        rows.push(
          `${node.tagName.toLowerCase()}.${String(node.className).split(' ')[0]}` +
            `(cw${node.clientWidth} sw${node.scrollWidth} ovx:${style.overflowX} minw:${style.minWidth})`,
        );
        node = node.parentElement;
      }
      return rows.join(' > ');
    })()
  : '无';

return (
  `${(location.hash || '#/').padEnd(22)} ` +
  `视口${viewport.w}x${viewport.h} 溢出${horizontalOverflow} ${keyboardText} ` +
  `按钮越界${clippedButtons.length ? clippedButtons.join('|') : '0'} ` +
  `主按钮${primaryInside === null ? '无' : primaryInside ? `「${primaryText}」在视口内` : `「${primaryText}」被裁!`}\n` +
  `    材质：${materialText}\n` +
  `    祖先：${ancestorChain}`
);

