// ── Dosing analysis based on seed scenario ──────────────────────────
// Static reference numbers shown on the 劑量 page (InsulinAdvisor).
// TDD ≈ 3 × 9U (NovoRapid) + 16.5U (Tresiba) ≈ 43.5 U/day
// ICR = 500 ÷ 43.5 ≈ 11  (1U covers 11g carbs)
// ISF = 1700 ÷ 43.5 ≈ 39 mg/dL per unit

export const SEED_ANALYSIS = {
  tdd: 43.5,
  icr: 11,
  isf: 39,
  meals: [
    { foods: '全麥三明治＋雞胸＋豆漿', carbs: 34, preBG: 110, recommended: 3.6, actual: 9, risk: '低血糖風險', riskLevel: 'high' },
    { foods: '地瓜＋豆漿', carbs: 44, preBG: 110, recommended: 4.5, actual: 9, risk: '低血糖風險', riskLevel: 'high' },
    { foods: '白飯＋雞腿＋青菜', carbs: 50, preBG: 120, recommended: 5.6, actual: 9, risk: '輕微過量', riskLevel: 'medium' },
    { foods: '鸚嘴豆＋青菜＋豆漿', carbs: 42, preBG: 110, recommended: 4.3, actual: 9, risk: '低血糖風險', riskLevel: 'high' },
  ],
  timingNote: 'NovoRapid 餐後10分鐘注射：血糖已開始上升，胰島素起效延遲，導致餐後1小時明顯血糖峰值，建議改為餐前15-20分鐘注射。',
};
