import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * 浏览器兼容目标。
 *
 * ⚠️ 这里必须同时设 `build.target` **和** `esbuild.target`。
 *
 * 只设 `build.target` 时，**开发服务器不做任何语法降级** —— Vite dev 用 esbuild
 * 以 `esnext` 转换 TS/JSX，类字段、可选链等原样输出。老设备（例如 iPadOS 15 上的
 * Safari）遇到不支持的语法会直接 SyntaxError，模块加载失败，
 * 页面表现就是**一片空白**，而且没有任何提示。
 *
 * es2019 = Safari 13 起支持，覆盖 iPadOS 14/15/16/17；同时 esbuild 会把
 * class fields 降级成构造函数赋值（class fields 要 Safari 14.1+）。
 */
const BROWSER_TARGET = 'es2019';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: {
    // 开发环境同样降级，保证「dev 能跑 = 真机也能跑」
    target: BROWSER_TARGET,
  },
  build: {
    target: BROWSER_TARGET,
    // 曲谱/皮肤是静态数据，打进主包即可；挑战类模块后续再拆分按需加载。
    chunkSizeWarningLimit: 700,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
