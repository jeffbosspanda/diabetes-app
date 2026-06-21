import { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { Activity, Plus, AlertTriangle, TrendingUp } from 'lucide-react';
import { getBGStatus, analyzeGlycemicEvents, analyzeGlucoseExcursions } from '../utils/insulinCalculator';
import { analyzeGlucoseStats } from '../utils/glucoseStats';
import { analyzeSecondWave } from '../utils/secondWave';
import { computeCyclePhase, analyzeCycleGlucoseImpact, CYCLE_PHASE_META } from '../utils/cyclePhase';
import { format, subDays } from 'date-fns';

const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const fmtD = d => format(d, 'yyyy-MM-dd');

export default function GlucoseLog() {
  const { state, dispatch } = useApp();
  const [form, setForm] = useState({ value: '', mealContext: 'fasting', notes: '' });
  const [showForm, setShowForm] = useState(false);
  const [showAllExcursions, setShowAllExcursions] = useState(false);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const PREVIEW_N = 3;
  const todayStr = fmtD(new Date());
  const [fromDate, setFromDate] = useState(fmtD(subDays(new Date(), 7)));
  const [toDate, setToDate]     = useState(todayStr);
  const unit = state.settings.bgUnit;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleAdd = () => {
    if (!form.value) return;
    dispatch({
      type: 'ADD_GLUCOSE',
      payload: { value: parseFloat(form.value), mealContext: form.mealContext, notes: form.notes, timestamp: new Date().toISOString(), unit },
    });
    setForm({ value: '', mealContext: 'fasting', notes: '' });
    setShowForm(false);
  };

  // Selected window [from 00:00, to 23:59:59]
  const winLo = new Date(`${fromDate}T00:00:00`).getTime();
  const winHi = new Date(`${toDate}T23:59:59`).getTime();
  const applyPreset = (days) => { setFromDate(fmtD(subDays(new Date(), days))); setToDate(todayStr); };
  const activePreset = (days) => fromDate === fmtD(subDays(new Date(), days)) && toDate === todayStr;

  const filtered = state.glucoseReadings
    .filter(r => { const t = new Date(r.timestamp).getTime(); return t >= winLo && t <= winHi; })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Detailed glucose statistics (pre/post/late-night avgs + split low/high counts)
  const stats = useMemo(
    () => analyzeGlucoseStats(state.glucoseReadings, state.meals, { from: winLo, to: winHi }),
    [state.glucoseReadings, state.meals, winLo, winHi]
  );

  // Hypo / hyper event root-cause analysis
  const eventAnalysis = useMemo(
    () => analyzeGlycemicEvents(state.glucoseReadings, state.meals, state.insulinLogs, { from: winLo, to: winHi }),
    [state.glucoseReadings, state.meals, state.insulinLogs, winLo, winHi]
  );

  // 急速上升/下降 per-event root-cause analysis
  const excursionAnalysis = useMemo(
    () => analyzeGlucoseExcursions(state.glucoseReadings, state.meals, state.insulinLogs, { from: winLo, to: winHi }),
    [state.glucoseReadings, state.meals, state.insulinLogs, winLo, winHi]
  );

  // 餐後第二波升糖（2–4h 後再度上升）
  const secondWaveDays = Math.max(1, Math.ceil((Date.now() - winLo) / (24 * 3600 * 1000)));
  const secondWave = useMemo(
    () => analyzeSecondWave(state.meals, state.glucoseReadings, state.insulinLogs, { days: secondWaveDays }),
    [state.meals, state.glucoseReadings, state.insulinLogs, secondWaveDays]
  );
  const [showAllSecondWave, setShowAllSecondWave] = useState(false);

  // Menstrual cycle phase + personalized glucose impact (female users only).
  const isFemale = state.profile?.gender === 'female';
  const hasPeriodData = isFemale && !!state.profile?.lastPeriodStart;
  const cycleLen = parseInt(state.profile?.cycleLength) || 28;
  const cycle = useMemo(
    () => hasPeriodData ? computeCyclePhase(state.profile.lastPeriodStart, cycleLen) : null,
    [hasPeriodData, state.profile?.lastPeriodStart, cycleLen]
  );
  const cycleImpact = useMemo(
    () => hasPeriodData
      ? analyzeCycleGlucoseImpact(state.glucoseReadings, state.profile.lastPeriodStart, cycleLen)
      : null,
    [hasPeriodData, state.glucoseReadings, state.profile?.lastPeriodStart, cycleLen]
  );

  return (
    <div className="page">
      <div className="page-header">
        <Activity size={22} /> <h2>血糖紀錄</h2>
        <button className="btn-icon" onClick={() => setShowForm(s => !s)}><Plus size={20} /></button>
      </div>

      {showForm && (
        <div className="card form-card">
          <h3>新增血糖值</h3>
          <div className="form-grid">
            <div className="form-group">
              <label>血糖值 ({unit})</label>
              <input type="number" value={form.value} onChange={e => set('value', e.target.value)} placeholder={unit === 'mg/dL' ? '例: 120' : '例: 6.7'} autoFocus />
            </div>
            <div className="form-group">
              <label>測量時機</label>
              <select value={form.mealContext} onChange={e => set('mealContext', e.target.value)}>
                <option value="fasting">空腹/餐前</option>
                <option value="post-meal">餐後 2 小時</option>
                <option value="bedtime">睡前</option>
                <option value="night">半夜</option>
                <option value="other">其他</option>
              </select>
            </div>
          </div>
          {form.value && (
            <div className="bg-status" style={{ color: getBGStatus(parseFloat(form.value), unit).color }}>
              狀態：{getBGStatus(parseFloat(form.value), unit).label}
            </div>
          )}
          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="備註 (選填)" style={{ marginBottom: 8 }} />
          <div className="btn-row">
            <button className="btn-primary" onClick={handleAdd}>新增</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

      {/* Range selector: quick presets + custom date range */}
      <div className="range-tabs" style={{ marginBottom: 10 }}>
        {[7, 30, 90].map(d => (
          <button key={d} className={`range-tab ${activePreset(d) ? 'active' : ''}`} onClick={() => applyPreset(d)}>
            {d} 天
          </button>
        ))}
      </div>
      <div className="date-range-row">
        <input type="date" className="date-range-input" value={fromDate} max={toDate}
          onChange={e => e.target.value && setFromDate(e.target.value)} />
        <span className="date-range-sep">至</span>
        <input type="date" className="date-range-input" value={toDate} min={fromDate} max={todayStr}
          onChange={e => e.target.value && setToDate(e.target.value)} />
      </div>

      {/* Overall KPIs */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">平均血糖</div>
          <div className="stat-value">{stats.overallAvg ?? '-'}</div>
          <div className="stat-unit">{unit}</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#22c55e' }}>
          <div className="stat-label">達標率 TIR</div>
          <div className="stat-value" style={{ color: stats.tir >= 70 ? '#22c55e' : '#ef4444' }}>{stats.tir}%</div>
          <div className="stat-unit">70-180 {unit}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">讀數筆數</div>
          <div className="stat-value">{stats.readingCount}</div>
          <div className="stat-unit">筆</div>
        </div>
      </div>

      {/* Contextual averages */}
      <div className="stats-row">
        <div className="stat-card" style={{ borderColor: '#6366f1' }}>
          <div className="stat-label">飯前血糖平均</div>
          <div className="stat-value" style={{ color: '#6366f1' }}>{stats.preMealAvg ?? '-'}</div>
          <div className="stat-unit">n={stats.preMealN}・目標 80–130</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#f59e0b' }}>
          <div className="stat-label">飯後峰值平均</div>
          <div className="stat-value" style={{ color: '#f59e0b' }}>{stats.postMealPeakAvg ?? '-'}</div>
          <div className="stat-unit">n={stats.postMealPeakN}・目標 &lt;180</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#8b5cf6' }}>
          <div className="stat-label">深夜血糖平均</div>
          <div className="stat-value" style={{ color: '#8b5cf6' }}>{stats.lateNightAvg ?? '-'}</div>
          <div className="stat-unit">00–06・n={stats.lateNightN}</div>
        </div>
      </div>

      {/* Low / high split by pre / post meal */}
      <div className="card bg-split-card">
        <h3>低血糖 / 高血糖分布</h3>
        <table className="bg-split-table">
          <thead>
            <tr><th></th><th>飯前</th><th>飯後</th><th>其他</th><th>小計</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="bg-split-label low">低血糖 &lt;70</td>
              <td>{stats.counts.lowPre}</td>
              <td>{stats.counts.lowPost}</td>
              <td>{stats.counts.lowOther}</td>
              <td className="bg-split-total low">{stats.lowTotal}</td>
            </tr>
            <tr>
              <td className="bg-split-label high">高血糖 &gt;180</td>
              <td>{stats.counts.highPre}</td>
              <td>{stats.counts.highPost}</td>
              <td>{stats.counts.highOther}</td>
              <td className="bg-split-total high">{stats.highTotal}</td>
            </tr>
          </tbody>
        </table>
        <p className="hint" style={{ marginTop: 6 }}>
          飯前＝餐前 45 分鐘內；飯後＝用餐後 3 小時內；其他＝無鄰近餐食的時段。
        </p>
      </div>

      {/* Rate of change (rise / fall slopes) */}
      {(stats.slopes.riseN > 0 || stats.slopes.fallN > 0) && (
        <div className="card slope-card">
          <h3>血糖變化速率</h3>
          <div className="slope-grid">
            <div className="slope-item">
              <div className="slope-arrow up">↑</div>
              <div className="slope-val" style={{ color: '#f59e0b' }}>{stats.slopes.avgRise ?? '-'}</div>
              <div className="slope-label">平均上升斜率</div>
              <div className="slope-unit">mg/dL/分</div>
            </div>
            <div className="slope-item">
              <div className="slope-arrow down">↓</div>
              <div className="slope-val" style={{ color: '#6366f1' }}>{stats.slopes.avgFall ?? '-'}</div>
              <div className="slope-label">平均下降斜率</div>
              <div className="slope-unit">mg/dL/分</div>
            </div>
            <div className="slope-item">
              <div className="slope-arrow up">⤒</div>
              <div className="slope-val" style={{ color: '#ef4444' }}>{stats.slopes.maxRise ?? '-'}</div>
              <div className="slope-label">最大上升斜率</div>
              <div className="slope-unit">mg/dL/分</div>
            </div>
            <div className="slope-item">
              <div className="slope-arrow down">⤓</div>
              <div className="slope-val" style={{ color: '#ef4444' }}>{stats.slopes.maxFall ?? '-'}</div>
              <div className="slope-label">最大下降斜率</div>
              <div className="slope-unit">mg/dL/分</div>
            </div>
          </div>
          <div className="slope-steep">
            <span className="slope-steep-item">急速上升（≥2 mg/dL/分）<b style={{ color: '#f59e0b' }}>{stats.slopes.steepRise}</b> 次</span>
            <span className="slope-steep-item">急速下降（≥2 mg/dL/分）<b style={{ color: '#ef4444' }}>{stats.slopes.steepFall}</b> 次</span>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            斜率由間隔 30 分鐘內的連續血糖值計算（共 {stats.slopes.riseN + stats.slopes.fallN} 段）。
            上升過快多與高GI食物或餐前胰島素不足有關；下降過快需注意低血糖風險。
          </p>
        </div>
      )}

      {/* 急速上升 / 下降 原因分析 */}
      {excursionAnalysis.excursions.length > 0 && (
        <div className="card event-analysis-card">
          <div className="ea-header">
            <TrendingUp size={16} color="var(--accent2)" />
            <h3>急速升降原因分析</h3>
            <span className="ea-period">
              近 {excursionAnalysis.summary.days} 天 · 急升 {excursionAnalysis.summary.riseCount} · 急降 {excursionAnalysis.summary.fallCount}
            </span>
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>
            系統找出每段血糖急速變化（≥2 mg/dL/分、變化 ≥30 mg/dL），依事件前的飲食、速效/短效注射與運動推測原因，僅供參考。
          </p>

          {(showAllExcursions ? excursionAnalysis.excursions : excursionAnalysis.excursions.slice(0, PREVIEW_N)).map((ex, i) => {
            const isRise = ex.dir === 'rise';
            return (
              <div key={i} className={`ea-event ea-${isRise ? 'hyper' : 'hypo'}`}>
                <div className="ea-event-top">
                  <span className={`ea-badge ${isRise ? 'ea-badge-high' : 'ea-badge-low'}`}>
                    {isRise ? '急速上升' : '急速下降'} {ex.fromBG}→{ex.toBG} mg/dL（{ex.delta > 0 ? '+' : ''}{ex.delta}）
                  </span>
                  <span className="ea-time">{format(new Date(ex.startT), 'MM/dd HH:mm')}</span>
                  <span className="ea-dur">{ex.durationMin} 分鐘 · 峰值 {ex.maxRate} mg/dL/分</span>
                </div>

                <div className="ea-context">
                  事件前 3 小時：碳水 {ex.context.carbs}g · 餐前胰島素 {ex.context.bolusUnits}U
                  {ex.context.lastLong && ` · 長效 ${ex.context.lastLong.units}U`}
                </div>

                <div className="ea-causes">
                  {ex.causes.map((c, j) => (
                    <div key={j} className="ea-cause">
                      <span className="ea-cause-label">{c.label}</span>
                      <span className="ea-cause-detail">{c.detail}</span>
                    </div>
                  ))}
                </div>

                {ex.suggestions.length > 0 && (
                  <div className="ea-suggestions">
                    {ex.suggestions.map((s, j) => (
                      <div key={j} className="ea-suggestion">💡 {s}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {excursionAnalysis.excursions.length > PREVIEW_N && (
            <button className="btn-secondary full-width" style={{ marginTop: 4 }}
              onClick={() => setShowAllExcursions(v => !v)}>
              {showAllExcursions ? '收合' : `顯示更多（共 ${excursionAnalysis.excursions.length} 筆）`}
            </button>
          )}

          <div className="basal-disclaimer" style={{ marginTop: 8 }}>
            以上為系統自動分析，任何劑量調整請先諮詢醫師或衛教師。
          </div>
        </div>
      )}

      {/* Hypo / hyper event analysis */}
      {eventAnalysis.summary && (eventAnalysis.events.length > 0) && (
        <div className="card event-analysis-card">
          <div className="ea-header">
            <AlertTriangle size={16} color="var(--accent2)" />
            <h3>血糖事件原因分析</h3>
            <span className="ea-period">
              近 {eventAnalysis.summary.days} 天 · 低 {eventAnalysis.summary.hypoCount} · 高 {eventAnalysis.summary.hyperCount}
            </span>
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>
            系統依事件前的飲食、長/短效注射劑量與時間推測可能原因，僅供參考。
          </p>

          {(showAllEvents ? eventAnalysis.events : eventAnalysis.events.slice(0, PREVIEW_N)).map((ev, i) => {
            const isHypo = ev.kind === 'hypo';
            return (
              <div key={i} className={`ea-event ea-${ev.kind}`}>
                <div className="ea-event-top">
                  <span className={`ea-badge ${isHypo ? 'ea-badge-low' : 'ea-badge-high'}`}>
                    {isHypo ? '低血糖' : '高血糖'} {ev.extreme} mg/dL
                  </span>
                  <span className="ea-time">{format(new Date(ev.startT), 'MM/dd HH:mm')}</span>
                  {ev.durationMin > 0 && <span className="ea-dur">持續約 {ev.durationMin} 分鐘</span>}
                </div>

                <div className="ea-context">
                  事件前 5 小時：碳水 {ev.context.carbs}g · 餐前胰島素 {ev.context.rapidUnits}U
                  {ev.context.lastLong && ` · 長效 ${ev.context.lastLong.units}U`}
                </div>

                <div className="ea-causes">
                  {ev.causes.map((c, j) => (
                    <div key={j} className="ea-cause">
                      <span className="ea-cause-label">{c.label}</span>
                      <span className="ea-cause-detail">{c.detail}</span>
                    </div>
                  ))}
                </div>

                {ev.suggestions.length > 0 && (
                  <div className="ea-suggestions">
                    {ev.suggestions.map((s, j) => (
                      <div key={j} className="ea-suggestion">💡 {s}</div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {eventAnalysis.events.length > PREVIEW_N && (
            <button className="btn-secondary full-width" style={{ marginTop: 4 }}
              onClick={() => setShowAllEvents(v => !v)}>
              {showAllEvents ? '收合' : `顯示更多（共 ${eventAnalysis.events.length} 筆）`}
            </button>
          )}

          <div className="basal-disclaimer" style={{ marginTop: 8 }}>
            以上為系統自動分析，任何劑量調整請先諮詢醫師或衛教師。
          </div>
        </div>
      )}

      {/* 餐後第二波升糖分析 */}
      {secondWave.events.length > 0 && (
        <div className="card event-analysis-card">
          <div className="ea-header">
            <TrendingUp size={16} color="var(--accent2)" />
            <h3>餐後第二波升糖分析</h3>
            <span className="ea-period">
              近 {secondWave.summary.days} 天 · {secondWave.summary.count}/{secondWave.summary.examined} 餐
            </span>
          </div>
          <p className="hint" style={{ marginBottom: 10 }}>
            有些餐點血糖不是餐後立刻上升，而是 2–4 小時後出現第二波（常見於高脂高蛋白餐）。系統從實際血糖偵測這類延遲升糖，僅供參考。
          </p>

          {(showAllSecondWave ? secondWave.events : secondWave.events.slice(0, PREVIEW_N)).map((ev, i) => (
            <div key={i} className="ea-event ea-hyper">
              <div className="ea-event-top">
                <span className="ea-badge ea-badge-high">
                  第二波 +{ev.rise2} mg/dL（峰值 {ev.latePeak}）
                </span>
                <span className="ea-time">{format(new Date(ev.timestamp), 'MM/dd HH:mm')}</span>
                <span className="ea-dur">餐後 {ev.latePeakMin} 分鐘達峰 · {ev.glycemicLabel}</span>
              </div>
              {ev.foods && <div className="ea-context">餐點：{ev.foods.slice(0, 28)}{ev.foods.length > 28 ? '…' : ''}</div>}
              <div className="ea-context">
                餐前 {ev.baseline}
                {ev.earlyPeak != null && ` · 前段峰 ${ev.earlyPeak}（${ev.earlyPeakMin}分）`}
                {ev.troughBG != null && ` · 回落 ${ev.troughBG}`}
                {` · 第二波峰 ${ev.latePeak}（${ev.latePeakMin}分）`}
              </div>
              <div className="ea-causes">
                {ev.causes.map((c, j) => (
                  <div key={j} className="ea-cause"><span className="ea-cause-detail">{c}</span></div>
                ))}
              </div>
              {ev.suggestions.length > 0 && (
                <div className="ea-suggestions">
                  {ev.suggestions.map((sg, j) => <div key={j} className="ea-suggestion">💡 {sg}</div>)}
                </div>
              )}
            </div>
          ))}

          {secondWave.events.length > PREVIEW_N && (
            <button className="btn-secondary full-width" style={{ marginTop: 4 }}
              onClick={() => setShowAllSecondWave(v => !v)}>
              {showAllSecondWave ? '收合' : `顯示更多（共 ${secondWave.events.length} 筆）`}
            </button>
          )}

          <div className="basal-disclaimer" style={{ marginTop: 8 }}>
            以上為系統自動分析，任何劑量或注射方式調整請先諮詢醫師或衛教師。
          </div>
        </div>
      )}

      {eventAnalysis.summary && eventAnalysis.events.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          <TrendingUp size={16} style={{ margin: '0 auto 6px' }} />
          <div>近 {eventAnalysis.summary.days} 天無低血糖或高血糖事件，血糖控制良好 👍</div>
        </div>
      )}

      {/* ── Menstrual cycle BG impact (female users) ── */}
      {cycle && (
        <div className={`card cycle-card cycle-${cycle.level}`}>
          <div className="cycle-head">
            <span className="cycle-flower">🌸</span>
            <span className="cycle-phase">{cycle.label}</span>
            <span className="cycle-day">週期第 {cycle.day} 天</span>
            <span className={`cycle-trend cycle-trend-${cycle.bgTrend}`}>
              {cycle.bgTrend === 'rising' ? '血糖易偏高 ↑' : cycle.bgTrend === 'falling' ? '血糖易偏低 ↓' : '血糖較平穩 →'}
            </span>
          </div>
          <div className="cycle-note">{cycle.note}</div>

          {/* Per-phase avg from user's own readings */}
          {cycleImpact?.hasData && (() => {
            const shown = cycleImpact.phases.filter(p => p.enough);
            const maxAvg = Math.max(...shown.map(p => p.avg));
            return (
              <div className="cycle-impact">
                <div className="cycle-impact-title">📊 你各階段的平均血糖</div>
                <div className="cycle-bars">
                  {shown.map(p => (
                    <div key={p.key} className={`cycle-bar-row ${p.key === cycle.phase ? 'cur' : ''}`}>
                      <span className="cycle-bar-label">{p.short}</span>
                      <div className="cycle-bar-track">
                        <div className="cycle-bar-fill" style={{ width: `${Math.round(p.avg / maxAvg * 100)}%`, background: p.color }} />
                      </div>
                      <span className="cycle-bar-val">{p.avg} <span className="cycle-bar-unit">mg/dL</span></span>
                      {p.hypoPct >= 10 && <span className="cycle-bar-hypo">低血糖 {p.hypoPct}%</span>}
                    </div>
                  ))}
                </div>
                {cycleImpact.insights.map((ins, i) => (
                  <div key={i} className={`cycle-insight cycle-insight-${ins.level}`}>{ins.text}</div>
                ))}
              </div>
            );
          })()}

          {cycleImpact && !cycleImpact.enoughForCompare && (
            <div className="cycle-impact-hint">
              持續記錄血糖後，系統將分析你各週期階段的個人血糖型態（需每個階段至少 8 筆讀數）。
            </div>
          )}

          <div className="cycle-meta">距下次經期約 {cycle.daysToNextPeriod} 天</div>
          <div className="basal-disclaimer" style={{ marginTop: 4 }}>
            月經週期對血糖的影響因人而異，任何劑量調整請先諮詢醫師或衛教師。
          </div>
        </div>
      )}

      {/* Female user but no period data set */}
      {isFemale && !hasPeriodData && (
        <div className="card" style={{ borderLeft: '3px solid #ef6c8e', paddingLeft: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span>🌸</span>
            <strong style={{ fontSize: 14 }}>月經週期血糖分析</strong>
          </div>
          <p className="hint">在「個人資料」設定上次月經開始日期後，系統將分析月經週期（濾泡期／黃體期／月經期）對你血糖的影響。</p>
        </div>
      )}

      {/* Recent readings */}
      <div className="card">
        <h3>最近紀錄</h3>
        {filtered.slice(-15).reverse().map((r, i) => {
          const status = getBGStatus(r.value, r.unit || unit);
          return (
            <div key={i} className="log-row">
              <div className="log-time">{format(new Date(r.timestamp), 'MM/dd HH:mm')}</div>
              <div className="log-value" style={{ color: status.color }}>{r.value} {unit}</div>
              <div className="log-tag">{r.mealContext}</div>
              <div className="log-status" style={{ color: status.color }}>{status.label}</div>
            </div>
          );
        })}
        {filtered.length === 0 && <div className="empty-state">此期間無紀錄</div>}
      </div>
    </div>
  );
}
