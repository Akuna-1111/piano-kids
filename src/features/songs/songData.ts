import type { Song, SongNote } from './types';

/**
 * 曲谱数据。原则（文档 7.3）：只保存一份原始旋律，
 * 「实际要弹的音」由 KeyboardRangeResolver 推导，只维护这一份数据。
 *
 * 记谱约定：
 *  - `seq([[音名, 时值(拍)], ...])`，起始拍自动累加，避免手工数拍出错
 *  - 第三项可选，用于个别需要单独强调 / 放轻的音；不写就按小节重拍自动推导（见 dynamics.ts）
 *  - 每首曲子的总拍数必须是 beatsPerBar 的整数倍，否则重拍会错位（有单测保证）
 *  - **音域必须落在 C4–C5 的白键上**：产品只有 8 键一个档位，
 *    越界的音会被 resolver 吸附，旋律轮廓就变了（`songData.test.ts` 守住这条）
 *
 * ⚠️ 曲目收录标准：只收录能够确认完整旋律与节奏的传统 / 古典儿歌。
 * 中文儿歌里相当一部分我无法确认到「可发布」的准确度，宁可不收，也不放可能错的谱。
 * 需要补充中文曲目时，把旋律（简谱或音名+时值）给出来即可直接加进来。
 */

type SeqEntry = readonly [string, number] | readonly [string, number, number];

/** 紧凑写法： [音名, 时值(拍)] 或 [音名, 时值(拍), 力度]，起始拍自动累加。 */
function seq(pairs: readonly SeqEntry[]): SongNote[] {
  let beat = 0;
  return pairs.map((entry) => {
    const [note, duration, velocity] = entry;
    const item: SongNote = velocity === undefined
      ? { note, beat, duration }
      : { note, beat, duration, velocity };
    beat += duration;
    return item;
  });
}

// ============================================================ 第一档：8 键就能弹

/** 热十字面包 —— 全曲只用 C/D/E 三个音，是最短的一首，适合当作「第一首」。 */
const hotCrossBuns: Song = {
  id: 'hot-cross-buns',
  title: '热十字面包',
  subtitle: 'Hot Cross Buns',
  category: 'english',
  difficulty: 1,
  bpm: 100,
  beatsPerBar: 4,
  notes: seq([
    ['E4', 1], ['D4', 1], ['C4', 2],
    ['E4', 1], ['D4', 1], ['C4', 2],
    ['C4', 1], ['C4', 1], ['C4', 1], ['C4', 1],
    ['D4', 1], ['D4', 1], ['D4', 1], ['D4', 1],
    ['E4', 1], ['D4', 1], ['C4', 2],
  ]),
};

/** 玛丽有只小羊羔 —— 只用 E/D/C/G 四个音。 */
const maryLamb: Song = {
  id: 'mary-lamb',
  title: '玛丽有只小羊羔',
  subtitle: 'Mary Had a Little Lamb',
  category: 'english',
  difficulty: 1,
  bpm: 104,
  beatsPerBar: 4,
  notes: seq([
    ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 2],
    ['D4', 1], ['D4', 1], ['D4', 2],
    ['E4', 1], ['G4', 1], ['G4', 2],
    ['E4', 1], ['D4', 1], ['C4', 1], ['D4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
    ['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1], ['D4', 1], ['C4', 4],
  ]),
};

/** 小星星 —— 音域 C4–A4，八分音符少，旋律最好记。 */
const twinkle: Song = {
  id: 'twinkle-star',
  title: '小星星',
  subtitle: '一闪一闪亮晶晶',
  category: 'classic',
  difficulty: 1,
  bpm: 96,
  beatsPerBar: 4,
  notes: seq([
    ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
    ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
    ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
    ['G4', 1], ['G4', 1], ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 2],
    ['C4', 1], ['C4', 1], ['G4', 1], ['G4', 1], ['A4', 1], ['A4', 1], ['G4', 2],
    ['F4', 1], ['F4', 1], ['E4', 1], ['E4', 1], ['D4', 1], ['D4', 1], ['C4', 2],
  ]),
};

