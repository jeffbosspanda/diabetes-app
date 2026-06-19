import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  Activity, Utensils, Syringe, User, AlertCircle, TrendingUp,
  ChevronRight, ChevronLeft, Sun, Zap, Lightbulb, Navigation, Sparkles, ArrowUpRight, Trophy,
} from 'lucide-react';
import {
  ComposedChart, Line, ReferenceLine, ReferenceArea, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Area,
} from 'recharts';
import {
  checkDataSufficiency, getBGStatus, calculateTDD,
  deriveICRandISF, estimateTDDFromWeight,
} from '../utils/insulinCalculator';
import { computeDailySummary } from '../utils/dailySummary';
import { predictBG30 } from '../utils/bgPredictor';
import { computeMealPatternInsights } from '../utils/mealPatternInsights';
import { computeAchievements } from '../utils/achievements';
import { computeCyclePhase, analyzeCycleGlucoseImpact } from '../utils/cyclePhase';
import { format, subHours, subDays } from 'date-fns';

// ── High-contrast palette ───────────────────────────────────────────────────
// Meals are ALL blue (regardless of type); insulin & BG use distinct hues.
const MEAL_COLOR  = '#2563eb'; // all meals → blue
const RAPID_COLOR = '#f97316'; // 速效 rapid analog → orange
const SHORT_COLOR = '#0ea5e9'; // 短效 Regular → sky blue
const LONG_COLOR  = '#a855f7'; // 長效 long-acting → purple
const insulinColor = (bt) => (bt === 'long' ? LONG_COLOR : bt === 'short' ? SHORT_COLOR : RAPID_COLOR);
const insulinTypeLabel = (bt) => (bt === 'long' ? '長效' : bt === 'short' ? '短效' : '速效');
const BG_COLOR    = '#0e9488'; // BG line → teal (high contrast on warm-white)

// per-type lookup kept for labels only; every type maps to the same blue
const MEAL_COLORS = { breakfast: MEAL_COLOR, lunch: MEAL_COLOR, dinner: MEAL_COLOR, lateSnack: MEAL_COLOR, snack: MEAL_COLOR };
const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜', snack: '點心' };

// Qualitative influence label — direction + coarse magnitude (no precise number,
// since the underlying estimate isn't precise enough to show as mg/dL).
function influence(n) {
  const a = Math.abs(n);
  if (a < 3) return '影響小';
  const word = a < 12 ? '中等' : '明顯';
  return n > 0 ? `↑ ${word}` : `↓ ${word}`;
}

// ── Custom BG dot: red if low, amber if high, BG colour otherwise ───────────
function BGDot(props) {
  const { cx, cy, payload } = props;
  if (!payload?.v) return null;
  const color = payload.v < 70 ? '#ef4444' : payload.v > 180 ? '#f59e0b' : BG_COLOR;
  return <circle cx={cx} cy={cy} r={3.5} fill={color} stroke="#ffffff" strokeWidth={1} />;
}

// ── Custom timeline tooltip ─────────────────────────────────────────────────
function TimelineTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="timeline-tooltip">
      <div className="tt-time">{format(new Date(d.ts), 'HH:mm')}</div>
      {d.v !== undefined && (
        <div className="tt-bg" style={{ color: d.v < 70 ? '#ef4444' : d.v > 180 ? '#f97316' : '#22c55e' }}>
          {d.v} mg/dL
        </div>
      )}
    </div>
  );
}

// ── HTML marker strip (above chart, no SVG coordinate system issues) ─────────
// CHART_L = left offset of chart drawing area = YAxis width + left-margin offset
const CHART_L = 24; // 34px YAxis width + (-10) left margin
const CHART_R = 12; // right margin

// Lane height per stacked row, and the minimum horizontal gap (% of plot width)
// two chips must keep before they're considered overlapping.
const LANE_H = 26;
const MIN_GAP_PCT = 8;
const MAX_LANES = 3;

