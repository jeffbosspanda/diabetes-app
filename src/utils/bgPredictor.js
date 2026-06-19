// ── 30-minute BG Predictor ────────────────────────────────────────────────────
// Base: linear regression slope over last 60 min of CGM readings
// Δ correction: pharmacokinetic model computes the CHANGE in insulin/meal effects
//   expected in the next 30 min vs the current rate.
//   Only the DELTA is added — not the full effect — to avoid double-counting
//   what the regression slope already captures.

const STALE_MS    = 15 * 60 * 1000;
const WINDOW_MS   = 60 * 60 * 1000;
const PREDICT_MIN = 30;

// ── Regression ────────────────────────────────────────────────────────────────
function linearSlope(readings) {
  if (readings.length < 2) return 0;
  const origin = readings[0].ts;
  const xs = readings.map(r => (r.ts - origin) / 60000);
  const ys = readings.map(r => r.v);
  const n = xs.length;
  const sx  = xs.reduce((s, x) => s + x, 0);
  const sy  = ys.reduce((s, y) => s + y, 0);
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sx2 = xs.reduce((s, x) => s + x * x, 0);
  const d   = n * sx2 - sx * sx;
  return d !== 0 ? (n * sxy - sx * sy) / d : 0;
}

// ── Rapid insulin activity curve (triangular, peak at DIA/4) ─────────────────
// Returns instantaneous activity fraction (unit: 1/min, integrates to 1 over DIA)
function rapidActivityRate(t, dia = 240) {
  if (t <= 0 || t >= dia) return 0;
  const peak = dia / 4; // ~60 min for 4h DIA
  if (t <= peak) return t / (peak * peak);
  return (dia - t) / ((dia - peak) * peak);
}

// BG rate of change (mg/dL per min) from a single rapid bolus at time t_min after injection
// Negative = lowering BG
function insulinBGRate(t, units, isf, dia = 240) {
  return -rapidActivityRate(t, dia) * units * isf;
}

// Delta: how much MORE (or LESS) BG change will occur in the next 30 min
// vs what the current slope already implies.
// Uses midpoint rule: compares future average rate to current rate over 30 min.
function insulinDelta30(t, units, isf, dia = 240) {
  const currentRate = insulinBGRate(t, units, isf, dia);
  // Average rate over the next PREDICT_MIN minutes (3 midpoints)
  const futureRate = [10, 20, 30].reduce((s, dt) => s + insulinBGRate(t + dt, units, isf, dia), 0) / 3;
  return (futureRate - currentRate) * PREDICT_MIN;
}

// ── Carb absorption (linear over absorptionTime) ──────────────────────────────
function carbBGRate(t, carbs, isf, icr, absMin) {
  if (t < 0 || t >= absMin) return 0;
  return (carbs / absMin) * (isf / icr); // constant rate while absorbing
}

// Delta: change in carb-BG contribution in next 30 min vs current rate
function mealDelta30(t, carbs, isf, icr, absMin) {
  const currentRate = carbBGRate(t, carbs, isf, icr, absMin);
  const futureRate  = [10, 20, 30].reduce((s, dt) => s + carbBGRate(t + dt, carbs, isf, icr, absMin), 0) / 3;
  return (futureRate - currentRate) * PREDICT_MIN;
}

// ── Trend arrow ───────────────────────────────────────────────────────────────
function trendArrow(slope) {
  if (slope >=  2.0) return { arrow: '↑↑', label: '快速上升', dir: 'up'   };
  if (slope >=  1.0) return { arrow: '↑',  label: '上升',     dir: 'up'   };
  if (slope >=  0.5) return { arrow: '↗',  label: '緩升',     dir: 'up'   };
  if (slope > -0.5)  return { arrow: '→',  label: '平穩',     dir: 'flat' };
  if (slope > -1.0)  return { arrow: '↘',  label: '緩降',     dir: 'down' };
  if (slope > -2.0)  return { arrow: '↓',  label: '下降',     dir: 'down' };
  return               { arrow: '↓↓', label: '快速下降', dir: 'down' };
}

// ── Warning ───────────────────────────────────────────────────────────────────
function buildWarning(current, predicted, slope) {
  if (predicted < 70) {
    const minsTo = slope < 0 ? Math.round((current - 70) / (-slope)) : null;
    return {
      level: 'danger',
      msg: minsTo != null && minsTo < 30
        ? `⚠ 約 ${minsTo} 分鐘後可能低血糖（< 70 mg/dL），建議立即補充 15g 快速碳水`
        : `⚠ 預測 30 分鐘後低血糖（${predicted} mg/dL），建議補充 15g 碳水`,
    };
  }
  if (predicted > 180) {
    return {
      level: 'high',
      msg: `⚠ 預測 30 分鐘後高血糖（${predicted} mg/dL），注意飲食或確認是否需補充胰島素`,
    };
  }
  if (predicted > 160 && slope >= 1) {
    return { level: 'warn', msg: '血糖持續快速上升，建議密切觀察' };
  }
  if (predicted < 90 && slope <= -0.5) {
    return { level: 'warn', msg: '血糖持續下降，留意低血糖風險' };
  }
  return null;
}

