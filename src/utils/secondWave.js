// Second-wave post-meal rise detector.
//
// Many people (especially after high-fat / high-protein meals) don't spike right
// after eating — the carbs are handled early, then a SECOND rise appears 2–4h
// later as fat/protein slow gastric emptying and prolong absorption, by which
// time the meal bolus has worn off. This scans real CGM data per meal and flags
// meals whose BG climbed again ≥2h after eating.
import { classifyMeal } from './glycemicResponse';

const MIN = 60 * 1000;

export function analyzeSecondWave(meals, glucoseReadings, insulinLogs = [], { days = 14 } = {}) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const reads = glucoseReadings
    .map(r => ({ t: new Date(r.timestamp).getTime(), v: r.value }))
    .sort((a, b) => a.t - b.t);

  // nearest reading to t within tolerance
  const at = (t, tolMin = 25) => {
    let best = null, bd = Infinity;
    for (const r of reads) { const d = Math.abs(r.t - t); if (d < bd) { bd = d; best = r; } }
    return bd <= tolMin * 60 * 1000 ? best : null;
  };
  const peakIn = (t0, t1) => {
    let m = null;
    for (const r of reads) if (r.t >= t0 && r.t <= t1 && (!m || r.v > m.v)) m = r;
    return m;
  };
  const troughIn = (t0, t1) => {
    let m = null;
    for (const r of reads) if (r.t >= t0 && r.t <= t1 && (!m || r.v < m.v)) m = r;
    return m;
  };

  const events = [];
  let mealsExamined = 0;

  for (const meal of meals) {
    if (!meal.carbs) continue;
    const mt = new Date(meal.timestamp).getTime();
    if (mt < cutoff) continue;

    const base = meal.preMealBG ?? at(mt, 30)?.v;
    if (base == null) continue;

    // Need data coverage in the 2–5h window to judge a second wave.
    const late = peakIn(mt + 120 * MIN, mt + 300 * MIN);
    if (!late) continue;
    mealsExamined++;

    const early = peakIn(mt, mt + 120 * MIN);          // first 2h peak
    const v120 = at(mt + 120 * MIN, 45)?.v;            // value at ~2h
    const trough = troughIn(mt + 60 * MIN, late.t);    // dip between waves
    const ref = v120 ?? early?.v ?? base;              // level entering the late window

    const rise2 = late.v - ref;
    // Second wave: renewed climb ≥25 mg/dL after the 2h mark, peaking ≥160, and
    // (if we saw a dip) the late peak clearly exceeds that trough.
    const dippedThenRose = !trough || (late.v - trough.v) >= 25;
    if (rise2 >= 25 && late.v >= 160 && dippedThenRose && late.t > mt + 130 * MIN) {
      const prof = classifyMeal(meal);

      // Was there bolus (rapid/short) only early, leaving the late wave uncovered?
      const bolus = insulinLogs.find(l =>
        (l.brandType === 'rapid' || l.brandType === 'short') &&
        Math.abs(new Date(l.timestamp).getTime() - mt) < 30 * MIN
      );

      const causes = [];
      if (prof.type === 'fatProtein') {
        causes.push('高脂高蛋白延遲消化：胃排空變慢，碳水與蛋白在 2–4 小時後才大量吸收。');
      } else if (prof.type === 'fast' || prof.type === 'delayed') {
        causes.push('餐後碳水持續吸收，後段血糖再度上升。');
      }
      if (bolus) {
        const dia = bolus.brandType === 'short' ? 7 : 4;
        causes.push(`餐前${bolus.brandType === 'short' ? '短效' : '速效'} ${bolus.units}U 作用約 ${dia} 小時，第二波出現時藥效多已減弱。`);
      } else {
        causes.push('此餐無餐前胰島素紀錄，後段升糖無胰島素覆蓋。');
      }

      const suggestions = [];
      if (prof.type === 'fatProtein') {
        suggestions.push('高脂高蛋白餐可考慮分次注射（部分餐前、部分餐後 1–2 小時），或與醫師討論延長型注射方式。');
      }
      suggestions.push('餐後 2–3 小時可量血糖，必要時依校正劑量補打（請先與醫師／衛教師確認）。');

      events.push({
        timestamp: meal.timestamp,
        foods: meal.foods,
        mealType: meal.mealType,
        baseline: Math.round(base),
        earlyPeak: early ? early.v : null,
        earlyPeakMin: early ? Math.round((early.t - mt) / MIN) : null,
        troughBG: trough ? trough.v : null,
        latePeak: late.v,
        latePeakMin: Math.round((late.t - mt) / MIN),
        rise2: Math.round(rise2),
        glycemicType: prof.type,
        glycemicLabel: prof.label,
        causes,
        suggestions,
      });
    }
  }

  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return {
    events,
    summary: mealsExamined > 0
      ? { days, count: events.length, examined: mealsExamined, pct: Math.round(events.length / mealsExamined * 100) }
      : null,
  };
}
