// ── Gamification: achievement engine ──────────────────────────────────────
// Computes friendly, encouraging achievements from the user's own data.
// READ-ONLY — never mutates glucose / meals / insulin. All thresholds are
// clinically-flavoured but tuned to motivate, not to give medical advice.

const DAY = 86400000;

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function mean(arr) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null; }
function clampPct(v, t) { return Math.max(0, Math.min(100, Math.round((v / t) * 100))); }

// Estimated A1c (GMI) from mean glucose (mg/dL): GMI% = 3.31 + 0.02392 × mean
function gmi(meanBG) { return Math.round((3.31 + 0.02392 * meanBG) * 10) / 10; }

function groupByDay(readings) {
  const byDay = {};
  for (const r of readings) {
    if (r?.value == null || !r.timestamp) continue;
    (byDay[dayKey(r.timestamp)] ||= []).push(r.value);
  }
  return byDay;
}

// Walk calendar days backward from today (or yesterday if today is sparse),
// counting consecutive days where predicate(dayValues) holds. A day with too
// few readings stops the streak (we can't confirm it).
function dailyStreak(byDay, predicate, minSamples = 6) {
  let streak = 0;
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  const todayVals = byDay[dayKey(Date.now())];
  if (!todayVals || todayVals.length < minSamples) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    const vals = byDay[dayKey(cursor.getTime())];
    if (!vals || vals.length < minSamples) break;
    if (!predicate(vals)) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function tirOf(vals) { return vals.filter(v => v >= 70 && v <= 180).length / vals.length * 100; }

// Consecutive days with ≥1 logged meal (engagement streak)
function mealLoggingStreak(meals) {
  const set = new Set(meals.filter(m => m.timestamp).map(m => dayKey(m.timestamp)));
  let streak = 0;
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  if (!set.has(dayKey(Date.now()))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    if (!set.has(dayKey(cursor.getTime()))) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Count nights (last `days`) where overnight 00:00–06:00 BG is calm:
// range ≤ 40 mg/dL and mean within 80–140.
function overnightStability(readings, days = 7) {
  const cutoff = Date.now() - days * DAY;
  const byNight = {};
  for (const r of readings) {
    if (r?.value == null || !r.timestamp) continue;
    const t = new Date(r.timestamp);
    if (t.getTime() < cutoff || t.getHours() >= 6) continue;
    (byNight[dayKey(r.timestamp)] ||= []).push(r.value);
  }
  let stable = 0, total = 0;
  for (const k in byNight) {
    const v = byNight[k];
    if (v.length < 3) continue;
    total++;
    const range = Math.max(...v) - Math.min(...v);
    const m = mean(v);
    if (range <= 40 && m >= 80 && m <= 140) stable++;
  }
  return { stable, total };
}

// Count meals (last `days`) whose post-meal rise is gentle (peak − pre ≤ 50
// within 2h) — i.e. a "normal" post-prandial slope.
function normalPostMealCount(readings, meals, days = 30) {
  const cutoff = Date.now() - days * DAY;
  const sorted = readings
    .filter(r => r?.value != null && r.timestamp)
    .map(r => ({ v: r.value, t: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a.t - b.t);
  let count = 0, evaluated = 0;
  for (const meal of meals) {
    if (!meal.timestamp) continue;
    const mt = new Date(meal.timestamp).getTime();
    if (mt < cutoff) continue;
    let pre = meal.preMealBG;
    if (pre == null) {
      const before = sorted.filter(r => r.t >= mt - 45 * 60000 && r.t <= mt);
      if (before.length) pre = before[before.length - 1].v;
    }
    if (pre == null) continue;
    const post = sorted.filter(r => r.t >= mt && r.t <= mt + 120 * 60000);
    if (!post.length) continue;
    evaluated++;
    const peak = Math.max(...post.map(r => r.v));
    if (peak - pre <= 50) count++;
  }
  return { count, evaluated };
}

// Estimated-A1c trend: recent 14d vs prior 14d
function a1cTrend(readings) {
  const now = Date.now();
  const valsIn = (lo, hi) => readings
    .filter(r => r?.value != null && r.timestamp)
    .filter(r => { const t = new Date(r.timestamp).getTime(); return t > lo && t <= hi; })
    .map(r => r.value);
  const recent = valsIn(now - 14 * DAY, now);
  const prior = valsIn(now - 28 * DAY, now - 14 * DAY);
  const recentGMI = recent.length ? gmi(mean(recent)) : null;
  if (recent.length < 20 || prior.length < 20) {
    return { status: 'insufficient', recentGMI };
  }
  const priorGMI = gmi(mean(prior));
  const delta = Math.round((recentGMI - priorGMI) * 10) / 10;
  return { status: 'ok', recentGMI, priorGMI, delta, improved: delta <= -0.1 };
}

// ── Main ───────────────────────────────────────────────────────────────────
export function computeAchievements(state) {
  const readings = state.glucoseReadings || [];
  const meals = state.meals || [];
  const byDay = groupByDay(readings);

  const tirStreak = dailyStreak(byDay, v => tirOf(v) > 80);
  const noHypoStreak = dailyStreak(byDay, v => !v.some(x => x < 70));
  const night = overnightStability(readings, 7);
  const postMeal = normalPostMealCount(readings, meals, 30);
  const a1c = a1cTrend(readings);
  const logStreak = mealLoggingStreak(meals);

  const enoughData = readings.length >= 10;

  const list = [
    {
      id: 'tir7',
      emoji: '🛡️',
      name: '守備鐵壁',
      blurb: '連續 7 天 TIR > 80%',
      tagline: '血糖防線滴水不漏！',
      unlocked: tirStreak >= 7,
      value: Math.min(tirStreak, 7),
      target: 7,
      unit: '天',
      detail: enoughData
        ? (tirStreak >= 7 ? `已連續 ${tirStreak} 天達標，繼續守住！` : `目前連續 ${tirStreak} 天 TIR>80%，再 ${7 - tirStreak} 天解鎖`)
        : '同步血糖後開始計算',
      insufficient: !enoughData,
    },
    {
      id: 'noHypo14',
      emoji: '🧤',
      name: '低血糖絕緣體',
      blurb: '連續 14 天無低血糖（<70）',
      tagline: '穩穩接住每一球，零失誤！',
      unlocked: noHypoStreak >= 14,
      value: Math.min(noHypoStreak, 14),
      target: 14,
      unit: '天',
      detail: enoughData
        ? (noHypoStreak >= 14 ? `已連續 ${noHypoStreak} 天無低血糖！` : `目前連續 ${noHypoStreak} 天無低血糖，再 ${14 - noHypoStreak} 天解鎖`)
        : '同步血糖後開始計算',
      insufficient: !enoughData,
    },
    {
      id: 'night',
      emoji: '🌙',
      name: '夜貓守護者',
      blurb: '近 7 晚有 5 晚深夜血糖平穩',
      tagline: '一夜好眠，血糖不搗蛋～',
      unlocked: night.stable >= 5,
      value: Math.min(night.stable, 5),
      target: 5,
      unit: '晚',
      detail: night.total === 0
        ? '尚無深夜血糖資料（00:00–06:00）'
        : (night.stable >= 5 ? `近 7 晚有 ${night.stable} 晚平穩，睡得安穩！` : `近 7 晚平穩 ${night.stable} 晚，再 ${5 - night.stable} 晚解鎖`),
      insufficient: night.total === 0,
    },
    {
      id: 'postMeal',
      emoji: '🍽️',
      name: '餐後穩穩',
      blurb: '累積 20 餐飯後血糖斜率正常',
      tagline: '吃飽飽，血糖不暴衝！',
      unlocked: postMeal.count >= 20,
      value: Math.min(postMeal.count, 20),
      target: 20,
      unit: '餐',
      detail: postMeal.evaluated === 0
        ? '記錄飲食並同步餐後血糖後開始計算'
        : (postMeal.count >= 20 ? `已累積 ${postMeal.count} 餐斜率正常，超穩！` : `近 30 天 ${postMeal.count} 餐飯後平穩（共評估 ${postMeal.evaluated} 餐）`),
      insufficient: postMeal.evaluated === 0,
    },
    {
      id: 'a1cDown',
      emoji: '📉',
      name: 'A1c 下坡王',
      blurb: '預估糖化血色素較前期下降',
      tagline: '一路向下，控糖有成！',
      unlocked: a1c.status === 'ok' && a1c.improved,
      value: a1c.status === 'ok' && a1c.improved ? 1 : 0,
      target: 1,
      unit: '',
      detail: a1c.status !== 'ok'
        ? (a1c.recentGMI != null ? `目前預估 A1c 約 ${a1c.recentGMI}%，需 4 週資料比較趨勢` : '需累積約 4 週血糖資料')
        : (a1c.improved
            ? `預估 A1c ${a1c.priorGMI}% → ${a1c.recentGMI}%（↓${Math.abs(a1c.delta)}），漂亮！`
            : `預估 A1c ${a1c.priorGMI}% → ${a1c.recentGMI}%（${a1c.delta >= 0 ? '+' : ''}${a1c.delta}），再加把勁`),
      insufficient: a1c.status !== 'ok',
      progressLabel: a1c.status === 'ok' ? `${a1c.recentGMI}%` : (a1c.recentGMI != null ? `${a1c.recentGMI}%` : '—'),
    },
    {
      id: 'logStreak7',
      emoji: '🔥',
      name: '記錄不斷電',
      blurb: '連續 7 天記錄飲食',
      tagline: '習慣養成中，火力全開！',
      unlocked: logStreak >= 7,
      value: Math.min(logStreak, 7),
      target: 7,
      unit: '天',
      detail: logStreak >= 7 ? `已連續 ${logStreak} 天記錄，自律滿分！` : `目前連續 ${logStreak} 天記錄飲食，再 ${7 - logStreak} 天解鎖`,
      insufficient: false,
    },
  ];

  // Derive pct / progress text for each
  for (const a of list) {
    a.pct = a.unlocked ? 100 : clampPct(a.value, a.target);
    a.progressText = a.progressLabel ?? (a.target > 1 ? `${a.value} / ${a.target}${a.unit}` : (a.unlocked ? '已解鎖' : '未解鎖'));
  }

  const unlockedCount = list.filter(a => a.unlocked).length;
  return {
    achievements: list,
    unlockedCount,
    total: list.length,
    // For the dashboard teaser: closest-to-unlock locked achievement
    nextUp: list
      .filter(a => !a.unlocked && !a.insufficient)
      .sort((a, b) => b.pct - a.pct)[0] || null,
  };
}
