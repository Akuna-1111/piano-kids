import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import './styles/tokens.css';
import './styles/base.css';

declare global {
  interface Window {
    /** index.html 的兜底脚本用它判断应用是否已经正常挂载 */
    __pianoRunning?: boolean;
  }
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('找不到 #root 容器');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 标记已经挂载：index.html 的兜底提示从此不再介入
window.__pianoRunning = true;

// PWA：仅在正式构建中注册 Service Worker，开发环境不缓存以免调试困难
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 离线能力是增强项，注册失败不影响使用 */
    });
  });
}
