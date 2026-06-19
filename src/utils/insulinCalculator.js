export const INSULIN_BRANDS = {
  rapid: [
    { name: 'NovoRapid', company: 'Novo Nordisk', type: '速效', onset: '10-20min', peak: '1-3hr', duration: '3-5hr' },
    { name: 'Humalog', company: 'Eli Lilly', type: '速效', onset: '15min', peak: '30-90min', duration: '2-4hr' },
    { name: 'Apidra', company: 'Sanofi', type: '速效', onset: '10-15min', peak: '1-2hr', duration: '3-5hr' },
    { name: 'Fiasp', company: 'Novo Nordisk', type: '超速效', onset: '2-5min', peak: '1-2hr', duration: '3-5hr' },
    { name: 'Lyumjev', company: 'Eli Lilly', type: '超速效', onset: '2-5min', peak: '1hr', duration: '2-4hr' },
  ],
  // 短效＝一般人胰島素（Regular / R），與速效類似物不同：起效慢、峰值晚、作用久，
  // 須餐前約 30 分鐘注射。
  short: [
    { name: 'Humulin R', company: 'Eli Lilly', type: '短效', onset: '30min', peak: '2-4hr', duration: '6-8hr' },
    { name: 'Actrapid', company: 'Novo Nordisk', type: '短效', onset: '30min', peak: '2-4hr', duration: '6-8hr' },
    { name: 'Novolin R', company: 'Novo Nordisk', type: '短效', onset: '30min', peak: '2-4hr', duration: '6-8hr' },
    { name: 'Insuman Rapid', company: 'Sanofi', type: '短效', onset: '30min', peak: '2-4hr', duration: '7-9hr' },
  ],
  long: [
    { name: 'Lantus', company: 'Sanofi', type: '長效', onset: '1-2hr', peak: 'Flat', duration: '24hr' },
    { name: 'Toujeo', company: 'Sanofi', type: '長效', onset: '6hr', peak: 'Flat', duration: '36hr+' },
    { name: 'Tresiba', company: 'Novo Nordisk', type: '超長效', onset: '1hr', peak: 'Flat', duration: '42hr+' },
    { name: 'Levemir', company: 'Novo Nordisk', type: '長效', onset: '1-2hr', peak: 'Flat', duration: '16-24hr' },
    { name: 'Basaglar', company: 'Eli Lilly', type: '長效', onset: '1-2hr', peak: 'Flat', duration: '24hr' },
  ],
};

// ── Brand pharmacokinetics ────────────────────────────────────────────────
// IMPORTANT: 1 U has the SAME glucose-lowering potency across all rapid
// analogs and regular insulin. Brand does NOT change ICR/ISF unit counts.
// What changes is TIMING (pre-bolus) and insulin-on-board DURATION.
export const BRAND_PHARMA = {
  NovoRapid: { kind: 'rapid', prebolus: 15, iobHours: 4, timing: '餐前 10–15 分鐘注射，吸收與血糖上升較同步' },
  Humalog:   { kind: 'rapid', prebolus: 15, iobHours: 4, timing: '餐前 15 分鐘注射效果最佳' },
  Apidra:    { kind: 'rapid', prebolus: 15, iobHours: 4, timing: '餐前 10–15 分鐘注射' },
  Fiasp:     { kind: 'ultra', prebolus: 2,  iobHours: 3, timing: '超速效：可餐前 0–2 分鐘或開動後立即注射' },
  Lyumjev:   { kind: 'ultra', prebolus: 2,  iobHours: 3, timing: '超速效：可餐前 0–2 分鐘或開動後注射' },
  // 短效（Regular / R）：起效慢、作用久，必須餐前 30 分鐘注射。
  'Humulin R':     { kind: 'short', prebolus: 30, iobHours: 7, timing: '短效（一般人胰島素）：須餐前 30 分鐘注射' },
  'Actrapid':      { kind: 'short', prebolus: 30, iobHours: 7, timing: '短效（一般人胰島素）：須餐前 30 分鐘注射' },
  'Novolin R':     { kind: 'short', prebolus: 30, iobHours: 7, timing: '短效（一般人胰島素）：須餐前 30 分鐘注射' },
  'Insuman Rapid': { kind: 'short', prebolus: 30, iobHours: 8, timing: '短效（一般人胰島素）：須餐前 30 分鐘注射' },
  Regular:   { kind: 'short', prebolus: 30, iobHours: 7, timing: '短效（一般人胰島素）：須餐前 30 分鐘注射' },
};

export function getBrandProfile(name) {
  return BRAND_PHARMA[name] || BRAND_PHARMA.NovoRapid;
}

// 餐前胰島素 = 速效（analog）＋ 短效（Regular）。兩者每單位降糖力相同，
// ICR/ISF 計算一致；差別在注射時機與殘餘胰島素（IOB）持續時間。
export const BOLUS_TYPES = ['rapid', 'short'];
export const isBolus = (brandType) => BOLUS_TYPES.includes(brandType);
export const bolusLabel = (brandType) => (brandType === 'short' ? '短效' : '速效');
// IOB 作用時數：短效約 7h，速效約 4h。
export const bolusIOBHours = (brandType) => (brandType === 'short' ? 7 : 4);

// Minimum data requirements before making dose recommendations
export const MIN_DATA_REQUIREMENTS = {
  glucoseReadings: 7,   // at least 7 days of readings
  meals: 7,
  insulinLogs: 5,
  profile: true,
};

