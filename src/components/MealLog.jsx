import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { Utensils, Plus, AlertTriangle, CheckCircle, Zap, Search, Pencil, Trash2, TrendingUp, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { format, subDays } from 'date-fns';
import { parseMealText, parseMealFoods } from '../utils/foodParser';
import { classifyGlycemicResponse, classifyFood } from '../utils/glycemicResponse';
import ConfirmDialog from './ConfirmDialog';
import { calcDietaryNeeds, analyzeDailyIntake, getDietaryTips, buildNutrientAdvice, mealNutrientFeedback, VEG_TYPES } from '../utils/dietaryAdvisor';
import NutrientImpactRanking from './NutrientImpactRanking';

const MEAL_TYPES = [
  { key: 'breakfast', label: '早餐', icon: '🌅' },
  { key: 'lunch',     label: '午餐', icon: '☀️' },
  { key: 'dinner',    label: '晚餐', icon: '🌙' },
  { key: 'lateSnack', label: '宵夜', icon: '🌛' },
  { key: 'snack',     label: '點心', icon: '🍎' },
];

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

const BLANK_FORM = { mealType: 'lunch', foods: '', notes: '', exerciseBefore: false, exerciseAfter: false, timestamp: nowLocal() };
const BLANK_MANUAL = { carbs: '', protein: '', fat: '', calories: '' };

export default function MealLog() {
  const { state, dispatch } = useApp();
  const [showForm, setShowForm]   = useState(false);
  const [editIndex, setEditIndex] = useState(null);
  const [form, setForm]           = useState(BLANK_FORM);
  const [analysis, setAnalysis]   = useState(null);
  const [inputMode, setInputMode] = useState('auto'); // 'auto' | 'manual'
  const [manual, setManual]       = useState(BLANK_MANUAL);
  const setM = (k, v) => setManual(m => ({ ...m, [k]: v }));

  // confirm dialog state
  const [confirm, setConfirm] = useState(null); // { type: 'delete'|'edit', index, data? }
  const [showAllAdvice, setShowAllAdvice] = useState(false);

  // The add/edit form opens as a centered modal (see render) so editing a row
  // never scrolls the page back to the top — avoids confusing it with the input
  // area. Lock body scroll while the modal is open.
  useEffect(() => {
    if (!showForm) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showForm]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const autoBG = useMemo(() => {
    const mealTime = form.timestamp ? new Date(form.timestamp).getTime() : Date.now();
    const window = 60 * 60 * 1000;
    return state.glucoseReadings
      .filter(r => Math.abs(new Date(r.timestamp).getTime() - mealTime) < window)
      .sort((a, b) => Math.abs(new Date(a.timestamp) - mealTime) - Math.abs(new Date(b.timestamp) - mealTime))[0] || null;
  }, [state.glucoseReadings, form.timestamp]);

  const handleAnalyze = () => {
    if (!form.foods.trim()) return;
    setAnalysis(parseMealText(form.foods));
  };

  const handleFoodsChange = (v) => { set('foods', v); setAnalysis(null); };

  const openAdd = () => {
    setEditIndex(null);
    setForm({ ...BLANK_FORM, timestamp: nowLocal() });
    setAnalysis(null);
    setInputMode('auto');
    setManual(BLANK_MANUAL);
    setShowForm(true);
  };

  const openEdit = (origIdx) => {
    const m = state.meals[origIdx];
    setEditIndex(origIdx);
    setForm({
      mealType:      m.mealType     || 'lunch',
      foods:         m.foods        || '',
      notes:         m.notes        || '',
      exerciseBefore: m.exerciseBefore || false,
      exerciseAfter:  m.exerciseAfter  || false,
      timestamp:     m.timestamp
        ? new Date(new Date(m.timestamp) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : nowLocal(),
    });
    if (m.carbs !== undefined) {
      setAnalysis({
        carbs: m.carbs, protein: m.protein, fat: m.fat, calories: m.calories,
        highGI: m.highGI || [], diabetesNotes: m.diabetesNotes || '',
        confidence: m.analysisConfidence || 'medium', foods: [], unmatched: [],
      });
      setInputMode('auto');
      setManual(BLANK_MANUAL);
    } else {
      setAnalysis(null);
      setInputMode('manual');
      setManual({ carbs: '', protein: '', fat: '', calories: '' });
    }
    setShowForm(true);
  };

  const manualReady = inputMode === 'manual' && manual.carbs !== '';
  const autoReady   = inputMode === 'auto'   && (analysis !== null || form.foods);

  const handleSave = () => {
    if (!form.foods && !manualReady && !analysis) return;
    // Block saving an auto-analysis whose carbs are undetermined — recording 0 g
    // would mislead the dose calculator. Force manual entry instead.
    if (inputMode === 'auto' && analysis?.undetermined) { setInputMode('manual'); return; }
    const nutrition = inputMode === 'manual'
      ? { carbs: parseFloat(manual.carbs) || 0, protein: parseFloat(manual.protein) || 0, fat: parseFloat(manual.fat) || 0, calories: parseFloat(manual.calories) || 0, highGI: [], diabetesNotes: '', analysisConfidence: 'manual' }
      : { carbs: analysis?.carbs ?? 0, protein: analysis?.protein ?? 0, fat: analysis?.fat ?? 0, calories: analysis?.calories ?? 0, highGI: analysis?.highGI ?? [], diabetesNotes: analysis?.diabetesNotes ?? '', analysisConfidence: analysis?.confidence };
    const payload = {
      ...form,
      ...nutrition,
      preMealBG:     autoBG?.value     ?? null,
      preMealBGTime: autoBG?.timestamp ?? null,
      timestamp: new Date(form.timestamp).toISOString(),
    };

    if (editIndex !== null) {
      dispatch({ type: 'UPDATE_MEAL', payload: { index: editIndex, data: payload } });
    } else {
      dispatch({ type: 'ADD_MEAL', payload });
    }
    setForm({ ...BLANK_FORM, timestamp: nowLocal() });
    setAnalysis(null);
    setShowForm(false);
    setEditIndex(null);
  };

  const handleDeleteConfirmed = (origIdx) => {
    dispatch({ type: 'DELETE_MEAL', payload: origIdx });
    setConfirm(null);
  };

  // Single-day filter for recent meals list
  const mealToday = format(new Date(), 'yyyy-MM-dd');
  const [mealDay, setMealDay] = useState(mealToday);
  const mealIsToday = mealDay === mealToday;
  const mLo = new Date(`${mealDay}T00:00:00`).getTime();
  const mHi = new Date(`${mealDay}T23:59:59`).getTime();
  const shiftMealDay = (delta) => {
    const d = new Date(`${mealDay}T00:00:00`);
    d.setDate(d.getDate() + delta);
    const next = format(d, 'yyyy-MM-dd');
    if (next > mealToday) return; // no future days
    setMealDay(next);
  };

  // sorted with original index preserved, filtered to the selected day
  const recent = state.meals
    .map((m, i) => ({ ...m, _origIdx: i }))
    .filter(m => { const t = new Date(m.timestamp).getTime(); return t >= mLo && t <= mHi; })
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const dietaryNeeds  = useMemo(() => calcDietaryNeeds(state.profile), [state.profile]);
  const dailyIntake   = useMemo(() => analyzeDailyIntake(state.meals, dietaryNeeds), [state.meals, dietaryNeeds]);
  const weeklyMeals   = useMemo(() => state.meals.filter(m => new Date(m.timestamp) > subDays(new Date(), 7)), [state.meals]);
  const dietaryTips   = useMemo(() => getDietaryTips(dietaryNeeds, weeklyMeals), [dietaryNeeds, weeklyMeals]);

  // Diet preferences (vegetarian type + 忌口) → tailored nutrient advice
  const dietPrefs = {
    vegetarianType: state.settings.vegetarianType || 'none',
    avoidFoods: state.settings.avoidFoods || '',
  };
  const setPref = (k, v) => dispatch({ type: 'UPDATE_SETTINGS', payload: { [k]: v } });
  const nutrientAdvice = useMemo(
    () => buildNutrientAdvice(dietaryNeeds, dailyIntake, dietPrefs, weeklyMeals),
    [dietaryNeeds, dailyIntake, dietPrefs.vegetarianType, dietPrefs.avoidFoods, weeklyMeals]
  );

  return (
    <div className="page">
      {confirm && (
        <ConfirmDialog
          title="確認刪除？"
          message={`將永久刪除此筆飲食紀錄（${MEAL_TYPES.find(t => t.key === state.meals[confirm.index]?.mealType)?.label ?? ''}），無法復原。`}
          confirmLabel="刪除"
          danger
          onConfirm={() => handleDeleteConfirmed(confirm.index)}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="page-header">
        <Utensils size={22} /> <h2>飲食紀錄</h2>
        <button className="btn-icon" onClick={openAdd}><Plus size={24} strokeWidth={2.5} /></button>
      </div>

      {showForm && (
        <div className="meal-form-overlay">
        <div className="card form-card meal-form-modal">
          <div className="meal-form-modal-head">
            <h3>{editIndex !== null ? '編輯紀錄' : '記錄這餐'}</h3>
            <button className="meal-form-close" onClick={() => { setShowForm(false); setAnalysis(null); setEditIndex(null); }} aria-label="關閉">
              <X size={18} />
            </button>
          </div>

          <div className="meal-type-row">
            {MEAL_TYPES.map(m => (
              <button key={m.key}
                className={`meal-type-btn ${form.mealType === m.key ? 'active' : ''}`}
                onClick={() => set('mealType', m.key)}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>

          {autoBG ? (
            <div className="auto-bg-banner">
              <CheckCircle size={13} color="var(--green)" />
              <span>自動偵測餐前血糖：<strong>{autoBG.value} mg/dL</strong>（{format(new Date(autoBG.timestamp), 'HH:mm')} LibreLink）</span>
            </div>
          ) : (
            <div className="auto-bg-banner auto-bg-warn">
              <AlertTriangle size={13} />
              <span>未偵測到近期 LibreLink 血糖資料，請先同步 FreeStyle Libre</span>
            </div>
          )}

          {/* Mode toggle */}
          <div className="input-mode-tabs">
            <button className={`mode-tab ${inputMode === 'auto' ? 'mode-tab-active' : ''}`}
              onClick={() => setInputMode('auto')}>
              <Zap size={12} /> 自動分析
            </button>
            <button className={`mode-tab ${inputMode === 'manual' ? 'mode-tab-active' : ''}`}
              onClick={() => setInputMode('manual')}>
              <Pencil size={12} /> 手動輸入
            </button>
          </div>

          {inputMode === 'auto' && (
            <>
              <div className="form-group">
                <label>餐點內容描述</label>
                <textarea value={form.foods} onChange={e => handleFoodsChange(e.target.value)}
                  placeholder="例：白飯一碗、兩根香蕉、200g雞腿、半斤豬肉、葡萄糖一包、碳水50" rows={3} />
                <div className="food-input-hint">
                  支援重量「200g／公克／克白飯」「半斤豬肉」「3兩牛肉」按比例換算（1 台斤＝600g、1 兩＝37.5g）；常用單位「一碗」「兩根」「3片」「一湯匙」；可直接寫碳水量「碳水50」或補糖「葡萄糖一包」。<b>無法判斷時會明確標示，請改用手動輸入。</b>
                </div>
              </div>
              <button className="btn-analyze" onClick={handleAnalyze} disabled={!form.foods.trim()}>
                <Search size={14} /> 分析營養成分
              </button>
            </>
          )}

          {inputMode === 'manual' && (
            <div className="manual-nutrition">
              <div className="form-group">
                <label>餐點描述（選填）</label>
                <input value={form.foods} onChange={e => set('foods', e.target.value)}
                  placeholder="例：自助餐、便利商店便當…" />
              </div>
              <div className="manual-grid">
                <div className="form-group">
                  <label>碳水化合物 (g) *</label>
                  <input type="number" min="0" step="1" value={manual.carbs}
                    onChange={e => setM('carbs', e.target.value)} placeholder="必填" />
                </div>
                <div className="form-group">
                  <label>蛋白質 (g)</label>
                  <input type="number" min="0" step="1" value={manual.protein}
                    onChange={e => setM('protein', e.target.value)} placeholder="選填" />
                </div>
                <div className="form-group">
                  <label>脂肪 (g)</label>
                  <input type="number" min="0" step="1" value={manual.fat}
                    onChange={e => setM('fat', e.target.value)} placeholder="選填" />
                </div>
                <div className="form-group">
                  <label>熱量 (kcal)</label>
                  <input type="number" min="0" step="1" value={manual.calories}
                    onChange={e => setM('calories', e.target.value)} placeholder="選填" />
                </div>
              </div>
              {manual.carbs && (
                <div className="manual-preview">
                  碳水 <strong>{manual.carbs}g</strong>
                  {manual.protein ? ` · 蛋白 ${manual.protein}g` : ''}
                  {manual.fat     ? ` · 脂肪 ${manual.fat}g`     : ''}
                  {manual.calories? ` · ${manual.calories}kcal`  : ''}
                </div>
              )}
            </div>
          )}

          {analysis && (
            <div className="analysis-card">
              <div className="analysis-header">
                <Zap size={14} color="var(--accent2)" />
                <span>營養分析結果</span>
                <span className={`confidence-badge conf-${analysis.confidence}`}>
                  {analysis.confidence === 'high' ? '高信心'
                    : analysis.confidence === 'medium' ? '中信心'
                    : analysis.confidence === 'partial' ? '部分無法判斷'
                    : analysis.confidence === 'undetermined' ? '無法判斷'
                    : '低信心'}
                </span>
              </div>

              {/* Carbs could not be determined at all → do not trust 0 g; push to manual */}
              {analysis.undetermined && (
                <div className="undetermined-banner">
                  <AlertTriangle size={14} />
                  <div>
                    <b>系統無法判斷碳水量</b>
                    <div className="undetermined-sub">
                      請改用「手動輸入」填寫碳水，或在描述中直接寫碳水量（例：<b>碳水50</b>）或份量（例：<b>白飯一碗</b>、<b>200g</b>、<b>半斤</b>、<b>葡萄糖一包</b>）。
                    </div>
                    <button type="button" className="btn-switch-manual" onClick={() => setInputMode('manual')}>
                      <Pencil size={12} /> 改用手動輸入碳水
                    </button>
                  </div>
                </div>
              )}

              {/* Some items recognized, others not → totals may undercount */}
              {analysis.partial && (analysis.unmatched || []).length > 0 && (
                <div className="partial-banner">
                  <AlertTriangle size={13} />
                  <span>有項目<b>無法判斷</b>（{analysis.unmatched.join('、')}），其碳水未計入，總量可能<b>低估</b>。可補述份量或改用手動輸入。</span>
                </div>
              )}

              <div className="detected-foods">
                {(analysis.foods || []).map((f, i) => <span key={i} className="food-tag">{f}</span>)}
                {(analysis.unmatched || []).length > 0 && (
                  <span className="food-tag unmatched-tag" title="資料庫中未找到，碳水未計入">
                    ⚠ 無法判斷：{analysis.unmatched.join('、')}
                  </span>
                )}
              </div>
              <div className="nutrition-grid">
                <div className="nutrition-item carbs">
                  <div className="nutrition-value">
                    {analysis.undetermined ? <span className="nv-unknown">無法判斷</span> : <>{analysis.carbs}<span>g</span></>}
                  </div>
                  <div className="nutrition-label">碳水化合物</div>
                </div>
                <div className="nutrition-item protein">
                  <div className="nutrition-value">{analysis.protein}<span>g</span></div>
                  <div className="nutrition-label">蛋白質</div>
                </div>
                <div className="nutrition-item fat">
                  <div className="nutrition-value">{analysis.fat}<span>g</span></div>
                  <div className="nutrition-label">脂肪</div>
                </div>
                <div className="nutrition-item calories">
                  <div className="nutrition-value">{analysis.calories}<span>kcal</span></div>
                  <div className="nutrition-label">熱量</div>
                </div>
              </div>
              {analysis.highGI?.length > 0 && (
                <div className="high-gi-section">
                  <div className="high-gi-title"><AlertTriangle size={13} /> 高GI食物警示</div>
                  {analysis.highGI.map((item, i) => (
                    <div key={i} className="high-gi-item">
                      <span className="gi-name">{item.name}</span>
                      <span className="gi-badge">GI {item.gi}</span>
                      <span className="gi-warning">{item.warning}</span>
                    </div>
                  ))}
                </div>
              )}
              {(() => {
                const g = classifyGlycemicResponse(analysis);
                const perFood = parseMealFoods(form.foods || '').filter(f => f.undetermined || (f.carbs ?? 0) > 0 || (f.protein ?? 0) >= 25 || (f.fat ?? 0) >= 20);
                return (
                  <div className="glycemic-box" style={{ borderColor: g.color }}>
                    <span className="glycemic-badge" style={{ background: g.color }}>整餐：{g.emoji} {g.label}</span>
                    {perFood.length > 0 && (
                      <div className="food-glycemic-list" style={{ marginTop: 2 }}>
                        {perFood.map((f, j) => {
                          if (f.undetermined) {
                            return (
                              <div key={j} className="fg-row">
                                <span className="fg-dot" style={{ background: '#9ca3af' }} />
                                <span className="fg-name">{f.name}</span>
                                <span className="fg-label fg-unknown">❓ 無法判斷</span>
                              </div>
                            );
                          }
                          const fg = classifyFood(f);
                          return (
                            <div key={j} className="fg-row">
                              <span className="fg-dot" style={{ background: fg.color }} />
                              <span className="fg-name">{f.name}</span>
                              <span className="fg-label" style={{ color: fg.color }}>{fg.emoji} {fg.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <span className="glycemic-note">{g.note}</span>
                  </div>
                );
              })()}
              {analysis.diabetesNotes && <div className="diabetes-notes">💡 {analysis.diabetesNotes}</div>}
            </div>
          )}

          <div className="form-group" style={{ marginTop: 12 }}>
            <label>用餐時間</label>
            <input type="datetime-local" value={form.timestamp} onChange={e => set('timestamp', e.target.value)} />
          </div>

          <div className="checkbox-row">
            <label className="checkbox-label">
              <input type="checkbox" checked={form.exerciseBefore} onChange={e => set('exerciseBefore', e.target.checked)} />
              餐前有運動
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.exerciseAfter} onChange={e => set('exerciseAfter', e.target.checked)} />
              餐後計畫運動
            </label>
          </div>

          <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="備註（選填）" style={{ marginBottom: 8 }} />

          <div className="btn-row">
            <button className="btn-primary" onClick={handleSave}
              disabled={inputMode === 'manual' ? !manual.carbs : (!form.foods || analysis?.undetermined)}>
              {editIndex !== null ? '儲存變更' : '記錄這餐'}
            </button>
            <button className="btn-secondary" onClick={() => { setShowForm(false); setAnalysis(null); setEditIndex(null); }}>取消</button>
          </div>
        </div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">本週用餐次數</div>
          <div className="stat-value">{state.meals.filter(m => new Date(m.timestamp) > new Date(Date.now() - 7 * 86400000)).length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">平均碳水 (g)</div>
          <div className="stat-value">
            {state.meals.length ? Math.round(state.meals.slice(-14).reduce((s, m) => s + (m.carbs || 0), 0) / Math.min(state.meals.length, 14)) : '-'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">高GI警示次數</div>
          <div className="stat-value" style={{ color: 'var(--yellow)' }}>
            {state.meals.filter(m => m.highGI?.length > 0).length}
          </div>
        </div>
      </div>

      {/* ── Dietary needs + today's intake ── */}
      {dietaryNeeds && (
        <div className="card dietary-card">
          <div className="dietary-header">
            <TrendingUp size={15} color="var(--accent2)" />
            <h3>每日營養目標</h3>
            {!dietaryNeeds.hasFullProfile && (
              <span className="dietary-estimate-badge">估算值</span>
            )}
          </div>

          {/* Target row — value + recommended range */}
          <div className="dietary-targets">
            {[
              { label: '熱量',  val: `${dietaryNeeds.tdee}`, unit: 'kcal', range: `${dietaryNeeds.ranges.calories.min}–${dietaryNeeds.ranges.calories.max}`, color: '#f97316' },
              { label: '碳水',  val: `${dietaryNeeds.carbsG}`, unit: 'g', range: `${dietaryNeeds.ranges.carbs.min}–${dietaryNeeds.ranges.carbs.max}g`, color: '#6366f1' },
              { label: '蛋白質',val: `${dietaryNeeds.proteinG}`, unit: 'g', range: `${dietaryNeeds.ranges.protein.min}–${dietaryNeeds.ranges.protein.max}g`, color: '#22c55e' },
              { label: '脂肪',  val: `${dietaryNeeds.fatG}`, unit: 'g', range: `${dietaryNeeds.ranges.fat.min}–${dietaryNeeds.ranges.fat.max}g`, color: '#f59e0b' },
            ].map(t => (
              <div key={t.label} className="dt-item">
                <div className="dt-val" style={{ color: t.color }}>{t.val}<span className="dt-unit">{t.unit}</span></div>
                <div className="dt-label">{t.label}</div>
                <div className="dt-sub">建議 {t.range}</div>
              </div>
            ))}
          </div>

          {/* Calculation method explanation */}
          <details className="diet-method">
            <summary>目標數值如何計算？</summary>
            <div className="diet-method-body">
              <div className="dm-row"><span className="dm-k">熱量 (TDEE)</span><span className="dm-v">{dietaryNeeds.method.tdee}＝{dietaryNeeds.tdee} kcal</span></div>
              <div className="dm-row"><span className="dm-k">碳水</span><span className="dm-v">{dietaryNeeds.method.carbs}（{dietaryNeeds.ranges.carbs.pct}）</span></div>
              <div className="dm-row"><span className="dm-k">蛋白質</span><span className="dm-v">{dietaryNeeds.method.protein}</span></div>
              <div className="dm-row"><span className="dm-k">脂肪</span><span className="dm-v">{dietaryNeeds.method.fat}（{dietaryNeeds.ranges.fat.pct}）</span></div>
              <div className="dm-row"><span className="dm-k">膳食纖維</span><span className="dm-v">建議每日 {dietaryNeeds.ranges.fiber.min}–{dietaryNeeds.ranges.fiber.max} g</span></div>
              <div className="dm-note">中央粗體為建議單一目標值，「建議範圍」為 ADA / DRI 對糖尿病患者的合理區間。</div>
            </div>
          </details>

          {/* Today's intake progress */}
          {dailyIntake && (
            <div className="today-intake">
              <div className="today-intake-title">今日攝取進度</div>
              {[
                { label: '熱量', actual: dailyIntake.actual.calories, target: dietaryNeeds.tdee,    unit: 'kcal', pct: dailyIntake.calPct,     color: '#f97316' },
                { label: '碳水', actual: dailyIntake.actual.carbs,    target: dietaryNeeds.carbsG,  unit: 'g',    pct: dailyIntake.carbPct,    color: '#6366f1' },
                { label: '蛋白', actual: dailyIntake.actual.protein,  target: dietaryNeeds.proteinG,unit: 'g',    pct: dailyIntake.proteinPct, color: '#22c55e' },
              ].map(row => (
                <div key={row.label} className="intake-row">
                  <span className="ir-label">{row.label}</span>
                  <div className="ir-bar-wrap">
                    <div className="ir-bar-bg">
                      <div className="ir-bar-fill" style={{
                        width: `${Math.min(row.pct, 100)}%`,
                        background: row.pct > 105 ? '#ef4444' : row.color,
                      }} />
                    </div>
                  </div>
                  <span className="ir-text">{row.actual}<span className="ir-unit">{row.unit}</span>
                    <span className="ir-target"> / {row.target}</span>
                  </span>
                  <span className="ir-pct" style={{ color: row.pct > 105 ? '#ef4444' : row.pct >= 80 ? '#22c55e' : 'var(--text-muted)' }}>
                    {row.pct}%
                  </span>
                </div>
              ))}

              {/* Today's recommendations */}
              {dailyIntake.recommendations.length > 0 && (
                <div className="intake-recs">
                  {dailyIntake.recommendations.map((r, i) => (
                    <div key={i} className={`intake-rec intake-rec-${r.type}`}>
                      <span>{r.icon}</span> {r.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Diet preferences ── */}
      <div className="card">
        <div className="dietary-header" style={{ marginBottom: 10 }}>
          <Utensils size={14} color="var(--accent2)" />
          <h3>飲食偏好</h3>
        </div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label>素食類別</label>
          <select value={dietPrefs.vegetarianType} onChange={e => setPref('vegetarianType', e.target.value)}>
            {VEG_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>忌口食物（以逗號分隔）</label>
          <input value={dietPrefs.avoidFoods} onChange={e => setPref('avoidFoods', e.target.value)}
            placeholder="例：牛肉、花生、奶製品" />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>設定後，下方營養建議會依您的素別與忌口調整。</p>
      </div>

      {/* ── Nutrient analysis & dietary advice (merged) ── */}
      {(nutrientAdvice.length > 0 || dietaryTips.length > 0) && (
        <div className="card">
          <div className="dietary-header" style={{ marginBottom: 10 }}>
            <TrendingUp size={14} color="var(--accent2)" />
            <h3>營養素分析與建議</h3>
          </div>
          {(() => {
            const ADVICE_PREVIEW = 3;
            const allAdvice = [
              ...nutrientAdvice.map((t, i) => ({
                key: `n-${i}`,
                cls: t.severity === 'warn' ? 'warn' : t.severity === 'neutral' ? 'neutral' : 'info',
                title: t.title, body: t.body,
              })),
              ...dietaryTips.map((tip, i) => ({
                key: `d-${i}`, cls: tip.severity, title: tip.title, body: tip.body,
              })),
            ];
            const shown = showAllAdvice ? allAdvice : allAdvice.slice(0, ADVICE_PREVIEW);
            return (<>
              {shown.map(a => (
                <div key={a.key} className={`diet-tip diet-tip-${a.cls}`}>
                  <div className="tip-title">{a.title}</div>
                  <div className="tip-body">{a.body}</div>
                </div>
              ))}
              {allAdvice.length > ADVICE_PREVIEW && (
                <button className="btn-secondary full-width" style={{ marginTop: 4 }}
                  onClick={() => setShowAllAdvice(s => !s)}>
                  {showAllAdvice ? '收合' : `顯示更多（共 ${allAdvice.length} 個建議）`}
                </button>
              )}
            </>);
          })()}
          {!dietaryNeeds && (
            <div className="hint" style={{ marginTop: 8 }}>
              前往「個人資料」填寫身高體重年齡可獲得更精準建議
            </div>
          )}
        </div>
      )}

      {/* ── Nutrient Impact Ranking ── */}
      <NutrientImpactRanking />

      <div className="card">
        <h3>最近飲食紀錄</h3>
        <div className="day-nav">
          <button className="day-nav-btn" onClick={() => shiftMealDay(-1)} aria-label="前一天"><ChevronLeft size={16} /></button>
          <input type="date" className="day-nav-date" value={mealDay} max={mealToday}
            onChange={e => e.target.value && setMealDay(e.target.value)} />
          <button className="day-nav-btn" onClick={() => shiftMealDay(1)} disabled={mealIsToday} aria-label="後一天"><ChevronRight size={16} /></button>
          {!mealIsToday && <button className="day-nav-today" onClick={() => setMealDay(mealToday)}>今天</button>}
        </div>
        {recent.length === 0 && <div className="empty-state">當天無飲食紀錄</div>}
        {recent.map((m) => {
          const mt = MEAL_TYPES.find(t => t.key === m.mealType);
          const fb = mealNutrientFeedback(m);
          return (
            <div key={m._origIdx} className="meal-row">
              <div className="meal-icon">{mt?.icon || '🍽️'}</div>
              <div className="meal-info">
                <div className="meal-name">{mt?.label} · {format(new Date(m.timestamp), 'MM/dd HH:mm')}</div>
                <div className="meal-foods">{m.foods}</div>
                <div className="meal-meta">
                  {m.carbs > 0    && <span>碳水 {m.carbs}g</span>}
                  {m.protein > 0  && <span>蛋白 {m.protein}g</span>}
                  {m.calories > 0 && <span>{m.calories}kcal</span>}
                  {m.preMealBG    && <span>餐前BG {m.preMealBG}</span>}
                  {m.highGI?.length > 0 && <span className="tag-yellow">⚠ 高GI</span>}
                  {m.exerciseBefore && <span className="tag-green">餐前運動</span>}
                  {m.exerciseAfter  && <span className="tag-blue">餐後運動</span>}
                </div>
                {(() => {
                  const perFood = parseMealFoods(m.foods || '').filter(f => f.undetermined || (f.carbs ?? 0) > 0 || (f.protein ?? 0) >= 25 || (f.fat ?? 0) >= 20);
                  if (perFood.length < 1) return null;
                  return (
                    <div className="food-glycemic-list">
                      {perFood.map((f, j) => {
                        if (f.undetermined) {
                          return (
                            <div key={j} className="fg-row">
                              <span className="fg-dot" style={{ background: '#9ca3af' }} />
                              <span className="fg-name">{f.name}</span>
                              <span className="fg-label fg-unknown">❓ 無法判斷</span>
                            </div>
                          );
                        }
                        const g = classifyFood(f);
                        return (
                          <div key={j} className="fg-row">
                            <span className="fg-dot" style={{ background: g.color }} />
                            <span className="fg-name">{f.name}</span>
                            <span className="fg-label" style={{ color: g.color }}>{g.emoji} {g.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {fb.good.length > 0 && (
                  <div className="meal-feedback meal-feedback-good">✅ 補充了 {fb.good.join('、')}</div>
                )}
                {fb.notes.map((n, j) => (
                  <div key={j} className="meal-feedback meal-feedback-note">💡 {n}</div>
                ))}
                {m.diabetesNotes && <div className="meal-notes">💡 {m.diabetesNotes}</div>}
              </div>
              <div className="row-actions">
                <button className="btn-row-action" title="編輯" onClick={() => openEdit(m._origIdx)}>
                  <Pencil size={14} />
                </button>
                <button className="btn-row-action btn-row-delete" title="刪除" onClick={() => setConfirm({ index: m._origIdx })}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {recent.length === 0 && <div className="empty-state">尚無飲食紀錄，點右上角 + 新增</div>}
      </div>
    </div>
  );
}
