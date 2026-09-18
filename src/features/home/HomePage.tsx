import { Link, useNavigate } from 'react-router-dom';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { PianoKeyboard } from '@/features/piano/PianoKeyboard';
import { usePianoAudio } from '@/features/piano/usePianoAudio';
import { Icon } from '@/shared/ui/Icon';
import './home.css';

/**
 * 首页（文档 4.1 / 2.1）—— **首页就是自由弹**。
 *
 * ```text
 * 顶栏：[跟我弹]      小钢琴      [小挑战]        [装扮][★][设置]
 * 正文：整块键盘（拿走剩余空间），打开就能按
 * ```
 *
 * - **没有「今天想怎么玩？」这一段**：首页不是目录，孩子打开就该在琴前面
 * - **跟我弹 / 小挑战 收成顶栏的图标按钮**，分列品牌名两侧（1fr auto 1fr 栅格，真居中）
 * - 自由弹**不再是一个入口**：它就是首页本身（`/free` 仍然可用，只是不再从这里进入）
 *
 * ## 这条形态顺带把一条偏离修回来了
 *
 * 上一版把首页琴键去掉之后，就不再满足设计规范 Appendix D 第 1–2 项
 * （「第一眼能看见钢琴吗 / 第一触摸能听见声音吗」）与验收清单的
 * 「打开首页就能立刻弹响第一个键」。现在首页又是键盘本身，**两条都重新满足**。
 * 「键盘在首页变丑」的问题也一并解决：它现在拿到整块剩余空间，而不是一条 230px 的窄带。
 */

export function HomePage() {
  const navigate = useNavigate();
  const { progress, settings } = useProgressStore();
  const { handleNoteOn, handleNoteOff } = usePianoAudio();

  return (
    <div className="home">
      <header className="home__bar">
        {/* 两个入口在左（只有文字，没有图标），品牌名居中，HUD 在右 */}
        <nav className="home__nav" aria-label="主要入口">
          <Link to="/songs" className="home__nav-btn">
            跟我弹
          </Link>
          <Link to="/challenges" className="home__nav-btn">
            小挑战
          </Link>
        </nav>

        <h1 className="home__brand-name">小钢琴</h1>

        <div className="home__hud">
          <Link to="/wardrobe" className="hud-btn hud-btn--icon" aria-label="我的装扮">
            <Icon name="hanger" size={20} />
          </Link>
          <span className="hud-btn hud-stars" aria-label={`当前星星 ${progress.starsTotal} 颗`}>
            <Icon name="star-filled" size={20} />
            <span>{progress.starsTotal}</span>
          </span>
          <button
            type="button"
            className="hud-btn hud-btn--icon"
            onClick={() => navigate('/settings')}
            aria-label="设置"
          >
            <Icon name="sliders" size={20} />
          </button>
        </div>
      </header>

      {/* 首页就是自由弹：键盘拿走剩下所有空间（AGENTS §9）。
         立体感做在**琴键本身**（顶面/前脸/接触阴影），不再套一层座面。 */}
      <main className="home__stage">
        <PianoKeyboard
          size={settings.keyboardSize}
          showNoteNames={settings.showNoteNames}
          onNoteOn={handleNoteOn}
          onNoteOff={handleNoteOff}
        />
      </main>
    </div>
  );
}
