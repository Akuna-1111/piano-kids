import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { PianoKeyboard } from '@/features/piano/PianoKeyboard';
import {
  REAL_OCTAVE_SPAN_MM,
  REAL_WHITE_KEY_MM,
  describeKeyWidth,
  type DeviceMetrics,
  type KeyWidthResult,
} from '@/features/piano/keySize';
import { useProgressStore } from '@/core/progress/ProgressStore';
import {
  clearHoldSamples,
  getHoldSamples,
  getHoldSkippedCount,
  holdRatio,
  recentHoldSamples,
  summarizeHolds,
  type HoldStatsSummary,
} from '@/features/practice/holdStats';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import './tuning.css';

/** 键盘算出的物理尺寸（白键毫米数 + 设备 PPI 估算来源） */
type KeyboardMetrics = KeyWidthResult & { metrics: DeviceMetrics };

const PPI_SOURCE_LABEL: Record<DeviceMetrics['source'], string> = {
  'device-table': '已知机型',
  desktop: '桌面 96dpi',
  assumed: '兜底估算',
};

/**
 * 真机自检页（Phase 0 验收标准 / 文档 19.1、19.2）。
 *
 * 入口是隐藏路由 `#/tuning`，不在任何儿童界面里出现。
 * 存在的理由很实际：Phase 0 的验收标准（快速连续点击、快速滑动、多指同时按下
 * 都不卡音 / 不重复触发 / 不留卡住的音）只能在真实 iPad Safari 上验证，
 * 而这个页面把「需要观察的量」变成可以当场读出来的数字。
 */

const MAX_EVENTS = 12;
const MAX_HOLD_ROWS = 8;

/** 把比值显示成百分比，例如 0.625 → "63%"。 */
function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

interface TraceRow {
  id: number;
  kind: 'down' | 'up' | 'cancel';
  note: string;
  pointerId: number;
  /** pointerdown → noteOn 调用的耗时（毫秒） */
  handlerMs: number;
}

