import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/shared/ui/Icon';
import './challenges.css';

/**
 * 小挑战入口（设计规范 §2.1 首页第 3 个一级入口）。
 *
 * 这里只做一件事：选一个挑战（§0.3 一次只解决一个决定）。
 * 因此是极简入口 —— 三个挑战，不做成列表、更不做成 Dashboard。
 */

interface ChallengeEntry {
  to: string;
  icon: IconName;
  title: string;
  desc: string;
}

const CHALLENGES: readonly ChallengeEntry[] = [
  {
    to: '/challenges/staff',
    icon: 'keyboard',
    title: '看谱找键',
    desc: '看看这个音在五线谱的哪里，找出对应的琴键',
  },
  {
    to: '/challenges/ear',
    icon: 'sound',
    title: '听音找键',
    desc: '听一个音，找出它在哪里',
  },
  {
    to: '/challenges/beat',
    icon: 'metronome',
    title: '节拍挑战',
    desc: '跟着咔声按琴键，看看能连对几下',
  },
];

export function ChallengesHomePage() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <header className="page__bar">
        <button type="button" className="ui-btn ui-btn--ghost" onClick={() => navigate('/')}>
          <Icon name="arrow-left" size={20} />
          返回
        </button>
        <h1 className="page__title">小挑战</h1>
      </header>

      <div className="page__body">
        <nav className="chl-home" aria-label="挑战列表">
          {CHALLENGES.map((entry) => (
            <Link key={entry.to} to={entry.to} className="chl-home__card">
              <Icon name={entry.icon} size={28} className="chl-home__icon" />
              <span className="chl-home__title">{entry.title}</span>
              <span className="chl-home__desc">{entry.desc}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
