import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import { Syringe, AlertTriangle, CheckCircle, Info, Plus, Zap, Moon, Settings, Pencil, Trash2, Clock } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import {
  checkDataSufficiency, calculateTDD, deriveICRandISF,
  proposeICRCorrection, recommendDose, estimateTDDFromWeight,
  analyzeBasalAdequacy, analyzeRapidDosingHistory, INSULIN_BRANDS,
  getBrandProfile,
} from '../utils/insulinCalculator';
import { parseMealText } from '../utils/foodParser';
import { format } from 'date-fns';
import { SEED_ANALYSIS } from '../utils/seedData';

const EXERCISE_TYPES = [
  { value: 'light',    label: '輕度（散步、瑜伽）' },
  { value: 'moderate', label: '中度（慢跑、游泳）' },
  { value: 'vigorous', label: '高強度（重訓、間歇）' },
];

const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function InsulinAdvisor() {
  const { state, dispatch } = useApp();
  const nav = useNavigate();

  const rapidBrand = state.settings.rapidBrand || 'NovoRapid';
  const shortBrand = state.settings.shortBrand || 'Humulin R';
  const longBrand  = state.settings.longBrand  || 'Tresiba';
  const rapidProfile = getBrandProfile(rapidBrand);
  // brandType → 對應品牌名稱
  const brandFor = (bt) => (bt === 'long' ? longBrand : bt === 'short' ? shortBrand : rapidBrand);

  // Insulin types the user actually uses — a brand set to「無」is excluded from
  // the injection-logging UI (tabs + brand bar).
  const TYPE_META = {
    rapid: { brand: rapidBrand, label: '速效', emoji: '⚡', tagClass: 'rapid-tag', activeClass: 'active-rapid', Icon: Zap },
    short: { brand: shortBrand, label: '短效', emoji: '🕒', tagClass: 'short-tag', activeClass: 'active-short', Icon: Clock },
    long:  { brand: longBrand,  label: '長效', emoji: '🌙', tagClass: 'long-tag',  activeClass: 'active-long',  Icon: Moon },
  };
  const availableTypes = ['rapid', 'short', 'long'].filter(t => TYPE_META[t].brand && TYPE_META[t].brand !== '無');

  const [form, setForm] = useState({
    mealType: 'lunch',
    exerciseBefore: false, exerciseBeforeType: 'moderate',
    exerciseAfter:  false, exerciseAfterType:  'moderate',
  });
  const [foodText, setFoodText]   = useState('');
  const [foodAnalysis, setFoodAnalysis] = useState(null);
  const [result, setResult]       = useState(null);
  const [logDose, setLogDose]     = useState(false);
  const [logMeal, setLogMeal]     = useState(false);

  const [quickLog, setQuickLog] = useState({
    units: '', brandType: 'rapid', mealType: 'lunch',
    timestamp: nowLocal(), notes: '',
  });
  const [quickSaved, setQuickSaved] = useState(false);
  const setQ = (k, v) => setQuickLog(q => ({ ...q, [k]: v }));
  const set  = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // If the selected injection type is now「無」(unavailable), fall back to the first
  // available one so the form never points at a brand the user doesn't use.
  useEffect(() => {
    if (availableTypes.length && !availableTypes.includes(quickLog.brandType)) {
      setQ('brandType', availableTypes[0]);
    }
  }, [availableTypes, quickLog.brandType]);

  // edit / delete state for injection logs
  const [logConfirm, setLogConfirm]   = useState(null); // { index: origIdx }
  const [editLogIdx, setEditLogIdx]   = useState(null);
  const [editLogForm, setEditLogForm] = useState(null);
  const setEL = (k, v) => setEditLogForm(f => ({ ...f, [k]: v }));

  const openEditLog = (origIdx) => {
    const l = state.insulinLogs[origIdx];
    setEditLogIdx(origIdx);
    setEditLogForm({
      units:     String(l.units || ''),
      brandType: l.brandType || 'rapid',
      mealType:  l.mealType  || 'lunch',
      notes:     l.notes     || '',
      timestamp: l.timestamp
        ? new Date(new Date(l.timestamp) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : nowLocal(),
    });
  };

  const handleSaveEditLog = () => {
    if (!editLogForm?.units) return;
    dispatch({
      type: 'UPDATE_INSULIN_LOG',
      payload: {
        index: editLogIdx,
        data: {
          units:     parseFloat(editLogForm.units),
          brand:     brandFor(editLogForm.brandType),
          brandType: editLogForm.brandType,
          mealType:  editLogForm.mealType,
          notes:     editLogForm.notes,
          timestamp: new Date(editLogForm.timestamp).toISOString(),
        },
      },
    });
    setEditLogIdx(null);
    setEditLogForm(null);
  };

  // ── Auto-fill BG from latest LibreLink reading (≤30 min) ──
  const autoLatestBG = useMemo(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    return state.glucoseReadings
      .filter(r => new Date(r.timestamp).getTime() > cutoff)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
  }, [state.glucoseReadings]);

  // ── TDD: logs → manual profile → weight estimate → safe default ──
  const { tdd, tddSource } = useMemo(() => {
    const fromLogs = calculateTDD(state.insulinLogs);
    if (fromLogs) return { tdd: fromLogs, tddSource: 'logs' };
    if (state.profile?.tdd) return { tdd: parseFloat(state.profile.tdd), tddSource: 'manual' };
    const fromWeight = estimateTDDFromWeight(state.profile?.weight);
    if (fromWeight) return { tdd: fromWeight, tddSource: 'weight' };
    return { tdd: 40, tddSource: 'default' };
  }, [state.insulinLogs, state.profile]);

  // Active ICR/ISF = manual override if set, else TDD-derived (regression is opt-in below)
  const { icr, isf } = useMemo(() => {
    const base = deriveICRandISF(tdd, state.settings.bgUnit);
    return { icr: state.icr ?? base.icr, isf: state.isf ?? base.isf };
  }, [tdd, state.icr, state.isf, state.settings.bgUnit]);

  // Regression correction proposal (opt-in)
  const correctionProposal = useMemo(
    () => proposeICRCorrection(state.meals, state.glucoseReadings, state.insulinLogs, icr, isf),
    [state.meals, state.glucoseReadings, state.insulinLogs, icr, isf]
  );
  const [correctionResult, setCorrectionResult] = useState(null);
  const applyCorrection = () => {
    const from = icr;
    const to = correctionProposal.suggestedICR;
    dispatch({ type: 'UPDATE_ICR_ISF', payload: { icr: to, isf } });
    setCorrectionResult({ from, to });
  };

  const insufficiencies = useMemo(() => checkDataSufficiency(state), [state]);
  const hasEnoughData = insufficiencies.length === 0;

  // ── Basal adequacy analysis ──
  const basalAnalysis = useMemo(() =>
    analyzeBasalAdequacy(state.glucoseReadings, state.insulinLogs),
    [state.glucoseReadings, state.insulinLogs]
  );

  // ── Rapid dosing behavior analysis ──
  const rapidAnalysis = useMemo(() =>
    analyzeRapidDosingHistory(state.meals, state.glucoseReadings, state.insulinLogs),
    [state.meals, state.glucoseReadings, state.insulinLogs]
  );

  // ── Formula explanation toggle ──
  const [showFormula, setShowFormula] = useState(false);

  // ── Parameter adjustment ──
  const targetBG = state.settings.targetBG || 100;
  const [showParamEdit, setShowParamEdit] = useState(false);
  const [pendingParams, setPendingParams] = useState({ icr: '', isf: '', targetBG: '' });
  const [paramConfirm, setParamConfirm]   = useState(false);
  const setPP = (k, v) => setPendingParams(p => ({ ...p, [k]: v }));

  const openParamEdit = () => {
    setPendingParams({ icr: String(icr ?? ''), isf: String(isf ?? ''), targetBG: String(targetBG) });
    setShowParamEdit(true);
  };

  const handleParamConfirmed = () => {
    const newICR = parseFloat(pendingParams.icr);
    const newISF = parseFloat(pendingParams.isf);
    const newTBG = parseFloat(pendingParams.targetBG);
    if (!isNaN(newICR) && !isNaN(newISF)) dispatch({ type: 'UPDATE_ICR_ISF', payload: { icr: newICR, isf: newISF } });
    if (!isNaN(newTBG)) dispatch({ type: 'UPDATE_SETTINGS', payload: { targetBG: newTBG } });
    setParamConfirm(false);
    setShowParamEdit(false);
  };

  // ── Food analysis ──
  const handleAnalyzeFood = () => {
    if (!foodText.trim()) return;
    const result = parseMealText(foodText);
    setFoodAnalysis(result);
  };

  // ── Calculate dose ──
  const currentBG = autoLatestBG?.value ?? null;
  const carbs = foodAnalysis?.carbs ?? null;

  const calculate = () => {
    if (!carbs || currentBG === null) return;
    const rec = recommendDose({
      currentBG,
      targetBG: state.settings.targetBG || 100,
      carbs,
      mealType: form.mealType,
      icr, isf,
      exerciseBefore:     form.exerciseBefore,
      exerciseAfter:      form.exerciseAfter,
      exerciseBeforeType: form.exerciseBeforeType,
      exerciseAfterType:  form.exerciseAfterType,
      brand: rapidBrand,
      protein:     foodAnalysis?.protein ?? 0,
      fat:         foodAnalysis?.fat ?? 0,
      highGICount: foodAnalysis?.highGI?.length ?? 0,
    });
    setResult(rec);
  };

  const handleLogDose = () => {
    if (!result) return;
    dispatch({
      type: 'ADD_INSULIN_LOG',
      payload: {
        units:    result.totalDose,
        brand:    rapidBrand,
        brandType: 'rapid',
        mealType: form.mealType,
        currentBG,
        timestamp: new Date().toISOString(),
        source: 'calculated',
      },
    });
    setLogDose(true);
    setTimeout(() => setLogDose(false), 2000);
  };

  const handleLogMeal = () => {
    if (!foodAnalysis || !foodText) return;
    dispatch({
      type: 'ADD_MEAL',
      payload: {
        mealType: form.mealType,
        foods: foodText,
        carbs:    foodAnalysis.carbs,
        protein:  foodAnalysis.protein,
        fat:      foodAnalysis.fat,
        calories: foodAnalysis.calories,
        highGI:   foodAnalysis.highGI ?? [],
        diabetesNotes: foodAnalysis.diabetesNotes ?? '',
        preMealBG: currentBG,
        preMealBGTime: autoLatestBG?.timestamp ?? null,
        exerciseBefore: form.exerciseBefore,
        exerciseAfter:  form.exerciseAfter,
        timestamp: new Date().toISOString(),
        analysisConfidence: foodAnalysis.confidence,
      },
    });
    setLogMeal(true);
    setTimeout(() => setLogMeal(false), 2000);
  };

  const handleQuickLog = () => {
    if (!quickLog.units) return;
    dispatch({
      type: 'ADD_INSULIN_LOG',
      payload: {
        units:    parseFloat(quickLog.units),
        brand:    brandFor(quickLog.brandType),
        brandType: quickLog.brandType,
        mealType: quickLog.mealType,
        timestamp: new Date(quickLog.timestamp).toISOString(),
        notes:    quickLog.notes,
        source:   'manual',
      },
    });
    setQuickSaved(true);
    setTimeout(() => {
      setQuickSaved(false);
      setQuickLog(q => ({ ...q, units: '', notes: '', timestamp: nowLocal() }));
    }, 1500);
  };

  const tddSourceLabel = {
    logs: `${state.insulinLogs.length} 筆注射紀錄`,
    manual: '手動輸入',
    weight: `體重估算（${state.profile?.weight}kg）`,
    default: '預設值（建議補充資料）',
  }[tddSource];

  return (
    <div className="page">
      {logConfirm && (
        <ConfirmDialog
          title="確認刪除注射紀錄？"
          message={`${format(new Date(state.insulinLogs[logConfirm.index]?.timestamp), 'MM/dd HH:mm')}  ${state.insulinLogs[logConfirm.index]?.units} U — 此操作無法復原。`}
          confirmLabel="刪除"
          danger
          onConfirm={() => { dispatch({ type: 'DELETE_INSULIN_LOG', payload: logConfirm.index }); setLogConfirm(null); }}
          onCancel={() => setLogConfirm(null)}
        />
      )}

      {paramConfirm && (
        <ConfirmDialog
          title="確認修改計算參數？"
          message={`新參數：ICR 1:${pendingParams.icr}、ISF ${pendingParams.isf} mg/dL/U、目標血糖 ${pendingParams.targetBG} mg/dL。\n\n⚠️ 風險提醒：劑量參數直接影響注射量計算。ICR 設太低或 ISF 設太低，可能導致每餐劑量過高，造成低血糖（低於 70 mg/dL）；反之可能導致持續高血糖。建議在醫師或衛教師指導下調整，首次修改後請密切監測血糖。`}
          confirmLabel="我了解風險，確認修改"
          danger
          onConfirm={handleParamConfirmed}
          onCancel={() => setParamConfirm(false)}
        />
      )}

      <div className="page-header">
        <Syringe size={22} /> <h2>胰島素劑量建議</h2>
      </div>

      {/* Data warnings (soft — don't block) */}
      {!hasEnoughData && (
        <div className="card alert-card alert-soft">
          <div className="alert-header">
            <AlertTriangle size={16} color="#f59e0b" />
            <span>資料尚不完整，以下為估算值，僅供參考</span>
          </div>
          <ul className="insufficiency-list">
            {insufficiencies.map((f, i) => (
              <li key={i}><AlertTriangle size={11} color="#f59e0b" /> {f.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Basal adequacy analysis ── */}
      {basalAnalysis.status !== 'insufficient_data' && (
        <div className={`card basal-alert-card basal-${basalAnalysis.severity}`}>
          <div className="basal-alert-header">
            {basalAnalysis.severity === 'good'
              ? <CheckCircle size={15} color="var(--green)" />
              : <AlertTriangle size={15} color={basalAnalysis.severity === 'danger' ? '#ef4444' : '#f59e0b'} />}
            <span className="basal-alert-title">長效胰島素評估</span>
            <span className="basal-avg-badge">{basalAnalysis.avgBG} mg/dL 夜間均值</span>
          </div>
          <div className="basal-alert-msg">{basalAnalysis.message}</div>
          {basalAnalysis.suggestion && (
            <div className="basal-suggestion">
              💡 {basalAnalysis.suggestion}
            </div>
          )}
          {basalAnalysis.avgLongDose && (
            <div className="basal-meta">
              近7天長效平均劑量：{basalAnalysis.avgLongDose.toFixed(1)} U／次
            </div>
          )}
          <div className="basal-disclaimer">此為系統估算，調整前請諮詢醫師或衛教師。</div>
        </div>
      )}

      {/* ICR / ISF summary + param edit */}
      <div className="card icr-card">
        <div className="icr-row">
          <div className="icr-item">
            <div className="icr-label">ICR</div>
            <div className="icr-value">1 : {icr ?? '?'}</div>
            <div className="icr-hint">每 {icr}g 碳水→1U</div>
          </div>
          <div className="icr-item">
            <div className="icr-label">ISF</div>
            <div className="icr-value">{isf ?? '?'}</div>
            <div className="icr-hint">1U 降 {isf} mg/dL</div>
          </div>
          <div className="icr-item">
            <div className="icr-label">TDD</div>
            <div className="icr-value">{tdd?.toFixed(1)} U</div>
            <div className="icr-hint">{tddSourceLabel}</div>
          </div>
        </div>
        <div className="param-row">
          <span className="param-hint">目標血糖 {targetBG} mg/dL</span>
          <button className="btn-param-edit" onClick={showParamEdit ? () => setShowParamEdit(false) : openParamEdit}>
            <Pencil size={11} /> {showParamEdit ? '收起' : '調整參數'}
          </button>
        </div>
        {showParamEdit && (
          <div className="param-edit-panel">
            <div className="param-edit-title">
              <Info size={13} color="var(--accent2)" /> 手動調整計算參數
            </div>
            <div className="param-explain">
              <div className="param-explain-row">
                <span className="pe-label">ICR（碳水比）</span>
                <span className="pe-desc">每 1 U 餐前胰島素可覆蓋多少克碳水。數值越小代表更敏感，需要更多胰島素。</span>
              </div>
              <div className="param-explain-row">
                <span className="pe-label">ISF（敏感度）</span>
                <span className="pe-desc">1 U 餐前胰島素可使血糖下降多少 mg/dL。數值越大代表更敏感。</span>
              </div>
              <div className="param-explain-row">
                <span className="pe-label">目標血糖</span>
                <span className="pe-desc">校正劑量的計算目標值，通常設 100 mg/dL。</span>
              </div>
            </div>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="form-group">
                <label>ICR（每 U 覆蓋碳水 g）</label>
                <input type="number" min="1" max="50" step="1"
                  value={pendingParams.icr} onChange={e => setPP('icr', e.target.value)}
                  placeholder={String(icr ?? '')} />
              </div>
              <div className="form-group">
                <label>ISF（mg/dL / U）</label>
                <input type="number" min="10" max="200" step="1"
                  value={pendingParams.isf} onChange={e => setPP('isf', e.target.value)}
                  placeholder={String(isf ?? '')} />
              </div>
              <div className="form-group" style={{ gridColumn: 'span 2' }}>
                <label>目標血糖（mg/dL）</label>
                <input type="number" min="70" max="180" step="5"
                  value={pendingParams.targetBG} onChange={e => setPP('targetBG', e.target.value)}
                  placeholder={String(targetBG)} />
              </div>
            </div>
            <button className="btn-primary full-width" style={{ marginTop: 8 }}
              onClick={() => setParamConfirm(true)}
              disabled={!pendingParams.icr || !pendingParams.isf || !pendingParams.targetBG}>
              套用參數
            </button>
          </div>
        )}
      </div>

      {/* ── Regression correction proposal (opt-in) ── */}
      {correctionProposal.suggested && !correctionResult && (
        <div className="card correction-card">
          <div className="correction-header">
            <Info size={15} color="var(--accent2)" />
            <span className="correction-title">參數回歸修正建議</span>
          </div>
          <div className="correction-body">
            <p>{correctionProposal.reason}</p>
            <div className="correction-change">
              <span className="cc-from">ICR 1:{correctionProposal.activeICR}</span>
              <span className="cc-arrow">→</span>
              <span className="cc-to">1:{correctionProposal.suggestedICR}</span>
            </div>
            <p className="correction-note">
              此修正依據近期餐後血糖反應的回歸分析。是否同意套用？套用後將影響後續所有劑量計算。
            </p>
          </div>
          <div className="correction-actions">
            <button className="btn-primary" onClick={applyCorrection}>同意修正</button>
            <button className="btn-secondary" onClick={() => setCorrectionResult({ dismissed: true })}>暫不修正</button>
          </div>
        </div>
      )}

      {/* Correction result notification */}
      {correctionResult && !correctionResult.dismissed && (
        <div className="card correction-result">
          <CheckCircle size={16} color="var(--green)" />
          <span>
            已完成參數修正：ICR <strong>1:{correctionResult.from}</strong> → <strong>1:{correctionResult.to}</strong>。
            後續劑量計算將套用新參數。
          </span>
        </div>
      )}

      {/* ── Calculator ── */}
      <div className="card">
        <h3>計算本餐劑量</h3>

        {/* Confirmed brand display */}
        <div className="confirmed-brand-bar">
          <span className="rapid-tag">⚡ {rapidBrand}</span>
          <button className="btn-brand-change" onClick={() => nav('/settings')}>
            <Settings size={11} /> 更換品牌
          </button>
        </div>
        <div className="brand-timing-hint">
          <Info size={11} /> {rapidProfile.timing}（劑量單位不因品牌改變，差異在注射時機）
        </div>

        {/* Auto BG from LibreLink */}
        <div className={`auto-bg-banner ${autoLatestBG ? '' : 'auto-bg-warn'}`}>
          {autoLatestBG ? (
            <>
              <CheckCircle size={13} color="var(--green)" />
              <span>餐前血糖（LibreLink）：<strong>{autoLatestBG.value} mg/dL</strong>
                <span className="bg-time-badge">{format(new Date(autoLatestBG.timestamp), 'HH:mm')}</span>
              </span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} />
              <span>無近期 LibreLink 血糖（30分鐘內），請先同步或手動記錄血糖</span>
            </>
          )}
        </div>

        {/* Meal type */}
        <div className="form-group">
          <label>用餐類型</label>
          <select value={form.mealType} onChange={e => set('mealType', e.target.value)}>
            <option value="breakfast">早餐</option>
            <option value="lunch">午餐</option>
            <option value="dinner">晚餐</option>
            <option value="lateSnack">宵夜</option>
            <option value="snack">點心</option>
          </select>
        </div>

        {/* Food description */}
        <div className="form-group">
          <label>餐點內容描述</label>
          <textarea value={foodText} onChange={e => { setFoodText(e.target.value); setFoodAnalysis(null); setResult(null); }}
            placeholder="例：白飯一碗、雞腿一隻、炒青菜" rows={2} />
        </div>
        <button className="btn-analyze" onClick={handleAnalyzeFood} disabled={!foodText.trim()}>
          <Zap size={13} /> 分析食物
        </button>

        {/* Nutrition result */}
        {foodAnalysis && (
          <div className="analysis-card" style={{ marginBottom: 12 }}>
            <div className="nutrition-grid">
              <div className="nutrition-item carbs">
                <div className="nutrition-value">{foodAnalysis.carbs}<span>g</span></div>
                <div className="nutrition-label">碳水</div>
              </div>
              <div className="nutrition-item protein">
                <div className="nutrition-value">{foodAnalysis.protein}<span>g</span></div>
                <div className="nutrition-label">蛋白質</div>
              </div>
              <div className="nutrition-item fat">
                <div className="nutrition-value">{foodAnalysis.fat}<span>g</span></div>
                <div className="nutrition-label">脂肪</div>
              </div>
              <div className="nutrition-item calories">
                <div className="nutrition-value">{foodAnalysis.calories}<span>kcal</span></div>
                <div className="nutrition-label">熱量</div>
              </div>
            </div>
            {foodAnalysis.highGI?.length > 0 && (
              <div className="high-gi-section">
                <div className="high-gi-title"><AlertTriangle size={12} /> 高GI食物</div>
                {foodAnalysis.highGI.map((h, i) => (
                  <div key={i} className="high-gi-item">
                    <span className="gi-name">{h.name}</span>
                    <span className="gi-badge">GI {h.gi}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Exercise */}
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
        {form.exerciseBefore && (
          <div className="form-group exercise-type-row">
            <label>餐前運動強度</label>
            <select value={form.exerciseBeforeType} onChange={e => set('exerciseBeforeType', e.target.value)}>
              {EXERCISE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}
        {form.exerciseAfter && (
          <div className="form-group exercise-type-row">
            <label>餐後運動強度</label>
            <select value={form.exerciseAfterType} onChange={e => set('exerciseAfterType', e.target.value)}>
              {EXERCISE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        <button className="btn-primary full-width" onClick={calculate}
          disabled={!foodAnalysis || currentBG === null}>
          計算建議劑量
        </button>
        {(!foodAnalysis || currentBG === null) && (
          <p className="hint" style={{ textAlign: 'center', marginTop: 6 }}>
            {!foodAnalysis ? '請先描述餐點並分析食物' : '無近期血糖資料，請先同步 LibreLink'}
          </p>
        )}

        {/* Formula explanation toggle */}
        <button className="btn-formula-toggle" onClick={() => setShowFormula(s => !s)}>
          <Info size={12} /> {showFormula ? '收起說明' : '劑量如何計算？'}
        </button>
        {showFormula && (
          <div className="formula-panel">
            <div className="formula-title">📐 劑量計算公式</div>

            {/* Step 0: TDD derivation from user data */}
            <div className="formula-step formula-step-derive">
              <span className="fs-label">⓪ 您的 TDD（每日總劑量）</span>
              {tddSource === 'logs' && (
                <span className="fs-formula">
                  過去 7 天注射紀錄平均 → <strong>TDD = {tdd?.toFixed(1)} U／天</strong>
                  <span className="fs-note-inline">（來自 {state.insulinLogs.length} 筆紀錄，系統自動計算）</span>
                </span>
              )}
              {tddSource === 'weight' && (
                <span className="fs-formula">
                  體重估算：{state.profile?.weight} kg × 0.5 U/kg = <strong>TDD = {tdd?.toFixed(1)} U</strong>
                  <span className="fs-note-inline">（尚無足夠注射紀錄，以體重推算）</span>
                </span>
              )}
              {tddSource === 'manual' && (
                <span className="fs-formula">
                  手動設定 → <strong>TDD = {tdd?.toFixed(1)} U</strong>
                </span>
              )}
              {tddSource === 'default' && (
                <span className="fs-formula">
                  預設值 → <strong>TDD = 40 U</strong>
                  <span className="fs-note-inline warn">建議填寫體重或累積注射紀錄以提升精準度</span>
                </span>
              )}
            </div>

            {/* Step 1: ICR derivation */}
            <div className="formula-step">
              <span className="fs-label">① ICR（碳水胰島素比）</span>
              <span className="fs-formula">
                500 ÷ TDD = 500 ÷ {tdd?.toFixed(1)} = <strong>1 : {icr}</strong>
                {state.icr ? <span className="fs-override"> ✏️ 已手動覆蓋</span> : null}
              </span>
              <span className="fs-note">
                「500 法則」：T1D 患者每 <strong>{icr} g</strong> 碳水需要 1 U 餐前胰島素。
                TDD 愈高代表胰島素需求大，ICR 數值愈小（每克碳水需更多胰島素）。
              </span>
            </div>

            {/* Step 2: ISF derivation */}
            <div className="formula-step">
              <span className="fs-label">② ISF（胰島素敏感度）</span>
              <span className="fs-formula">
                1700 ÷ TDD = 1700 ÷ {tdd?.toFixed(1)} = <strong>{isf} mg/dL / U</strong>
                {state.isf ? <span className="fs-override"> ✏️ 已手動覆蓋</span> : null}
              </span>
              <span className="fs-note">
                「1700 法則」：注射 1 U 餐前胰島素，血糖約下降 <strong>{isf} mg/dL</strong>。
                TDD 愈高，ISF 數值愈小（每 U 影響血糖幅度較小）。
              </span>
            </div>

            {/* Step 3: carb dose */}
            <div className="formula-step">
              <span className="fs-label">③ 碳水劑量</span>
              <span className="fs-formula">
                {foodAnalysis?.carbs ?? '碳水'}g ÷ ICR {icr} = <strong>{foodAnalysis ? (Math.round(foodAnalysis.carbs / icr * 10) / 10) : '?'} U</strong>
              </span>
            </div>

            {/* Step 4: correction dose */}
            <div className="formula-step">
              <span className="fs-label">④ 校正劑量</span>
              <span className="fs-formula">
                （{currentBG ?? '血糖'} − 目標 {targetBG}）÷ ISF {isf} = <strong>{currentBG !== null ? (Math.round((currentBG - targetBG) / isf * 10) / 10) : '?'} U</strong>
              </span>
            </div>

            {/* Step 5: total */}
            <div className="formula-step">
              <span className="fs-label">⑤ 合計</span>
              <span className="fs-formula">③ + ④，再依運動強度 / 餐型修正</span>
            </div>

            <button className="btn-param-edit" style={{ marginTop: 10 }} onClick={openParamEdit}>
              <Pencil size={11} /> 調整 ICR / ISF / 目標血糖
            </button>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="card result-card">
          <div className="result-header">
            <CheckCircle size={20} color="#22c55e" />
            <h3>建議劑量</h3>
          </div>
          <div className="dose-display">
            <div className="dose-main">{result.totalDose} <span>U</span></div>
            <div className="dose-label">{rapidBrand}</div>
          </div>
          <div className="dose-breakdown">
            <div className="breakdown-row">
              <span>碳水劑量（{foodAnalysis?.carbs}g ÷ ICR {icr}）</span>
              <span>{result.carbDose} U</span>
            </div>
            <div className="breakdown-row">
              <span>校正劑量（BG {currentBG} → 目標 {state.settings.targetBG || 100}）</span>
              <span>{result.correctionDose > 0 ? '+' : ''}{result.correctionDose} U</span>
            </div>
            {result.notes.map((n, i) => (
              <div key={i} className="breakdown-note"><Info size={12} /> {n}</div>
            ))}
          </div>

          {/* ── Injection timing (digestion / GI / protein-fat aware) ── */}
          {result.injectionTiming && (
            <div className={`timing-card timing-${result.injectionTiming.mode}`}>
              <div className="timing-head">
                <Clock size={15} />
                <span className="timing-label">建議注射時機</span>
                <span className="timing-when">{result.injectionTiming.label}</span>
              </div>
              <div className="timing-reason">{result.injectionTiming.reason}</div>
              {result.injectionTiming.splitNote && (
                <div className="timing-split">💉 {result.injectionTiming.splitNote}</div>
              )}
            </div>
          )}

          <div className="safety-warning">
            <AlertTriangle size={14} color="#f59e0b" />
            此為參考值，最終劑量請與醫師或衛教師確認。
          </div>
          <div className="dose-log-row">
            <button className="btn-secondary" onClick={handleLogDose} style={{ flex: 1 }}>
              {logDose ? '✓ 已記錄注射' : '記錄此次注射'}
            </button>
            <button className="btn-secondary" onClick={handleLogMeal} style={{ flex: 1 }}
              disabled={!foodAnalysis}>
              {logMeal ? '✓ 已記錄飲食' : '同時記錄飲食'}
            </button>
          </div>
        </div>
      )}

      {/* ── Quick manual injection log ── */}
      <div className="card">
        <h3><Plus size={14} /> 手動記錄注射</h3>
        <div className="confirmed-brand-bar" style={{ marginBottom: 10 }}>
          {availableTypes.map(t => (
            <span key={t} className={TYPE_META[t].tagClass}>{TYPE_META[t].emoji} {TYPE_META[t].brand}</span>
          ))}
          <button className="btn-brand-change" onClick={() => nav('/settings')}>
            <Settings size={11} /> 更換
          </button>
        </div>

        {availableTypes.length === 0 ? (
          <p className="hint">尚未設定任何胰島素品牌，請先到「設定」選擇品牌。</p>
        ) : (
          <div className="inject-type-tabs">
            {availableTypes.map(t => {
              const { label, brand, activeClass, Icon } = TYPE_META[t];
              return (
                <button key={t} className={`inject-tab ${quickLog.brandType === t ? activeClass : ''}`}
                  onClick={() => setQ('brandType', t)}>
                  <Icon size={13} /> {label}（{brand}）
                </button>
              );
            })}
          </div>
        )}

        <div className="form-grid">
          <div className="form-group">
            <label>注射劑量 (U)</label>
            <input type="number" step="0.5" min="0" value={quickLog.units}
              onChange={e => setQ('units', e.target.value)} placeholder="單位 U" />
          </div>
          {(quickLog.brandType === 'rapid' || quickLog.brandType === 'short') && (
            <div className="form-group">
              <label>用餐類型</label>
              <select value={quickLog.mealType} onChange={e => setQ('mealType', e.target.value)}>
                <option value="breakfast">早餐</option>
                <option value="lunch">午餐</option>
                <option value="dinner">晚餐</option>
                <option value="lateSnack">宵夜</option>
                <option value="snack">點心</option>
                <option value="correction">校正劑量</option>
              </select>
            </div>
          )}
          {quickLog.brandType === 'long' && (
            <div className="form-group">
              <label>注射時機</label>
              <select value={quickLog.mealType} onChange={e => setQ('mealType', e.target.value)}>
                <option value="bedtime">睡前</option>
                <option value="morning">早晨</option>
                <option value="other">其他</option>
              </select>
            </div>
          )}
          <div className="form-group" style={{ gridColumn: 'span 2' }}>
            <label>注射時間</label>
            <input type="datetime-local" value={quickLog.timestamp}
              onChange={e => setQ('timestamp', e.target.value)} />
          </div>
        </div>
        <input value={quickLog.notes} onChange={e => setQ('notes', e.target.value)}
          placeholder="備註（選填）" style={{ marginBottom: 10 }} />
        <button className="btn-primary full-width" onClick={handleQuickLog}
          disabled={!quickLog.units || quickSaved}>
          {quickSaved ? <><CheckCircle size={14} /> 已記錄！</> : <><Syringe size={14} /> 記錄注射</>}
        </button>
      </div>

      {/* Recent logs */}
      <div className="card">
        <h3>最近注射紀錄</h3>
        {state.insulinLogs
          .map((l, i) => ({ ...l, _origIdx: i }))
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, 15)
          .map((l) => {
            const isShort = l.brandType === 'short' || INSULIN_BRANDS.short.find(b => b.name === l.brand);
            const isLong  = l.brandType === 'long' || INSULIN_BRANDS.long.find(b => b.name === l.brand);
            const isRapid = !isShort && !isLong;
            const typeLabel = isLong ? '長效' : isShort ? '短效' : '速效';
            const typeClass = isLong ? 'long-tag' : isShort ? 'short-tag' : 'rapid-tag';
            const dotColor  = isLong ? '#6366f1' : isShort ? '#0ea5e9' : '#f97316';
            const isEditing = editLogIdx === l._origIdx;
            return (
              <div key={l._origIdx}>
                <div className="log-row">
                  <div className="log-type-dot" style={{ background: dotColor }} />
                  <div className="log-col">
                    <div className="log-time">{format(new Date(l.timestamp), 'MM/dd HH:mm')}</div>
                    <div className="log-tag">{l.brand}</div>
                  </div>
                  <div className="log-value">{l.units} <span style={{ fontSize: 11 }}>U</span></div>
                  <div className="log-col-right">
                    <span className={`log-type-badge ${typeClass}`}>{typeLabel}</span>
                    <span className="log-meal">{l.mealType}</span>
                  </div>
                  <div className="row-actions">
                    <button className="btn-row-action" title="編輯" onClick={() => isEditing ? (setEditLogIdx(null), setEditLogForm(null)) : openEditLog(l._origIdx)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn-row-action btn-row-delete" title="刪除" onClick={() => setLogConfirm({ index: l._origIdx })}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {isEditing && editLogForm && (
                  <div className="inline-edit-form">
                    <div className="inject-type-tabs" style={{ marginBottom: 8 }}>
                      <button className={`inject-tab ${editLogForm.brandType === 'rapid' ? 'active-rapid' : ''}`} onClick={() => setEL('brandType', 'rapid')}>
                        <Zap size={12} /> 速效
                      </button>
                      <button className={`inject-tab ${editLogForm.brandType === 'short' ? 'active-short' : ''}`} onClick={() => setEL('brandType', 'short')}>
                        <Clock size={12} /> 短效
                      </button>
                      <button className={`inject-tab ${editLogForm.brandType === 'long' ? 'active-long' : ''}`} onClick={() => setEL('brandType', 'long')}>
                        <Moon size={12} /> 長效
                      </button>
                    </div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label>劑量 (U)</label>
                        <input type="number" step="0.5" min="0" value={editLogForm.units} onChange={e => setEL('units', e.target.value)} />
                      </div>
                      <div className="form-group">
                        <label>類型</label>
                        <select value={editLogForm.mealType} onChange={e => setEL('mealType', e.target.value)}>
                          <option value="breakfast">早餐</option>
                          <option value="lunch">午餐</option>
                          <option value="dinner">晚餐</option>
                          <option value="lateSnack">宵夜</option>
                          <option value="snack">點心</option>
                          <option value="correction">校正</option>
                          <option value="bedtime">睡前</option>
                          <option value="morning">早晨</option>
                        </select>
                      </div>
                      <div className="form-group" style={{ gridColumn: 'span 2' }}>
                        <label>時間</label>
                        <input type="datetime-local" value={editLogForm.timestamp} onChange={e => setEL('timestamp', e.target.value)} />
                      </div>
                    </div>
                    <input value={editLogForm.notes} onChange={e => setEL('notes', e.target.value)} placeholder="備註" style={{ marginBottom: 8 }} />
                    <div className="btn-row">
                      <button className="btn-primary" onClick={handleSaveEditLog}>儲存</button>
                      <button className="btn-secondary" onClick={() => { setEditLogIdx(null); setEditLogForm(null); }}>取消</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        {state.insulinLogs.length === 0 && <div className="empty-state">尚無注射紀錄</div>}
      </div>

      {/* Analysis report (seed data) */}
      {state.insulinLogs.some(l => l.source === 'seed') && (
        <div className="card dose-analysis-card">
          <div className="dose-analysis-header">
            <Info size={16} color="var(--accent2)" />
            <h3>劑量安全分析報告</h3>
          </div>
          <div className="analysis-section">
            <div className="analysis-section-title">📊 根據您的7天紀錄計算</div>
            <div className="analysis-metrics">
              <div className="analysis-metric">
                <div className="metric-val">{SEED_ANALYSIS.tdd} U</div>
                <div className="metric-label">TDD</div>
              </div>
              <div className="analysis-metric">
                <div className="metric-val">1:{SEED_ANALYSIS.icr}</div>
                <div className="metric-label">ICR</div>
              </div>
              <div className="analysis-metric">
                <div className="metric-val">{SEED_ANALYSIS.isf}</div>
                <div className="metric-label">ISF</div>
              </div>
            </div>
          </div>
          <div className="analysis-section">
            <div className="analysis-section-title">⚠️ 固定劑量 9U 的問題</div>
            <div className="dose-compare-table">
              <div className="dose-compare-header">
                <span>餐點</span><span>碳水</span><span>建議</span><span>實際</span><span>評估</span>
              </div>
              {SEED_ANALYSIS.meals.map((m, i) => (
                <div key={i} className={`dose-compare-row risk-${m.riskLevel}`}>
                  <span className="dcr-food">{m.foods}</span>
                  <span>{m.carbs}g</span>
                  <span className="dcr-rec">{m.recommended}U</span>
                  <span className="dcr-actual">{m.actual}U</span>
                  <span className={`risk-badge-${m.riskLevel}`}>{m.risk}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="analysis-section">
            <div className="analysis-section-title">⏱️ {SEED_ANALYSIS.timingNote}</div>
          </div>
          <div className="analysis-disclaimer">
            <AlertTriangle size={13} color="var(--yellow)" />
            以上為系統估算參考，任何劑量調整請先諮詢醫師或衛教師確認。
          </div>
        </div>
      )}

      {/* ── Rapid dosing analysis ── */}
      {rapidAnalysis.summary && (
        <div className="card rapid-analysis-card">
          <div className="rapid-header">
            <Activity size={16} color="var(--accent2)" />
            <h3>餐前胰島素注射行為分析（速效/短效）</h3>
            <span className="rapid-period">近14天 · {rapidAnalysis.summary.injectionCount} 次注射</span>
          </div>

          {/* Summary bar */}
          <div className="rapid-summary-bar">
            <div className="rsb-item rsb-good">
              <div className="rsb-val">{rapidAnalysis.summary.goodCount}</div>
              <div className="rsb-label">達標</div>
            </div>
            <div className="rsb-divider" />
            <div className="rsb-item rsb-high">
              <div className="rsb-val">{rapidAnalysis.summary.highCount}</div>
              <div className="rsb-label">注射後高血糖</div>
            </div>
            <div className="rsb-divider" />
            <div className="rsb-item rsb-low">
              <div className="rsb-val">{rapidAnalysis.summary.lowCount}</div>
              <div className="rsb-label">注射後低血糖</div>
            </div>
            {rapidAnalysis.summary.unknownCount > 0 && (
              <>
                <div className="rsb-divider" />
                <div className="rsb-item">
                  <div className="rsb-val" style={{ color: 'var(--text-muted)' }}>{rapidAnalysis.summary.unknownCount}</div>
                  <div className="rsb-label">資料不足</div>
                </div>
              </>
            )}
          </div>

          {/* Ratio bar */}
          <div className="ratio-bar">
            {rapidAnalysis.summary.goodRatio > 0 && (
              <div className="rb-seg rb-good" style={{ width: `${rapidAnalysis.summary.goodRatio}%` }} title={`達標 ${rapidAnalysis.summary.goodRatio}%`} />
            )}
            {rapidAnalysis.summary.highRatio > 0 && (
              <div className="rb-seg rb-high" style={{ width: `${rapidAnalysis.summary.highRatio}%` }} title={`高血糖 ${rapidAnalysis.summary.highRatio}%`} />
            )}
            {rapidAnalysis.summary.lowRatio > 0 && (
              <div className="rb-seg rb-low"  style={{ width: `${rapidAnalysis.summary.lowRatio}%`  }} title={`低血糖 ${rapidAnalysis.summary.lowRatio}%`} />
            )}
          </div>

          {/* Recommendations */}
          {rapidAnalysis.recommendations.length > 0 && (
            <div className="rapid-recs">
              {rapidAnalysis.recommendations.map((r, i) => (
                <div key={i} className={`rapid-rec rapid-rec-${r.type} rapid-rec-sev-${r.severity}`}>
                  <div className="rr-icon">
                    {r.type === 'low'  ? <AlertTriangle size={13} color="#ef4444" />
                      : r.type === 'high' ? <AlertTriangle size={13} color="#f59e0b" />
                      : r.type === 'rise' ? <span style={{ fontSize: 13 }}>📈</span>
                      : <Info size={13} color="var(--accent2)" />}
                  </div>
                  <div className="rr-body">
                    <div className="rr-msg">{r.msg}</div>
                    <div className="rr-action">💡 {r.action}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Every-injection timeline */}
          <div className="pair-list">
            <div className="pair-list-title">每次餐前胰島素注射紀錄</div>
            {rapidAnalysis.pairs.map((p, i) => {
              const OUTCOME_LABEL = { good: '達標', high: '偏高', low: '偏低', unknown: '資料不足' };
              const OUTCOME_COLOR = { good: 'var(--green)', high: '#f59e0b', low: '#ef4444', unknown: 'var(--text-muted)' };
              const icon = p.kind === 'correction' ? '💉'
                : p.kind === 'unmatched' ? '❓'
                : ({ breakfast:'🌅', lunch:'☀️', dinner:'🌙', lateSnack:'🌛', snack:'🍎' })[p.mealType] || '🍽️';
              const carbLabel = p.kind === 'correction' ? '校正劑量'
                : p.kind === 'unmatched' ? '無對應餐食'
                : `${p.carbs}g碳水`;
              const RISE_TAG = { highGI: '高GI', dose: '劑量不足', both: '高GI+劑量', unknown: '上升快' };
              return (
                <div key={i} className="pair-wrap">
                  <div className="pair-row">
                    <div className="pair-meal">
                      <span className="pair-type">{icon}</span>
                      <span className="pair-date">{format(new Date(p.timestamp), 'MM/dd HH:mm')}</span>
                    </div>
                    <div className="pair-data">
                      <span className="pair-carbs">{carbLabel}</span>
                      <span className="pair-dose">{p.doseGiven}U</span>
                      {p.preBG  != null && <span className="pair-bg">前{p.preBG}</span>}
                      {p.peakBG != null && <span className="pair-bg">峰{p.peakBG}</span>}
                      {p.outcome === 'low' && p.lowBG != null
                        ? <span className="pair-bg pair-bg-low">最低{p.lowBG}</span>
                        : p.lateBG != null && <span className="pair-bg">後{p.lateBG}</span>}
                      {p.steepRise && <span className="pair-bg pair-bg-rise">📈+{p.earlyRise} ({RISE_TAG[p.riseCause]})</span>}
                    </div>
                    <span className="pair-outcome" style={{ color: OUTCOME_COLOR[p.outcome] }}>
                      {OUTCOME_LABEL[p.outcome]}{p.alsoHigh ? '⚠' : ''}
                    </span>
                  </div>
                  {p.steepRise && p.riseEdu.length > 0 && (
                    <div className="pair-rise-note">
                      {p.riseEdu.map((e, j) => <div key={j} className="prn-line">{e}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="basal-disclaimer" style={{ marginTop: 8 }}>
            系統分析每一次餐前胰島素注射（速效/短效，含校正劑量）的餐後血糖反應，僅供參考，任何劑量調整請先諮詢醫師。
          </div>
        </div>
      )}

      {!rapidAnalysis.summary && state.insulinLogs.some(l => l.brandType === 'rapid' || l.brandType === 'short') && (
        <div className="card" style={{ textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
          <Activity size={16} style={{ margin:'0 auto 6px' }} />
          <div>尚無餐前胰島素注射可分析（近 14 天內）</div>
        </div>
      )}
    </div>
  );
}

function Activity({ size, color, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color || 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={style}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}