export function TuningPage() {
  const navigate = useNavigate();
  const { settings } = useProgressStore();

  const [diagnostics, setDiagnostics] = useState(() => audioEngine.getDiagnostics());
  const [trace, setTrace] = useState<TraceRow[]>([]);
  const [maxSimultaneous, setMaxSimultaneous] = useState(0);
  const [activePointers, setActivePointers] = useState(0);
  const [tapToOnMs, setTapToOnMs] = useState<number | null>(null);
  const [keySize, setKeySize] = useState<KeyboardMetrics | null>(null);
  /**
   * 键盘结构：**直接数 DOM**。
   *
   * 为了排查「iPad 上没看到黑键」这类只在真机上出现的现象，数出来的数字能一句话分清两种原因：
   *   · 白 15 / 黑 0  → 拿到的是**旧页面**（改之前根本没有黑键），刷新即可
   *   · 白 15 / 黑 10 → 黑键**渲染了但看不见**，那是真的渲染 / 层叠问题
   */
  const [keyCounts, setKeyCounts] = useState<{ size: string; white: number; black: number } | null>(
    null,
  );
  useEffect(() => {
    const container = document.querySelector('.pk');
    if (!container) return;
    setKeyCounts({
      size: container.getAttribute('data-keyboard-size') ?? '?',
      white: container.querySelectorAll('.pk-key--white').length,
      black: container.querySelectorAll('.pk-key--black').length,
    });
  }, []);

  const [holdSummary, setHoldSummary] = useState<HoldStatsSummary>(() =>
    summarizeHolds(getHoldSamples(), getHoldSkippedCount()),
  );
  const [holdRows, setHoldRows] = useState(() => recentHoldSamples(MAX_HOLD_ROWS));

  const handleKeyboardMetrics = useCallback((result: KeyboardMetrics) => {
    setKeySize((prev) =>
      prev && Math.abs(prev.keyMm - result.keyMm) < 0.05 && prev.metrics.ppi === result.metrics.ppi
        ? prev
        : result,
    );
  }, []);
  const size = settings.keyboardSize;

  const pointerDownAt = useRef(new Map<number, number>());
  const eventIdRef = useRef(0);

  const refresh = useCallback(() => {
    setDiagnostics(audioEngine.getDiagnostics());
    setHoldSummary(summarizeHolds(getHoldSamples(), getHoldSkippedCount()));
    setHoldRows(recentHoldSamples(MAX_HOLD_ROWS));
  }, []);

  useEffect(() => {
    const timer = setInterval(refresh, 400);
    return () => clearInterval(timer);
  }, [refresh]);

  const pushTrace = useCallback((row: Omit<TraceRow, 'id'>) => {
    eventIdRef.current += 1;
    const entry: TraceRow = { ...row, id: eventIdRef.current };
    setTrace((prev) => [entry, ...prev].slice(0, MAX_EVENTS));
  }, []);

  const handleNoteOn = useCallback(
    (note: string, velocity: number) => {
      const started = performance.now();
      audioEngine.noteOn(note, velocity);
      const handlerMs = performance.now() - started;

      // 需要知道是哪个 pointer：用当前按下的指针集合推断（自检页只用于观察）
      let pointerId = -1;
      for (const id of pointerDownAt.current.keys()) {
        pointerId = id;
        break;
      }
      const downAt = pointerDownAt.current.get(pointerId);
      if (downAt !== undefined) {
        setTapToOnMs(Math.round((started - downAt) * 100) / 100);
      }
      pushTrace({ kind: 'down', note, pointerId, handlerMs: Math.round(handlerMs * 100) / 100 });
      refresh();
    },
    [pushTrace, refresh],
  );

  const handleNoteOff = useCallback(
    (note: string) => {
      audioEngine.noteOff(note);
      pushTrace({ kind: 'up', note, pointerId: -1, handlerMs: 0 });
      refresh();
    },
    [pushTrace, refresh],
  );

  // 观察多点触控：记录同时按下的最大指针数
  const trackPointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.type === 'pointerdown') {
        pointerDownAt.current.set(event.pointerId, performance.now());
      } else {
        pointerDownAt.current.delete(event.pointerId);
      }
      setActivePointers(pointerDownAt.current.size);
      setMaxSimultaneous((prev) => Math.max(prev, pointerDownAt.current.size));
    },
    [],
  );

  const stuckCheck = useMemo(() => {
    // 没有任何手指按着，但引擎里还有音 = 卡音
    return activePointers === 0 && diagnostics.heldVoices > 0;
  }, [activePointers, diagnostics.heldVoices]);

  /** 试听：按下、保持一会、再松开 —— 用来确认「按住持续衰减」和「松开有制音器余音」。 */
  const audition = useCallback(
    (note: string, holdMs: number) => {
      void audioEngine.ensureReady().then(() => {
        audioEngine.noteOn(note, 0.9);
        window.setTimeout(() => audioEngine.noteOff(note), holdMs);
      });
    },
    [],
  );

  return (
    <div className="tune">
      <header className="tune__top">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="tune__title">真机自检</h1>
        <span className="tune__sub">#/tuning</span>
      </header>

      <div className="tune__body">
        <section className="tune__panel">
          <h2 className="tune__panel-title">音频引擎</h2>
          <dl className="tune__grid">
            <div>
              <dt>状态</dt>
              <dd className={cx(diagnostics.state === 'running' && 'is-ok')}>{diagnostics.state}</dd>
            </div>
            <div>
              <dt>采样率</dt>
              <dd>{diagnostics.sampleRate || '—'}</dd>
            </div>
            <div>
              <dt>baseLatency</dt>
              <dd>{diagnostics.baseLatencyMs ?? '—'} ms</dd>
            </div>
            <div>
              <dt>outputLatency</dt>
              <dd>{diagnostics.outputLatencyMs ?? '—'} ms</dd>
            </div>
            <div>
              <dt>按住的音</dt>
              <dd className={cx(stuckCheck && 'is-bad')}>{diagnostics.heldVoices}</dd>
            </div>
            <div>
              <dt>排程中的音</dt>
              <dd>{diagnostics.scheduledVoices}</dd>
            </div>
            <div>
              <dt>手指按下到发声的耗时</dt>
              <dd>{tapToOnMs ?? '—'} ms</dd>
            </div>
            <div>
              <dt>同时按下最多</dt>
              <dd className={cx(maxSimultaneous >= 2 && 'is-ok')}>{maxSimultaneous} 指</dd>
            </div>
          </dl>

          {/* 真实尺寸自检：让孩子的手指跨度能否迁移到真琴，变成可以当场读出来的数字 */}
          <h2 className="tune__panel-title tune__panel-title--spaced">琴键物理尺寸</h2>
          <dl className="tune__grid">
            <div>
              <dt>设备 PPI（估算）</dt>
              <dd className={cx(keySize?.metrics.source === 'assumed' && 'is-bad')}>
                {keySize ? `${Math.round(keySize.metrics.ppi)} (${PPI_SOURCE_LABEL[keySize.metrics.source]})` : '—'}
              </dd>
            </div>
            <div>
              <dt>设备像素比</dt>
              <dd>{keySize ? keySize.metrics.dpr : '—'}</dd>
            </div>
            <div>
              <dt>键盘档位 / 结构</dt>
              <dd className={cx(keyCounts && keyCounts.black > 0 && 'is-ok')}>
                {keyCounts
                  ? `${keyCounts.size} 键 · 白 ${keyCounts.white} · 黑 ${keyCounts.black}`
                  : '—'}
              </dd>

              <dt>白键实际宽度</dt>
              <dd className={cx(keySize?.isRealSize && 'is-ok')}>
                {keySize ? `${keySize.keyMm.toFixed(1)} mm` : '—'}
              </dd>
            </div>
            <div>
              <dt>真实钢琴白键</dt>
              <dd>{REAL_WHITE_KEY_MM} mm</dd>
            </div>
            <div>
              <dt>八度跨度（实际）</dt>
              <dd>{keySize ? `${(keySize.keyMm * 7).toFixed(1)} mm` : '—'}</dd>
            </div>
            <div>
              <dt>八度跨度（真实）</dt>
              <dd>{REAL_OCTAVE_SPAN_MM.toFixed(1)} mm</dd>
            </div>
          </dl>
          <p className="tune__hint tune__hint--tight">
            {keySize
              ? describeKeyWidth(keySize, keySize.metrics)
              : '正在测量键盘宽度…'}
            。8 键是唯一能在 iPad 上达到真实钢琴尺寸的档位；15 / 25 键受屏幕物理宽度限制必然更窄。
          </p>

          {stuckCheck ? (
            <p className="tune__alert">
              检测到可能卡住的音：没有手指按下但引擎仍有 {diagnostics.heldVoices} 个音在响。
            </p>
          ) : null}

          <div className="tune__actions">
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                audioEngine.allNotesOff();
                refresh();
              }}
            >
              全部松开
            </button>
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                void audioEngine.ensureReady().then(refresh);
              }}
            >
              恢复 AudioContext
            </button>
            <button type="button" className="ui-btn" onClick={() => setMaxSimultaneous(0)}>
              重置计数
            </button>
          </div>
        </section>

        <section className="tune__panel tune__panel--wide">
          <h2 className="tune__panel-title">音色试听</h2>
          <p className="tune__hint tune__hint--tight">
            按住 2 秒是为了听「按住期间声音一直在自然衰减」，而不是停在某个音量上。
            松手后应该还有一段逐渐变小、最后消失在房间混响里的余音，而不是「啪」地断掉。
          </p>
          <div className="tune__actions">
            <button type="button" className="ui-btn" onClick={() => audition('C3', 2000)}>
              低音 C3 · 按住 2 秒
            </button>
            <button type="button" className="ui-btn" onClick={() => audition('C4', 2000)}>
              中音 C4 · 按住 2 秒
            </button>
            <button type="button" className="ui-btn" onClick={() => audition('C6', 2000)}>
              高音 C6 · 按住 2 秒
            </button>
            <button type="button" className="ui-btn" onClick={() => audition('C4', 80)}>
              中音 C4 · 轻点一下
            </button>
          </div>
        </section>

        <section className="tune__panel tune__panel--wide">
          <h2 className="tune__panel-title">按住时长采样（仅本次会话，刷新即清空）</h2>
          <p className="tune__hint tune__hint--tight">
            在曲目里用<b>跟弹</b>模式弹一会儿再回来看。<b>按住提示</b>目前不参与评分，
            要不要变成评分，取决于这里的真实分布 —— 尤其是「没等到松手」的占比：
            它高就说明松手信号本身不可靠，那就不能拿来扣分。
          </p>

          <dl className="tune__grid">
            <div>
              <dt>确认松手（样本）</dt>
              <dd className={cx(holdSummary.count > 0 && 'is-ok')}>{holdSummary.count}</dd>
            </div>
            <div>
              <dt>没等到松手</dt>
              <dd className={cx(holdSummary.skippedCount > holdSummary.count && 'is-bad')}>
                {holdSummary.skippedCount}
              </dd>
            </div>
            <div>
              <dt>按住 / 标称（中位）</dt>
              <dd>{holdSummary.medianRatio === null ? '—' : percent(holdSummary.medianRatio)}</dd>
            </div>
            <div>
              <dt>短于一半</dt>
              <dd>{percent(holdSummary.tooShortRatio)}</dd>
            </div>
            <div>
              <dt>真的按够了</dt>
              <dd>{percent(holdSummary.reachedTargetRatio)}</dd>
            </div>
          </dl>

          {holdSummary.count > 0 ? (
            <ul className="tune__bars">
              {holdSummary.buckets.map((bucket) => (
                <li key={bucket.label} className="tune__bars-row">
                  <span className="tune__bars-label">{bucket.label}</span>
                  <span className="tune__bars-track">
                    <span
                      className="tune__bars-fill"
                      style={{ width: `${bucket.share * 100}%` }}
                    />
                  </span>
                  <span className="tune__bars-count">{bucket.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tune__trace-empty">还没有样本。去曲目里用跟弹模式弹一会儿。</p>
          )}

          {holdRows.length > 0 ? (
            <ul className="tune__trace tune__trace--spaced">
              {holdRows.map((sample, index) => (
                <li key={`${sample.note}-${index}`} className="tune__trace-row">
                  <span className="tune__trace-kind">{sample.note}</span>
                  <span className="tune__trace-note">
                    {Math.round(sample.heldMs)} / {Math.round(sample.targetMs)} ms
                  </span>
                  <span className="tune__trace-ms">{percent(holdRatio(sample))}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="tune__actions">
            <button
              type="button"
              className="ui-btn"
              onClick={() => {
                clearHoldSamples();
                refresh();
              }}
            >
              清空采样
            </button>
          </div>
        </section>

        <section className="tune__panel tune__panel--wide">
          <h2 className="tune__panel-title">事件轨迹（最近 {MAX_EVENTS} 条）</h2>
          <ul className="tune__trace">
            {trace.length === 0 ? (
              <li className="tune__trace-empty">在下面弹几个音，这里会实时显示 down / up 事件</li>
            ) : (
              trace.map((row) => (
                <li key={row.id} className={cx('tune__trace-row', `is-${row.kind}`)}>
                  <span className="tune__trace-kind">{row.kind}</span>
                  <span className="tune__trace-note">{row.note}</span>
                  <span className="tune__trace-ms">handler {row.handlerMs} ms</span>
                </li>
              ))
            )}
          </ul>
          <p className="tune__hint">
            自检清单：快速连续点击 / 快速横向滑动 / 两个手指同时按下 / 切后台再回来 / 锁屏再回来 /
            系统静音。任何一项出现「音不响」「重复触发」或「按住的音不归零」都算失败。
          </p>
        </section>

        <section className="tune__keys" onPointerDownCapture={trackPointer} onPointerUpCapture={trackPointer} onPointerCancelCapture={trackPointer}>
          <PianoKeyboard
            size={size}
            showNoteNames
            onNoteOn={handleNoteOn}
            onNoteOff={handleNoteOff}
            onMetrics={handleKeyboardMetrics}
          />
        </section>
      </div>
    </div>
  );
}
