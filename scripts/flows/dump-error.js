/**
 * 直接读页面上的白屏兜底信息（`index.html` 的 `__pianoShowError` 渲染出来的内容），
 * 用于诊断「应用没挂载」时到底是哪一行抛的错。
 *
 * 用法：npm run shot -- "#/practice/mary-lamb" --script scripts/flows/dump-error.js
 */

const text = document.body.innerText;
const pre = document.querySelector('pre');
const root = document.getElementById('root');

return JSON.stringify(
  {
    running: window.__pianoRunning === true,
    rootChildCount: root ? root.childNodes.length : null,
    bodyText: text.slice(0, 600),
    preText: pre ? (pre.textContent ?? '').slice(0, 1500) : null,
  },
  null,
  2,
);
