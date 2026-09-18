/**
 * 设置页布局检查：分段控件（键盘档位 / 节奏判定 / 音色）会不会溢出或把文字挤掉。
 *
 * 用法：npm run shot -- "#/settings" --script scripts/flows/settings-layout.js
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

await waitFor('.settings__group');

const groups = [...document.querySelectorAll('.settings__segmented')].map((group) => {
  const box = group.getBoundingClientRect();
  const buttons = [...group.querySelectorAll('button')].map((button) => {
    const r = button.getBoundingClientRect();
    return {
      text: (button.textContent ?? '').trim(),
      w: Math.round(r.width),
      // 文字被挤掉的判据：内容的自然宽度超过可见宽度
      clipped: button.scrollWidth > button.clientWidth + 1,
      rows: r.height > 44 ? 2 : 1,
    };
  });
  const totalWidth = buttons.reduce((sum, b) => sum + b.w, 0);
  return {
    label: group.parentElement?.querySelector('.settings__label')?.textContent ?? '?',
    groupWidth: Math.round(box.width),
    buttonsWidth: totalWidth,
    overflows: totalWidth > Math.round(box.width) + 1,
    buttons,
  };
});

return JSON.stringify(
  {
    viewport: { w: innerWidth, h: innerHeight },
    segmented: groups,
    anyClippedText: groups.some((g) => g.buttons.some((b) => b.clipped)),
    anyOverflow: groups.some((g) => g.overflows),
  },
  null,
  2,
);
