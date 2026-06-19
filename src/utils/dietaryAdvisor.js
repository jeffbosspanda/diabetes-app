// ── Daily nutritional needs calculator for diabetic patients ─────────────

const ACTIVITY_FACTOR = 1.4; // light-moderate activity (default for T1D)

export function calcDietaryNeeds(profile) {
  if (!profile?.weight) return null;

  const weight = parseFloat(profile.weight);
  const height = parseFloat(profile.height);
  const age    = parseFloat(profile.age);
  const gender = profile.gender; // 'male' | 'female'

  // BMR — Mifflin-St Jeor if full data, weight-based fallback
  let bmr;
  if (weight && height && age && gender) {
    bmr = gender === 'female'
      ? 10 * weight + 6.25 * height - 5 * age - 161
      : 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    // fallback: weight × 22 (sedentary base)
    bmr = weight * 22;
  }

  const tdee = Math.round(bmr * ACTIVITY_FACTOR);

  // ADA-aligned macros for T1D:
  // Carbs 45–50% | Protein 20% (min 1.2g/kg) | Fat 30–35%
  const carbsCal  = tdee * 0.47;
  const proteinCal = Math.max(tdee * 0.20, weight * 1.2 * 4); // 4 kcal/g
  const fatCal     = tdee - carbsCal - proteinCal;

  const carbsG    = Math.round(carbsCal / 4);
  const proteinG  = Math.round(proteinCal / 4);
  const fatG      = Math.round(fatCal / 9);
  const fiberG    = 25; // ADA minimum

  // Per-meal carb guide (breakfast/lunch/dinner + 1 snack)
  const carbPerMeal   = Math.round(carbsG * 0.28); // ~28% per main meal
  const carbPerSnack  = Math.round(carbsG * 0.16); // ~16% for snack

  // Recommended RANGES (ADA / DRI), grams derived from the same TDEE
  const ranges = {
    calories: { min: Math.round(tdee * 0.95), max: Math.round(tdee * 1.05) },
    carbs:    { min: Math.round(tdee * 0.45 / 4), max: Math.round(tdee * 0.55 / 4), pct: '45–55%' },
    protein:  { min: Math.round(Math.max(tdee * 0.15 / 4, weight * 1.0)), max: Math.round(Math.max(tdee * 0.20 / 4, weight * 1.5)), note: '1.0–1.5 g/kg' },
    fat:      { min: Math.round(tdee * 0.25 / 9), max: Math.round(tdee * 0.35 / 9), pct: '25–35%' },
    fiber:    { min: 25, max: 38 },
  };

  const usedMSJ = !!(weight && height && age && gender);
  const method = {
    tdee:    `BMR（${usedMSJ ? `Mifflin-St Jeor ${gender === 'female' ? '女性' : '男性'}公式` : '體重×22 估算'}）× 活動係數 ${ACTIVITY_FACTOR}`,
    carbs:   '總熱量 45–55% ÷ 4 kcal/g（碳水每克 4 大卡）',
    protein: `每公斤體重 1.0–1.5 g（${weight} kg），約佔總熱量 15–20%`,
    fat:     '總熱量 25–35% ÷ 9 kcal/g（脂肪每克 9 大卡）',
  };

  return {
    tdee,
    bmr:     Math.round(bmr),
    carbsG,
    proteinG,
    fatG,
    fiberG,
    carbPerMeal,
    carbPerSnack,
    proteinPerKg: parseFloat((proteinG / weight).toFixed(1)),
    hasFullProfile: usedMSJ,
    ranges,
    method,
    activityFactor: ACTIVITY_FACTOR,
  };
}

