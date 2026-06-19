import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { Trophy, ChevronLeft, Lock } from 'lucide-react';
import { computeAchievements } from '../utils/achievements';

export default function Achievements() {
  const { state } = useApp();
  const nav = useNavigate();
  const { achievements, unlockedCount, total } = useMemo(
    () => computeAchievements(state),
    [state.glucoseReadings, state.meals]
  );

  const pct = Math.round((unlockedCount / total) * 100);

  return (
    <div className="page">
      <div className="page-header">
        <button className="btn-back" onClick={() => nav('/')} aria-label="返回首頁">
          <ChevronLeft size={20} />
        </button>
        <Trophy size={22} /> <h2>成就徽章</h2>
      </div>

      {/* Hero progress */}
      <div className="card ach-hero">
        <div className="ach-hero-emoji">🏅</div>
        <div className="ach-hero-body">
          <div className="ach-hero-count">{unlockedCount} <span>/ {total}</span></div>
          <div className="ach-hero-label">已解鎖徽章</div>
          <div className="ach-hero-bar">
            <div className="ach-hero-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <p className="ach-encourage">
        控糖是一場馬拉松，不是衝刺 🏃 每一個小進步都值得被看見。慢慢來，徽章會一個一個亮起來！
      </p>

      {/* Badge grid */}
      <div className="ach-grid">
        {achievements.map(a => (
          <div key={a.id} className={`ach-card ${a.unlocked ? 'ach-unlocked' : 'ach-locked'}`}>
            <div className="ach-badge">
              <span className="ach-emoji">{a.emoji}</span>
              {!a.unlocked && <span className="ach-lock"><Lock size={12} /></span>}
            </div>
            <div className="ach-name">{a.name}</div>
            <div className="ach-blurb">{a.blurb}</div>

            {a.unlocked ? (
              <div className="ach-tagline">{a.tagline}</div>
            ) : (
              <>
                <div className="ach-progress">
                  <div className="ach-progress-bar">
                    <div className="ach-progress-fill" style={{ width: `${a.pct}%` }} />
                  </div>
                  <span className="ach-progress-text">{a.progressText}</span>
                </div>
                <div className="ach-detail">{a.detail}</div>
              </>
            )}
            {a.unlocked && <div className="ach-ribbon">已達成 ✓</div>}
          </div>
        ))}
      </div>

      <div className="ach-foot">
        徽章依您的 LibreLink 血糖與飲食紀錄自動計算，僅作為鼓勵與自我追蹤，不構成醫療建議。
      </div>
    </div>
  );
}
