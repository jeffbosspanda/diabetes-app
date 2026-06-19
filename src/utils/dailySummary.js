// ── Daily Summary: best period, most volatile window, recommendations ─────────
import { format } from 'date-fns';

const IN_RANGE = v => v >= 70 && v <= 180;

function avg(arr) {
  return arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;
}

function fmtTime(ts) {
  return format(new Date(ts), 'HH:mm');
}

// Returns {start, end, count} for the longest consecutive in-range streak
function findBestPeriod(readings) {
  let bestStart = null, bestEnd = null, bestLen = 0;
  let curStart = null, curEnd = null, curLen = 0;

  for (const r of readings) {
    if (IN_RANGE(r.value)) {
      if (!curStart) { curStart = r; }
      curEnd = r;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
        bestEnd = curEnd;
      }
    } else {
      curStart = null; curEnd = null; curLen = 0;
    }
  }

  if (!bestStart || bestLen < 2) return null;
  return { start: bestStart._ts, end: bestEnd._ts, count: bestLen };
}

// Returns {start, end, range} for the 2-hour window with the largest BG swing
function findMostVolatileWindow(readings) {
  const WINDOW_MS = 2 * 3600 * 1000;
  let worst = null, worstRange = 0;

  for (let i = 0; i < readings.length; i++) {
    const wEnd = readings[i]._ts + WINDOW_MS;
    const win = readings.filter(r => r._ts >= readings[i]._ts && r._ts <= wEnd);
    if (win.length < 2) continue;
    const vals = win.map(r => r.value);
    const range = Math.max(...vals) - Math.min(...vals);
    if (range > worstRange) {
      worstRange = range;
      worst = {
        start: readings[i]._ts,
        end: win[win.length - 1]._ts,
        range,
      };
    }
  }

  return worstRange >= 30 ? worst : null;
}

// Generate ordered recommendations (max 3 returned)
function buildRecommendations(readings, meals, settings) {
  const recs = [];
  const vals = readings.map(r => r.value);
  const lows = readings.filter(r => r.value < 70);
  const highs = readings.filter(r => r.value > 180);
  const tir = readings.length
    ? Math.round(readings.filter(r => IN_RANGE(r.value)).length / readings.length * 100)
    : null;

  // Danger: low BG
  if (lows.length > 0) {
    recs.push({
      level: 'danger',
      text: `偵測到 ${lows.length} 次低血糖（< 70 mg/dL），建議隨身備糖`,
    });
  }

  // Post-meal peaks
  const mealTimes = meals.map(m => new Date(m.timestamp).getTime());
  const peaks = [];
  for (const mt of mealTimes) {
    const win = readings.filter(r => r._ts >= mt + 60 * 60000 && r._ts <= mt + 150 * 60000);
    if (win.length) peaks.push(Math.max(...win.map(r => r.value)));
  }
  const avgPeak = avg(peaks);
  if (avgPeak && avgPeak > 180) {
    recs.push({
      level: 'warn',
      text: `飯後平均峰值 ${avgPeak} mg/dL，建議確認飯前劑量或減少高 GI 食物`,
    });
  }

  // High volatility reminder
  const maxRange = (() => {
    if (vals.length < 2) return 0;
    return Math.max(...vals) - Math.min(...vals);
  })();
  if (maxRange > 120) {
    recs.push({
      level: 'warn',
      text: `今日血糖落差 ${maxRange} mg/dL，建議均衡攝取碳水並避免空腹過久`,
    });
  }

  // No meals logged
  if (meals.length === 0 && readings.length > 0) {
    recs.push({
      level: 'info',
      text: '尚未記錄今日飲食，建議補記以提升分析準確度',
    });
  }

  // All high
  if (highs.length > 0 && lows.length === 0 && avgPeak == null) {
    recs.push({
      level: 'warn',
      text: `偵測到 ${highs.length} 次高血糖（> 180 mg/dL），注意飲食控制`,
    });
  }

  // Good day
  if (tir !== null && tir >= 70 && lows.length === 0) {
    recs.push({
      level: 'good',
      text: `今日達標率 ${tir}%，血糖控制良好，繼續保持！`,
    });
  } else if (tir !== null && tir >= 50 && recs.length === 0) {
    recs.push({
      level: 'info',
      text: `今日達標率 ${tir}%，有進步空間，注意飲食節奏`,
    });
  }

  return recs.slice(0, 3);
}

// ── Main export ───────────────────────────────────────────────────────────────
export function computeDailySummary(glucoseReadings, meals, settings, selDay) {
  const lo = new Date(`${selDay}T00:00:00`).getTime();
  const hi = lo + 24 * 3600 * 1000;
  const inDay = ts => ts >= lo && ts < hi;

  const readings = glucoseReadings
    .filter(r => inDay(new Date(r.timestamp).getTime()))
    .map(r => ({ ...r, _ts: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a._ts - b._ts);

  const dayMeals = meals.filter(m => inDay(new Date(m.timestamp).getTime()));

  if (readings.length === 0) return null;

  const bestPeriod = findBestPeriod(readings);
  const worstWindow = readings.length >= 2 ? findMostVolatileWindow(readings) : null;
  const recommendations = buildRecommendations(readings, dayMeals, settings);

  return {
    bestPeriod: bestPeriod
      ? {
          label: `${fmtTime(bestPeriod.start)} – ${fmtTime(bestPeriod.end)}`,
          count: bestPeriod.count,
        }
      : null,
    worstWindow: worstWindow
      ? {
          label: `${fmtTime(worstWindow.start)} – ${fmtTime(worstWindow.end)}`,
          range: worstWindow.range,
        }
      : null,
    recommendations,
  };
}
