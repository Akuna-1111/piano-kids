import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from '@/features/home/HomePage';
import { SongListPage } from '@/features/songs/SongListPage';
import { PracticePage } from '@/features/practice/PracticePage';

/**
 * 路由表。
 *
 * 性能约束（文档十八 / 开发规则 13）：
 * `首页 / 曲目 / 练习 / 自由弹` 是主干，打进主包；
 * `装扮 / 小挑战 / 设置` 按需加载，绝不阻塞「打开就能弹」。
 */
const SkinWardrobePage = lazy(() =>
  import('@/features/skins/SkinWardrobePage').then((m) => ({ default: m.SkinWardrobePage })),
);
const ChallengesHomePage = lazy(() =>
  import('@/features/challenges/ChallengesHomePage').then((m) => ({
    default: m.ChallengesHomePage,
  })),
);
// 小挑战 · 听音找键
const EarTrainingPage = lazy(() =>
  import('@/features/challenges/ChallengesPage').then((m) => ({ default: m.ChallengesPage })),
);
// 小挑战 · 看谱找键（五线谱识谱）
const StaffReadingPage = lazy(() =>
  import('@/features/challenges/StaffReadingPage').then((m) => ({
    default: m.StaffReadingPage,
  })),
);
// 小挑战 · 节拍挑战（跟着拍子按琴键）
const BeatChallengePage = lazy(() =>
  import('@/features/challenges/BeatChallengePage').then((m) => ({
    default: m.BeatChallengePage,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
// 真机自检页：隐藏路由 #/tuning，不在任何儿童界面里露出入口
const TuningPage = lazy(() =>
  import('@/features/tuning/TuningPage').then((m) => ({ default: m.TuningPage })),
);

// 曲谱导入（家长页）：隐藏路由 #/import，不在任何儿童界面里露出入口
const JianpuImportPage = lazy(() =>
  import('@/features/import/JianpuImportPage').then((m) => ({
    default: m.JianpuImportPage,
  })),
);

function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      正在准备…
    </div>
  );
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/songs" element={<SongListPage />} />
        <Route path="/practice/:songId" element={<PracticePage />} />
        <Route path="/challenges" element={<ChallengesHomePage />} />
        <Route path="/challenges/ear" element={<EarTrainingPage />} />
        <Route path="/challenges/staff" element={<StaffReadingPage />} />
        <Route path="/challenges/beat" element={<BeatChallengePage />} />
        <Route path="/wardrobe" element={<SkinWardrobePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/tuning" element={<TuningPage />} />
        <Route path="/import" element={<JianpuImportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