/** 欢乐颂 —— 贝多芬第九交响曲主题，全曲音域 C4–G4，一步一级，非常适合初学。 */
const odeToJoy: Song = {
  id: 'ode-to-joy',
  title: '欢乐颂',
  subtitle: 'Beethoven · 第九交响曲',
  category: 'classic',
  difficulty: 1,
  bpm: 100,
  beatsPerBar: 4,
  notes: seq([
    ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1],
    ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
    ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1],
    ['E4', 1], ['D4', 1], ['D4', 2],
    ['E4', 1], ['E4', 1], ['F4', 1], ['G4', 1],
    ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
    ['C4', 1], ['C4', 1], ['D4', 1], ['E4', 1],
    ['D4', 1], ['C4', 1], ['C4', 2],
  ]),
};

/** 铃儿响叮当 —— 副歌段落，节奏规整，8 键可完整弹完。 */
const jingleBells: Song = {
  id: 'jingle-bells',
  title: '铃儿响叮当',
  subtitle: 'Jingle Bells',
  category: 'festival',
  difficulty: 1,
  bpm: 112,
  beatsPerBar: 4,
  notes: seq([
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['E4', 1], ['E4', 2],
    ['E4', 1], ['G4', 1], ['C4', 1], ['D4', 1],
    ['E4', 4],
    ['F4', 1], ['F4', 1], ['F4', 1], ['F4', 1],
    ['F4', 1], ['E4', 1], ['E4', 1], ['E4', 1],
    ['E4', 1], ['D4', 1], ['D4', 1], ['E4', 1],
    ['D4', 2], ['G4', 2],
  ]),
};

/** 老麦克唐纳 —— 只有 D4–B4，重复多，孩子很容易获得成就感。 */
const oldMacdonald: Song = {
  id: 'old-macdonald',
  title: '老麦克唐纳',
  subtitle: 'Old MacDonald Had a Farm',
  category: 'english',
  difficulty: 1,
  bpm: 108,
  beatsPerBar: 4,
  notes: seq([
    ['G4', 1], ['G4', 1], ['G4', 1], ['D4', 1],
    ['E4', 1], ['E4', 1], ['D4', 2],
    ['B4', 1], ['B4', 1], ['A4', 1], ['A4', 1],
    ['G4', 4],
    ['D4', 1], ['G4', 1], ['G4', 1], ['G4', 1],
    ['D4', 1], ['E4', 1], ['E4', 1], ['D4', 1],
    ['B4', 1], ['B4', 1], ['A4', 1], ['A4', 1],
    ['G4', 4],
  ]),
};

/** 划船歌 —— 音域 C4–C5，前两句级进，后两句有重复音型，适合练「同音连击」。 */
const rowYourBoat: Song = {
  id: 'row-your-boat',
  title: '划船歌',
  subtitle: 'Row Row Row Your Boat',
  category: 'english',
  difficulty: 1,
  bpm: 96,
  beatsPerBar: 4,
  notes: seq([
    ['C4', 1], ['C4', 1], ['C4', 1], ['D4', 1],
    ['E4', 2], ['E4', 1], ['D4', 1],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['C5', 1], ['C5', 1], ['C5', 1], ['G4', 1],
    ['G4', 1], ['G4', 1], ['E4', 1], ['E4', 1],
    ['E4', 1], ['C4', 1], ['C4', 1], ['C4', 1],
    ['G4', 1], ['F4', 1], ['E4', 1], ['D4', 1],
    ['C4', 4],
  ]),
};

// ============================================================ 第二档：更长 / 更宽

/**
 * 两只老虎 —— 含八分音符。
 *
 * 原曲结尾是「C–G–C」的**下行五度**（G3 在 C4 下面），8 键够不到，所以那个音记成 G4：
 * 这是 8 键玩具钢琴上通行的儿童版处理 —— 歌听得出，但结尾的五度是朝上的。
 */