export function checkDataSufficiency(state) {
  const flags = [];
  if (!state.profile) flags.push({ field: 'profile', message: '尚未建立病患基本資料（體重、年齡、性別、體脂、肌肉量）' });
  else {
    const p = state.profile;
    if (!p.weight) flags.push({ field: 'weight', message: '缺少體重資料' });
    if (!p.age) flags.push({ field: 'age', message: '缺少年齡資料' });
    if (!p.gender) flags.push({ field: 'gender', message: '缺少性別資料' });
    if (!p.bodyFat) flags.push({ field: 'bodyFat', message: '缺少體脂率資料' });
    if (!p.muscleMass) flags.push({ field: 'muscleMass', message: '缺少肌肉量資料' });
  }
  if (state.glucoseReadings.length < MIN_DATA_REQUIREMENTS.glucoseReadings)
    flags.push({ field: 'glucose', message: `血糖紀錄不足（目前 ${state.glucoseReadings.length} 筆，需至少 ${MIN_DATA_REQUIREMENTS.glucoseReadings} 筆）` });
  if (state.meals.length < MIN_DATA_REQUIREMENTS.meals)
    flags.push({ field: 'meals', message: `飲食紀錄不足（目前 ${state.meals.length} 筆，需至少 ${MIN_DATA_REQUIREMENTS.meals} 筆）` });
  if (state.insulinLogs.length < MIN_DATA_REQUIREMENTS.insulinLogs)
    flags.push({ field: 'insulin', message: `胰島素注射紀錄不足（目前 ${state.insulinLogs.length} 筆，需至少 ${MIN_DATA_REQUIREMENTS.insulinLogs} 筆）` });
  return flags;
}

// Calculate TDD from recent insulin logs (last 14 days)
export function calculateTDD(insulinLogs) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = insulinLogs.filter(l => new Date(l.timestamp) > cutoff);
  if (recent.length === 0) return null;
  const days = Math.max(1, (Date.now() - Math.min(...recent.map(l => new Date(l.timestamp)))) / 86400000);
  const total = recent.reduce((s, l) => s + (l.units || 0), 0);
  return total / days;
}

// Derive ICR and ISF from TDD
export function deriveICRandISF(tdd, bgUnit = 'mg/dL') {
  if (!tdd || tdd <= 0) return { icr: null, isf: null };
  const icr = Math.round(500 / tdd);
  const isf = bgUnit === 'mg/dL' ? Math.round(1700 / tdd) : Math.round(94 / tdd);
  return { icr, isf };
}

// Adaptive ICR/ISF adjustment based on post-meal BG response
export function adaptICRandISF(meals, glucoseReadings, insulinLogs, currentICR, currentISF) {
  if (!currentICR || !currentISF) return { icr: currentICR, isf: currentISF };
  const paired = [];
  for (const meal of meals) {
    if (!meal.carbs || !meal.preMealBG) continue;
    const mealTime = new Date(meal.timestamp).getTime();
    // Find insulin dose around meal time (±30min)
    const dose = insulinLogs.find(l =>
      Math.abs(new Date(l.timestamp).getTime() - mealTime) < 30 * 60 * 1000
    );
    if (!dose) continue;
    // Find post-meal BG 2h later
    const postBG = glucoseReadings.find(r =>
      new Date(r.timestamp).getTime() > mealTime + 90 * 60 * 1000 &&
      new Date(r.timestamp).getTime() < mealTime + 180 * 60 * 1000
    );
    if (!postBG) continue;
    paired.push({ carbs: meal.carbs, preBG: meal.preMealBG, postBG: postBG.value, dose: dose.units });
  }
  if (paired.length < 3) return { icr: currentICR, isf: currentISF };

  // Simple regression: expected vs actual BG rise
  let icrAdj = 0, count = 0;
  for (const p of paired) {
    const expectedDrop = p.dose * currentISF;
    const actualDrop = p.preBG - p.postBG;
    const netCarbEffect = p.carbs / currentICR - p.dose;
    if (Math.abs(netCarbEffect) > 0.1) {
      icrAdj += (actualDrop - expectedDrop) / netCarbEffect;
      count++;
    }
  }
  if (count === 0) return { icr: currentICR, isf: currentISF };
  const adjFactor = 1 + (icrAdj / count) * 0.1;
  return {
    icr: Math.max(5, Math.min(30, Math.round(currentICR * adjFactor))),
    isf: currentISF,
  };
}

// Estimate TDD from weight when no logs available (0.5 U/kg is a conservative starting point)
export function estimateTDDFromWeight(weight) {
  if (!weight || weight <= 0) return null;
  return Math.round(weight * 0.5);
}

const EXERCISE_ADJ = {
  light:    { before: 0.90, after: 0.90, label: '輕度' },
  moderate: { before: 0.85, after: 0.80, label: '中度' },
  vigorous: { before: 0.75, after: 0.70, label: '高強度' },
};

// ── Rapid-insulin injection-timing recommendation ─────────────────────────
// Adjusts WHEN to inject (not how much) based on the meal's digestion profile:
//   • High-GI / low-fat carbs spike fast  → inject EARLIER (more pre-bolus).
//   • High-fat / high-protein meals digest slowly, BG peak is delayed
//     → inject at meal start (or after), and consider a split dose.
// Brand pharmacokinetics set the baseline pre-bolus (Fiasp/Lyumjev are ultra-fast).
export function recommendInjectionTiming({ carbs = 0, protein = 0, fat = 0, highGICount = 0, brand }) {
  const profile = brand ? getBrandProfile(brand) : BRAND_PHARMA.NovoRapid;
  const base = profile.prebolus;            // brand default minutes before meal
  const ultra = profile.kind === 'ultra';   // Fiasp / Lyumjev
  const hasHighGI = highGICount > 0;
  const highFat = fat >= 20;
  const highProtein = protein >= 25;
  const slowDigest = highFat || highProtein;
  const lowCarb = carbs < 15;

  // mode: early | standard | delayed | correction
  if (slowDigest && !hasHighGI) {
    return {
      mode: 'delayed',
      offsetMin: ultra ? -10 : 0,
      label: ultra ? '開動後 5–10 分鐘注射' : '餐前 0 分鐘～開動時注射',
      reason: `本餐脂肪 ${Math.round(fat)}g／蛋白質 ${Math.round(protein)}g 偏高，胃排空變慢、血糖上升延後；太早注射易先低血糖、之後又高血糖。`,
      splitNote: (carbs >= 40 && highFat)
        ? '高脂高碳水餐（披薩、炸物、咖哩飯）可與醫師討論「分次注射」：先打約 60%，1.5–2 小時後依血糖補打約 40%，對應延後的血糖高峰。'
        : null,
      brand: profile === BRAND_PHARMA.NovoRapid && !brand ? 'NovoRapid' : brand,
    };
  }
  if (hasHighGI) {
    return {
      mode: 'early',
      offsetMin: ultra ? 5 : Math.max(base, 20),
      label: ultra ? '餐前 5 分鐘注射' : '餐前 15–20 分鐘注射',
      reason: '本餐含高GI食物，血糖上升快；提前注射讓胰島素先起效，並先吃蔬菜、蛋白質、最後吃澱粉，可削平血糖峰值。',
      splitNote: null,
      brand: brand || 'NovoRapid',
    };
  }
  if (lowCarb) {
    return {
      mode: 'correction',
      offsetMin: base,
      label: '以血糖校正為主、注意低血糖',
      reason: `碳水偏低（約 ${Math.round(carbs)}g），餐食劑量小，以校正劑量為主，注意避免注射後低血糖。`,
      splitNote: null,
      brand: brand || 'NovoRapid',
    };
  }
  return {
    mode: 'standard',
    offsetMin: base,
    label: profile.timing,
    reason: '一般混合餐，依品牌建議時機注射即可。',
    splitNote: null,
    brand: brand || 'NovoRapid',
  };
}

