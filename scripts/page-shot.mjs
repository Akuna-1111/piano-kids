/**
 * 真机尺寸截图 + 几何读数（开发工具，不参与产物）。
 *
 * ## 为什么需要它
 *
 * 这个项目已经踩过好几次「jsdom 测不出来、只有在真机上才是坏的」的坑：
 * 琴键高度、长按被系统抢走、以及「谱面上的拼音被遮挡」。
 * jsdom 没有布局引擎，`getBoundingClientRect()` 恒为 0，
 * 所以这些事既写不了渲染测试，也不该靠「读 CSS 猜」。
 *
 * 这个脚本用 Chrome 的 DevTools Protocol 在**真实布局引擎**里跑，
 * 输出两样东西：
 *   1. 一张按 iPad 视口（默认 810×1080、dpr 2）渲染的截图
 *   2. 关键元素的真实几何（rect / 字体实际像素 / SVG viewBox / 命中测试）
 *
 * 命中测试（`elementFromPoint`）尤其有用：它能直接回答
 * 「这个元素到底被谁挡住了」，而不是靠肉眼比对。
 *
 * ## 用法
 *
 * ```bash
 * npm run dev                     # 先起开发服务器
 * npm run shot -- "#/challenges/staff" --click 开始
 * npm run shot -- "#/practice/twinkle-star" --click 开始跟弹 --out practice.png
 * ```
 *
 * 产物写在 `.shots/`（已 gitignore），不污染仓库。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : '',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const PORT = Number(process.env.SHOT_PORT ?? 9333);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const options = {
    hash: '#/',
    click: /** @type {string | null} */ (null),
    out: /** @type {string | null} */ (null),
    // iPad 第 7 代竖屏；`keySize.ts` 的 DEVICE_PPI 表认得 "810x1080"
    width: 810,
    height: 1080,
    dpr: 2,
    wait: 900,
    probe: /** @type {string | null} */ (null),
    script: /** @type {string | null} */ (null),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      options.hash = arg;
      continue;
    }
    const value = argv[i + 1];
    if (arg === '--click') options.click = value;
    else if (arg === '--out') options.out = value;
    else if (arg === '--width') options.width = Number(value);
    else if (arg === '--height') options.height = Number(value);
    else if (arg === '--dpr') options.dpr = Number(value);
    else if (arg === '--wait') options.wait = Number(value);
    else if (arg === '--probe') options.probe = value;
    else if (arg === '--script') options.script = value;
    else continue;
    i += 1;
  }
  return options;
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error('找不到 Chrome / Edge，请用 SHOT_CHROME 指定可执行文件');
  return process.env.SHOT_CHROME ?? found;
}

async function waitForPageSocket(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(150);
  }
  throw new Error('Chrome 的调试端口没有就绪');
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((res, rej) => {
      socket.onopen = res;
      socket.onerror = () => rej(new Error('CDP WebSocket 连接失败'));
    });
    const cdp = new Cdp(socket);
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const entry = cdp.pending.get(msg.id);
      if (!entry) return;
      cdp.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
    };
    return cdp;
  }

  send(method, params = {}) {
    const id = (this.seq += 1);
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`页面内脚本抛错：${description}`);
    }
    return result.result.value;
  }
}

/**
 * 页面内探针：读关键元素的真实几何 + 命中测试。
 * 命中测试是重点 —— 它直接回答「被谁挡住了」。
 */
