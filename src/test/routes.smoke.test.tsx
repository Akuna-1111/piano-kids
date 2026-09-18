import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { clearAllStorage } from '@/core/progress/storage';

/**
 * 路由冒烟：**每一个路由都必须能渲染出来**。
 *
 * 这条测试的由来是一个真实故障：iPad 上打开 `#/tuning` 是白屏。
 * 原因是 React 渲染期间抛错会卸载整棵树 —— 表现就是一片空白，
 * 而在此之前没有任何测试覆盖 `/tuning` 的渲染。
 *
 * 现在把所有路由都跑一遍，任何一个渲染崩溃都会在这里失败。
 */

const ROUTES = [
  { hash: '#/', expect: '小钢琴', name: '首页' },
  { hash: '#/songs', expect: '选一首歌', name: '曲目列表' },
  { hash: '#/challenges', expect: '看谱找键', name: '小挑战入口' },
  { hash: '#/challenges/ear', expect: '小挑战 · 听音找键', name: '听音找键' },
  { hash: '#/challenges/staff', expect: '小挑战 · 看谱找键', name: '看谱找键（五线谱）' },
  { hash: '#/challenges/beat', expect: '小挑战 · 节拍挑战', name: '节拍挑战' },
  { hash: '#/import', expect: '曲谱导入（家长）', name: '曲谱导入（家长页）' },
  { hash: '#/wardrobe', expect: '我的装扮', name: '我的装扮' },
  { hash: '#/settings', expect: '设置', name: '设置' },
  { hash: '#/tuning', expect: '真机自检', name: '真机自检' },
  { hash: '#/practice/twinkle-star', expect: '小星星', name: '练习页' },
  // 无效曲目应安全跳到曲目列表，而不是白屏
  { hash: '#/practice/does-not-exist', expect: '选一首歌', name: '不存在的曲目 → 曲目列表' },
  { hash: '#/not-a-route', expect: '小钢琴', name: '未知路由 → 首页' },
] as const;

describe('路由冒烟：每个路由都能渲染，不出现白屏', () => {
  beforeEach(() => {
    clearAllStorage();
    window.location.hash = '';
    // jsdom 没有布局引擎，getBoundingClientRect 恒为 0；给一个非零宽度让尺寸计算走通
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1048,
      height: 300,
      top: 0,
      left: 0,
      right: 1048,
      bottom: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });

  it.each(ROUTES)('$name（$hash）能正常渲染', async ({ hash, expect: text }) => {
    window.location.hash = hash;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
    window.addEventListener('error', onError);

    render(<App />);

    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());

    // 渲染期间不允许有任何未捕获错误
    expect(errors).toEqual([]);
    consoleError.mockRestore();
    window.removeEventListener('error', onError);
  });

  it('渲染过程中不允许出现 React 报错（白屏的先行指标）', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.location.hash = '#/tuning';
    render(<App />);
    await waitFor(() => expect(screen.getByText('真机自检')).toBeInTheDocument());
    // React 在渲染抛错 / key 缺失 / 非法 DOM 嵌套时都会走 console.error
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
