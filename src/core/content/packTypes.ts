/**
 * 内容包 —— 「用户自己导入的曲目」（开发规划 §12.5 的外挂方案）。
 *
 * ## 为什么要单独一套东西
 *
 * 内置曲库（`features/songs/songData.ts`）是**我们自己的作品**，随构建产物发布。
 * 而教材（例如《中国风钢琴入门教程》）的**编配受著作权保护**：这个应用要部署到公开地址，
 * 把教材内容打包进仓库 / 构建产物就是公开传播他人作品。
 *
 * 所以内容包这条路的规则是：
 *
 * - 应用**不含任何教材内容**，只提供「把你自己手上的谱录进来」的能力
 * - 包只存在**用户自己的设备上**（localStorage），不上传、不进构建产物
 * - 包是**只读快照**：导入后不可变，要改就重新导入（否则 ID 漂移，历史成绩会对不上）
 *
 * 这一层属于 `core/`：它不认识 React，也不认识内置曲库。
 */

/** 当前包格式版本。加字段要同时写迁移，和 `progress/migrations.ts` 一个规矩。 */
export const CONTENT_PACK_VERSION = 1;

/** 包里的一个音：与内置曲库同一套记法（beat 是拍，duration 是拍数） */
export interface PackNote {
  /** 空字符串 = 休止符 */
  note: string;
  beat: number;
  duration: number;
}

export interface PackSong {
  id: string;
  title: string;
  subtitle?: string;
  /** 每分钟拍数 */
  bpm: number;
  /** 每小节几拍，默认 4 */
  beatsPerBar?: 3 | 4;
  notes: PackNote[];
  /**
   * 简谱原文（可选）。
   * 留着它是为了**可核对**：家长能拿它和纸质谱逐音对一遍，
   * 也能在将来重新解析（`features/songs/jianpu.ts` 就是干这个的）。
   */
  jianpu?: string;
}

export interface ContentPack {
  version: number;
  /** 包 id：也会作为曲目 id 的前缀（`packId:songId`） */
  id: string;
  name: string;
  /** 来源说明，例如「家里那本书」——给自己看的，不做任何校验之外的事 */
  source?: string;
  createdAt: number;
  songs: PackSong[];
}

/** 导入曲目的完整 id：**必须带包前缀**，保证 `bestAccuracyBySong` 的历史成绩不会串到别的曲子 */
export function packSongId(packId: string, songId: string): string {
  return `${packId}:${songId}`;
}

export function splitPackSongId(id: string): { packId: string; songId: string } | null {
  const at = id.indexOf(':');
  if (at <= 0 || at === id.length - 1) return null;
  return { packId: id.slice(0, at), songId: id.slice(at + 1) };
}
