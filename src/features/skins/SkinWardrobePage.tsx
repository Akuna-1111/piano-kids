import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { PianoKeyboard } from '@/features/piano/PianoKeyboard';
import { usePianoAudio } from '@/features/piano/usePianoAudio';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import { SkinSample } from './SkinSample';
import {
  DEFAULT_SKIN_ID,
  SKINS,
  describeUnlockCondition,
  getOrderedSkins,
  getSkinById,
  type Skin,
} from '@/features/skins/skins';
import { describeSkinProgress } from '@/features/skins/skinResolver';
import { getSkinTheme } from '@/features/skins/skinThemes';
import './skins.css';

/**
 * 我的装扮（文档 10.1 / 10.8 / 10.9 + 设计规范 §12）。
 *
 * 结构与规范的对齐：
 *   §12.1 「横向展示的**琴键样品板**」，明确「不要采用普通电商商品卡片布局」
 *         → 顶部只留「当前星星成长值」，其下是一条样品板，每块样品就是一小段**真实琴键**
 *   §12.2 未解锁不要「灰度滤镜 + 锁图标」——保持材质可见，解锁信息只说一句话
 *   §10.9 预览窗是真正可弹的键盘，而不是静态色块
 *   §53  布局稳定：预览标题长短变化不能顶动琴键
 *   §54  禁止意外横向拖拽：样品板自动换行，不做横向滚动
 *
 * 刻意不使用「商店 / 购买 / 价格 / 稀有度」这类词 —— 这里是衣柜，不是商城。
 */
export function SkinWardrobePage() {
  const navigate = useNavigate();
  const { progress, previewSkinId, setPreviewSkinId, equipSkin } = useProgressStore();
  const { handleNoteOn, handleNoteOff } = usePianoAudio();
  const [wornNotice, setWornNotice] = useState<string | null>(null);

  // 离开装扮页立即恢复正式装备的皮肤（文档 10.8）
  useEffect(() => () => setPreviewSkinId(null), [setPreviewSkinId]);

  const skins = useMemo(() => getOrderedSkins(progress.unlockedSkinIds), [progress.unlockedSkinIds]);

  const previewSkin = previewSkinId ? getSkinById(previewSkinId) : null;
  const shownSkin =
    previewSkin ?? getSkinById(progress.equippedSkinId) ?? getSkinById(DEFAULT_SKIN_ID)!;
  const shownTheme = getSkinTheme(shownSkin.themeId);
  const shownUnlocked = progress.unlockedSkinIds.includes(shownSkin.id);
  const isEquipped = progress.equippedSkinId === shownSkin.id;

  /** §12.2：解锁信息只需要一句话。 */
  const oneLineUnlock = (skin: Skin): string => {
    const progressHint = describeSkinProgress(skin, progress);
    return progressHint ?? describeUnlockCondition(skin.unlock);
  };

  const handleEquip = () => {
    if (!shownUnlocked) return;
    equipSkin(shownSkin.id);
    setPreviewSkinId(null);
    setWornNotice(`已经换上「${shownSkin.name}琴键」`);
    window.setTimeout(() => setWornNotice(null), 2200);
  };

  return (
    <div className="page wardrobe">
      <header className="page__bar">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="page__title">我的装扮</h1>
      </header>

      <div className="page__body wardrobe__body">
        <p className="wardrobe__growth">
          <span className="wardrobe__growth-label">当前星星成长值</span>
          <span className="wardrobe__growth-value">
            <Icon name="star-filled" size={20} />
            {progress.starsTotal}
          </span>
        </p>

        <section aria-label="琴键样品">
          <ul className="wardrobe__board">
            {skins.map((skin) => {
              const unlocked = progress.unlockedSkinIds.includes(skin.id);
              const equipped = progress.equippedSkinId === skin.id;
              const active = shownSkin.id === skin.id;

              return (
                <li key={skin.id}>
                  <button
                    type="button"
                    className={cx(
                      'sample',
                      active && 'is-active',
                      !unlocked && 'is-locked',
                    )}
                    onClick={() => setPreviewSkinId(skin.id)}
                    aria-pressed={active}
                  >
                    <SkinSample theme={getSkinTheme(skin.themeId)} />
                    <span className="sample__foot">
                      <span className="sample__name">{skin.name}</span>
                      <span className="sample__state">
                        {equipped ? '正在用' : unlocked ? '可以试弹' : oneLineUnlock(skin)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="wardrobe__board-hint">点击任意样品即可试弹</p>
        </section>

        <section className="wardrobe__preview" aria-label="试弹">
          {/* §53：标题与说明长短不一，用固定最小高度保证下面的琴键不会上下移动 */}
          <div className="wardrobe__preview-head">
            <div className="wardrobe__preview-info">
              <p className="wardrobe__preview-title">
                {shownSkin.name}琴键
                <span className="wardrobe__material">{shownTheme.material}</span>
              </p>
              <p className="wardrobe__preview-desc">
                {shownUnlocked ? shownSkin.description : oneLineUnlock(shownSkin)}
              </p>
            </div>
            <div className="wardrobe__preview-actions">
              {shownUnlocked ? (
                <button
                  type="button"
                  className="ui-btn ui-btn--primary"
                  onClick={handleEquip}
                  disabled={isEquipped}
                >
                  {isEquipped ? '正在用' : '就用这个'}
                </button>
              ) : (
                <span className="ui-pill">还没解锁</span>
              )}
              {previewSkin ? (
                <button
                  type="button"
                  className="ui-btn ui-btn--ghost"
                  onClick={() => setPreviewSkinId(null)}
                >
                  关闭预览
                </button>
              ) : null}
            </div>
          </div>

          <div className="wardrobe__keys">
            <PianoKeyboard
              size={8}
              showNoteNames
              onNoteOn={handleNoteOn}
              onNoteOff={handleNoteOff}
            />
          </div>
        </section>

        <p className="wardrobe__footnote">
          {progress.unlockedSkinIds.length} / {SKINS.length} 套琴键已获得。
          星星是成长记录，不会被花掉 —— 攒够数量就会自动获得新琴键。
        </p>
      </div>

      {wornNotice ? (
        <div className="wardrobe__toast" role="status">
          {wornNotice}
        </div>
      ) : null}
    </div>
  );
}