// Main dose recommendation
export function recommendDose({
  currentBG, targetBG = 100, carbs, mealType, icr, isf,
  exerciseBefore, exerciseAfter,
  exerciseBeforeType = 'moderate', exerciseAfterType = 'moderate',
  brand, protein = 0, fat = 0, highGICount = 0,
}) {
  if (!icr || !isf || currentBG === undefined || currentBG === null || !carbs) return null;

  const correctionDose = (currentBG - targetBG) / isf;
  const carbDose = carbs / icr;
  let totalDose = correctionDose + carbDose;

  const bAdj = exerciseBefore  ? EXERCISE_ADJ[exerciseBeforeType]?.before  ?? 0.85 : 1;
  const aAdj = exerciseAfter   ? EXERCISE_ADJ[exerciseAfterType]?.after    ?? 0.80 : 1;
  totalDose *= bAdj * aAdj;

  if (mealType === 'breakfast') totalDose *= 1.1;

  // Brand affects TIMING only — unit potency is identical across analogs.
  const profile = brand ? getBrandProfile(brand) : null;

  const notes = [
    exerciseBefore ? `餐前${EXERCISE_ADJ[exerciseBeforeType]?.label ?? ''}運動，劑量減少 ${Math.round((1 - bAdj) * 100)}%` : null,
    exerciseAfter  ? `餐後${EXERCISE_ADJ[exerciseAfterType]?.label  ?? ''}運動計畫，劑量減少 ${Math.round((1 - aAdj) * 100)}%` : null,
    mealType === 'breakfast' ? '早餐胰島素抗性較高，劑量增加 10%' : null,
    profile ? `${brand}：${profile.timing}` : null,
  ].filter(Boolean);

  return {
    correctionDose: Math.round(correctionDose * 10) / 10,
    carbDose:        Math.round(carbDose       * 10) / 10,
    totalDose:       Math.max(0, Math.round(totalDose * 10) / 10),
    notes,
    timing: profile ? { prebolus: profile.prebolus, iobHours: profile.iobHours, text: profile.timing } : null,
    injectionTiming: recommendInjectionTiming({ carbs, protein, fat, highGICount, brand }),
  };
}

// ── Regression correction proposal (opt-in) ───────────────────────────────
// Compares the currently-active ICR against what recent post-meal BG response
// suggests. Returns a proposal the UI can ask the user to approve.
export function proposeICRCorrection(meals, glucoseReadings, insulinLogs, activeICR, activeISF) {
  if (!activeICR || !activeISF) return { suggested: false };
  const { icr: suggestedICR } = adaptICRandISF(meals, glucoseReadings, insulinLogs, activeICR, activeISF);
  const delta = suggestedICR - activeICR;
  if (Math.abs(delta) < 1) return { suggested: false, activeICR, suggestedICR };
  return {
    suggested: true,
    activeICR,
    suggestedICR,
    delta,
    direction: delta > 0 ? 'looser' : 'tighter',
    // looser ICR (bigger number) = less insulin per carb → fixes post-meal lows
    reason: delta > 0
      ? '近期餐後血糖偏低，系統建議「放寬」碳水比（每 U 覆蓋更多碳水，劑量略降）'
      : '近期餐後血糖偏高，系統建議「收緊」碳水比（每 U 覆蓋較少碳水，劑量略增）',
  };
}

// ── Basal (long-acting) adequacy assessment ──────────────────────────────
export function analyzeBasalAdequacy(glucoseReadings, insulinLogs) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;

  // Overnight readings: 00:00–07:00
  const overnight = glucoseReadings.filter(r => {
    const h = new Date(r.timestamp).getHours();
    return new Date(r.timestamp).getTime() > cutoff && h < 7;
  });

  // Fasting readings: 06:00–09:30 (first reading of day as proxy)
  const fasting = glucoseReadings.filter(r => {
    const d = new Date(r.timestamp);
    const h = d.getHours() + d.getMinutes() / 60;
    return d.getTime() > cutoff && h >= 6 && h <= 9.5;
  });

  // Recent long-acting doses
  const recentLong = insulinLogs.filter(l =>
    l.brandType === 'long' && new Date(l.timestamp).getTime() > cutoff
  );
  const avgLongDose = recentLong.length
    ? recentLong.reduce((s, l) => s + (l.units || 0), 0) / recentLong.length
    : null;

  if (overnight.length < 5 && fasting.length < 3) {
    return { status: 'insufficient_data', avgLongDose };
  }

  const sample = overnight.length >= 5 ? overnight : fasting;
  const avgBG = sample.reduce((s, r) => s + r.value, 0) / sample.length;
  const lowCount  = sample.filter(r => r.value < 70).length;
  const highCount = sample.filter(r => r.value > 140).length;
  const lowRatio  = lowCount / sample.length;
  const highRatio = highCount / sample.length;

  const avgFasting = fasting.length
    ? fasting.reduce((s, r) => s + r.value, 0) / fasting.length
    : null;

  if (lowRatio >= 0.2 || avgBG < 72) {
    return {
      status: 'too_high',
      severity: 'danger',
      avgBG: Math.round(avgBG),
      avgFasting: avgFasting ? Math.round(avgFasting) : null,
      lowCount, sampleSize: sample.length, avgLongDose,
      message: `夜間低血糖偏多（${lowCount}/${sample.length} 次低於 70 mg/dL），長效劑量可能過高`,
      suggestion: '建議減少長效胰島素 1–2 U，並與醫師討論',
    };
  }
  if (avgBG > 150 || (avgFasting && avgFasting > 140)) {
    return {
      status: 'too_low',
      severity: 'warning',
      avgBG: Math.round(avgBG),
      avgFasting: avgFasting ? Math.round(avgFasting) : null,
      highCount, sampleSize: sample.length, avgLongDose,
      message: `夜間/空腹血糖偏高（平均 ${Math.round(avgBG)} mg/dL），長效劑量可能不足`,
      suggestion: '建議增加長效胰島素 1–2 U，並與醫師討論',
    };
  }
  if (avgBG >= 80 && avgBG <= 130) {
    return {
      status: 'adequate',
      severity: 'good',
      avgBG: Math.round(avgBG),
      avgFasting: avgFasting ? Math.round(avgFasting) : null,
      avgLongDose,
      message: `夜間血糖控制良好（平均 ${Math.round(avgBG)} mg/dL）`,
      suggestion: null,
    };
  }
  return {
    status: 'borderline',
    severity: 'caution',
    avgBG: Math.round(avgBG),
    avgFasting: avgFasting ? Math.round(avgFasting) : null,
    avgLongDose,
    message: `夜間血糖稍偏高（平均 ${Math.round(avgBG)} mg/dL），建議持續觀察`,
    suggestion: '維持目前劑量，若持續偏高再考慮調整',
  };
}

