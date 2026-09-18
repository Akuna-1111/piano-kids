import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { audioEngine } from '@/core/audio/AudioEngine';
import { loadContentPacks, saveContentPacks } from '@/core/content/packStorage';
import { validateContentPack, type PackValidationResult } from '@/core/content/packSchema';
import { CONTENT_PACK_VERSION, type ContentPack } from '@/core/content/packTypes';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { getPlayableMidi } from '@/features/piano/pianoLayout';
import { parseJianpu } from '@/features/songs/jianpu';
import { packSongToSong } from '@/features/songs/packSongs';
import { resolveSong } from '@/features/songs/songResolver';
import { Icon } from '@/shared/ui/Icon';
import './import.css';

/**
 * 曲谱导入 —— **家长页**，隐藏路由 `#/import`（不在任何儿童界面里露出入口，与 `#/tuning` 同一规矩）。
 *
 * ## 为什么是「贴简谱」而不是「拍照片」
 *
 * 教材的编配受著作权保护，不能进这个会公开部署的仓库（AGENTS §16）；
 * 而照片识谱被判定为不可靠（进度文档《AI 读谱》）。所以这条路的形态是：
 * **家长把手上谱面的数字谱贴进来** → 机械解析 → 校验 → 存在**自己设备**上。
 * 100% 准确，也不需要 AI 读谱。
 *
 * ## 校验分两类（曲谱错一个音就是在教错音）
 *
 * - **错误**：数据本身坏了（音名不合法、时值越界、拍号对不上）→ 不让保存
 * - **警告**：数据没错，但当前键盘上要吸附（越界的音）→ 提示，但仍可保存
 */

function draftId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

const SAMPLE = `1=C 4/4
5 5 6 5 | 3 2 1 - |`;

