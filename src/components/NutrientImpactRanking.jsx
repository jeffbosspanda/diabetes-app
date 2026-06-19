import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { BarChart2 } from 'lucide-react';
import { computeFoodImpactRanking } from '../utils/foodImpactRanking';

const PERIODS = [
  { label: '7天',  days: 7  },
  { label: '30天', days: 30 },
  { label: '90天', days: 90 },
];

// Color ramp: high impact → red-orange, low impact → teal
function impactColor(ratio) {
  // ratio: 0–1 where 1 = max impact
  if (ratio >= 0.8) return '#ef4444';
  if (ratio >= 0.6) return '#f97316';
  if (ratio >= 0.4) return '#f59e0b';
  if (ratio >= 0.2) return '#22c55e';
  return '#0fb8a6';
}

export default function NutrientImpactRanking() {
  const { state } = useApp();
  const [days, setDays] = useState(30);

  const ranking = useMemo(
    () => computeFoodImpactRanking(state.glucoseReadings, state.meals, days),
    [state.glucoseReadings, state.meals, days]
  );

  const maxImpact = ranking[0]?.avgImpact || 1;

  return (
    <div className="card nir-card">
      <div className="nir-header">
        <div className="nir-title-row">
          <BarChart2 size={15} color="var(--accent)" />
          <h3>食物血糖影響排行</h3>
        </div>
        <div className="nir-period-tabs">
          {PERIODS.map(p => (
            <button
              key={p.days}
              className={`nir-tab ${days === p.days ? 'nir-tab-active' : ''}`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <p className="nir-desc">
        依各食物碳水占比分配該餐血糖衝擊，排除蛋白質、脂肪等低碳水食物的誤判，僅計算碳水貢獻造成的血糖上升幅度（mg/dL）。
      </p>

      {ranking.length === 0 ? (
        <div className="nir-empty">
          <BarChart2 size={28} color="var(--text-muted)" />
          <p>近 {days} 天資料不足</p>
          <span>需同時有飲食記錄及對應的飯後血糖數據才能計算</span>
        </div>
      ) : (
        <div className="nir-list">
          {ranking.map((item, i) => {
            const ratio = item.avgImpact / maxImpact;
            const color = impactColor(ratio);
            return (
              <div key={item.food} className="nir-row">
                <span className="nir-rank">{i + 1}</span>
                <span className="nir-food">{item.food}</span>
                <div className="nir-bar-wrap">
                  <div
                    className="nir-bar"
                    style={{ width: `${Math.round(ratio * 100)}%`, background: color }}
                  />
                </div>
                <span className="nir-val" style={{ color }}>+{item.avgImpact}</span>
                {item.count > 1 && (
                  <span className="nir-count">×{item.count}</span>
                )}
              </div>
            );
          })}
          <div className="nir-unit-note">單位：mg/dL 平均上升幅度</div>
        </div>
      )}
    </div>
  );
}