// ── Main export ───────────────────────────────────────────────────────────────
export function predictBG30(glucoseReadings, meals = [], insulinLogs = [], icr = 10, isf = 50) {
  const now = Date.now();

  // Most recent reading overall (used to report data freshness even when stale)
  const allSorted = glucoseReadings
    .map(r => ({ ts: new Date(r.timestamp).getTime(), v: r.value }))
    .sort((a, b) => a.ts - b.ts);
  const lastEver = allSorted[allSorted.length - 1] || null;
  const minsSinceLast = lastEver ? Math.round((now - lastEver.ts) / 60000) : null;

  // Regression base
  const recent = glucoseReadings
    .filter(r => now - new Date(r.timestamp).getTime() <= WINDOW_MS)
    .map(r => ({ ts: new Date(r.timestamp).getTime(), v: r.value }))
    .sort((a, b) => a.ts - b.ts);

  if (recent.length < 2) {
    return { status: 'insufficient', lastValue: lastEver?.v ?? null, minsSinceLast };
  }

  const latest = recent[recent.length - 1];
  if (now - latest.ts > STALE_MS) {
    return { status: 'stale', lastValue: latest.v, minsSinceLast };
  }

  const slope        = linearSlope(recent);
  const trendContrib = Math.round(slope * PREDICT_MIN);
  const { arrow, label, dir } = trendArrow(slope);

  // ── Rapid insulin delta ───────────────────────────────────────────────────
  let insulinContrib = 0;
  const activeRapid = [];

  for (const log of insulinLogs) {
    // 餐前胰島素＝速效 + 短效。短效（Regular）作用更久（DIA≈6h），須用較長曲線。
    if (log.brandType !== 'rapid' && log.brandType !== 'short') continue;
    const dia = log.brandType === 'short' ? 360 : 240;
    const t = (now - new Date(log.timestamp).getTime()) / 60000;
    if (t < 0 || t > dia) continue;
    const delta = insulinDelta30(t, log.units, isf, dia);
    insulinContrib += delta;
    activeRapid.push({ brand: log.brand, units: log.units, minsAgo: Math.round(t) });
  }
  insulinContrib = Math.round(insulinContrib);

  // ── Meal carb delta ───────────────────────────────────────────────────────
  let mealContrib = 0;
  const activeMeals = [];

  for (const meal of meals) {
    if (!meal.carbs || meal.carbs <= 0) continue;
    const t = (now - new Date(meal.timestamp).getTime()) / 60000;
    if (t < 0 || t > 240) continue;
    const absMin = meal.highGI?.length > 0 ? 60 : 120;
    if (t >= absMin) continue; // already fully absorbed
    const delta = mealDelta30(t, meal.carbs, isf, icr, absMin);
    mealContrib += delta;
    const remaining = Math.max(0, meal.carbs * (1 - t / absMin));
    activeMeals.push({ foods: meal.foods, carbs: meal.carbs, remaining: Math.round(remaining), minsAgo: Math.round(t) });
  }
  mealContrib = Math.round(mealContrib);

  // ── Long-acting note (informational only, ≤ 90 min since injection) ───────
  const recentLong = insulinLogs.filter(l => {
    if (l.brandType !== 'long') return false;
    const t = (now - new Date(l.timestamp).getTime()) / 60000;
    return t >= 0 && t <= 90;
  });
  const longActingNote = recentLong.length > 0
    ? `${recentLong[0].brand} ${recentLong[0].units}U 剛注射，需 2–4h 達峰`
    : null;

  // ── Combine ───────────────────────────────────────────────────────────────
  // Clamp individual contributions to ±60 to guard against bad data
  const safeInsulin = Math.max(-60, Math.min(60, insulinContrib));
  const safeMeal    = Math.max(-30, Math.min(60, mealContrib));
  const predicted   = Math.round(latest.v + trendContrib + safeInsulin + safeMeal);
  const warning     = buildWarning(latest.v, predicted, slope);

  return {
    status:        'ok',
    current:       latest.v,
    predicted,
    slope:         Math.round(slope * 10) / 10,
    arrow,
    trendLabel:    label,
    dir,
    trendContrib,
    insulinContrib: safeInsulin,
    mealContrib:    safeMeal,
    activeRapid,
    activeMeals,
    longActingNote,
    warning,
    latestTs:      latest.ts,
    dataPoints:    recent.length,
  };
}
