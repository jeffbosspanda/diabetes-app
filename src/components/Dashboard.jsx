import { useMemo, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  Activity, Utensils, Syringe, User, AlertCircle, TrendingUp,
  ChevronRight, ChevronLeft, Sun, Zap, Lightbulb, Navigation, Sparkles, ArrowUpRight, Trophy, RefreshCw,
} from 'lucide-react';
import {
  ComposedChart, ReferenceLine, ReferenceArea, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Area,
} from 'recharts';
import {
  checkDataSufficiency, getBGStatus, calculateTDD,
  deriveICRandISF, estimateTDDFromWeight, BRAND_PHARMA,
} from '../utils/insulinCalculator';
import { computeDailySummary } from '../utils/dailySummary';
import { predictBG30 } from '../utils/bgPredictor';
import { syncLibreData } from '../utils/libreLinkUp';
import { computeMealPatternInsights } from '../utils/mealPatternInsights';
import { computeAchievements } from '../utils/achievements';
import { computeCyclePhase, analyzeCycleGlucoseImpact } from '../utils/cyclePhase';
import { format, subDays } from 'date-fns';
import { parseMealFoods } from '../utils/foodParser';

// ── High-contrast palette ───────────────────────────────────────────────────
// Meals are ALL blue (regardless of type); insulin & BG use distinct hues.
const MEAL_COLOR  = '#2563eb'; // all meals → blue
const RAPID_COLOR = '#f97316'; // 速效 rapid analog → orange
const SHORT_COLOR = '#0ea5e9'; // 短效 Regular → sky blue
const LONG_COLOR  = '#a855f7'; // 長效 long-acting → purple
const insulinColor = (bt) => (bt === 'long' ? LONG_COLOR : bt === 'short' ? SHORT_COLOR : RAPID_COLOR);
const insulinTypeLabel = (bt) => (bt === 'long' ? '長效' : bt === 'short' ? '短效' : '速效');
const BG_COLOR    = '#0e9488'; // BG line → teal (high contrast on warm-white)
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

// ── Glycemic impact curve profiles (research-backed timing) ──────────────────
// High vs low GI peak difference ~17 min: PMC3571634
// Fat/protein delays gastric emptying 30–60 min, pushes peak to 2–4 h: PMC7352659
const GI_VIS = {
  fast:       { lagMin: 0,  peakMin: 45,  durMin: 150, color: '#e08585', zh: '高GI快速' },
  medium:     { lagMin: 10, peakMin: 65,  durMin: 195, color: '#e8a84a', zh: '中GI緩升' },
  low:        { lagMin: 15, peakMin: 90,  durMin: 255, color: '#5cb89a', zh: '低GI緩慢' },
  fatProtein: { lagMin: 40, peakMin: 150, durMin: 360, color: '#7f9cc4', zh: '高脂蛋白延遲' },
  minimal:    { lagMin: 0,  peakMin: 30,  durMin: 90,  color: '#a8c0a8', zh: '低影響' },
};
function foodGIProfile(food) {
  if ((food.fat ?? 0) >= 15 || (food.protein ?? 0) >= 20) return GI_VIS.fatProtein;
  const gi = food.gi;
  if (gi == null) return GI_VIS.low;           // unknown → conservative
  if (gi >= 70) return GI_VIS.fast;
  if (gi >= 56) return GI_VIS.medium;
  if ((food.carbs ?? 0) < 4) return GI_VIS.minimal;
  return GI_VIS.low;
}

// Peak height of a food's curve = its glycaemic impact, so different foods rise
// to different levels (not a uniform peak). Driven by glycaemic load
// (GL ≈ GI/100 × carbs); fat/protein meals have low GL but a real delayed rise,
// so they get a protein/fat-based floor. Returns 0.2–1.0 of the track height.
function foodImpactMag(food, prof) {
  const gi = food.gi ?? 50;
  const carbs = food.carbs ?? 0;
  let gl = (gi / 100) * carbs;
  if (prof === GI_VIS.fatProtein) {
    gl = Math.max(gl, (food.protein ?? 0) * 0.25 + (food.fat ?? 0) * 0.12);
  }
  return Math.min(1, Math.max(0.2, gl / 40));
}