const twoTigers: Song = {
  id: 'two-tigers',
  title: '两只老虎',
  subtitle: 'Frère Jacques',
  category: 'folk',
  difficulty: 2,
  bpm: 112,
  beatsPerBar: 4,
  notes: seq([
    ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
    ['C4', 1], ['D4', 1], ['E4', 1], ['C4', 1],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
    ['G4', 0.5], ['A4', 0.5], ['G4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1],
    ['C4', 1], ['G4', 1], ['C4', 2],
    ['C4', 1], ['G4', 1], ['C4', 2],
  ]),
};

/** 伦敦桥 —— 音域 C4–G4，句子长一点，用来练「一整句不断」。 */
const londonBridge: Song = {
  id: 'london-bridge',
  title: '伦敦桥',
  subtitle: 'London Bridge Is Falling Down',
  category: 'english',
  difficulty: 2,
  bpm: 112,
  beatsPerBar: 4,
  notes: seq([
    ['G4', 1], ['A4', 1], ['G4', 1], ['F4', 1],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['D4', 1], ['E4', 1], ['F4', 2],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['G4', 1], ['A4', 1], ['G4', 1], ['F4', 1],
    ['E4', 1], ['F4', 1], ['G4', 2],
    ['D4', 2], ['G4', 2],
    ['E4', 2], ['C4', 2],
  ]),
};

/**
 * 生日快乐 —— **暂不收录**（数据保留在这里，等键盘变宽再放回 `SONGS`）。
 *
 * 原因：旋律从 G3 到 G4，跨度**正好一个八度**，而 8 键键盘是 C4–C5，也只有 12 个半音。
 * 只有整八度移调才能让每个音都落在白键上（半音移调会引入黑键），
 * 于是 G3–G4 与 G4–G5 各有一头掉出键盘 —— 这首歌在这块键盘上**无法原样弹完**。
 *
 * 想让它回来有两条路：更宽的键盘，或者一份把跨度收窄的简化版编配（需要产品侧确认）。
 */
const happyBirthday: Song = {
  id: 'happy-birthday',
  title: '生日快乐',
  subtitle: 'Happy Birthday to You',
  category: 'festival',
  difficulty: 2,
  bpm: 108,
  beatsPerBar: 3,
  notes: seq([
    ['G3', 0.5], ['G3', 0.5], ['A3', 1], ['G3', 1], ['C4', 1], ['B3', 2],
    ['G3', 0.5], ['G3', 0.5], ['A3', 1], ['G3', 1], ['D4', 1], ['C4', 2],
    ['G3', 0.5], ['G3', 0.5], ['G4', 1], ['E4', 1], ['C4', 1], ['B3', 1], ['A3', 1],
    ['F4', 0.5], ['F4', 0.5], ['E4', 1], ['C4', 1], ['D4', 1], ['C4', 2],
  ]),
};

/** 全部曲目。 */
export const SONGS: readonly Song[] = [
  // 由易到难：先短、先窄、先只用白键
  hotCrossBuns,
  maryLamb,
  twinkle,
  odeToJoy,
  jingleBells,
  oldMacdonald,
  rowYourBoat,
  londonBridge,
  twoTigers,
  // happyBirthday 暂不收录：8 键装不下（理由见它自己的注释）
];

const SONG_BY_ID = new Map(SONGS.map((song) => [song.id, song]));

export function getSongById(id: string): Song | undefined {
  return SONG_BY_ID.get(id);
}

/** 推荐练习顺序：难度低 → 高，同难度按曲目本身的最短优先。 */
export function getSongsByDifficulty(): Song[] {
  return [...SONGS].sort((a, b) => {
    if (a.difficulty !== b.difficulty) return a.difficulty - b.difficulty;
    const aBeats = a.notes.reduce((sum, note) => sum + note.duration, 0);
    const bBeats = b.notes.reduce((sum, note) => sum + note.duration, 0);
    if (aBeats !== bBeats) return aBeats - bBeats;
    return SONGS.indexOf(a) - SONGS.indexOf(b);
  });
}

/** 曲目分类（与其在 UI 上出现的顺序一致）。 */
export const SONG_CATEGORIES: ReadonlyArray<{ id: Song['category']; label: string }> = [
  { id: 'folk', label: '儿歌' },
  { id: 'classic', label: '古典' },
  { id: 'english', label: '英文' },
  { id: 'festival', label: '节日' },
];

export function getSongsByCategory(category: Song['category'] | 'all'): Song[] {
  const sorted = getSongsByDifficulty();
  return category === 'all' ? sorted : sorted.filter((song) => song.category === category);
}

export { hotCrossBuns, maryLamb, twinkle, odeToJoy, jingleBells, oldMacdonald, rowYourBoat, londonBridge, twoTigers, happyBirthday };