// ── Compare today's intake against targets ─────────────────────────────────
export function analyzeDailyIntake(meals, needs) {
  if (!needs) return null;

  const today = new Date().toDateString();
  const todayMeals = meals.filter(m => new Date(m.timestamp).toDateString() === today);

  const actual = todayMeals.reduce((acc, m) => ({
    carbs:    acc.carbs    + (m.carbs    || 0),
    protein:  acc.protein  + (m.protein  || 0),
    fat:      acc.fat      + (m.fat      || 0),
    calories: acc.calories + (m.calories || 0),
  }), { carbs: 0, protein: 0, fat: 0, calories: 0 });

  const mealCount = todayMeals.length;

  const pct = (a, t) => t > 0 ? Math.round(a / t * 100) : 0;

  const carbPct    = pct(actual.carbs,    needs.carbsG);
  const proteinPct = pct(actual.protein,  needs.proteinG);
  const calPct     = pct(actual.calories, needs.tdee);

  const remaining = {
    carbs:    Math.max(0, needs.carbsG    - actual.carbs),
    protein:  Math.max(0, needs.proteinG  - actual.protein),
    fat:      Math.max(0, needs.fatG      - actual.fat),
    calories: Math.max(0, needs.tdee      - actual.calories),
  };

  const recommendations = [];

  // Carbs
  if (carbPct > 110) {
    recommendations.push({ type: 'warn', icon: '🍚', msg: `今日碳水已達目標的 ${carbPct}%，剩餘餐次建議選擇低碳選項（蔬菜、蛋白質為主）` });
  } else if (mealCount >= 2 && carbPct < 50) {
    recommendations.push({ type: 'info', icon: '⚠️', msg: `今日碳水偏低（${carbPct}%），注意避免低血糖，可適量補充複合碳水` });
  }

  // Protein
  if (proteinPct < 60 && mealCount >= 2) {
    recommendations.push({ type: 'info', icon: '🥩', msg: `今日蛋白質不足（目標 ${needs.proteinG}g，約 ${needs.proteinPerKg}g/kg），建議增加雞蛋、豆腐、瘦肉` });
  }

  // Calories
  if (calPct > 105 && mealCount >= 2) {
    recommendations.push({ type: 'warn', icon: '🔥', msg: `今日熱量已達 ${calPct}%，晚餐/宵夜建議以蔬菜和蛋白質為主` });
  }

  // Meal distribution
  const breakfastEaten = todayMeals.some(m => m.mealType === 'breakfast');
  if (!breakfastEaten && new Date().getHours() >= 10) {
    recommendations.push({ type: 'info', icon: '🌅', msg: '今日尚未記錄早餐，規律用餐有助於穩定全天血糖' });
  }

  // Per-meal reminder
  if (mealCount === 0) {
    recommendations.push({ type: 'info', icon: '📋', msg: `建議每餐碳水控制在 ${needs.carbPerMeal}g 左右，每日三餐加一份點心（約 ${needs.carbPerSnack}g 碳水）` });
  }

  return { actual, remaining, mealCount, carbPct, proteinPct, calPct, recommendations };
}

// ── General dietary advice for T1D ─────────────────────────────────────────
export function getDietaryTips(needs, weeklyMeals) {
  const tips = [];
  const week = weeklyMeals || [];

  // Average carbs per meal
  const mainMeals = week.filter(m => ['breakfast','lunch','dinner'].includes(m.mealType));
  const avgCarbs = mainMeals.length
    ? Math.round(mainMeals.reduce((s, m) => s + (m.carbs || 0), 0) / mainMeals.length)
    : null;

  if (needs) {
    const diff = avgCarbs !== null ? avgCarbs - needs.carbPerMeal : null;
    if (diff !== null && diff > 20) {
      tips.push({ severity: 'warn', title: '每餐碳水偏高', body: `近期每餐平均 ${avgCarbs}g 碳水，建議目標 ${needs.carbPerMeal}g。可減少白飯份量或改吃糙米、地瓜` });
    } else if (diff !== null && diff < -15) {
      tips.push({ severity: 'info', title: '每餐碳水偏低', body: `近期每餐平均 ${avgCarbs}g 碳水，若有頻繁低血糖可考慮適量增加複合碳水` });
    }
  }

  // High GI frequency
  const highGIMeals = week.filter(m => m.highGI?.length > 0).length;
  if (week.length > 0 && highGIMeals / week.length > 0.5) {
    tips.push({ severity: 'warn', title: '高GI食物頻率偏高', body: `近7天 ${highGIMeals}/${week.length} 餐含高GI食物，建議以低GI澱粉替代：糙米、燕麥、地瓜、全麥麵包` });
  }

  // Fiber note
  tips.push({ severity: 'neutral', title: '膳食纖維目標 25g/天', body: '每餐加一份蔬菜（半盤）可補充 3–5g 纖維，有助延緩血糖上升' });

  // Fixed tips for T1D
  tips.push({ severity: 'neutral', title: '進食順序技巧', body: '先吃蔬菜 → 蛋白質 → 澱粉，可降低餐後血糖峰值約 30–40 mg/dL' });

  return tips;
}

// ── Diet preferences (vegetarian type + food restrictions) ─────────────────
export const VEG_TYPES = [
  { value: 'none',        label: '無（葷食）' },
  { value: 'ovo-lacto',   label: '蛋奶素' },
  { value: 'lacto',       label: '奶素' },
  { value: 'vegan',       label: '全素' },
  { value: 'wu-xin',      label: '五辛素' },
  { value: 'pescatarian', label: '海鮮素' },
];