// ── Action Gantt geometry — aligned to the BG chart's plot area ──────────────
// LABEL_W matches the chart's YAxis width so block x-positions line up with the
// glucose curve above; CHART_R matches the chart's right margin.
const LABEL_W = 36;
const CHART_R = 12;
const TRACK_H = 30;        // vertical band height for one curve (one sub-row)
const LANE_GAP = 8;        // gap between lanes
const GANTT_XAXIS_H = 16;  // bottom strip for time-tick labels

// Smooth pharmacokinetic activity profile, normalised 0..1, for any item drawn
// in the Gantt. Returns relative action intensity at time `ts`:
//   start → 0 (作用開始), rise to peak → 1 (增強→峰值), fall back to 0 (減弱→結束).
// Long-acting basal has no sharp peak → a flat plateau (quick onset, long hold,
// slow taper) so users see it as steady background action rather than a spike.
function activityNorm(ts, startTs, peakTs, endTs, flat) {
  if (ts <= startTs || ts >= endTs) return 0;
  if (flat || peakTs == null) {
    const f = (ts - startTs) / (endTs - startTs);
    const PLATEAU = 0.62;
    if (f < 0.10) return (f / 0.10) * PLATEAU;          // quick onset
    if (f > 0.82) return (1 - (f - 0.82) / 0.18) * PLATEAU; // slow taper
    return PLATEAU;                                      // steady hold
  }
  if (ts <= peakTs) {
    const r = (ts - startTs) / (peakTs - startTs);
    return (1 - Math.cos(Math.PI * r)) / 2;              // smooth 0→1 (增強中)
  }
  const r = (ts - peakTs) / (endTs - peakTs);
  return (1 + Math.cos(Math.PI * r)) / 2;                // smooth 1→0 (減弱中)
}

// Interval-packing: when blocks overlap in time they must not be drawn on top of
// each other. Greedily assign each block to the first sub-row (track) whose last
// block has already ended; otherwise open a new track. Mutates blocks with .track
// and returns how many tracks the lane needs (min 1 so empty lanes keep a row).
function packTracks(blocks) {
  const sorted = [...blocks].sort((a, b) => a.left - b.left);
  const trackEnds = []; // right edge (%) of the last block placed on each track
  const GAP = 0.4;      // small % gap so visually-touching blocks still split
  for (const b of sorted) {
    let placed = false;
    for (let t = 0; t < trackEnds.length; t++) {
      if (b.left >= trackEnds[t] + GAP) {
        b.track = t;
        trackEnds[t] = b.left + b.width;
        placed = true;
        break;
      }
    }
    if (!placed) {
      b.track = trackEnds.length;
      trackEnds.push(b.left + b.width);
    }
  }
  return { blocks: sorted, trackCount: Math.max(1, trackEnds.length) };
}

// Total action duration (hours): long-acting per brand; bolus from BRAND_PHARMA.
const LONG_DURATION_H = { Lantus: 24, Toujeo: 36, Tresiba: 42, Levemir: 22, Basaglar: 24 };
function insulinActionH(brand, brandType) {
  if (brandType === 'long') return LONG_DURATION_H[brand] ?? 24;
  const p = BRAND_PHARMA[brand];
  return p ? p.iobHours : (brandType === 'short' ? 7 : 4);
}
// Peak time (hours) places the gradient's brightest point; null = flat basal.
function insulinPeakH(brandType) {
  if (brandType === 'long') return null;
  return brandType === 'short' ? 3 : 1.5;
}

