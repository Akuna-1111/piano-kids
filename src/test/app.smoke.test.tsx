import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { PROGRESS_STORAGE_KEY, SETTINGS_STORAGE_KEY, clearAllStorage } from '@/core/progress/storage';
import { getSongById } from '@/features/songs/songData';
import { resolveSong } from '@/features/songs/songResolver';
import { SKINS } from '@/features/skins/skins';
import {
  clearHoldSamples,
  getHoldSamples,
  recordHoldSample,
  recordHoldSkipped,
} from '@/features/practice/holdStats';

/**
 * 核心路径冒烟测试（文档 19.4）：
 *
 *   打开网页 → 选歌 → 听一遍 → 开始跟弹 → 弹完 → 获得星星 → 皮肤解锁 → 进入装扮
 *
 * jsdom 没有布局引擎，因此这里用一个可控的 elementFromPoint 桩来模拟「手指落在某个琴键上」。
 * 这正是键盘组件采用的命中测试方式，所以这条路走通意味着真实的 pointer 流程也走通。
 * 真实 iPad 上的触感与音频延迟仍然必须人工验证（开发规则 14）。
 */

let pointTarget: Element | null = null;

function pressKey(note: string) {
  const container = document.querySelector('.pk');
  const key = document.querySelector(`[data-note="${note}"]`);
  if (!container || !key) throw new Error(`找不到琴键 ${note}`);
  pointTarget = key;
  fireEvent.pointerDown(container, { pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(container, { pointerId: 1, clientX: 0, clientY: 0 });
}

/** 只按下、不松手 —— 用来验证「按住提示」。 */
function pressKeyDown(note: string) {
  const container = document.querySelector('.pk');
  const key = document.querySelector(`[data-note="${note}"]`);
  if (!container || !key) throw new Error(`找不到琴键 ${note}`);
  pointTarget = key;
  fireEvent.pointerDown(container, { pointerId: 1, clientX: 0, clientY: 0 });
}

function releaseKey() {
  const container = document.querySelector('.pk');
  if (!container) throw new Error('找不到键盘');
  pointTarget = null;
  fireEvent.pointerUp(container, { pointerId: 1, clientX: 0, clientY: 0 });
}

function keyClasses(note: string): string {
  return document.querySelector(`[data-note="${note}"]`)?.className ?? '';
}

/** 读自检页某个指标格的值：按 dt 文案找到同一格里的 dd。 */
function gridValue(label: string): string | undefined {
  for (const cell of document.querySelectorAll('.tune__grid > div')) {
    if (cell.querySelector('dt')?.textContent === label) {
      return cell.querySelector('dd')?.textContent ?? undefined;
    }
  }
  return undefined;
}

/** 分布条每一档的计数。 */
function bucketCounts(): string[] {
  return [...document.querySelectorAll('.tune__bars-count')].map((el) => el.textContent ?? '');
}

function readProgress() {
  return JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) ?? '{}');
}

function readSettings() {
  return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
}