// Diet-appropriate protein sources (high quality, low-GI friendly)
const PROTEIN_SOURCES = {
  none:        ['雞胸肉', '魚', '雞蛋', '牛奶', '豆腐', '毛豆'],
  pescatarian: ['魚', '蝦', '雞蛋', '牛奶', '豆腐', '毛豆'],
  'ovo-lacto': ['雞蛋', '牛奶', '優格', '豆腐', '毛豆', '鷹嘴豆'],
  lacto:       ['牛奶', '優格', '起司', '豆腐', '毛豆', '黑豆'],
  vegan:       ['豆腐', '毛豆', '鷹嘴豆', '扁豆', '天貝', '堅果'],
  'wu-xin':    ['豆腐', '毛豆', '鷹嘴豆', '扁豆', '堅果', '藜麥'],
};

// ── Nutrient-source keyword detection (works on the meal's food description) ──
const NUTRIENT_KEYWORDS = {
  protein: ['雞', '豬', '牛', '羊', '魚', '鮭', '鯖', '鮪', '蝦', '蛤', '蛋', '豆腐', '豆干', '毛豆', '豆漿', '優格', '牛奶', '起司', '瘦肉', '雞胸', '天貝', '鷹嘴豆', '扁豆', '黑豆', '堅果'],
  b12:     ['牛', '豬', '雞', '羊', '魚', '鮭', '鯖', '鮪', '蝦', '蛤', '蚌', '蛋', '牛奶', '起司', '優格', '乳', '肝', '營養酵母', '強化'],
  iron:    ['紅肉', '牛', '豬肝', '肝', '鴨血', '豬血', '菠菜', '莧菜', '紅莧', '深綠', '黑豆', '紅豆', '扁豆', '芝麻', '南瓜籽'],
  calcium: ['牛奶', '起司', '優格', '乳', '豆干', '板豆腐', '芝麻', '小魚乾', '蝦米', '芥蘭', '莧菜', '深綠'],
  omega3:  ['鮭', '鯖', '秋刀', '沙丁', '鯡', '亞麻', '奇亞', '核桃', '藻'],
  fiber:   ['菜', '蔬', '全穀', '糙米', '燕麥', '地瓜', '番薯', '豆', '芹', '花椰', '菇', '海帶', '蘋果', '芭樂', '水果', '玉米'],
  vitc:    ['番茄', '彩椒', '甜椒', '青椒', '芭樂', '柑', '橘', '柳丁', '檸檬', '奇異果', '草莓', '花椰', '高麗菜'],
};

const NUTRIENT_LABELS = {
  protein: '優質蛋白', b12: '維生素 B12', iron: '鐵質',
  calcium: '鈣質', omega3: 'Omega-3', fiber: '膳食纖維', vitc: '維生素 C',
};

export function detectNutrients(text) {
  const found = new Set();
  if (!text) return found;
  for (const [n, ks] of Object.entries(NUTRIENT_KEYWORDS)) {
    if (ks.some(k => text.includes(k))) found.add(n);
  }
  return found;
}

// Count, across the user's actual logged meals, how many contained each nutrient
export function analyzeNutrientCoverage(meals) {
  const counts = { protein: 0, b12: 0, iron: 0, calcium: 0, omega3: 0, fiber: 0, vitc: 0 };
  for (const m of meals) {
    for (const n of detectNutrients(m.foods || '')) counts[n]++;
  }
  return { counts, mealCount: meals.length };
}

// Diet-appropriate source suggestions per nutrient + vegetarian type
function suggestSources(n, vegType) {
  const meat = vegType === 'none';
  const fish = vegType === 'none' || vegType === 'pescatarian';
  const dairyEgg = ['none', 'pescatarian', 'ovo-lacto'].includes(vegType);
  const dairy = dairyEgg || vegType === 'lacto';
  switch (n) {
    case 'b12':
      if (meat) return ['肉類', '魚', '蛋', '乳製品'];
      if (fish) return ['魚', '貝類', '蛋', '乳製品'];
      if (vegType === 'ovo-lacto') return ['蛋', '乳製品'];
      if (vegType === 'lacto') return ['乳製品（起司、優格）'];
      return ['B12 強化食品（強化豆奶、營養酵母）', '或 B12 補充劑'];
    case 'iron':
      return meat ? ['紅肉', '肝臟', '深綠蔬菜', '豆類']
        : fish ? ['魚', '深綠蔬菜', '豆類', '黑芝麻']
        : ['深綠蔬菜', '豆類', '黑芝麻', '南瓜籽'];
    case 'calcium':
      return dairy ? ['乳製品', '豆干', '深綠蔬菜'] : ['板豆腐', '豆干', '深綠蔬菜', '黑芝麻', '強化豆奶'];
    case 'omega3':
      return fish ? ['鮭魚', '鯖魚', '亞麻籽', '核桃'] : ['亞麻籽', '奇亞籽', '核桃', '藻油'];
    case 'fiber':  return ['蔬菜', '全穀', '糙米', '地瓜', '豆類'];
    case 'vitc':   return ['番茄', '彩椒', '芭樂', '柑橘', '奇異果'];
    default:       return [];
  }
}