function EventMarkerStrip({ events, windowStart, windowEnd }) {
  const span = windowEnd - windowStart;
  const pct = (ts) => Math.max(0, Math.min(100, (ts - windowStart) / span * 100));

  // Assign each chip to a lane so time-adjacent markers stack vertically instead
  // of overprinting each other. Greedy first-fit by ascending time.
  const sorted = [...events]
    .map(ev => ({ ev, p: pct(new Date(ev.timestamp).getTime()) }))
    .sort((a, b) => a.p - b.p);
  const laneLastX = []; // last placed x% per lane
  const placed = sorted.map(item => {
    let lane = laneLastX.findIndex(x => item.p - x >= MIN_GAP_PCT);
    if (lane === -1) {
      if (laneLastX.length < MAX_LANES) { lane = laneLastX.length; laneLastX.push(item.p); }
      else { // out of lanes — reuse the lane whose last marker is furthest left
        lane = laneLastX.indexOf(Math.min(...laneLastX));
        laneLastX[lane] = item.p;
      }
    } else {
      laneLastX[lane] = item.p;
    }
    return { ...item, lane };
  });
  const laneCount = Math.max(1, laneLastX.length);

  return (
    <div className="marker-strip" style={{ position: 'relative', height: laneCount * LANE_H, marginBottom: 0 }}>
      {placed.map(({ ev, p, lane }, i) => {
        const isMeal = ev._type === 'meal';
        const color = isMeal ? MEAL_COLOR : insulinColor(ev.brandType);
        const label = isMeal
          ? (MEAL_LABELS[ev.mealType] || '餐')[0]
          : `${ev.units}U`;
        return (
          <div key={i} className="ev-chip" style={{
            left: `calc(${CHART_L}px + (100% - ${CHART_L + CHART_R}px) * ${p / 100})`,
            top: lane * LANE_H,
          }}>
            {isMeal ? (
              <div className="ev-chip-circle" style={{ background: color }}>{label}</div>
            ) : (
              <div className="ev-chip-tri" style={{ color }}>
                <svg width="12" height="10" viewBox="0 0 12 10">
                  <polygon points="6,0 0,10 12,10" fill={color} opacity={0.9} />
                </svg>
                <span>{label}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const { state } = useApp();
  const nav = useNavigate();

  const insufficiencies = useMemo(() => checkDataSufficiency(state), [state]);

  const latestBG = useMemo(() =>
    state.glucoseReadings.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0],
    [state.glucoseReadings]
  );
  const bgStatus = latestBG ? getBGStatus(latestBG.value, latestBG.unit || state.settings.bgUnit) : null;

  const tdd = useMemo(() => {
    const fromLogs = calculateTDD(state.insulinLogs);
    if (fromLogs) return fromLogs;
    return estimateTDDFromWeight(state.profile?.weight) ?? 40;
  }, [state.insulinLogs, state.profile]);

  const { icr, isf } = useMemo(() => deriveICRandISF(tdd, state.settings.bgUnit), [tdd, state.settings.bgUnit]);

  const tir7d = useMemo(() => {
    const r7 = state.glucoseReadings.filter(r => new Date(r.timestamp) > subDays(new Date(), 7));
    if (!r7.length) return null;
    return Math.round(r7.filter(r => r.value >= 70 && r.value <= 180).length / r7.length * 100);
  }, [state.glucoseReadings]);

  const todayInsulin = useMemo(() =>
    state.insulinLogs
      .filter(l => new Date(l.timestamp).toDateString() === new Date().toDateString())
      .reduce((s, l) => s + (l.units || 0), 0),
    [state.insulinLogs]
  );

  // ── Day-window timeline data ──────────────────────────────────────────────
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [selDay, setSelDay] = useState(todayStr);
  const [slideDir, setSlideDir] = useState('from-right');
  const isToday = selDay === todayStr;

  const winLo = new Date(`${selDay}T00:00:00`).getTime();
  const winHi = isToday ? Date.now() : winLo + 24 * 3600 * 1000;
  const inWin = ts => ts >= winLo && ts <= winHi;

  const goToDay = (next) => {
    if (next > todayStr || next === selDay) return; // no future / no-op
    setSlideDir(next > selDay ? 'from-right' : 'from-left'); // later day enters from right
    setSelDay(next);
  };
  const shiftDay = (delta) => {
    const d = new Date(`${selDay}T00:00:00`);
    d.setDate(d.getDate() + delta);
    goToDay(format(d, 'yyyy-MM-dd'));
  };

  const bgPoints = useMemo(() =>
    state.glucoseReadings
      .filter(r => inWin(new Date(r.timestamp).getTime()))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(r => ({ ts: new Date(r.timestamp).getTime(), v: r.value })),
    [state.glucoseReadings, selDay]
  );

  const mealEvents = useMemo(() =>
    state.meals.filter(m => inWin(new Date(m.timestamp).getTime())),
    [state.meals, selDay]
  );

  const insulinEvents = useMemo(() =>
    state.insulinLogs.filter(l => inWin(new Date(l.timestamp).getTime())),
    [state.insulinLogs, selDay]
  );

  const hasTimeline = bgPoints.length > 0;

  const dailySummary = useMemo(
    () => computeDailySummary(state.glucoseReadings, state.meals, state.settings, selDay),
    [state.glucoseReadings, state.meals, state.settings, selDay]
  );

  const bgPrediction = useMemo(
    () => predictBG30(state.glucoseReadings, state.meals, state.insulinLogs, icr, isf),
    [state.glucoseReadings, state.meals, state.insulinLogs, icr, isf]
  );

  const mealInsight = useMemo(
    () => computeMealPatternInsights(state.glucoseReadings, state.meals, 14),
    [state.glucoseReadings, state.meals]
  );

  const achievements = useMemo(
    () => computeAchievements(state),
    [state.glucoseReadings, state.meals]
  );

  // Menstrual-cycle phase (female users who logged their period).
  const cycle = useMemo(() => {
    if (state.profile?.gender !== 'female') return null;
    return computeCyclePhase(state.profile?.lastPeriodStart, parseInt(state.profile?.cycleLength) || 28);
  }, [state.profile]);

  // Personalized cycle→glucose impact from the user's own readings.
  const cycleImpact = useMemo(() => {
    if (state.profile?.gender !== 'female' || !state.profile?.lastPeriodStart) return null;
    return analyzeCycleGlucoseImpact(
      state.glucoseReadings, state.profile.lastPeriodStart, parseInt(state.profile?.cycleLength) || 28
    );
  }, [state.profile, state.glucoseReadings]);

  // x-axis pinned to the selected day; explicit ticks force the full range
  const xDomain = useMemo(() => [winLo, winHi], [selDay]);
  const xTicks = useMemo(() => {
    const [start, end] = xDomain;
    const step = (end - start) / 6;
    return Array.from({ length: 7 }, (_, i) => Math.round(start + step * i));
  }, [xDomain]);

  // y-axis domain
  const allBGValues = bgPoints.map(p => p.v);
  const yMin = allBGValues.length ? Math.max(40, Math.min(...allBGValues) - 20) : 60;
  const yMax = allBGValues.length ? Math.min(350, Math.max(...allBGValues) + 30) : 300;

  return (
    <div className="page">
      {/* Header */}
      <div className="dashboard-top">
        <div>
          <h2>歡迎{state.profile?.name ? `，${state.profile.name}` : ''}！</h2>
          <p className="date-label">{format(new Date(), 'yyyy年M月d日')}</p>
        </div>
        <button className="btn-icon" onClick={() => nav('/profile')}><User size={20} /></button>
      </div>

      {/* Data alert */}
      {insufficiencies.length > 0 && (
        <div className="alert alert-warning clickable" onClick={() => nav('/profile')}>
          <AlertCircle size={16} />
          <span>尚缺 {insufficiencies.length} 項資料，系統使用估算值。點此完善資料。</span>
        </div>
      )}

      {/* ── Latest BG chip ── */}
      <div className="card bg-chip-row" onClick={() => nav('/glucose')} style={{ cursor: 'pointer' }}>
        <div>
          <div className="bg-label">最新血糖</div>
          {latestBG ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <div className="bg-value" style={{ color: bgStatus?.color }}>{latestBG.value}</div>
              <span className="bg-unit">{state.settings.bgUnit}</span>
              <span className="bg-status-badge" style={{ background: bgStatus?.color }}>{bgStatus?.label}</span>
              <span className="bg-time">{format(new Date(latestBG.timestamp), 'HH:mm')}</span>
            </div>
          ) : (
            <div className="empty-stat">尚無血糖資料 →</div>
          )}
        </div>
        <ChevronRight size={16} color="var(--text-secondary)" />
      </div>

      {/* ── 30-min BG Prediction ── */}
      {bgPrediction && bgPrediction.status !== 'ok' && (
        <div className="card bgp-card bgp-card-idle">
          <div className="bgp-idle-head">
            <Navigation size={13} color="var(--text-muted)" />
            <span className="bgp-idle-title">30 分鐘後血糖預測</span>
          </div>
          <div className="bgp-idle-msg">
            <AlertCircle size={14} />
            <span>需要最新血糖數據才可進行預測</span>
          </div>
          <div className="bgp-idle-sub">
            {bgPrediction.status === 'insufficient'
              ? '近 1 小時內血糖讀數不足（至少需 2 筆）'
              : bgPrediction.minsSinceLast != null
                ? `最近一筆血糖為 ${bgPrediction.minsSinceLast} 分鐘前${bgPrediction.lastValue != null ? `（${bgPrediction.lastValue} mg/dL）` : ''}，需 15 分鐘內的數據`
                : '尚無血糖資料，請先同步 FreeStyle Libre'}
          </div>
          <button className="btn-secondary bgp-idle-btn" onClick={() => nav('/glucose')}>
            同步 LibreLink →
          </button>
        </div>
      )}

      {bgPrediction && bgPrediction.status === 'ok' && (
        <div className={`card bgp-card ${bgPrediction.warning ? `bgp-${bgPrediction.warning.level}` : ''}`}>
          {/* Top row: trend + predicted value */}
          <div className="bgp-row">
            <div className="bgp-trend">
              <Navigation size={13} color="var(--accent)" />
              <span className="bgp-trend-label">趨勢</span>
              <span className={`bgp-arrow bgp-dir-${bgPrediction.dir}`}>{bgPrediction.arrow}</span>
              <span className="bgp-trend-text">{bgPrediction.trendLabel}</span>
              <span className="bgp-slope">({bgPrediction.slope > 0 ? '+' : ''}{bgPrediction.slope} mg/dL/min)</span>
            </div>
            <div className="bgp-predict">
              <span className="bgp-predict-label">30 分後預測</span>
              <span className="bgp-predict-cat" style={{ color: bgPrediction.predictedCategory.color }}>
                {bgPrediction.predictedCategory.label}
              </span>
            </div>
          </div>

          {/* Contribution breakdown — qualitative direction (avoids false precision) */}
          <div className="bgp-breakdown">
            <span className="bgp-bk-item">
              <span className="bgp-bk-dot bgp-bk-trend" />
              趨勢 {influence(bgPrediction.trendContrib)}
            </span>
            {bgPrediction.mealContrib !== 0 && (
              <span className="bgp-bk-item">
                <span className="bgp-bk-dot bgp-bk-meal" />
                飲食 {influence(bgPrediction.mealContrib)}
              </span>
            )}
            {bgPrediction.insulinContrib !== 0 && (
              <span className="bgp-bk-item">
                <span className="bgp-bk-dot bgp-bk-insulin" />
                胰島素 {influence(bgPrediction.insulinContrib)}
              </span>
            )}
          </div>

          {/* Active context chips */}
          {(bgPrediction.activeMeals.length > 0 || bgPrediction.activeRapid.length > 0 || bgPrediction.longActingNote) && (
            <div className="bgp-context">
              {bgPrediction.activeMeals.map((m, i) => (
                <span key={i} className="bgp-chip bgp-chip-meal">
                  🍽 {m.foods?.slice(0, 12)}{m.foods?.length > 12 ? '…' : ''} 剩餘 {m.remaining}g 醣
                  {m.glycemic ? ` · ${m.glycemic}` : ''}
                </span>
              ))}
              {bgPrediction.activeRapid.map((r, i) => (
                <span key={i} className="bgp-chip bgp-chip-insulin">
                  💉 {r.brand} {r.units}U · {r.minsAgo} 分鐘前
                </span>
              ))}
              {bgPrediction.longActingNote && (
                <span className="bgp-chip bgp-chip-long">{bgPrediction.longActingNote}</span>
              )}
            </div>
          )}

          {/* Warning */}
          {bgPrediction.warning && (
            <div className={`bgp-warning bgp-warning-${bgPrediction.warning.level}`}>
              {bgPrediction.warning.msg}
            </div>
          )}
        </div>
      )}

      {/* ── Menstrual cycle phase (female) ── */}
      {cycle && (
        <div className={`card cycle-card cycle-${cycle.level}`} onClick={() => nav('/profile')} style={{ cursor: 'pointer' }}>
          <div className="cycle-head">
            <span className="cycle-flower">🌸</span>
            <span className="cycle-phase">{cycle.label}</span>
            <span className="cycle-day">週期第 {cycle.day} 天</span>
            <span className={`cycle-trend cycle-trend-${cycle.bgTrend}`}>
              {cycle.bgTrend === 'rising' ? '血糖易偏高 ↑' : cycle.bgTrend === 'falling' ? '血糖易偏低 ↓' : '血糖較平穩 →'}
            </span>
          </div>
          <div className="cycle-note">{cycle.note}</div>

          {/* Personalized: the user's own avg BG per phase — makes the effect tangible */}
          {cycleImpact?.hasData && (() => {
            const shown = cycleImpact.phases.filter(p => p.enough);
            const maxAvg = Math.max(...shown.map(p => p.avg), 1);
            return (
              <div className="cycle-impact" onClick={(e) => e.stopPropagation()}>
                <div className="cycle-impact-title">📊 你各階段的平均血糖</div>
                <div className="cycle-bars">
                  {shown.map(p => (
                    <div key={p.key} className={`cycle-bar-row ${p.key === cycle.phase ? 'cur' : ''}`}>
                      <span className="cb-label" style={{ color: p.color }}>{p.short}</span>
                      <span className="cb-track">
                        <span className="cb-fill" style={{ width: `${Math.round(p.avg / maxAvg * 100)}%`, background: p.color }} />
                      </span>
                      <span className="cb-val">{p.avg}<small> mg/dL</small></span>
                    </div>
                  ))}
                </div>
                {cycleImpact.insights.map((ins, i) => (
                  <div key={i} className={`cycle-insight cycle-insight-${ins.level}`}>{ins.text}</div>
                ))}
              </div>
            );
          })()}

          {/* Not enough data yet → tell them what unlocks the personal comparison */}
          {cycleImpact && !cycleImpact.enoughForCompare && (
            <div className="cycle-impact-hint" onClick={(e) => e.stopPropagation()}>
              持續記錄滿一個完整週期，系統就會用「你自己的血糖」對比各階段，讓你親眼看見生理期對血糖的影響。
            </div>
          )}

          <div className="cycle-meta">距下次經期約 {cycle.daysToNextPeriod} 天 · 點此更新經期</div>
        </div>
      )}

      {/* ── Day Timeline ── */}
      <div className="card timeline-card">
        <div className="timeline-header">
          <h3>{isToday ? '今日' : format(new Date(`${selDay}T00:00:00`), 'M/d')} 血糖 · 飲食 · 注射</h3>
          <div className="timeline-legend">
            <span className="legend-dot" style={{ background: BG_COLOR }} />BG
            <span className="legend-dot" style={{ background: MEAL_COLOR }} />餐
            <span className="legend-dot" style={{ background: RAPID_COLOR }} />速效
            <span className="legend-dot" style={{ background: SHORT_COLOR }} />短效
            <span className="legend-dot" style={{ background: LONG_COLOR }} />長效
          </div>
        </div>

        {/* Day navigator */}
        <div className="day-nav">
          <button className="day-nav-btn" onClick={() => shiftDay(-1)} aria-label="前一天"><ChevronLeft size={16} /></button>
          <input type="date" className="day-nav-date" value={selDay} max={todayStr}
            onChange={e => e.target.value && goToDay(e.target.value)} />
          <button className="day-nav-btn" onClick={() => shiftDay(1)} disabled={isToday} aria-label="後一天"><ChevronRight size={16} /></button>
          {!isToday && <button className="day-nav-today" onClick={() => goToDay(todayStr)}>今天</button>}
        </div>

        {/* Sliding day content (re-keyed per day to replay the slide animation) */}
        <div className={`day-slide ${slideDir}`} key={selDay}>
        {hasTimeline ? (
          <>
            {/* HTML marker strip — positioned above chart, aligned to chart drawing area */}
            <EventMarkerStrip
              events={[
                ...mealEvents.map(m => ({ ...m, _type: 'meal' })),
                ...insulinEvents.map(l => ({ ...l, _type: 'insulin' })),
              ]}
              windowStart={xDomain[0]}
              windowEnd={xDomain[1]}
            />

            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={bgPoints} margin={{ top: 8, right: 12, bottom: 4, left: -10 }}>
                <defs>
                  <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={BG_COLOR} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={BG_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,90,82,0.10)" />
                <XAxis
                  dataKey="ts"
                  type="number"
                  scale="time"
                  domain={xDomain}
                  ticks={xTicks}
                  allowDataOverflow
                  tickFormatter={ts => format(new Date(ts), 'HH:mm')}
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  width={34}
                />
                <Tooltip content={<TimelineTooltip />} />

                {/* Target zone */}
                <ReferenceArea y1={70} y2={180} fill="#22c55e" fillOpacity={0.08} />
                <ReferenceLine y={70}  stroke="#ef4444" strokeDasharray="5 4" strokeWidth={1.5} />
                <ReferenceLine y={180} stroke="#f59e0b" strokeDasharray="5 4" strokeWidth={1.5} />

                {/* BG area */}
                <Area
                  type="monotone" dataKey="v"
                  stroke={BG_COLOR} strokeWidth={2.6}
                  fill="url(#bgGrad)"
                  dot={<BGDot />}
                  activeDot={{ r: 5 }}
                  connectNulls
                />

                {/* Meal vertical lines — all blue */}
                {mealEvents.map((m, i) => (
                  <ReferenceLine
                    key={`meal-${i}`}
                    x={new Date(m.timestamp).getTime()}
                    stroke={MEAL_COLOR}
                    strokeWidth={2}
                    strokeDasharray="5 3"
                  />
                ))}

                {/* Insulin vertical lines */}
                {insulinEvents.map((l, i) => (
                  <ReferenceLine
                    key={`ins-${i}`}
                    x={new Date(l.timestamp).getTime()}
                    stroke={insulinColor(l.brandType)}
                    strokeWidth={2}
                    strokeDasharray="2 4"
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </>
        ) : (
          <div className="timeline-empty" onClick={() => nav('/glucose')}>
            <Activity size={28} color="var(--text-secondary)" />
            <p>{isToday ? '尚無今日血糖資料' : `${format(new Date(`${selDay}T00:00:00`), 'M/d')} 無血糖資料`}</p>
            <button className="btn-secondary" onClick={e => { e.stopPropagation(); nav('/glucose'); }}>
              同步 LibreLink →
            </button>
          </div>
        )}

        {/* Events list under chart */}
        {(mealEvents.length > 0 || insulinEvents.length > 0) && (
          <div className="event-list">
            {[...mealEvents.map(m => ({ ...m, _type: 'meal' })),
              ...insulinEvents.map(l => ({ ...l, _type: 'insulin' }))]
              .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
              .map((ev, i) => (
                <div key={i} className="event-row">
                  <span className="event-time">{format(new Date(ev.timestamp), 'HH:mm')}</span>
                  {ev._type === 'meal' ? (
                    <>
                      <span className="event-dot" style={{ background: MEAL_COLOR }} />
                      <span className="event-label">{MEAL_LABELS[ev.mealType]}</span>
                      {ev.carbs && <span className="event-meta">{ev.carbs}g 碳水</span>}
                      {ev.foods && <span className="event-meta event-foods">{ev.foods.slice(0, 20)}{ev.foods.length > 20 ? '…' : ''}</span>}
                    </>
                  ) : (
                    <>
                      <span className="event-dot" style={{ background: insulinColor(ev.brandType) }} />
                      <span className="event-label">{insulinTypeLabel(ev.brandType)} {ev.brand}</span>
                      <span className="event-meta">{ev.units} U</span>
                    </>
                  )}
                </div>
              ))
            }
          </div>
        )}
        </div>{/* /day-slide */}
      </div>

      {/* ── Daily Summary ── */}
      {dailySummary && (
        <div className="card daily-summary-card">
          <div className="ds-header">
            <Sun size={15} color="var(--accent)" />
            <h3>{isToday ? '今日' : format(new Date(`${selDay}T00:00:00`), 'M/d')} 摘要</h3>
          </div>

          <div className="ds-rows">
            {/* Best period */}
            <div className="ds-row">
              <span className="ds-icon ds-icon-good"><Sun size={13} /></span>
              <div className="ds-content">
                <span className="ds-label">最佳時段</span>
                {dailySummary.bestPeriod ? (
                  <span className="ds-value ds-good">
                    {dailySummary.bestPeriod.label}
                    <span className="ds-meta">（{dailySummary.bestPeriod.count} 次達標）</span>
                  </span>
                ) : (
                  <span className="ds-value ds-muted">無連續達標資料</span>
                )}
              </div>
            </div>

            {/* Most volatile window */}
            <div className="ds-row">
              <span className="ds-icon ds-icon-warn"><Zap size={13} /></span>
              <div className="ds-content">
                <span className="ds-label">最大波動</span>
                {dailySummary.worstWindow ? (
                  <span className="ds-value ds-warn">
                    {dailySummary.worstWindow.label}
                    <span className="ds-meta">（落差 {dailySummary.worstWindow.range} mg/dL）</span>
                  </span>
                ) : (
                  <span className="ds-value ds-muted">波動平穩</span>
                )}
              </div>
            </div>

            {/* Recommendations */}
            <div className="ds-row ds-row-recs">
              <span className="ds-icon ds-icon-info"><Lightbulb size={13} /></span>
              <div className="ds-content">
                <span className="ds-label">今日建議</span>
                <ul className="ds-rec-list">
                  {dailySummary.recommendations.map((r, i) => (
                    <li key={i} className={`ds-rec ds-rec-${r.level}`}>{r.text}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Meal-pattern Insight ── */}
      {mealInsight && (
        <div className="card mpi-card">
          <div className="mpi-header">
            <Sparkles size={15} color="var(--accent)" />
            <h3>最近 {mealInsight.days} 天觀察</h3>
          </div>

          {/* Headline finding */}
          <div className="mpi-finding">
            <div className="mpi-finding-main">
              <span className="mpi-meal-label">{mealInsight.worst.label}後血糖平均上升</span>
              <span className="mpi-rise">+{mealInsight.worst.avgRise}<span className="mpi-unit"> mg/dL</span></span>
            </div>
            <div className="mpi-compare">
              <ArrowUpRight size={13} color="var(--yellow)" />
              高於{mealInsight.ref.label} <strong>{mealInsight.pctHigher}%</strong>
              <span className="mpi-n">（{mealInsight.worst.count} 餐次）</span>
            </div>
          </div>

          {/* Mini bar comparison across meal types */}
          <div className="mpi-bars">
            {mealInsight.allMeals.map((m, i) => {
              const max = mealInsight.allMeals[0].avgRise || 1;
              const isWorst = m.label === mealInsight.worst.label;
              return (
                <div key={i} className="mpi-bar-row">
                  <span className="mpi-bar-label">{m.label}</span>
                  <div className="mpi-bar-track">
                    <div className="mpi-bar-fill" style={{
                      width: `${Math.round((m.avgRise / max) * 100)}%`,
                      background: isWorst ? 'var(--yellow)' : 'var(--accent)',
                    }} />
                  </div>
                  <span className="mpi-bar-val">+{m.avgRise}</span>
                </div>
              );
            })}
          </div>

          {/* Cause */}
          <div className="mpi-cause">
            <span className="mpi-tag">可能原因</span>
            {mealInsight.cause}
          </div>

          {/* Intervention estimate */}
          {mealInsight.suggestion && (
            <div className="mpi-suggest">
              <Lightbulb size={13} color="var(--green)" />
              <div className="mpi-suggest-body">
                <div className="mpi-suggest-action">{mealInsight.suggestion.action}</div>
                <div className="mpi-suggest-est">
                  預估峰值下降 <strong>{mealInsight.suggestion.estDrop[0]}–{mealInsight.suggestion.estDrop[1]} mg/dL</strong>
                </div>
              </div>
            </div>
          )}

          <div className="mpi-disclaimer">＊ 估算僅供參考，實際反應因人而異</div>
        </div>
      )}

      {/* Achievements teaser */}
      <div className="card ach-teaser" onClick={() => nav('/achievements')}>
        <div className="ach-teaser-head">
          <Trophy size={16} color="#f59e0b" />
          <span className="ach-teaser-title">成就徽章</span>
          <span className="ach-teaser-count">{achievements.unlockedCount}/{achievements.total} 已解鎖</span>
          <ChevronRight size={16} color="var(--text-muted)" />
        </div>
        <div className="ach-teaser-row">
          {achievements.achievements.slice(0, 6).map(a => (
            <div key={a.id} className={`ach-chip ${a.unlocked ? 'ach-chip-on' : 'ach-chip-off'}`} title={`${a.name}：${a.blurb}`}>
              {a.emoji}
            </div>
          ))}
        </div>
        {achievements.nextUp && (
          <div className="ach-teaser-next">
            <span className="ach-teaser-next-emoji">{achievements.nextUp.emoji}</span>
            <span>差一點點：<strong>{achievements.nextUp.name}</strong>　{achievements.nextUp.detail}</span>
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div className="stats-row">
        <div className="stat-card clickable" onClick={() => nav('/glucose')}>
          <TrendingUp size={16} color="#6366f1" />
          <div className="stat-label">達標率 TIR</div>
          <div className="stat-value" style={{ color: tir7d !== null ? (tir7d >= 70 ? '#22c55e' : '#ef4444') : 'inherit' }}>
            {tir7d !== null ? `${tir7d}%` : '-'}
          </div>
          <div className="stat-unit">近7天 70–180</div>
        </div>
        <div className="stat-card clickable" onClick={() => nav('/insulin')}>
          <Syringe size={16} color="#a78bfa" />
          <div className="stat-label">今日胰島素</div>
          <div className="stat-value">{todayInsulin > 0 ? todayInsulin.toFixed(1) : '-'}</div>
          <div className="stat-unit">U</div>
        </div>
        <div className="stat-card clickable" onClick={() => nav('/insulin')}>
          <Activity size={16} color="#22c55e" />
          <div className="stat-label">ICR / ISF</div>
          <div className="stat-value" style={{ fontSize: 14 }}>1:{icr}</div>
          <div className="stat-unit">/{isf}</div>
        </div>
      </div>

      {/* Quick actions — prominent */}
      <div className="quick-actions-grid">
        <button className="qab-primary" onClick={() => nav('/meals')}>
          <Utensils size={20} />
          <span>記錄飲食</span>
          <span className="qab-sub">描述餐點・分析營養</span>
        </button>
        <button className="qab-primary qab-insulin" onClick={() => nav('/insulin')}>
          <Syringe size={20} />
          <span>計算劑量</span>
          <span className="qab-sub">本餐建議・一鍵記錄</span>
        </button>
        <button className="qab-secondary" onClick={() => nav('/glucose')}>
          <Activity size={16} /> 血糖記錄
        </button>
        <button className="qab-secondary" onClick={() => nav('/settings')}>
          <User size={16} /> 設定
        </button>
      </div>
    </div>
  );
}
