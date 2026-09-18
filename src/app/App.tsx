import { useMemo } from 'react';
import { HashRouter } from 'react-router-dom';
import { ProgressProvider } from '@/core/progress/ProgressStore';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { getSkinTheme, themeToCssVars } from '@/features/skins/skinThemes';
import { useAudioUnlock } from '@/shared/hooks/useAudioUnlock';
import { AppRoutes } from './routes';
import './app.css';

/**
 * 应用外壳。
 *
 * 皮肤只在这里做一件事：把「皮肤层」的 CSS 变量写到根节点的内联样式上。
 * 基础 UI 的颜色永远来自 tokens.css，因此换皮肤不会像换了一个产品（文档 3.2）。
 */
function AppShell() {
  const { activeSkin, settings } = useProgressStore();

  // 第一次触摸 / 按键即解锁 AudioContext（不弹「点击开始」遮罩）
  useAudioUnlock();

  const themeVars = useMemo(
    () => themeToCssVars(getSkinTheme(activeSkin.themeId)),
    [activeSkin.themeId],
  ) as React.CSSProperties;

  return (
    <div
      className="app"
      data-skin={activeSkin.themeId}
      data-reduced-motion={settings.reducedMotion ? 'true' : undefined}
      style={themeVars}
    >
      <AppRoutes />
    </div>
  );
}

export function App() {
  return (
    <ProgressProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </ProgressProvider>
  );
}
