import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProgressStore } from '@/core/progress/ProgressStore';
import { describeRange } from '@/features/piano/pianoLayout';
import { SONG_CATEGORIES, getSongsByCategory } from '@/features/songs/songData';
import { loadPackSongs } from '@/features/songs/packSongs';
import { resolveSong } from '@/features/songs/songResolver';
import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/utils/cx';
import './songs.css';

/** 曲目列表（文档 2.2 的第一步）：选一首歌开始练习。 */
export function SongListPage() {
  const navigate = useNavigate();
  const { progress, settings } = useProgressStore();
  const [category, setCategory] = useState<'all' | (typeof SONG_CATEGORIES)[number]['id']>('all');

  // 导入曲目（内容包）与内置曲库合成一份列表：内置在前，导入在后（AGENTS §16）
  const packSongs = useMemo(() => loadPackSongs(), []);
  const allSongs = useMemo(() => [...getSongsByCategory('all'), ...packSongs], [packSongs]);
  const songs = useMemo(
    () => (category === 'all' ? allSongs : allSongs.filter((song) => song.category === category)),
    [allSongs, category],
  );

  // 「我的曲目」这一格只在真的有导入曲目时才出现（不摆空分类）
  const categories = useMemo(
    () =>
      packSongs.length > 0
        ? [...SONG_CATEGORIES, { id: 'pack' as const, label: '我的曲目' }]
        : SONG_CATEGORIES,
    [packSongs.length],
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of SONG_CATEGORIES) {
      map.set(
        item.id,
        allSongs.filter((song) => song.category === item.id).length,
      );
    }
    map.set('pack', packSongs.length);
    return map;
  }, [allSongs, packSongs.length]);

  return (
    <div className="page">
      <header className="page__bar">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="page__title">选一首歌</h1>
        <span className="hud-btn hud-stars">
          <Icon name="star-filled" size={20} />
          <span>{progress.starsTotal}</span>
        </span>
      </header>

      <div className="page__body">
        <div className="songs__filters" role="group" aria-label="曲目分类">
          <button
            type="button"
            className={cx('songs__filter', category === 'all' && 'is-active')}
            onClick={() => setCategory('all')}
          >
            全部
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cx('songs__filter', category === item.id && 'is-active')}
              onClick={() => setCategory(item.id)}
            >
              {item.label}
              <span className="songs__filter-count">{counts.get(item.id) ?? 0}</span>
            </button>
          ))}
        </div>

        <p className="songs__hint">
          键盘是 <strong>{describeRange(settings.keyboardSize)}</strong>
          （{settings.keyboardSize} 键，与真实钢琴白键同宽）
        </p>

        <ul className="songs__list">
          {songs.map((song) => {
            const done = progress.completedSongIds.includes(song.id);
            const best = progress.bestAccuracyBySong[song.id];
            const resolved = resolveSong(song, settings.keyboardSize);

            return (
              <li key={song.id}>
                <button
                  type="button"
                  className={cx('song-card', done && 'is-done')}
                  onClick={() => navigate(`/practice/${song.id}`)}
                >
                  <span className="song-card__main">
                    <span className="song-card__title">
                      {done ? (
                        <Icon name="check" size={20} className="song-card__check" />
                      ) : null}
                      {song.title}
                    </span>
                    {song.subtitle ? (
                      <span className="song-card__subtitle">{song.subtitle}</span>
                    ) : null}
                    <span className="song-card__tags">
                      <span className="song-card__tag">{song.notes.length} 个音</span>
                      <span className="song-card__tag">
                        {Math.round(resolved.totalSeconds)} 秒
                      </span>
                      <span className="song-card__tag">{resolved.bpm} 拍/分</span>
                    </span>
                  </span>

                  <span className="song-card__meta">
                    <span
                      className="song-card__difficulty"
                      aria-label={`难度 ${song.difficulty} / 3`}
                    >
                      {[1, 2, 3].map((level) => (
                        <span
                          key={level}
                          className={cx('song-card__dot', level <= song.difficulty && 'is-on')}
                        />
                      ))}
                    </span>
                    {best !== undefined ? (
                      <span className="song-card__best">最好 {Math.round(best)}%</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="songs__footnote">
          每首歌只保留一份原始曲谱，弹的时候会自动把音放进这一个八度里。
        </p>
      </div>
    </div>
  );
}