// ── Rapid-acting dosing behavior analysis ────────────────────────────────
const MEAL_LABEL = { breakfast:'早餐', lunch:'午餐', dinner:'晚餐', lateSnack:'宵夜', snack:'點心' };

// Analyzes EVERY rapid injection in the window (meal bolus, correction, or
// unmatched), not only meal↔injection pairs.
export function analyzeRapidDosingHistory(meals, glucoseReadings, insulinLogs) {
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  const rapidShots = insulinLogs
    .filter(l => isBolus(l.brandType) && new Date(l.timestamp).getTime() > cutoff)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const maxIn = (lo, hi, anchor) => {
    const xs = glucoseReadings.filter(r => { const dt = new Date(r.timestamp).getTime() - anchor; return dt >= lo && dt <= hi; });
    return xs.length ? Math.max(...xs.map(r => r.value)) : null;
  };
  const minIn = (lo, hi, anchor) => {
    const xs = glucoseReadings.filter(r => { const dt = new Date(r.timestamp).getTime() - anchor; return dt >= lo && dt <= hi; });
    return xs.length ? Math.min(...xs.map(r => r.value)) : null;
  };

  const pairs = [];

  for (const inj of rapidShots) {
    const injTime = new Date(inj.timestamp).getTime();

    // nearest meal within ±45 min (may be none → correction / unlogged)
    const meal = meals
      .filter(m => Math.abs(new Date(m.timestamp).getTime() - injTime) < 45 * 60 * 1000)
      .sort((a, b) => Math.abs(new Date(a.timestamp) - injTime) - Math.abs(new Date(b.timestamp) - injTime))[0] || null;

    const isCorrection = !meal && (inj.mealType === 'correction' || (meal === null && (inj.currentBG || 0) > 0));
    const kind = meal ? 'meal' : isCorrection ? 'correction' : 'unmatched';
    const anchor = meal ? new Date(meal.timestamp).getTime() : injTime;

    // pre BG
    const preBG = meal?.preMealBG ?? inj.currentBG ?? (glucoseReadings
      .filter(r => { const dt = new Date(r.timestamp).getTime() - injTime; return dt >= -60*60*1000 && dt <= 15*60*1000; })
      .sort((a, b) => Math.abs(new Date(a.timestamp) - injTime) - Math.abs(new Date(b.timestamp) - injTime))[0]?.value ?? null);

    const peakBG = maxIn(45*60*1000, 180*60*1000, anchor);   // hyperglycemia peak
    const lateBG = minIn(120*60*1000, 210*60*1000, anchor);  // shown for context
    // CAREFUL hypo scan: lowest reading anywhere in the rapid-insulin action
    // window (injection → +5h), so a low at any point is caught, not just at 2–3.5h.
    const lowBG  = minIn(0, 300*60*1000, injTime);
    const hasData = peakBG !== null || lowBG !== null || lateBG !== null;

    // ── Post-prandial rise-rate (spike steepness) ──
    const earlyReadings = glucoseReadings
      .filter(r => { const dt = new Date(r.timestamp).getTime() - anchor; return dt >= 0 && dt <= 90*60*1000; })
      .map(r => ({ v: r.value, dt: (new Date(r.timestamp).getTime() - anchor) / 60000 }))
      .sort((a, b) => a.dt - b.dt);
    let riseRate = null, earlyRise = null, steepRise = false, riseCause = null;
    const riseEdu = [];
    if (preBG != null && earlyReadings.length) {
      const top = earlyReadings.reduce((m, x) => (x.v > m.v ? x : m), earlyReadings[0]);
      earlyRise = top.v - preBG;
      riseRate = +(earlyRise / Math.max(15, top.dt)).toFixed(2); // mg/dL per min
      steepRise = earlyRise >= 60 && top.dt <= 90;               // ≥60 mg/dL within 90 min
    }
    if (steepRise) {
      const highGI = (meal?.highGI?.length || 0) > 0;
      // "did not come back down" → insulin under-dosed
      const stillHigh = (lateBG != null && lateBG > 180) ||
                        (peakBG != null && peakBG > 180 && (lateBG == null || lateBG > 150));
      if (highGI && !stillHigh) {
        riseCause = 'highGI';
        riseEdu.push(`血糖快速上升但隨後回落，主因可能是高GI食物（${meal.highGI.map(h => h.name).join('、')}）。`);
        riseEdu.push('衛教：高GI食物建議餐前提前 15–20 分鐘注射、先吃蔬菜與蛋白質再吃澱粉，可削平血糖峰值。');
      } else if (stillHigh) {
        riseCause = highGI ? 'both' : 'dose';
        riseEdu.push(highGI
          ? '既含高GI食物、餐後血糖也未回落到目標，餐前胰島素劑量可能偏低。'
          : '血糖快速上升且未回落到目標，餐前胰島素劑量可能不足。');
        riseEdu.push('衛教：與醫師討論降低 ICR（每 U 覆蓋較少碳水＝劑量增加），並確認碳水估算與注射時機。');
      } else {
        riseCause = 'unknown';
        riseEdu.push('血糖上升過快，建議確認碳水估算、注射時機與食物 GI 值。');
      }
    }

    // Safety first: ANY low in the action window → not 達標 (hypo takes priority).
    let outcome = 'unknown', severity = null;
    const wentLow  = lowBG  !== null && lowBG  < 70;
    const wentHigh = peakBG !== null && peakBG > 180;
    if (wentLow) {
      outcome = 'low';
      severity = lowBG < 54 ? 'danger' : 'warning';
    } else if (wentHigh) {
      outcome = 'high';
      severity = peakBG > 250 ? 'danger' : 'warning';
    } else if (hasData) {
      // 達標 only when there was readable BG AND neither low nor high occurred
      outcome = 'good';
      severity = 'good';
    }

    pairs.push({
      kind, meal, injection: inj, preBG, peakBG, lateBG, lowBG,
      outcome, severity,
      alsoHigh: wentLow && wentHigh, // had a low but also spiked high
      riseRate, earlyRise, steepRise, riseCause, riseEdu,
      doseGiven: inj.units,
      carbs:     meal?.carbs ?? 0,
      mealType:  meal?.mealType ?? inj.mealType ?? 'correction',
      timestamp: inj.timestamp,
      dataMissing: outcome === 'unknown',
    });
  }

  if (pairs.length === 0) return { pairs: [], summary: null, recommendations: [] };

  const highCount = pairs.filter(p => p.outcome === 'high').length;
  const lowCount  = pairs.filter(p => p.outcome === 'low').length;
  const goodCount = pairs.filter(p => p.outcome === 'good').length;
  const unknownCount = pairs.filter(p => p.outcome === 'unknown').length;
  const injectionCount = pairs.length;
  const total = highCount + lowCount + goodCount; // injections with a known outcome

  // Per meal-type breakdown (known outcomes only)
  const byMealType = {};
  for (const p of pairs) {
    if (p.outcome === 'unknown') continue;
    if (!byMealType[p.mealType]) byMealType[p.mealType] = { high:0, low:0, good:0, total:0 };
    byMealType[p.mealType][p.outcome] = (byMealType[p.mealType][p.outcome] || 0) + 1;
    byMealType[p.mealType].total++;
  }

  const recommendations = [];

  // Hypo is the dangerous outcome — flag even a single event.
  const severeLow = pairs.some(p => p.outcome === 'low' && p.severity === 'danger');
  if (lowCount >= 1) {
    recommendations.push({
      type: 'low',
      severity: (severeLow || lowCount / Math.max(total, 1) >= 0.3) ? 'danger' : 'warning',
      msg: `近期 ${lowCount}/${total} 次注射後發生低血糖（＜70 mg/dL）${severeLow ? '，其中有嚴重低血糖（＜54）' : ''}，務必謹慎`,
      action: '低血糖風險：確認劑量與碳水是否相符、注射後是否準時進食、餐前是否已偏低；與醫師討論減少劑量 0.5–1 U 或提高 ICR。隨身攜帶速效糖。',
    });
  }
  if (total > 0 && highCount / total >= 0.4) {
    recommendations.push({
      type: 'high',
      severity: highCount / total >= 0.6 ? 'danger' : 'warning',
      msg: `近期 ${highCount}/${total} 次注射後仍高血糖（＞180 mg/dL），餐前胰島素劑量可能不足`,
      action: '建議確認注射時間（餐前10–15分鐘更有效），或與醫師討論降低 ICR 數值',
    });
  }
  if (unknownCount > 0) {
    recommendations.push({
      type: 'info',
      severity: 'caution',
      msg: `有 ${unknownCount} 次注射缺少對應的餐後血糖資料，無法評估效果`,
      action: '建議注射後 2 小時量測血糖或同步 LibreLink，以利完整分析',
    });
  }

  for (const [mt, stats] of Object.entries(byMealType)) {
    if (stats.total < 2) continue;
    const label = MEAL_LABEL[mt] || (mt === 'correction' ? '校正' : mt);
    if (stats.high / stats.total >= 0.6) {
      recommendations.push({ type: 'high', severity: 'warning', msg: `${label}注射後血糖持續偏高（${stats.high}/${stats.total} 次）`, action: `${label}可能有胰島素抗性較高或碳水估算不足，可嘗試提前注射或增加劑量` });
    }
    if (stats.low / stats.total >= 0.5) {
      recommendations.push({ type: 'low', severity: 'warning', msg: `${label}反覆出現注射後低血糖（${stats.low}/${stats.total} 次）`, action: `${label}劑量可能偏高，建議減少 0.5–1 U 或重新估算碳水` });
    }
  }

  // Steep post-prandial rise → distinguish high-GI food vs under-dosing
  const steepShots = pairs.filter(p => p.steepRise);
  if (steepShots.length) {
    const giN   = steepShots.filter(p => p.riseCause === 'highGI').length;
    const doseN = steepShots.filter(p => p.riseCause === 'dose' || p.riseCause === 'both').length;
    recommendations.push({
      type: 'rise',
      severity: doseN > 0 ? 'warning' : 'caution',
      msg: `有 ${steepShots.length} 次注射後血糖上升過快（餐後 90 分鐘內升幅 ≥60 mg/dL）${giN ? `，${giN} 次疑似高GI食物` : ''}${doseN ? `，${doseN} 次疑似劑量不足` : ''}`,
      action: '高GI食物→提前 15–20 分鐘注射並先吃菜與蛋白質；劑量不足（血糖未回落）→與醫師討論增加劑量或降低 ICR。可量測注射後 1 小時血糖協助判斷。',
    });
  }

  const ratioBase = total || 1;
  return {
    pairs: pairs.slice(-12).reverse(),
    summary: {
      highCount, lowCount, goodCount, unknownCount, injectionCount, total,
      highRatio: Math.round(highCount/ratioBase*100),
      lowRatio:  Math.round(lowCount/ratioBase*100),
      goodRatio: Math.round(goodCount/ratioBase*100),
    },
    recommendations,
    byMealType,
  };
}