// Build nutrient advice from the user's ACTUAL logged meals (data-driven)
export function buildNutrientAdvice(needs, dailyIntake, prefs = {}, recentMeals = []) {
  if (!needs) return [];
  const vegType = prefs.vegetarianType || 'none';
  const avoid = (prefs.avoidFoods || '')
    .split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
  const filterAvoid = list => list.filter(f => !avoid.some(a => f.includes(a) || a.includes(f)));

  const out = [];

  if (!recentMeals.length) {
    out.push({ severity: 'neutral', title: '尚無足夠飲食紀錄', body: '記錄餐點後，系統會依您實際吃下的食物分析營養素是否均衡。' });
    return out;
  }

  const { counts, mealCount } = analyzeNutrientCoverage(recentMeals);

  // Protein adequacy — from actual intake
  const proteinSrc = filterAvoid(PROTEIN_SOURCES[vegType] || PROTEIN_SOURCES.none);
  if (dailyIntake && dailyIntake.mealCount > 0 && dailyIntake.proteinPct < 70) {
    out.push({
      severity: 'warn',
      title: `今日蛋白質偏低（${dailyIntake.proteinPct}%）`,
      body: `目標約 ${needs.proteinG} g（${needs.proteinPerKg} g/kg）。可增加：${proteinSrc.slice(0, 5).join('、')}。`,
    });
  }

  // Micronutrient gaps — DATA DRIVEN, applies to everyone (incl. omnivores)
  const MICROS = [
    { key: 'b12',     note: 'B12 僅存在於動物性與強化食品，葷食者若少吃肉、蛋、奶、魚也可能缺乏。' },
    { key: 'iron',    note: '缺鐵易疲倦；植物性鐵搭配維生素 C 吸收更佳。' },
    { key: 'calcium', note: '長期不足影響骨骼健康。' },
    { key: 'omega3',  note: '有助心血管與抗發炎。' },
    { key: 'fiber',   note: '有助延緩餐後血糖上升、穩定腸道。' },
    { key: 'vitc',    note: '抗氧化並促進鐵質吸收。' },
  ];
  for (const m of MICROS) {
    const c = counts[m.key];
    const label = NUTRIENT_LABELS[m.key];
    const src = filterAvoid(suggestSources(m.key, vegType));
    if (c === 0) {
      out.push({ severity: 'warn', title: `近期飲食缺乏${label}`,
        body: `過去 ${mealCount} 餐未偵測到${label}來源。${m.note} 建議來源：${src.join('、')}。` });
    } else if (c / mealCount < 0.25) {
      out.push({ severity: 'info', title: `${label}來源偏少`,
        body: `${mealCount} 餐中僅 ${c} 餐含${label}來源，建議增加：${src.join('、')}。` });
    }
  }

  // Positive feedback for nutrients the user covers well
  const wellCovered = MICROS
    .filter(m => counts[m.key] / mealCount >= 0.5)
    .map(m => NUTRIENT_LABELS[m.key]);
  if (wellCovered.length) {
    out.push({ severity: 'neutral', title: '營養攝取良好 👍', body: `近期飲食充分攝取：${wellCovered.join('、')}，請繼續保持。` });
  }

  if (avoid.length) {
    out.push({ severity: 'neutral', title: '已避開忌口食物', body: `建議中已排除：${avoid.join('、')}。` });
  }

  return out;
}

// Per-meal feedback: which nutrients this meal supplied + gentle reminders
export function mealNutrientFeedback(meal) {
  const det = detectNutrients(meal.foods || '');
  const good = [...det].map(k => NUTRIENT_LABELS[k]).filter(Boolean);
  const notes = [];
  if ((meal.highGI?.length || 0) > 0) notes.push('含高GI食物，注意餐後血糖');
  if ((meal.fat || 0) > 30) notes.push('脂肪較高，血糖高峰可能延後');
  if ((meal.carbs || 0) > 0 && !det.has('protein') && !det.has('fiber'))
    notes.push('以澱粉為主，可搭配蛋白質或蔬菜延緩血糖上升');
  return { good, notes };
}
