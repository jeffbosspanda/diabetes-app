// ── Meal-pattern Insights ─────────────────────────────────────────────────────
// Over the last N days, group meals by type, compute average post-meal BG rise
// (peak 60–150 min − pre-meal BG), then surface the worst-performing meal type,
// infer a likely cause, and estimate the effect of a concrete intervention.

const MEAL_LABELS = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜', snack: '點心',
};

const MIN_SAMPLES = 3; // need ≥3 of a meal type before trusting its average

function findPeak(readings, from, to) {
  const win = readings.filter(r => r._ts >= from && r._ts <= to);
  return win.length ? Math.max(...win.map(r => r.value)) : null;
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

// Infer a likely cause + intervention for the worst meal type
function inferCause(worst, refRise) {
  const excess = worst.avgRise - refRise;
  const proteinRatio = worst.avgCarbs > 0 ? worst.avgProtein / worst.avgCarbs : 0;
  const highGIShare = worst.count ? worst.highGICount / worst.count : 0;

  // Estimate tier for protein intervention (modest, literature-based ~15–20 mg/dL per 20g)
  const proteinEst = excess > 45 ? [20, 25] : excess > 25 ? [15, 20] : [10, 15];

  // ① Protein insufficiency — low protein relative to carbs
  if (proteinRatio < 0.3 && worst.avgCarbs >= 30) {
    return {
      cause: `${worst.label}蛋白質不足（平均僅 ${Math.round(worst.avgProtein)}g，碳水 ${Math.round(worst.avgCarbs)}g）`,
      suggestion: {
        action: `${worst.label}增加 20g 蛋白質（如蛋、豆漿、無糖優格）`,
        estDrop: proteinEst,
      },
    };
  }

  // ② Frequent high-GI foods
  if (highGIShare >= 0.5) {
    return {
      cause: `${worst.label}經常含高GI食物（${Math.round(highGIShare * 100)}% 餐次）`,
      suggestion: {
        action: `${worst.label}改低GI主食或先吃蔬菜、蛋白質再吃澱粉`,
        estDrop: [15, 25],
      },
    };
  }

  // ③ Carb-heavy
  if (worst.avgCarbs >= 55) {
    return {
      cause: `${worst.label}碳水偏高（平均 ${Math.round(worst.avgCarbs)}g）`,
      suggestion: {
        action: `${worst.label}減少約 ¼ 份量主食`,
        estDrop: [12, 20],
      },
    };
  }

  // ④ Generic — fast spike, no clear single cause
  return {
    cause: `${worst.label}餐後血糖上升較快`,
    suggestion: {
      action: `調整進食順序（蔬菜→蛋白質→澱粉）或飯後散步 10 分鐘`,
      estDrop: [10, 18],
    },
  };
}

export function computeMealPatternInsights(glucoseReadings, meals, days = 14) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;

  const readings = glucoseReadings
    .map(r => ({ ...r, _ts: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a._ts - b._ts);

  // Bucket per meal type
  const buckets = {}; // type → { rises, carbs, proteins, highGICount }

  for (const meal of meals) {
    const mealTs = new Date(meal.timestamp).getTime();
    if (mealTs < cutoff) continue;
    const type = meal.mealType;
    if (!MEAL_LABELS[type]) continue;

    // Pre-meal BG
    let preBG = meal.preMealBG ?? null;
    if (preBG == null) {
      const pre = readings.filter(r => r._ts >= mealTs - 45 * 60000 && r._ts <= mealTs);
      if (pre.length) preBG = pre[pre.length - 1].value;
    }
    if (preBG == null) continue;

    const peak = findPeak(readings, mealTs + 60 * 60000, mealTs + 150 * 60000);
    if (peak == null) continue;

    const rise = peak - preBG;
    if (rise < -20) continue; // implausible — skip noise

    if (!buckets[type]) buckets[type] = { rises: [], carbs: [], proteins: [], highGICount: 0 };
    buckets[type].rises.push(rise);
    buckets[type].carbs.push(meal.carbs || 0);
    buckets[type].proteins.push(meal.protein || 0);
    if (meal.highGI?.length > 0) buckets[type].highGICount++;
  }

  // Aggregate, keep only meal types with enough samples
  const summaries = Object.entries(buckets)
    .filter(([, b]) => b.rises.length >= MIN_SAMPLES)
    .map(([type, b]) => ({
      type,
      label: MEAL_LABELS[type],
      avgRise: Math.round(avg(b.rises)),
      avgCarbs: avg(b.carbs) || 0,
      avgProtein: avg(b.proteins) || 0,
      highGICount: b.highGICount,
      count: b.rises.length,
    }));

  if (summaries.length < 2) return null; // need ≥2 comparable meal types

  summaries.sort((a, b) => b.avgRise - a.avgRise);
  const worst = summaries[0];
  // Reference = lowest-rising other meal type
  const ref = summaries[summaries.length - 1];
  if (worst.type === ref.type || ref.avgRise <= 0) return null;

  const pctHigher = Math.round((worst.avgRise - ref.avgRise) / ref.avgRise * 100);
  if (pctHigher < 15) return null; // gap too small to be meaningful

  const { cause, suggestion } = inferCause(worst, ref.avgRise);

  return {
    days,
    worst: { label: worst.label, avgRise: worst.avgRise, count: worst.count },
    ref: { label: ref.label, avgRise: ref.avgRise },
    pctHigher,
    cause,
    suggestion,
    allMeals: summaries.map(s => ({ label: s.label, avgRise: s.avgRise, count: s.count })),
  };
}