export function JianpuImportPage() {
  const navigate = useNavigate();
  const { settings } = useProgressStore();

  const [text, setText] = useState('');
  const [packName, setPackName] = useState('我的曲目');
  const [songTitle, setSongTitle] = useState('');
  const [bpm, setBpm] = useState(80);
  const [report, setReport] = useState<{ parseWarnings: string[]; result: PackValidationResult } | null>(
    null,
  );
  const [packs, setPacks] = useState<ContentPack[]>(() => loadContentPacks().packs);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);

  const playableMidi = useMemo(
    () => new Set(getPlayableMidi(settings.keyboardSize)),
    [settings.keyboardSize],
  );

  /** 解析 + 校验（不写盘）；id 每次重新生成，保存时用的就是这一份 */
  const handleCheck = useCallback(() => {
    const parsed = parseJianpu(text);
    const song = {
      id: draftId('song'),
      title: songTitle.trim() || '导入的曲子',
      bpm,
      notes: parsed.notes,
      jianpu: text,
    };
    const candidate = {
      version: CONTENT_PACK_VERSION,
      id: draftId('pack'),
      name: packName.trim() || '我的曲目',
      songs: parsed.beatsPerBar === null ? [song] : [{ ...song, beatsPerBar: parsed.beatsPerBar }],
    };
    const result = validateContentPack(candidate, { playableMidi });
    setReport({ parseWarnings: parsed.warnings, result });
    setSavedTitle(null);
  }, [text, songTitle, packName, bpm, playableMidi]);

  const okReport = report && report.result.ok ? report.result : null;

  /** 试听：用的是**吸附之后**的音 —— 家长听到的就是孩子会弹的 */
  const handlePreview = useCallback(() => {
    if (!okReport) return;
    const song = packSongToSong(okReport.pack, okReport.pack.songs[0]);
    const resolved = resolveSong(song, settings.keyboardSize);
    void audioEngine.ensureReady().then((ready) => {
      if (!ready) return;
      const startedAt = audioEngine.currentTime + 0.12;
      for (const note of resolved.notes) {
        audioEngine.playScheduled(
          note.playedNote,
          startedAt + note.beat * resolved.beatSeconds,
          Math.max(0.12, note.duration * resolved.beatSeconds * 0.92),
          note.velocity ?? 0.8,
        );
      }
    });
  }, [report, settings.keyboardSize]);

  const handleSave = useCallback(() => {
    if (!okReport) return;
    const pack = okReport.pack;
    saveContentPacks([...loadContentPacks().packs, pack]);
    setPacks(loadContentPacks().packs);
    setSavedTitle(pack.songs[0].title);
    setReport(null);
    setText('');
    setSongTitle('');
  }, [report]);

  const handleRemove = useCallback((id: string) => {
    const next = loadContentPacks().packs.filter((pack) => pack.id !== id);
    saveContentPacks(next);
    setPacks(next);
  }, []);

  return (
    <div className="page">
      <header className="page__bar">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="page__title">曲谱导入（家长）</h1>
      </header>

      <div className="page__body im">
        <p className="im__lead">
          把谱面上的**数字谱**贴进来，检查通过后保存到**这台设备**上 —— 曲库的「我的曲目」里就会出现它。
          内容只存在本机，不会上传，也不会打进应用。
        </p>

        <label className="im__field">
          <span className="im__label">简谱</span>
          <textarea
            className="im__textarea is-selectable"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            placeholder={`例：\n${SAMPLE}`}
            spellCheck={false}
          />
        </label>
        <p className="im__hint">
          写法：<code>1=C 4/4</code> 开头；<code>1</code>–<code>7</code> 唱名、<code>0</code> 休止、
          <code>#4</code>/<code>b7</code> 黑键、<code>1'</code>/<code>5,</code> 高/低八度、
          <code>-</code> 延长一拍、<code>_</code> 减半、<code>~</code> 附点、<code>|</code> 小节线。
        </p>

        <div className="im__row">
          <label className="im__field im__field--grow">
            <span className="im__label">内容包名字</span>
            <input
              className="im__input is-selectable"
              value={packName}
              onChange={(event) => setPackName(event.target.value)}
              placeholder="例如：第 1 册上"
            />
          </label>
          <label className="im__field im__field--grow">
            <span className="im__label">曲名</span>
            <input
              className="im__input is-selectable"
              value={songTitle}
              onChange={(event) => setSongTitle(event.target.value)}
              placeholder="例如：茉莉花"
            />
          </label>
          <label className="im__field">
            <span className="im__label">速度</span>
            <input
              className="im__input im__input--num is-selectable"
              type="number"
              min={40}
              max={208}
              value={bpm}
              onChange={(event) => setBpm(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="im__actions">
          <button
            type="button"
            className="ui-btn ui-btn--primary"
            onClick={handleCheck}
            disabled={text.trim().length === 0}
          >
            检查
          </button>
          {okReport ? (
            <button type="button" className="ui-btn" onClick={handlePreview}>
              听一遍（吸附后）
            </button>
          ) : null}
          {okReport ? (
            <button type="button" className="ui-btn" onClick={handleSave}>
              保存到我的曲目
            </button>
          ) : null}
        </div>

        {report ? (
          <div className="im__report">
            {report.result.ok ? (
              <>
                <p className="im__ok">
                  检查通过：{report.result.pack.songs[0].notes.length} 个音 ·{' '}
                  {report.result.pack.songs[0].beatsPerBar ?? 4}/4 · {report.result.pack.songs[0].bpm}{' '}
                  拍/分
                </p>
                {report.result.warnings.map((warning) => (
                  <p className="im__warn" key={warning}>
                    {warning}
                  </p>
                ))}
              </>
            ) : (
              report.result.errors.map((error) => (
                <p className="im__error" key={error}>
                  {error}
                </p>
              ))
            )}
            {report.parseWarnings.map((warning) => (
              <p className="im__warn" key={warning}>
                {warning}
              </p>
            ))}
          </div>
        ) : null}

        {savedTitle ? <p className="im__ok">已保存「{savedTitle}」，去曲库的「我的曲目」看看。</p> : null}

        <h2 className="im__heading">本机已有的内容包</h2>
        {packs.length === 0 ? (
          <p className="im__hint">还没有导入过任何曲子。</p>
        ) : (
          <ul className="im__packs">
            {packs.map((pack) => (
              <li className="im__pack" key={pack.id}>
                <span>
                  {pack.name} · {pack.songs.length} 首
                </span>
                <button type="button" className="ui-btn ui-btn--ghost" onClick={() => handleRemove(pack.id)}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