// ── Glycemic event (hypo / hyper) root-cause analysis ─────────────────────
// Detects out-of-range episodes, then correlates each with the user's recent
// meals, rapid doses and long-acting doses to infer probable cause + advice.
function analyzeOneEvent(ev, meals, insulinLogs) {
  const startT = ev.startT;
  const hour = new Date(startT).getHours();
  const LOOKBACK = 5 * 60 * 60 * 1000;

  const recentMeals = meals
    .filter(m => { const t = new Date(m.timestamp).getTime(); return t <= startT && t > startT - LOOKBACK; })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentRapid = insulinLogs
    .filter(l => isBolus(l.brandType) && (() => { const t = new Date(l.timestamp).getTime(); return t <= startT && t > startT - LOOKBACK; })())
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentLong = insulinLogs
    .filter(l => l.brandType === 'long' && new Date(l.timestamp).getTime() <= startT && new Date(l.timestamp).getTime() > startT - 30 * 60 * 60 * 1000)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const lastMeal  = recentMeals[0] || null;
  const lastRapid = recentRapid[0] || null;
  const totalCarbs = recentMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const totalRapid = recentRapid.reduce((s, l) => s + (l.units || 0), 0);
  const overnight = hour < 6;
  const morning   = hour >= 5 && hour <= 9;

  const causes = [];
  const suggestions = [];

  if (ev.kind === 'hypo') {
    if (totalRapid > 0 && totalCarbs < totalRapid * 8) {
      causes.push({ label: '餐前胰島素劑量相對碳水偏高', detail: `事件前注射 ${totalRapid.toFixed(1)} U 餐前胰島素，但碳水僅約 ${Math.round(totalCarbs)} g` });
      suggestions.push('下次相同餐點可與醫師討論減少 0.5–1 U，或重新確認碳水估算');
    }
    if (lastRapid && lastMeal && new Date(lastRapid.timestamp) - new Date(lastMeal.timestamp) < -20 * 60 * 1000) {
      causes.push({ label: '注射後進食延遲', detail: '餐前胰島素注射明顯早於進食，吸收與血糖上升不同步' });
      suggestions.push('注射後請於建議時間內進食，避免空窗期低血糖');
    }
    if (recentMeals.some(m => m.exerciseBefore || m.exerciseAfter)) {
      causes.push({ label: '運動增加胰島素敏感度', detail: '事件前後有運動紀錄，肌肉攝取葡萄糖增加' });
      suggestions.push('運動前後可降低劑量或補充碳水');
    }
    if (recentRapid.length >= 2) {
      causes.push({ label: '劑量疊加 (insulin stacking)', detail: `${LOOKBACK / 3600000} 小時內有 ${recentRapid.length} 次餐前胰島素注射，作用時間重疊` });
      suggestions.push('校正劑量前請考量前一劑的殘餘胰島素 (IOB)');
    }
    if (overnight && recentLong.length > 0) {
      causes.push({ label: '長效劑量可能過高', detail: `夜間低血糖，前次長效 ${recentLong[0].units} U` });
      suggestions.push('反覆夜間低血糖建議與醫師討論減少長效 1–2 U');
    }
    if (causes.length === 0) {
      causes.push({ label: '原因待確認', detail: '事件前無明顯餐食/注射紀錄，可能為基礎率或活動量影響' });
      suggestions.push('補充事件前的飲食與注射紀錄有助於分析');
    }
  } else { // hyper
    const carbyNoBolus = lastMeal && (lastMeal.carbs || 0) > 30 && totalRapid === 0;
    if (carbyNoBolus) {
      causes.push({ label: '可能漏打餐前胰島素', detail: `進食約 ${Math.round(lastMeal.carbs)} g 碳水但事件前無餐前胰島素注射紀錄` });
      suggestions.push('確認是否漏打；高碳水餐務必餐前注射');
    } else if (lastMeal && totalRapid > 0 && totalCarbs > totalRapid * 18) {
      causes.push({ label: '餐前胰島素劑量相對碳水不足', detail: `碳水約 ${Math.round(totalCarbs)} g，餐前胰島素僅 ${totalRapid.toFixed(1)} U` });
      suggestions.push('與醫師討論收緊碳水比 (降低 ICR 數值) 或確認碳水估算');
    }
    if (lastMeal?.highGI?.length > 0) {
      causes.push({ label: '高GI食物使血糖快速上升', detail: `含高GI：${lastMeal.highGI.map(h => h.name).join('、')}` });
      suggestions.push('高GI食物建議提前注射或搭配蛋白質/纖維延緩吸收');
    }
    if (lastRapid && lastMeal && new Date(lastRapid.timestamp) - new Date(lastMeal.timestamp) > 30 * 60 * 1000) {
      causes.push({ label: '注射時間較晚', detail: '餐前胰島素於餐後 30 分鐘以上才注射，未及時壓制血糖峰值' });
      suggestions.push('改為餐前 10–15 分鐘注射（超速效可餐前注射）');
    }
    if (morning && totalRapid === 0 && totalCarbs === 0) {
      causes.push({ label: '黎明現象或長效不足', detail: '清晨空腹高血糖，可能為黎明荷爾蒙或基礎胰島素不足' });
      suggestions.push('持續清晨高血糖建議與醫師討論長效劑量或注射時間');
    }
    // Post-meal hyper with NO exercise around the meal → encourage activity
    const ateThenHigh = lastMeal && (lastMeal.carbs || 0) > 0;
    const noExercise  = recentMeals.length > 0 && !recentMeals.some(m => m.exerciseBefore || m.exerciseAfter);
    if (ateThenHigh && noExercise) {
      causes.push({ label: '餐前後缺乏運動', detail: '此餐前後無運動紀錄，活動量低不利餐後葡萄糖代謝' });
      suggestions.push('餐後 30 分鐘內散步 15–20 分鐘，肌肉攝取葡萄糖可有效降低餐後高血糖');
    }
    if (causes.length === 0) {
      causes.push({ label: '原因待確認', detail: '事件前無明顯餐食/注射紀錄' });
      suggestions.push('補充事件前的飲食與注射紀錄有助於分析');
    }
  }

  return {
    kind: ev.kind,
    extreme: ev.extreme,
    startT,
    durationMin: Math.round((ev.lastT - ev.startT) / 60000),
    readingCount: ev.readings.length,
    context: {
      carbs: Math.round(totalCarbs),
      rapidUnits: Math.round(totalRapid * 10) / 10,
      lastRapid: lastRapid ? { units: lastRapid.units, timestamp: lastRapid.timestamp } : null,
      lastLong:  recentLong[0] ? { units: recentLong[0].units, timestamp: recentLong[0].timestamp } : null,
    },
    causes,
    suggestions: [...new Set(suggestions)],
  };
}