const PROBE = `(() => {
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x * 10) / 10,
      y: Math.round(r.y * 10) / 10,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      bottom: Math.round(r.bottom * 10) / 10,
    };
  };
  const px = (el, prop) => (el ? getComputedStyle(el).getPropertyValue(prop) : null);

  const svg = document.querySelector('.staff');
  const solfege = document.querySelector('.staff__label-solfege');
  const pinyin = document.querySelector('.staff__label-pinyin');

  // SVG 文字：getBoundingClientRect 给的是渲染后的实际盒子（含缩放）
  const svgBox = (el) => {
    if (!el || typeof el.getBBox !== 'function') return null;
    const b = el.getBBox();
    return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
  };

  // 拼音中心点上，最上层是谁？
  let topAtPinyin = null;
  let pinyinHit = null;
  let overlapping = [];
  if (pinyin) {
    const r = pinyin.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    topAtPinyin = el ? (el.getAttribute('class') ?? el.tagName) : null;
    pinyinHit = { cx: Math.round(cx), cy: Math.round(cy) };

    // 谁和拼音的实际矩形相交？（自己与祖先不算）
    const ancestors = new Set();
    for (let node = pinyin; node; node = node.parentElement) ancestors.add(node);
    overlapping = [...document.querySelectorAll('*')]
      .filter((node) => !ancestors.has(node) && node.getClientRects().length > 0)
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0 &&
        box.left < r.right && box.right > r.left && box.top < r.bottom && box.bottom > r.top)
      .map(({ node, box }) => ({
        cls: node.getAttribute('class') ?? node.tagName,
        y: Math.round(box.y), bottom: Math.round(box.bottom),
      }));
  }

  return JSON.stringify({
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    bodyScroll: { h: document.body.scrollHeight, w: document.body.scrollWidth },
    svg: rect(svg),
    svgViewBox: svg ? svg.getAttribute('viewBox') : null,
    svgOverflow: px(svg, 'overflow'),
    solfegeText: rect(solfege),
    solfegeBBox: svgBox(solfege),
    solfegeFontPx: px(solfege, 'font-size'),
    solfegeFill: px(solfege, 'fill'),
    pinyinText: rect(pinyin),
    pinyinBBox: svgBox(pinyin),
    pinyinFontPx: px(pinyin, 'font-size'),
    pinyinFill: px(pinyin, 'fill'),
    pinyinHit,
    topAtPinyin,
    overlapping,
    keyboard: rect(document.querySelector('.chl__keyboard') ?? document.querySelector('.pp__keyboard')),
    keys: rect(document.querySelector('.pk')),
    hint: rect(document.querySelector('.chl__target-hint')),
  }, null, 2);
})()`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = `http://127.0.0.1:5173/${options.hash}`;
  const outDir = resolve(process.cwd(), '.shots');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, options.out ?? 'shot.png');

  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'piano-shot-'))}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      // 页面里的 `el.click()` **不算用户手势**，AudioContext 会一直停在 suspended、
      // ensureReady() 永不 resolve —— 于是「开始跟弹」点不动。
      // 真机上那次点击是真手势，所以这只是探针的限制，不是应用的问题。
      '--autoplay-policy=no-user-gesture-required',
      '--force-device-scale-factor=1',
      `--window-size=${options.width},${options.height}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let cdp;
  try {
    cdp = await Cdp.connect(await waitForPageSocket());
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: options.dpr,
      mobile: true,
    });

    await cdp.send('Page.navigate', { url });

    // 等应用挂载。**失败只警告、不中断** ——
    // 挂不上的时候恰恰最需要把 --script / --probe 跑起来看现场。
    const mounted = await cdp.evaluate(`
      new Promise((resolve) => {
        const deadline = Date.now() + 12000;
        const tick = () => {
          if (document.querySelector('.app') || document.querySelector('.chl') || document.querySelector('.pp')) {
            resolve(true);
          } else if (Date.now() > deadline) resolve('timeout');
          else setTimeout(tick, 100);
        };
        tick();
      })
    `);
    if (mounted !== true) {
      console.warn(`⚠️ 应用没有挂载（${mounted}），继续执行以便输出现场信息`);
    }

    if (options.click) {
      // 路由是 React.lazy 的：`.app` 外壳已经在，目标按钮可能还没挂上 ——
      // 所以要等的是**按钮本身**，不是应用外壳。
      const clicked = await cdp.evaluate(`
        new Promise((resolve) => {
          const target = ${JSON.stringify(options.click)};
          const deadline = Date.now() + 15000;
          const tick = () => {
            const el = [...document.querySelectorAll('button, a')]
              .find((node) => (node.textContent ?? '').trim().includes(target));
            if (el) {
              el.click();
              resolve(true);
              return;
            }
            if (Date.now() > deadline) {
              resolve('未出现「' + target + '」，当前可见的是：' +
                [...document.querySelectorAll('button, a')].map((n) => (n.textContent ?? '').trim()).join(' | '));
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        })
      `);
      if (clicked !== true) throw new Error(`点不到「${options.click}」：${clicked}`);
    }

    await sleep(options.wait);

    // 需要在页面里做一连串操作（点按钮、模拟按键、等元素）时用 --script 传一个 JS 文件，
    // 比把长表达式塞进命令行可靠得多。脚本里 return / resolve 的值会被当作几何输出。
    let probe;
    if (options.script) {
      const source = readFileSync(resolve(process.cwd(), options.script), 'utf8');
      probe = await cdp.evaluate(`Promise.resolve((async () => { ${source} })())`);
    } else if (options.probe) {
      probe = await cdp.evaluate(options.probe);
    } else {
      probe = await cdp.evaluate(PROBE);
    }

    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
    // 同时落一份**纯 JSON**，方便用脚本比对（直接重定向 stdout 会被 PowerShell 改编码）
    writeFileSync(outFile.replace(/\.png$/, '.json'), probe);

    console.log(`URL      ${url}`);
    console.log(`截图     ${outFile}`);
    console.log(`几何     ${outFile.replace(/\.png$/, '.json')}`);
    console.log(probe);
  } finally {
    try {
      cdp?.socket.close();
    } catch {
      /* 忽略 */
    }
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
