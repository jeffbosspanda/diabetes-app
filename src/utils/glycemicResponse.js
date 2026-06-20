// Classify a meal's expected glycemic response from its macros + GI signal.
// Drives both the BG predictor (absorption curve + onset lag) and the UI labels.
//
// Types:
//   fast            快速升糖 — high-GI / simple carbs; early sharp peak (~30–60min).
//   delayed         延遲升糖 — low-GI / complex carbs; slower, steadier rise.
//   fatProtein      高脂高蛋白延遲升糖 — fat/protein heavy; gastric emptying slows,
//                   BG peak pushed late (2–4h) and prolonged; risk of late high.
//   minimal         低碳水 — little carbohydrate, minimal BG impact.
//
// peakMin / lagMin / absMin are used by the predictor: carbs start absorbing after
// lagMin and finish by lagMin+absMin (longer & later for fat/protein meals).
export function classifyGlycemicResponse({ carbs = 0, protein = 0, fat = 0, highGICount = 0, highGI } = {}) {
  // Accept either an explicit highGICount OR a highGI array (parseMealText returns
  // the latter). Without this, passing an analysis object straight in silently
  // reads highGICount=0, so a high-GI meal (e.g. 葡萄糖) would be mislabelled
  // 緩慢升糖 even while its per-food row shows 快速升糖.
  const hiGI = highGICount || (Array.isArray(highGI) ? highGI.length : 0);
  const highFat = fat >= 20;
  const highProtein = protein >= 25;

  if (carbs < 10 && !highFat && !highProtein) {
    return {
      type: 'minimal', label: '低升糖', emoji: '🟢', color: '#22c55e',
      peakMin: 60, lagMin: 0, absMin: 90,
      note: '碳水偏低，對血糖影響小。',
    };
  }

  if (highFat || highProtein) {
    return {
      type: 'fatProtein', label: '高脂高蛋白·延遲升糖', emoji: '🟣', color: '#a855f7',
      peakMin: 180, lagMin: 30, absMin: 300,
      note: `脂肪 ${Math.round(fat)}g／蛋白 ${Math.round(protein)}g 偏高，胃排空變慢，血糖高峰延後（約 2–4 小時）且持久；太早打餐前胰島素易先低後高，可考慮延後或分次注射。`,
    };
  }

  if (hiGI > 0) {
    return {
      type: 'fast', label: '快速升糖', emoji: '🔴', color: '#ef4444',
      peakMin: 45, lagMin: 0, absMin: 90,
      note: '含高GI食物，血糖上升快、峰值早（約 30–60 分鐘）；提前注射、先吃菜與蛋白質、最後吃澱粉可削平峰值。',
    };
  }

  return {
    type: 'delayed', label: '緩慢升糖', emoji: '🟡', color: '#f59e0b',
    peakMin: 120, lagMin: 10, absMin: 180,
    note: '以低GI／複合碳水為主，血糖上升較緩、較平穩。',
  };
}

// Convenience: classify from a stored meal record (uses highGI array length).
export function classifyMeal(meal) {
  if (!meal) return null;
  return classifyGlycemicResponse({
    carbs: meal.carbs ?? 0,
    protein: meal.protein ?? 0,
    fat: meal.fat ?? 0,
    highGICount: meal.highGI?.length ?? 0,
  });
}

// Classify a single food item from parseMealFoods ({ carbs, protein, fat, gi }).
export function classifyFood(food) {
  if (!food) return null;
  return classifyGlycemicResponse({
    carbs: food.carbs ?? 0,
    protein: food.protein ?? 0,
    fat: food.fat ?? 0,
    highGICount: (food.gi ?? 0) >= 70 ? 1 : 0,
  });
}