export function analyzeGlycemicEvents(glucoseReadings, meals, insulinLogs, opts = {}) {
  // Window: explicit [from, to] overrides the days-based cutoff.
  const hi = opts.to ?? Date.now();
  const lo = opts.from ?? (hi - (opts.days || 7) * 24 * 3600 * 1000);
  const days = Math.max(1, Math.round((hi - lo) / 86400000));
  const readings = glucoseReadings
    .filter(r => { const t = new Date(r.timestamp).getTime(); return t > lo && t <= hi; })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (readings.length < 3) return { events: [], summary: { hypoCount: 0, hyperCount: 0, days } };

  const GAP = 45 * 60 * 1000; // readings >45min apart start a new event
  const raw = [];
  let cur = null;
  for (const r of readings) {
    const t = new Date(r.timestamp).getTime();
    const kind = r.value < 70 ? 'hypo' : r.value > 180 ? 'hyper' : null;
    if (!kind) { cur = null; continue; }
    if (cur && cur.kind === kind && t - cur.lastT <= GAP) {
      cur.readings.push(r); cur.lastT = t;
      cur.extreme = kind === 'hypo' ? Math.min(cur.extreme, r.value) : Math.max(cur.extreme, r.value);
    } else {
      cur = { kind, readings: [r], startT: t, lastT: t, extreme: r.value };
      raw.push(cur);
    }
  }

  const events = raw.map(ev => analyzeOneEvent(ev, meals, insulinLogs)).reverse().slice(0, 12);
  return {
    events,
    summary: {
      hypoCount:  raw.filter(e => e.kind === 'hypo').length,
      hyperCount: raw.filter(e => e.kind === 'hyper').length,
      days,
    },
  };
}