describe('核心路径冒烟测试', () => {
  beforeEach(() => {
    clearAllStorage();
    // HashRouter 会把路由写进 location.hash，测试之间必须复位
    window.location.hash = '';
    // jsdom 没有布局，用一个可控桩代替真实命中测试
    pointTarget = null;
    // 采样器是模块级单例，测试之间必须清干净
    clearHoldSamples();
    document.elementFromPoint = vi.fn(() => pointTarget) as unknown as typeof document.elementFromPoint;
  });

  /** 开始跟弹是异步解锁音频后才切状态的，等谱面出现再继续。 */
  async function startPlaying() {
    fireEvent.click(screen.getByText('开始跟弹'));
    await waitFor(() => expect(document.querySelector('.pp__staff')).toBeTruthy());
    // 跟弹模式必须有五线谱（原来只有大字音名卡片）
    expect(document.querySelector('.pp__staff')?.getAttribute('aria-label')).toContain('五线谱上的');
  }

  it('首页就是自由弹：顶栏有跟我弹/小挑战，正文是键盘', () => {
    render(<App />);

    // 首页不再有「今天想怎么玩？」这一段目录
    expect(screen.queryByText('今天想怎么玩？')).toBeNull();

    // 两个入口在顶栏里（图标 + 文字），品牌名居中
    const songs = screen.getByText('跟我弹');
    const challenges = screen.getByText('小挑战');
    expect(songs.closest('.home__nav')).not.toBeNull();
    expect(challenges.closest('.home__nav')).not.toBeNull();
    // 品牌名与两个入口**平级**：入口在左（栅格第 1 列）、品牌名居中（第 2 列）
    expect(screen.getByText('小钢琴').closest('.home__bar')).not.toBeNull();
    expect(songs.closest('.home__nav')).not.toBeNull();

    // 正文就是可弹的键盘；装扮在顶栏，与星星同一排
    expect(document.querySelector('.home__stage .pk')).toBeTruthy();
    expect(screen.getByLabelText('我的装扮').closest('.home__hud')).not.toBeNull();
    expect(screen.getByLabelText(/当前星星/).closest('.home__hud')).not.toBeNull();
  });

  it('完整走通：选歌 → 开始跟弹 → 弹完整首 → 拿星星 → 解锁皮肤', async () => {
    render(<App />);

    // 1. 进入曲目列表
    fireEvent.click(screen.getByText('跟我弹'));
    expect(await screen.findByText('选一首歌')).toBeInTheDocument();
    expect(screen.getByText('小星星')).toBeInTheDocument();

    // 2. 选择小星星
    fireEvent.click(screen.getByText('小星星'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());

    // 3. 开始跟弹
    await startPlaying();

    // 4. 按曲谱顺序把每个音弹对
    const song = resolveSong(getSongById('twinkle-star')!, 8);
    for (const note of song.notes) {
      pressKey(note.playedNote);
    }

    // 5. 完成后立刻拿到奖励，不依赖 React state 是否刷新（文档 10.5）
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('完成啦！')).toBeInTheDocument();
    // 文案遵循设计规范 §20：先说完成，再说表现，最后说成长
    // 准确率与用时合成一行（4.3），不做成大号数字面板
    expect(within(dialog).getByText(/准确率/)).toBeInTheDocument();
    expect(within(dialog).getByText(/用时/)).toBeInTheDocument();
    expect(within(dialog).getByText(/星星成长值/)).toBeInTheDocument();

    // 完成页是精简过的：歌名不重复、没有大号数字面板、没有勋章 pill 墙
    expect(within(dialog).queryByText('小星星')).toBeNull();
    expect(dialog.querySelector('.pp-result__figures')).toBeNull();
    expect(dialog.querySelector('.pp-result__badge')).toBeNull();

    // 6. 成长数据已落盘
    const progress = readProgress();
    expect(progress.starsTotal).toBeGreaterThan(0);
    expect(progress.completedSongIds).toContain('twinkle-star');
    expect(progress.unlockedSkinIds).toContain('forest');
    expect(progress.achievements).toContain('first-song');
    expect(progress.streak.currentDays).toBe(1);

    // 7. 完成页上直接出现「新解锁」入口，点进去就是装扮页
    fireEvent.click(within(dialog).getByText(/森林/));
    // 这里等的是**装扮页的标题**（不是首页顶栏那个图标入口）
    await waitFor(() => expect(screen.getByText('我的装扮')).toBeInTheDocument());
  });

  it('弹错不会卡住：同一个音连错 3 次后自动继续（不给孩子挫败感）', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('跟我弹'));
    fireEvent.click(await screen.findByText('小星星'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());
    await startPlaying();

    const song = resolveSong(getSongById('twinkle-star')!, 8);
    const first = song.notes[0].playedNote;
    const wrong = first === 'C5' ? 'C4' : 'C5';

    for (let i = 0; i < 3; i += 1) pressKey(wrong);

    // 3 次之后目标已经前进到第 2 个音，并且仍然给孩子一句安慰
    expect(screen.getByText('没关系，再试一次 —— 就是亮起来的那个键')).toBeInTheDocument();

    // 继续把剩下的弹完，仍然能正常结算
    for (const note of song.notes.slice(1)) {
      pressKey(note.playedNote);
    }
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('装扮页是「琴键样品板」：每套皮肤一块真实琴键材质样品（§12.1）', async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('我的装扮'));
    await waitFor(() => expect(screen.getByText('点击任意样品即可试弹')).toBeInTheDocument());

    // 样品必须是真实琴键结构（白键层 + 黑键层），而不是「色卡 + 商品卡」
    const samples = document.querySelectorAll('.skin-sample');
    expect(samples.length).toBe(SKINS.length);
    for (const sample of samples) {
      expect(sample.querySelectorAll('.skin-sample__white').length).toBe(4);
      expect(sample.querySelectorAll('.skin-sample__black').length).toBe(2);
      // 样品自己带上受限的皮肤变量，因此展示的就是那块材质
      expect(sample.getAttribute('style')).toContain('--skin-key-bg');
    }

    // §12.2：未解锁不用「灰度 + 锁」，而且解锁信息只说一句话
    expect(document.querySelectorAll('.sample.is-locked').length).toBeGreaterThan(0);
    expect(screen.queryByText('🔒')).toBeNull();

    // §12.1：顶部只留当前星星成长值
    expect(screen.getByText('当前星星成长值')).toBeInTheDocument();

    // §10.9：预览窗是真正可弹的键盘
    expect(document.querySelector('.pk')).toBeTruthy();

    // 点样品切换预览，但不改装备状态
    fireEvent.click(screen.getByText('森林'));
    await waitFor(() => expect(screen.getByText('林木与苔藓')).toBeInTheDocument());
  });

  it('按对之后先「按住」：下一个键降级为弱提示，按住够了才升回强引导', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('跟我弹'));
    // 玛丽的前两个音是 E4 / D4，不是同一个键，方便分辨引导层级
    fireEvent.click(await screen.findByText('玛丽有只小羊羔'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());
    await startPlaying();

    const song = resolveSong(getSongById('mary-lamb')!, 8);
    const first = song.notes[0].playedNote;
    const second = song.notes[1].playedNote;
    expect(second).not.toBe(first);

    // 还没弹的时候，第一个音是强引导
    expect(keyClasses(first)).toContain('is-guide');

    // 按对，但**不松手**
    pressKeyDown(first);

    // 按住提示出现，并且写明要按住的是哪个音
    await waitFor(() => expect(document.querySelector('.pp__hold')).toBeTruthy());
    expect(document.querySelector('.pp__hold-label')?.textContent).toContain('按住');
    expect(document.querySelector('.pp__hold-bar')).toBeTruthy();
    // 填充时长来自谱面数据（音值 × 拍速），而不是一个写死的动画时长
    const bar = document.querySelector('.pp__hold-bar') as HTMLElement;
    expect(bar.getAttribute('style')).toContain('--pp-hold-ms');

    // 这时「下一个键」只是弱提示，还没有强引导 —— 孩子不该急着去弹它
    expect(keyClasses(second)).toContain('is-next');
    expect(keyClasses(second)).not.toContain('is-guide');
    expect(document.querySelector('.pk-key.is-guide')).toBeNull();

    // 按满之后（不需要松手）自动升回强引导，按住提示退场
    await waitFor(
      () => {
        expect(keyClasses(second)).toContain('is-guide');
        expect(document.querySelector('.pp__hold')).toBeNull();
      },
      { timeout: 3000 },
    );

    releaseKey();
  });

  it('按住提示不影响成绩：每一步都「弹一下就走」也能正常弹完并拿到奖励', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('跟我弹'));
    fireEvent.click(await screen.findByText('玛丽有只小羊羔'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());
    await startPlaying();

    const song = resolveSong(getSongById('mary-lamb')!, 8);
    for (const note of song.notes) {
      // 弹一下就松手：每一步都走「松手结束按住提示」这条路
      pressKeyDown(note.playedNote);
      releaseKey();
    }

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('完成啦！')).toBeInTheDocument();

    // 松手不参与评分：全部弹对，音准部分是满分，准确度不可能低于 70
    const progress = readProgress();
    expect(progress.completedSongIds).toContain('mary-lamb');
    expect(progress.stats.bestAccuracy).toBeGreaterThanOrEqual(70);
    expect(progress.starsTotal).toBeGreaterThan(0);
  });

  it('跟弹时的按住时长会进入真机自检页的采样', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('跟我弹'));
    fireEvent.click(await screen.findByText('玛丽有只小羊羔'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());
    await startPlaying();

    const song = resolveSong(getSongById('mary-lamb')!, 8);
    const first = song.notes[0];

    // 弹对第一个音，按住一会儿再松手
    pressKeyDown(first.playedNote);
    releaseKey();

    const samples = getHoldSamples();
    expect(samples).toHaveLength(1);
    expect(samples[0].note).toBe(first.playedNote);
    // 标称时长就是谱面里的音值 × 拍速（1 拍 @ 104bpm）
    expect(samples[0].targetMs).toBeCloseTo(first.duration * song.beatSeconds * 1000, 6);
    // jsdom 里两次事件几乎同时，所以肯定远短于标称 —— 这正是要收集的「太短」
    expect(samples[0].heldMs).toBeGreaterThanOrEqual(0);
    expect(samples[0].heldMs).toBeLessThan(samples[0].targetMs);
  });

  it('真机自检页把按住时长采样读出来（分布 + 没等到松手）', async () => {
    recordHoldSample({ note: 'C4', targetMs: 1000, heldMs: 400 }); // 40% → 25–50%
    recordHoldSample({ note: 'D4', targetMs: 1000, heldMs: 1200 }); // 120% → 按够了
    recordHoldSkipped();

    window.location.hash = '#/tuning';
    render(<App />);

    expect(await screen.findByText('真机自检')).toBeInTheDocument();
    expect(screen.getByText('按住时长采样（仅本次会话，刷新即清空）')).toBeInTheDocument();

    expect(gridValue('确认松手（样本）')).toBe('2');
    expect(gridValue('没等到松手')).toBe('1');
    // 中位数 = (0.4 + 1.2) / 2 = 0.8
    expect(gridValue('按住 / 标称（中位）')).toBe('80%');

    // 分布：两条样本分别落在「25–50%」和「按够了」，其余为 0
    expect(bucketCounts()).toEqual(['0', '1', '0', '0', '1']);

    // 最近样本按 ms 列出来
    const recent = document.querySelector('.tune__trace--spaced')?.textContent ?? '';
    expect(recent).toContain('400 / 1000 ms');
    expect(recent).toContain('1200 / 1000 ms');
  });

  it('完成页能「听我弹的」：回放的是孩子刚才真弹出来的东西', async () => {
    render(<App />);
    fireEvent.click(screen.getByText('跟我弹'));
    fireEvent.click(await screen.findByText('玛丽有只小羊羔'));
    await waitFor(() => expect(screen.getByText('开始跟弹')).toBeInTheDocument());
    await startPlaying();

    const song = resolveSong(getSongById('mary-lamb')!, 8);
    for (const note of song.notes) pressKey(note.playedNote);

    const dialog = await screen.findByRole('dialog');
    const replay = within(dialog).getByText('听我弹的');
    expect(replay).toBeInTheDocument();

    // 点下去要走完一轮：异步解锁音频 → 开始回放 → 按钮变成「停止」
    fireEvent.click(replay);
    await waitFor(() => expect(within(dialog).getByText('停止')).toBeInTheDocument());

    // 再点一次是停止，回到可重播状态
    fireEvent.click(within(dialog).getByText('停止'));
    await waitFor(() => expect(within(dialog).getByText('听我弹的')).toBeInTheDocument());
  });

  it('设置里换音色会真的传到音频引擎，并且写进存档', async () => {
    const { audioEngine } = await import('@/core/audio/AudioEngine');
    // 设置页不是从首页点进去的（首页只有四个一级入口），直接走路由
    window.location.hash = '#/settings';
    render(<App />);

    await waitFor(() => expect(screen.getByText('音色')).toBeInTheDocument());
    // 默认是三角钢琴
    expect(audioEngine.getVoicePresetId()).toBe('grand');

    fireEvent.click(screen.getByText('电钢琴'));
    await waitFor(() => expect(audioEngine.getVoicePresetId()).toBe('electric'));
    expect(readSettings().voicePreset).toBe('electric');

    fireEvent.click(screen.getByText('立式钢琴'));
    await waitFor(() => expect(audioEngine.getVoicePresetId()).toBe('upright'));
    expect(readSettings().voicePreset).toBe('upright');
  });
});

