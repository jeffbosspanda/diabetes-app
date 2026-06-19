// ── Food → BG Impact Ranking (carb-weighted) ─────────────────────────────────
// For each meal: impact = postMealPeak(60–150 min) − preMealBG
// Each food's share = its_carbs / meal_total_carbs
// Attributed impact = impact × carb_share
// This prevents zero-carb foods (chicken, greens) from inflating their ranking.

import { parseMealFoods } from './foodParser.js';

function findPeak(readings, from, to) {
  const win = readings.filter(r => r._ts >= from && r._ts <= to);
  return win.length ? Math.max(...win.map(r => r.value)) : null;
}

export function computeFoodImpactRanking(glucoseReadings, meals, days = 30) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const recentMeals = meals.filter(m => new Date(m.timestamp).getTime() >= cutoff);
  if (!recentMeals.length) return [];

  const readings = glucoseReadings
    .map(r => ({ ...r, _ts: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a._ts - b._ts);

  const foodImpacts = new Map(); // foodName → [weightedImpact, ...]

  for (const meal of recentMeals) {
    const mealTs = new Date(meal.timestamp).getTime();

    // Pre-meal BG: stored value first, else closest reading ≤45 min before meal
    let preBG = meal.preMealBG ?? null;
    if (preBG == null) {
      const pre = readings.filter(r => r._ts >= mealTs - 45 * 60000 && r._ts <= mealTs);
      if (pre.length) preBG = pre[pre.length - 1].value;
    }
    if (preBG == null) continue;

    // Post-meal peak 60–150 min after meal
    const peak = findPeak(readings, mealTs + 60 * 60000, mealTs + 150 * 60000);
    if (peak == null) continue;

    const impact = peak - preBG;
    if (impact <= 5) continue; // negligible spike

    // Per-food carb breakdown
    const foods = parseMealFoods(meal.foods || '');
    if (!foods.length) continue;

    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    if (totalCarbs === 0) continue; // no carb data — can't attribute impact

    for (const food of foods) {
      const carbShare = food.carbs / totalCarbs;
      const weightedImpact = impact * carbShare;
      if (weightedImpact < 1) continue; // negligible contribution

      if (!foodImpacts.has(food.name)) foodImpacts.set(food.name, []);
      foodImpacts.get(food.name).push(weightedImpact);
    }
  }

  const ranking = [];
  for (const [name, impacts] of foodImpacts.entries()) {
    const avg = Math.round(impacts.reduce((s, v) => s + v, 0) / impacts.length);
    ranking.push({ food: name, avgImpact: avg, count: impacts.length });
  }

  return ranking.sort((a, b) => b.avgImpact - a.avgImpact).slice(0, 10);
}
