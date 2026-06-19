// ── Detailed glucose statistics for reports & 血糖 page ───────────────────
// Classifies each reading relative to meals (pre / post / other) and computes
// pre-meal avg, post-meal peak avg, late-night avg, plus low/high counts split
// by pre- vs post-meal context.

const POST_WINDOW_MS = 180 * 60 * 1000; // 0–180 min after a meal
const PRE_WINDOW_MS  = 45  * 60 * 1000; // 0–45 min before a meal
const PEAK_LO_MS     = 60  * 60 * 1000; // peak search starts 60 min after meal
const PEAK_HI_MS     = 150 * 60 * 1000; // peak search ends 150 min after meal

function classifyReading(ts, mealTimes) {
  // post-meal takes priority over pre-meal
  for (const mt of mealTimes) {
    if (ts >= mt && ts <= mt + POST_WINDOW_MS) return 'post';
  }
  for (const mt of mealTimes) {
    if (ts >= mt - PRE_WINDOW_MS && ts < mt) return 'pre';
  }
  return 'other';
}

export function analyzeGlucoseStats(glucoseReadings, meals, opts = {}) {
  // Window: explicit [from, to] overrides the days-based cutoff.
  const hi = opts.to ?? Date.now();
  const lo = opts.from ?? (hi - (opts.days || 7) * 24 * 3600 * 1000);
  const days = Math.max(1, Math.round((hi - lo) / 86400000));
  const inWin = ts => ts > lo && ts <= hi;

  const readings = glucoseReadings
    .filter(r => inWin(new Date(r.timestamp).getTime()))
    .map(r => ({ ...r, _ts: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a._ts - b._ts);

  const mealTimes = meals
    .filter(m => inWin(new Date(m.timestamp).getTime()))
    .map(m => new Date(m.timestamp).getTime());

  const mealList = mealTimes.map(ts => ({ ts }));

  const avg = arr => arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null;

  // ── Pre-meal average ──
  // Prefer recorded preMealBG on the meal; else readings tagged fasting/pre; else window
  const preMealBGs = [];
  for (const m of meals) {
    if (!inWin(new Date(m.timestamp).getTime())) continue;
    if (m.preMealBG != null) preMealBGs.push(m.preMealBG);
  }
  const fastingReadings = readings
    .filter(r => ['fasting', 'pre-meal'].includes(r.mealContext))
    .map(r => r.value);
  const preClassified = readings
    .filter(r => classifyReading(r._ts, mealTimes) === 'pre')
    .map(r => r.value);
  const preMealPool = preMealBGs.length ? preMealBGs
    : fastingReadings.length ? fastingReadings
    : preClassified;
  const preMealAvg = avg(preMealPool);

  // ── Post-meal peak average ──
  // For each meal, take the max reading in the 60–150 min window
  const peaks = [];
  for (const m of mealList) {
    const window = readings.filter(r => r._ts >= m.ts + PEAK_LO_MS && r._ts <= m.ts + PEAK_HI_MS);
    if (window.length) peaks.push(Math.max(...window.map(r => r.value)));
  }
  const postMealPeakAvg = avg(peaks);

  // ── Late-night average (00:00–06:00) ──
  const lateNight = readings
    .filter(r => { const h = new Date(r.timestamp).getHours(); return h >= 0 && h < 6; })
    .map(r => r.value);
  const lateNightAvg = avg(lateNight);

  // ── Low / high counts split by pre / post meal ──
  const counts = {
    lowPre: 0, lowPost: 0, lowOther: 0,
    highPre: 0, highPost: 0, highOther: 0,
  };
  for (const r of readings) {
    const cls = classifyReading(r._ts, mealTimes);
    if (r.value < 70) {
      if (cls === 'pre') counts.lowPre++;
      else if (cls === 'post') counts.lowPost++;
      else counts.lowOther++;
    } else if (r.value > 180) {
      if (cls === 'pre') counts.highPre++;
      else if (cls === 'post') counts.highPost++;
      else counts.highOther++;
    }
  }

  const inRange = readings.filter(r => r.value >= 70 && r.value <= 180).length;
  const overallAvg = avg(readings.map(r => r.value));

  // ── Rate of change (rise / fall slopes) ──
  // Only consecutive readings ≤30 min apart give a meaningful slope.
  const MAX_SLOPE_GAP_MS = 30 * 60 * 1000;
  const rises = [], falls = [];
  for (let i = 1; i < readings.length; i++) {
    const dt = readings[i]._ts - readings[i - 1]._ts;
    if (dt <= 0 || dt > MAX_SLOPE_GAP_MS) continue;
    const slope = (readings[i].value - readings[i - 1].value) / (dt / 60000); // mg/dL per min
    if (slope > 0) rises.push(slope);
    else if (slope < 0) falls.push(-slope);
  }
  const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
  const slopes = {
    avgRise:   r1(mean(rises)),
    avgFall:   r1(mean(falls)),
    maxRise:   rises.length ? r1(Math.max(...rises)) : null,
    maxFall:   falls.length ? r1(Math.max(...falls)) : null,
    steepRise: rises.filter(s => s >= 2).length, // ≥2 mg/dL/min ≈ LibreLink ↑↑
    steepFall: falls.filter(s => s >= 2).length,
    riseN: rises.length,
    fallN: falls.length,
  };

  return {
    days,
    readingCount: readings.length,
    overallAvg,
    tir: readings.length ? Math.round(inRange / readings.length * 100) : 0,
    preMealAvg,
    preMealN: preMealPool.length,
    postMealPeakAvg,
    postMealPeakN: peaks.length,
    lateNightAvg,
    lateNightN: lateNight.length,
    counts,
    lowTotal:  counts.lowPre + counts.lowPost + counts.lowOther,
    highTotal: counts.highPre + counts.highPost + counts.highOther,
    slopes,
  };
}
