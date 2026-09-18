/**
 * 在**真实应用**里模拟「手指滑动琴键」，数清到底发生了什么。
 *
 * 为什么必须这样做：离线探针（`glissando.js`）是自己排的事件表，
 * 每次只触发一个音 —— 它**看不见**真实滑动时的事件流：
 *   · 一次滑动会产生多少个 noteOn / noteOff
 *   · 窄键（15 / 25 键只有 30–45px 宽）上手指容易同时压住相邻两个键，
 *     `elementFromPoint` 会不会在两者之间来回抖 → 半音高速交替（听起来就是「嘈杂」的嗡嗡声）
 *   · 同一个音会不会在几十毫秒内被反复重触发
 *
 * 做法：包一层 `audioEngine.noteOn/noteOff` 记账，然后用 PointerEvent 打一段真实滑动。
 *
 * 用法：npm run shot -- "#/free" --script scripts/flows/slide-events.js
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

/**
 * 用练习页底部的「键盘档位」按钮切换（**不能刷新页面** —— 刷新会杀掉本脚本自己的执行上下文）
 */
async function setKeyboardSize(size) {
  const button = [...document.querySelectorAll('.pp__sizes button')].find((b) =>
    (b.textContent ?? '').trim().startsWith(String(size)),
  );
  if (!button) throw new Error(`找不到 ${size} 键档位按钮`);
  button.click();
  await sleep(400);
  const current = document.querySelector('.pk')?.dataset.keyboardSize;
  if (current !== String(size)) throw new Error(`切换失败：当前是 ${current}`);
}

const { audioEngine } = await import('/src/core/audio/AudioEngine.ts');

await waitFor('.pk');

/** 记账：把引擎的 noteOn / noteOff 包一层 */
const events = [];
let capturing = false;
const originalOn = audioEngine.noteOn.bind(audioEngine);
const originalOff = audioEngine.noteOff.bind(audioEngine);
audioEngine.noteOn = (note, velocity) => {
  if (capturing) events.push({ t: performance.now(), kind: 'on', note });
  return originalOn(note, velocity);
};
audioEngine.noteOff = (note) => {
  if (capturing) events.push({ t: performance.now(), kind: 'off', note });
  return originalOff(note);
};

function keyGeometry() {
  const container = document.querySelector('.pk');
  const keys = [...container.querySelectorAll('.pk-key[data-note]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { note: el.dataset.note, x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const box = container.getBoundingClientRect();
  return { container, box, keys };
}

/** 打一段滑动：从键盘左侧滑到右侧（或反向），stepPx 控制每次 move 移动多少像素 */
async function slide({ container, box, stepPx, moveIntervalMs, direction }) {
  const y = box.y + box.height * 0.75; // 落在白键上
  const x0 = direction > 0 ? box.x + 4 : box.right - 4;
  const x1 = direction > 0 ? box.right - 4 : box.x + 4;
  const pointerId = 7;

  const send = (type, x) =>
    container.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pressure: 0.5,
        buttons: 1,
      }),
    );

  capturing = true;
  send('pointerdown', x0);
  const steps = Math.max(1, Math.round(Math.abs(x1 - x0) / stepPx));
  for (let i = 1; i <= steps; i += 1) {
    send('pointermove', x0 + ((x1 - x0) * i) / steps);
    if (moveIntervalMs > 0) await sleep(moveIntervalMs);
  }
  send('pointerup', x1);
  await sleep(120);
  capturing = false;
}

function summarise(label, size) {
  const ons = events.filter((e) => e.kind === 'on');
  const offs = events.filter((e) => e.kind === 'off');
  const spanMs = ons.length > 1 ? ons[ons.length - 1].t - ons[0].t : 0;
  const gaps = ons.slice(1).map((e, i) => e.t - ons[i].t);
  const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  // 30ms 内重新触发同一个音 = 抖动 / 重触发
  const lastOn = new Map();
  let retrigger = 0;
  for (const e of ons) {
    const prev = lastOn.get(e.note);
    if (prev !== undefined && e.t - prev < 30) retrigger += 1;
    lastOn.set(e.note, e.t);
  }
  // A→B→A 交替（相邻两键来回抖）
  let alternations = 0;
  for (let i = 2; i < ons.length; i += 1) {
    if (ons[i].note === ons[i - 2].note && ons[i].note !== ons[i - 1].note) alternations += 1;
  }
  // 每个音被按住的时长（on → 对应的 off）
  const heldMs = [];
  const pending = new Map();
  for (const e of events) {
    if (e.kind === 'on') {
      if (!pending.has(e.note)) pending.set(e.note, []);
      pending.get(e.note).push(e.t);
    } else {
      const queue = pending.get(e.note);
      if (queue && queue.length) heldMs.push(e.t - queue.shift());
    }
  }
  const meanHeld = heldMs.length ? heldMs.reduce((a, b) => a + b, 0) / heldMs.length : 0;
  const distinct = new Set(ons.map((e) => e.note)).size;

  return (
    `${label.padEnd(16)} 键${String(size).padStart(2)} | noteOn ${String(ons.length).padStart(3)} ` +
    `noteOff ${String(offs.length).padStart(3)} 不同音 ${String(distinct).padStart(2)} | ` +
    `平均间隔 ${meanGap.toFixed(0).padStart(3)}ms 每秒 ${(1000 / Math.max(meanGap, 1)).toFixed(0).padStart(2)}个音 | ` +
    `按住均值 ${meanHeld.toFixed(0).padStart(3)}ms | 30ms内重触发 ${String(retrigger).padStart(3)} ` +
    `A-B-A交替 ${String(alternations).padStart(3)} | 全程 ${(spanMs / 1000).toFixed(2)}s`
  );
}

const lines = [];
for (const size of [8, 25]) {
  await setKeyboardSize(size);
  const { container, box, keys } = keyGeometry();
  const whiteWidth = keys.find((k) => !k.note.includes('#'))?.w ?? 0;
  lines.push(`—— ${size} 键：白键宽 ${whiteWidth.toFixed(1)}px，键盘宽 ${box.width.toFixed(0)}px ——`);

  for (const [label, cfg] of [
    ['慢滑 2px/8ms', { stepPx: 2, moveIntervalMs: 8, direction: 1 }],
    ['快滑 24px/16ms', { stepPx: 24, moveIntervalMs: 16, direction: 1 }],
    ['来回滑 6px/10ms', { stepPx: 6, moveIntervalMs: 10, direction: 1 }],
  ]) {
    events.length = 0;
    await slide({ container, box, ...cfg });
    lines.push(summarise(label, size));
    if (label === '来回滑 6px/10ms') {
      events.length = 0;
      await slide({ container, box, stepPx: 6, moveIntervalMs: 10, direction: -1 });
      lines.push(summarise('  ↳ 反向', size));
    }
  }
}

audioEngine.noteOn = originalOn;
audioEngine.noteOff = originalOff;

return lines.join('\n');
