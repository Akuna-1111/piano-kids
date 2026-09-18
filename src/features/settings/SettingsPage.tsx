import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VOICE_PRESETS, VOICE_PRESET_IDS } from '@/core/audio/voicePresets';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import './settings.css';

/**
 * 设置页。
 *
 * 这里也是给家长看的「长期练习成果」入口 —— 刻意不放在首页，
 * 因为首页是孩子的主场，不该出现统计面板。
 */

const TIMING_OPTIONS = [
  { value: 1.6, label: '很宽松' },
  { value: 1, label: '标准' },
  { value: 0.7, label: '严格一点' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const { progress, settings, updateSettings, resetProgress } = useProgressStore();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="page">
      <header className="page__bar">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="page__title">设置</h1>
      </header>

      <div className="page__body settings__body">
        <section className="settings__group" aria-label="声音与手感">
          <h2 className="settings__group-title">声音与手感</h2>

          <label className="settings__row">
            <span className="settings__label">音量</span>
            <input
              className="settings__slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(event) => updateSettings({ volume: Number(event.target.value) })}
            />
            <span className="settings__value">{Math.round(settings.volume * 100)}%</span>
          </label>

          <div className="settings__row">
            <span className="settings__label">节奏判定</span>
            <div className="settings__segmented" role="group" aria-label="节奏判定宽松度">
              {TIMING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cx(
                    'settings__seg-btn',
                    settings.timingWindowScale === option.value && 'is-active',
                  )}
                  onClick={() => updateSettings({ timingWindowScale: option.value })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings__row">
            <span className="settings__label">音色</span>
            <div className="settings__segmented" role="group" aria-label="音色">
              {VOICE_PRESET_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={cx('settings__seg-btn', settings.voicePreset === id && 'is-active')}
                  onClick={() => updateSettings({ voicePreset: id })}
                >
                  {VOICE_PRESETS[id].name}
                </button>
              ))}
            </div>
          </div>
          <p className="settings__note">{VOICE_PRESETS[settings.voicePreset].description}。</p>

          <label className="settings__row settings__row--switch">
            <span className="settings__label">在琴键上显示音名</span>
            <input
              type="checkbox"
              className="settings__switch"
              checked={settings.showNoteNames}
              onChange={(event) => updateSettings({ showNoteNames: event.target.checked })}
            />
          </label>

          <label className="settings__row settings__row--switch">
            <span className="settings__label">谱面上显示数字简谱</span>
            <input
              type="checkbox"
              className="settings__switch"
              checked={settings.showSolfege}
              onChange={(event) => updateSettings({ showSolfege: event.target.checked })}
            />
          </label>

          <label className="settings__row settings__row--switch">
            <span className="settings__label">谱面上显示唱名拼音</span>
            <input
              type="checkbox"
              className="settings__switch"
              checked={settings.showPinyin}
              onChange={(event) => updateSettings({ showPinyin: event.target.checked })}
            />
          </label>
          <p className="settings__note">
            五线谱的音符正下方会标出「1 2 3…」和「do re mi…」，
            让谱面位置、简谱数字和读音一次对上。认熟之后关掉，就变成了纯识谱练习。
          </p>

          <label className="settings__row settings__row--switch">
            <span className="settings__label">减少动效</span>
            <input
              type="checkbox"
              className="settings__switch"
              checked={settings.reducedMotion}
              onChange={(event) => updateSettings({ reducedMotion: event.target.checked })}
            />
          </label>
          <p className="settings__note">
            系统开启「减弱动态效果」时也会自动降级，与这里的开关等效。
          </p>
        </section>

        <section className="settings__group" aria-label="练习记录">
          <h2 className="settings__group-title">练习记录</h2>
          <p className="settings__note">数据只保存在这台设备上，不会上传到任何服务器。</p>

          <dl className="settings__stats">
            <div>
              <dt>累计星星</dt>
              <dd>
                <Icon name="star-filled" size={20} /> {progress.starsTotal}
              </dd>
            </div>
            <div>
              <dt>完整弹完</dt>
              <dd>{progress.stats.songsCompleted} 次</dd>
            </div>
            <div>
              <dt>弹过的音</dt>
              <dd>{progress.stats.totalNotesPlayed} 个</dd>
            </div>
            <div>
              <dt>最高准确率</dt>
              <dd>{Math.round(progress.stats.bestAccuracy)}%</dd>
            </div>
            <div>
              <dt>连续练习</dt>
              <dd>
                {progress.streak.currentDays} 天
                <span className="settings__sub">（最长 {progress.streak.longestDays} 天）</span>
              </dd>
            </div>
            <div>
              <dt>勋章</dt>
              <dd>{progress.achievements.length} 枚</dd>
            </div>
          </dl>
        </section>

        <section className="settings__group" aria-label="重置">
          <h2 className="settings__group-title">重置</h2>
          {confirmReset ? (
            <div className="settings__danger">
              <p className="settings__note">
                会清空星星、勋章和装扮进度，且无法恢复。确定吗？
              </p>
              <div className="settings__danger-actions">
                <button type="button" className="ui-btn" onClick={() => setConfirmReset(false)}>
                  先不要
                </button>
                <button
                  type="button"
                  className="ui-btn ui-btn--primary settings__danger-confirm"
                  onClick={() => {
                    resetProgress();
                    setConfirmReset(false);
                  }}
                >
                  确定清空
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ui-btn" onClick={() => setConfirmReset(true)}>
              清空成长数据
            </button>
          )}
        </section>

        <p className="settings__about">
          小钢琴 · 打开即弹的网页钢琴。没有广告、没有账号、没有内购，所有内容都在本地运行。
        </p>
      </div>
    </div>
  );
}
