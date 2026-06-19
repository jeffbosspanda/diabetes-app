// ── Pending-insulin reminders ────────────────────────────────────────────
// Detects meals that should have a rapid-insulin dose but don't yet, and
// late-night eating. Used to nudge the user to log / give an injection.

const LOOKBACK_MS    = 4 * 60 * 60 * 1000;  // only consider meals in last 4h
const MATCH_WINDOW   = 30 * 60 * 1000;      // rapid dose within ±30 min counts as covered
const MIN_CARBS      = 10;                   // ignore trivial-carb meals
const LATE_HOUR      = 21;                    // meals at/after 21:00 are "late"
const GRACE_MS       = 15 * 60 * 1000;       // give 15 min after meal before nagging

const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜', snack: '點心' };

export function findMealsNeedingInsulin(meals, insulinLogs, now = Date.now()) {
  const result = [];

  for (const m of meals) {
    const mealTs = new Date(m.timestamp).getTime();
    if (now - mealTs > LOOKBACK_MS) continue;        // too old
    if (now - mealTs < GRACE_MS) continue;            // just ate, give grace period
    if ((m.carbs || 0) < MIN_CARBS) continue;         // negligible carbs

    // covered if any 餐前胰島素（速效/短效）dose within ±30 min of the meal
    const covered = insulinLogs.some(l =>
      (l.brandType === 'rapid' || l.brandType === 'short') &&
      Math.abs(new Date(l.timestamp).getTime() - mealTs) <= MATCH_WINDOW
    );
    if (covered) continue;

    const hour = new Date(m.timestamp).getHours();
    result.push({
      meal: m,
      mealTs,
      mealLabel: MEAL_LABELS[m.mealType] || '餐點',
      carbs: Math.round(m.carbs || 0),
      late: hour >= LATE_HOUR || hour < 4,
      minutesAgo: Math.round((now - mealTs) / 60000),
    });
  }

  return result.sort((a, b) => b.mealTs - a.mealTs);
}

export function buildInsulinReminderMessage(pending) {
  if (!pending.length) return null;
  const p = pending[0];
  const lateNote = p.late ? '（已是深夜，注意餐後高血糖）' : '';
  return `${p.mealLabel}（約 ${p.carbs}g 碳水，${p.minutesAgo} 分鐘前）尚未記錄胰島素注射，記得注射並登記${lateNote}`;
}