// ── Rapid rise / fall excursion root-cause analysis ───────────────────────
// Detects每一段「急速上升 / 急速下降」（斜率 ≥2 mg/dL/分、累積變化 ≥30 mg/dL），
// 再對照事件前的飲食、速效/短效注射、長效與運動，推測原因並給衛教建議。
const STEEP_RATE   = 2;   // mg/dL/min — 開始一段急速變化的門檻（≈ LibreLink ↑↑/↓↓）
const CONT_RATE    = 1;   // mg/dL/min — 同方向延續門檻
const SEG_GAP_MS   = 30 * 60 * 1000; // 連續血糖間隔上限
const MIN_DELTA    = 30;  // mg/dL — 累積變化太小不列為事件

function analyzeOneExcursion(ex, meals, insulinLogs) {
  const { dir, startT, endT, fromBG, toBG, maxRate } = ex;
  const LOOKBACK = 3 * 60 * 60 * 1000;
  const inLook = ts => ts <= endT && ts > startT - LOOKBACK;

  const recentMeals = meals
    .filter(m => inLook(new Date(m.timestamp).getTime()))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentBolus = insulinLogs
    .filter(l => isBolus(l.brandType) && inLook(new Date(l.timestamp).getTime()))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const recentLong = insulinLogs
    .filter(l => l.brandType === 'long' && new Date(l.timestamp).getTime() <= endT && new Date(l.timestamp).getTime() > startT - 30 * 3600 * 1000)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const lastMeal  = recentMeals[0] || null;
  const lastBolus = recentBolus[0] || null;
  const totalCarbs = recentMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const totalBolus = recentBolus.reduce((s, l) => s + (l.units || 0), 0);
  const highGI = recentMeals.flatMap(m => m.highGI || []);
  const hadExercise = recentMeals.some(m => m.exerciseBefore || m.exerciseAfter);
  const hour = new Date(startT).getHours();
  const morning = hour >= 4 && hour <= 9;

  const causes = [];
  const suggestions = [];

  if (dir === 'rise') {
    if (highGI.length > 0) {
      causes.push({ label: '高GI食物快速升糖', detail: `含高GI：${[...new Set(highGI.map(h => h.name))].join('、')}` });
      suggestions.push('高GI食物建議餐前提前注射、先吃蔬菜與蛋白質再吃澱粉，可削平血糖峰值');
    }
    if (lastMeal && totalCarbs > 0 && totalBolus === 0) {
      causes.push({ label: '進食但無餐前胰島素', detail: `事件前進食約 ${Math.round(totalCarbs)} g 碳水，無速效/短效注射紀錄` });
      suggestions.push('確認是否漏打；含碳水餐務必餐前注射');
    } else if (lastMeal && totalBolus > 0 && totalCarbs > totalBolus * 18) {
      causes.push({ label: '餐前胰島素劑量相對碳水不足', detail: `碳水約 ${Math.round(totalCarbs)} g，餐前胰島素僅 ${totalBolus.toFixed(1)} U` });
      suggestions.push('與醫師討論收緊碳水比（降低 ICR），或確認碳水估算');
    }
    if (lastBolus && lastMeal && new Date(lastBolus.timestamp) - new Date(lastMeal.timestamp) > 20 * 60 * 1000) {
      const lbl = bolusLabel(lastBolus.brandType);
      causes.push({ label: '餐前胰島素注射過晚', detail: `${lbl}於進食後 ${Math.round((new Date(lastBolus.timestamp) - new Date(lastMeal.timestamp)) / 60000)} 分鐘才注射，未及時壓制升糖` });
      suggestions.push(lastBolus.brandType === 'short' ? '短效須餐前約 30 分鐘注射' : '速效建議餐前 10–15 分鐘注射');
    }
    if (!lastMeal && morning && totalBolus === 0) {
      causes.push({ label: '黎明現象或基礎不足', detail: '清晨無進食卻急速升糖，可能為黎明荷爾蒙或長效劑量不足' });
      suggestions.push('反覆清晨升糖建議與醫師討論長效劑量或注射時間');
    }
    if (causes.length === 0) {
      causes.push({ label: '原因待確認', detail: '事件前無明顯餐食/注射紀錄，可能為壓力、其他食物或基礎率影響' });
      suggestions.push('補充事件前的飲食與注射紀錄有助於分析');
    }
  } else { // fall
    if (lastBolus) {
      const minsAgo = Math.round((startT - new Date(lastBolus.timestamp).getTime()) / 60000);
      const lbl = bolusLabel(lastBolus.brandType);
      causes.push({ label: `${lbl}胰島素作用中`, detail: `下降前 ${minsAgo} 分鐘注射 ${lastBolus.units} U ${lbl}，正值作用高峰` });
      if (toBG < 80) suggestions.push('下降幅度大且偏低，留意低血糖；確認劑量與碳水是否相符');
    }
    if (recentBolus.length >= 2) {
      causes.push({ label: '劑量疊加 (insulin stacking)', detail: `${LOOKBACK / 3600000} 小時內有 ${recentBolus.length} 次餐前胰島素注射，作用重疊` });
      suggestions.push('校正前請計入前一劑殘餘胰島素 (IOB)');
    }
    if (hadExercise) {
      causes.push({ label: '運動增加胰島素敏感度', detail: '事件前後有運動紀錄，肌肉攝取葡萄糖增加' });
      suggestions.push('運動前後可降低劑量或補充碳水');
    }
    if (lastBolus && totalCarbs > 0 && totalCarbs < totalBolus * 8) {
      causes.push({ label: '餐前胰島素相對碳水偏高', detail: `注射 ${totalBolus.toFixed(1)} U 但碳水僅約 ${Math.round(totalCarbs)} g` });
      suggestions.push('下次相同餐點可與醫師討論減量或重新確認碳水');
    }
    if (causes.length === 0) {
      causes.push({ label: '原因待確認', detail: '事件前無注射/運動紀錄，可能為餐後自然回落或基礎率影響' });
      suggestions.push('若反覆急速下降且偏低，補充注射與運動紀錄有助於分析');
    }
  }

  return {
    dir, startT, endT,
    fromBG, toBG,
    delta: Math.round(toBG - fromBG),
    maxRate: Math.round(maxRate * 10) / 10,
    durationMin: Math.max(1, Math.round((endT - startT) / 60000)),
    context: {
      carbs: Math.round(totalCarbs),
      bolusUnits: Math.round(totalBolus * 10) / 10,
      lastBolusType: lastBolus ? lastBolus.brandType : null,
      lastLong: recentLong[0] ? { units: recentLong[0].units, timestamp: recentLong[0].timestamp } : null,
    },
    causes,
    suggestions: [...new Set(suggestions)],
  };
}