// Activity-curve Gantt: meals + long-acting + rapid/short + per-food GI impact.
// Each item is drawn as a smooth filled curve showing its action trend over time
// (開始作用→增強中→峰值→減弱中→結束). Items that overlap in time within a lane are
// split onto separate sub-rows (tracks) so curves never sit on top of each other.
function ActionGantt({ meals, insulin, windowStart, windowEnd, xTicks }) {
  const wrapRef = useRef(null);
  const [plotW, setPlotW] = useState(300);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => setPlotW(Math.max(1, e.contentRect.width - LABEL_W - CHART_R)));
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const span = windowEnd - windowStart;
  const xPx = (ts) => LABEL_W + Math.max(0, Math.min(1, (ts - windowStart) / span)) * plotW;
  // left/width (%) for track packing; spillsLeft = started before this window.
  const geom = (startTs, endTs) => {
    const rawLeft = (startTs - windowStart) / span * 100;
    const left = Math.max(0, rawLeft);
    const right = Math.max(0, Math.min(100, (endTs - windowStart) / span * 100));
    return { left, width: Math.max(0.5, right - left), spillsLeft: rawLeft < 0 };
  };

  const insulinItem = (l, i) => {
    const startTs = new Date(l.timestamp).getTime();
    const durH = insulinActionH(l.brand, l.brandType);
    const peakH = insulinPeakH(l.brandType);
    const endTs = startTs + durH * 3600000;
    const flat = peakH == null;
    const peakTs = flat ? null : startTs + peakH * 3600000;
    const g = geom(startTs, endTs);
    return {
      key: `i${i}`, startTs, peakTs, endTs, flat, mag: 1, color: insulinColor(l.brandType),
      label: `${insulinTypeLabel(l.brandType)}${l.units}U${g.spillsLeft ? ' ↵' : ''}`,
      title: `${insulinTypeLabel(l.brandType)} ${l.brand || ''} ${l.units}U · ${format(new Date(startTs), 'MM/dd HH:mm')} · 作用約 ${durH}h${g.spillsLeft ? '（前一天注射）' : ''}`,
      ...g,
    };
  };
  const longItems  = insulin.filter(l => l.brandType === 'long').map(insulinItem);
  const bolusItems = insulin.filter(l => l.brandType !== 'long').map(insulinItem);

  const foodItems = meals.flatMap((m, mi) => {
    const mealTs = new Date(m.timestamp).getTime();
    let foods = parseMealFoods(m.foods || '')
      .filter(f => !f.undetermined && ((f.carbs ?? 0) >= 3 || (f.fat ?? 0) >= 12 || (f.protein ?? 0) >= 15));
    if (!foods.length) {
      const gi = (m.highGI?.length ?? 0) > 0 ? 75 : 50;
      foods = [{ name: MEAL_LABELS[m.mealType] || '餐', carbs: m.carbs ?? 10, protein: m.protein ?? 0, fat: m.fat ?? 0, gi }];
    }
    return foods.map((food, fi) => {
      const prof = foodGIProfile(food);
      const startTs = mealTs + prof.lagMin * 60000;
      const peakTs = mealTs + prof.peakMin * 60000;
      const endTs = mealTs + prof.durMin * 60000;
      const mag = foodImpactMag(food, prof);
      return {
        key: `f${mi}-${fi}`, startTs, peakTs, endTs, flat: false, mag, color: prof.color,
        label: (food.name || '食物').slice(0, 5),
        title: `${food.name || '食物'} · ${prof.zh} · 預估影響 ${prof.lagMin}–${prof.durMin} 分鐘`,
        ...geom(startTs, endTs),
      };
    });
  });

  const lanes = [
    { key: 'food',  label: '飲食\n影響', ...packTracks(foodItems) },
    { key: 'long',  label: '長效',       ...packTracks(longItems) },
    { key: 'bolus', label: '速效\n短效',  ...packTracks(bolusItems) },
  ];

  // Vertical layout: stack lanes, each as tall as its track count needs.
  let y = 2;
  const laid = lanes.map(lane => {
    const h = lane.trackCount * TRACK_H;
    const o = { ...lane, yTop: y, h };
    y += h + LANE_GAP;
    return o;
  });
  const plotBottom = y - LANE_GAP;
  const svgH = plotBottom + GANTT_XAXIS_H;
  const plotR = LABEL_W + plotW;

  const fmtTick = (ts) => format(new Date(ts), 'HH:mm');

  return (
    <div className="gantt" ref={wrapRef}>
      <div className="gantt-hint">曲線 = 作用強度趨勢（開始→增強→峰值→減弱→結束）· 起點 = 開始作用 · 同時段重疊者分列</div>
      <div className="gi-legend">
        {Object.values(GI_VIS).map(p => (
          <span key={p.zh} className="gi-legend-item">
            <span className="gi-dot" style={{ background: p.color }} />{p.zh}
          </span>
        ))}
      </div>
      <svg width="100%" height={svgH} className="gantt-svg">
        {/* time gridlines spanning all lanes */}
        {xTicks.map((ts, i) => {
          const x = xPx(ts);
          if (x < LABEL_W - 0.5 || x > plotR + 0.5) return null;
          return <line key={`g${i}`} x1={x} y1={2} x2={x} y2={plotBottom} stroke="var(--border)" strokeWidth={0.5} opacity={0.5} />;
        })}

        {laid.map(lane => {
          const amp = TRACK_H - 11; // curve peak height; leaves room for label
          return (
            <g key={lane.key}>
              {/* lane label (left gutter), vertically centred over its tracks */}
              {lane.label.split('\n').map((ln, k, arr) => (
                <text
                  key={k} x={2} y={lane.yTop + lane.h / 2 + (k - (arr.length - 1) / 2) * 10 + 3}
                  fontSize={9} fontWeight={700} fill="var(--text-secondary)"
                >{ln}</text>
              ))}

              {/* per-track baseline + curves */}
              {Array.from({ length: lane.trackCount }, (_, t) => {
                const baseY = lane.yTop + t * TRACK_H + TRACK_H - 4;
                return <line key={`b${t}`} x1={LABEL_W} y1={baseY} x2={plotR} y2={baseY} stroke="var(--border)" strokeWidth={0.7} />;
              })}

              {lane.blocks.map(b => {
                const baseY = lane.yTop + b.track * TRACK_H + TRACK_H - 4;
                const ts0 = Math.max(b.startTs, windowStart);
                const ts1 = Math.min(b.endTs, windowEnd);
                if (ts1 <= ts0) return null;
                const N = 44;
                const pts = [];
                for (let k = 0; k <= N; k++) {
                  const ts = ts0 + (ts1 - ts0) * k / N;
                  const a = activityNorm(ts, b.startTs, b.peakTs, b.endTs, b.flat);
                  pts.push({ x: xPx(ts), y: baseY - a * amp * b.mag });
                }
                const topD = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
                const fillD = `${topD}L${pts[N].x.toFixed(1)},${baseY}L${pts[0].x.toFixed(1)},${baseY}Z`;
                const wide = pts[N].x - pts[0].x > 22;

                // peak marker (skip for flat basal)
                let peakDot = null;
                if (!b.flat && b.peakTs != null && b.peakTs > ts0 && b.peakTs < ts1) {
                  const pa = activityNorm(b.peakTs, b.startTs, b.peakTs, b.endTs, false);
                  peakDot = <circle cx={xPx(b.peakTs)} cy={baseY - pa * amp * b.mag} r={1.8} fill={b.color} />;
                }
                return (
                  <g key={b.key}>
                    <title>{b.title}</title>
                    <path d={fillD} fill={b.color} opacity={0.16} />
                    <path d={topD} fill="none" stroke={b.color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" opacity={0.92} />
                    {peakDot}
                    {wide && (
                      <text x={pts[0].x + 3} y={lane.yTop + b.track * TRACK_H + 9}
                        fontSize={8} fontWeight={700} fill={b.color}>{b.label}</text>
                    )}
                  </g>
                );
              })}

              {lane.blocks.length === 0 && (
                <text x={LABEL_W + 6} y={lane.yTop + lane.h / 2 + 3} fontSize={10} fill="var(--text-muted)" opacity={0.5}>無</text>
              )}
            </g>
          );
        })}

        {/* x-axis time labels */}
        {xTicks.map((ts, i) => {
          const x = xPx(ts);
          if (x < LABEL_W || x > plotR) return null;
          return <text key={`x${i}`} x={x} y={svgH - 3} textAnchor="middle" fontSize={9} fill="var(--text-muted)">{fmtTick(ts)}</text>;
        })}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();

  // Quick LibreLink sync straight from the dashboard (no jump to 血糖頁).
  // Reuses the same authoritative-window reconciliation as LibreSync.
  const [quickSyncing, setQuickSyncing] = useState(false);
  const [quickSyncErr, setQuickSyncErr] = useState('');
  const handleQuickSync = async () => {
    const creds = state.settings.libreCredentials;
    // No saved credentials → can't sync silently; send user to 血糖頁 to connect.
    if (!creds?.username || !creds?.password) { nav('/glucose'); return; }
    setQuickSyncErr('');
    setQuickSyncing(true);
    try {
      const { readings } = await syncLibreData(creds.username, creds.password);
      if (readings.length) dispatch({ type: 'RECONCILE_GLUCOSE', payload: readings });
      dispatch({ type: 'UPDATE_SETTINGS', payload: {
        integrations: { ...state.settings.integrations, freestyleLibre: true },
      }});
    } catch (err) {
      setQuickSyncErr(err.message || '同步失敗，請稍後再試');
    } finally {
      setQuickSyncing(false);
    }
  };

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

  // Extended insulin set for the Gantt: includes any injection from adjacent
  // days whose action window overlaps the display window.
  // Look-back 48 h catches the longest basal (Tresiba 42 h); look-ahead 8 h
  // catches a short-acting bolus injected just before midnight of the prev day.
  const ganttInsulinEvents = useMemo(() => {
    const LOOK_BACK_MS  = 48 * 3600 * 1000;
    const LOOK_AHEAD_MS =  8 * 3600 * 1000;
    return state.insulinLogs.filter(l => {
      const injectedAt = new Date(l.timestamp).getTime();
      if (injectedAt >= winLo && injectedAt <= winHi) return true; // already in window
      const durMs = insulinActionH(l.brand, l.brandType) * 3600 * 1000;
      const actionEnd = injectedAt + durMs;
      // Injected before window: active if action hasn't expired by winLo
      if (injectedAt < winLo && injectedAt >= winLo - LOOK_BACK_MS) return actionEnd > winLo;
      // Injected after window start (future bleed from prev-day view): skip
      if (injectedAt > winHi && injectedAt <= winHi + LOOK_AHEAD_MS) return injectedAt < winHi;
      return false;
    });
  }, [state.insulinLogs, selDay]);

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

  // Clinically anchored y-ticks: round, diabetes-meaningful values that line up
  // with the 70/180 target band (so the gridlines mark "in-range" boundaries).
  const yTicks = useMemo(() => {
    const canon = [40, 54, 70, 100, 140, 180, 220, 260, 300, 350];
    const ticks = canon.filter(t => t >= yMin && t <= yMax);
    // Always surface the target-band edges if they fall inside the view.
    [70, 180].forEach(t => { if (t >= yMin && t <= yMax && !ticks.includes(t)) ticks.push(t); });
    return ticks.sort((a, b) => a - b);
  }, [yMin, yMax]);

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
          <button className="btn-secondary bgp-idle-btn" onClick={handleQuickSync} disabled={quickSyncing}>
            <RefreshCw size={14} className={quickSyncing ? 'spin' : ''} />
            {quickSyncing ? '同步中…' : '同步 LibreLink'}
          </button>
          {quickSyncErr && <div className="bgp-idle-sub" style={{ color: 'var(--red)' }}>{quickSyncErr}</div>}
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
            <ResponsiveContainer width="100%" height={190}>
              <ComposedChart data={bgPoints} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
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
                  ticks={yTicks}
                  tick={{ fontSize: 10, fill: 'var(--text-secondary)' }}
                  width={36}
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

                {/* Event timing now lives in the aligned Gantt below the chart. */}
              </ComposedChart>
            </ResponsiveContainer>

            {/* Action Gantt — meals + insulin duration + per-food GI impact, x-aligned to the curve.
                ganttInsulinEvents includes adjacent-day injections still active. */}
            <ActionGantt
              meals={mealEvents}
              insulin={ganttInsulinEvents}
              windowStart={xDomain[0]}
              windowEnd={xDomain[1]}
              xTicks={xTicks}
            />
          </>
        ) : (
          <div className="timeline-empty" onClick={() => nav('/glucose')}>
            <Activity size={28} color="var(--text-secondary)" />
            <p>{isToday ? '尚無今日血糖資料' : `${format(new Date(`${selDay}T00:00:00`), 'M/d')} 無血糖資料`}</p>
            <button className="btn-secondary" onClick={e => { e.stopPropagation(); handleQuickSync(); }} disabled={quickSyncing}>
              <RefreshCw size={14} className={quickSyncing ? 'spin' : ''} />
              {quickSyncing ? '同步中…' : '同步 LibreLink'}
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