export function analyzeGlucoseExcursions(glucoseReadings, meals, insulinLogs, opts = {}) {
  const hi = opts.to ?? Date.now();
  const lo = opts.from ?? (hi - (opts.days || 7) * 24 * 3600 * 1000);
  const days = Math.max(1, Math.round((hi - lo) / 86400000));
  const readings = glucoseReadings
    .filter(r => { const t = new Date(r.timestamp).getTime(); return t > lo && t <= hi; })
    .map(r => ({ v: r.value, ts: new Date(r.timestamp).getTime() }))
    .sort((a, b) => a.ts - b.ts);
  if (readings.length < 3) return { excursions: [], summary: { riseCount: 0, fallCount: 0, days } };

  // Build steep excursions by extending同方向的連續陡段。
  const raw = [];
  let cur = null;
  for (let i = 1; i < readings.length; i++) {
    const dt = readings[i].ts - readings[i - 1].ts;
    if (dt <= 0 || dt > SEG_GAP_MS) { cur = null; continue; }
    const rate = (readings[i].v - readings[i - 1].v) / (dt / 60000); // mg/dL/min
    const dir = rate > 0 ? 'rise' : 'fall';
    const absRate = Math.abs(rate);

    if (cur && cur.dir === dir && absRate >= CONT_RATE) {
      // extend
      cur.endT = readings[i].ts;
      cur.toBG = readings[i].v;
      cur.maxRate = Math.max(cur.maxRate, absRate);
    } else if (absRate >= STEEP_RATE) {
      // start new steep excursion from the previous reading
      cur = {
        dir, maxRate: absRate,
        startT: readings[i - 1].ts, endT: readings[i].ts,
        fromBG: readings[i - 1].v, toBG: readings[i].v,
      };
      raw.push(cur);
    } else {
      cur = null;
    }
  }

  const significant = raw.filter(e => Math.abs(e.toBG - e.fromBG) >= MIN_DELTA);
  const excursions = significant
    .map(e => analyzeOneExcursion(e, meals, insulinLogs))
    .sort((a, b) => b.startT - a.startT)
    .slice(0, 12);

  return {
    excursions,
    summary: {
      riseCount: significant.filter(e => e.dir === 'rise').length,
      fallCount: significant.filter(e => e.dir === 'fall').length,
      days,
    },
  };
}

export function getBGStatus(value, unit = 'mg/dL') {
  if (unit === 'mg/dL') {
    if (value < 70) return { label: '低血糖', color: '#ef4444', severity: 'critical' };
    if (value < 100) return { label: '正常偏低', color: '#22c55e', severity: 'good' };
    if (value < 140) return { label: '正常', color: '#22c55e', severity: 'good' };
    if (value < 180) return { label: '偏高', color: '#f59e0b', severity: 'warning' };
    if (value < 250) return { label: '高血糖', color: '#ef4444', severity: 'high' };
    return { label: '嚴重高血糖', color: '#7f1d1d', severity: 'critical' };
  }
  return { label: '正常', color: '#22c55e', severity: 'good' };
}
