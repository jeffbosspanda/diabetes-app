import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  User, Activity, Utensils, Syringe, Bell, Settings as Gear, X, ChevronRight, ChevronLeft, GraduationCap,
} from 'lucide-react';

// Guided first-login tour. Walks the user step-by-step and — crucially — does NOT
// end when they jump to a page: it minimizes to a floating「繼續教學」pill so they
// can actually perform the action, then resume the next step. Progress is
// persisted in settings (onboardingStep / onboardingCompleted) so a reload or
// navigation never interrupts the tour. Re-startable from 設定.
export default function Onboarding() {
  const { state, dispatch, loaded } = useApp();
  const nav = useNavigate();
  const [minimized, setMinimized] = useState(false);

  const s = state.settings || {};
  const completed = s.onboardingCompleted === true;
  const isNewUser =
    !completed &&
    !state.profile &&
    state.glucoseReadings.length === 0 &&
    state.meals.length === 0 &&
    state.insulinLogs.length === 0;
  const requested = s.onboardingCompleted === false; // explicit restart from 設定
  const active = !completed && (isNewUser || requested);

  const step = s.onboardingStep ?? 0;
  const setStep = (n) => dispatch({ type: 'UPDATE_SETTINGS', payload: { onboardingStep: n } });
  const complete = () => dispatch({ type: 'UPDATE_SETTINGS', payload: { onboardingCompleted: true, onboardingStep: 0 } });

  const steps = [
    {
      icon: '👋',
      title: '歡迎使用 DiaGuide',
      body: '這是你的糖尿病管理助手：自動同步血糖、記錄飲食與胰島素、提供劑量參考與高低血糖手機推播。接下來一步一步帶你完成設定，過程中可隨時「繼續教學」。',
      action: null,
    },
    {
      icon: <User size={26} />,
      title: '① 填寫基本資料',
      body: '輸入出生年月日、體重、身高、糖尿病類型等，系統才能算出個人化的 ICR／ISF 與劑量建議。點下方按鈕前往填寫，填完回來按「繼續教學」進入下一步。',
      action: { label: '前往填寫基本資料', path: '/profile' },
    },
    {
      icon: <Activity size={26} />,
      title: '② 連接 LibreLink',
      body: '在「設定」輸入 LibreLinkUp 帳密，血糖會自動同步進來（背景每 6 小時也會同步累積）。血糖資料只能由 LibreLink 進入，不會手動竄改。連接後回來按「繼續教學」。',
      action: { label: '前往連接 LibreLink', path: '/settings' },
    },
    {
      icon: <Utensils size={26} />,
      title: '③ 記錄飲食',
      body: '在「飲食」描述餐點即可分析碳水與營養。記錄越完整，劑量與分析越準。試著記一餐，再回來「繼續教學」。',
      action: { label: '前往記錄飲食', path: '/meals' },
    },
    {
      icon: <Activity size={26} />,
      title: '④ 查看血糖',
      body: '「血糖」頁可檢視趨勢圖、達標率與高低血糖原因分析。看看你的血糖曲線，再回來「繼續教學」。',
      action: { label: '前往血糖頁', path: '/glucose' },
    },
    {
      icon: <Syringe size={26} />,
      title: '⑤ 劑量建議',
      body: '「劑量」頁依本餐碳水、餐前血糖、運動算出參考劑量與注射時機，並會依你的實際反應提出參數修正建議。任何劑量調整務必諮詢醫師。',
      action: { label: '前往劑量頁', path: '/insulin' },
    },
    {
      icon: '🧭',
      title: '完成！各區塊總覽',
      body: 'AREAS',
      action: null,
    },
  ];

  if (!loaded || !active) return null;

  const cur = steps[Math.min(step, steps.length - 1)];
  const isLast = step >= steps.length - 1;

  // Minimized: a floating pill so the user can operate the page, then resume.
  if (minimized) {
    return (
      <button className="onboard-pill" onClick={() => setMinimized(false)}>
        <GraduationCap size={15} /> 繼續教學（{step + 1}/{steps.length}）
      </button>
    );
  }

  // Navigate for an action step, then minimize so the page is usable (tour stays alive).
  const goAndMinimize = (path) => { nav(path); setMinimized(true); };

  const AREAS = [
    { icon: <Activity size={16} />, name: '血糖', desc: '趨勢圖、達標率、高低血糖分析' },
    { icon: <Utensils size={16} />, name: '飲食', desc: '餐點營養分析與記錄' },
    { icon: <Syringe size={16} />, name: '劑量', desc: '劑量建議與注射紀錄' },
    { icon: <Bell size={16} />, name: '提醒', desc: '用餐提醒、手機推播警報' },
    { icon: <Gear size={16} />, name: '設定', desc: '品牌、LibreLink、報告、Q&A、重看教學' },
  ];

  return (
    <div className="onboard-overlay">
      <div className="onboard-card">
        <button className="onboard-skip" onClick={complete}>
          跳過教學，直接使用 <X size={13} />
        </button>

        <div className="onboard-icon">{cur.icon}</div>
        <h2 className="onboard-title">{cur.title}</h2>

        {cur.body === 'AREAS' ? (
          <ul className="onboard-areas">
            {AREAS.map(a => (
              <li key={a.name} className="onboard-area">
                <span className="oa-icon">{a.icon}</span>
                <span className="oa-name">{a.name}</span>
                <span className="oa-desc">{a.desc}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="onboard-body">{cur.body}</p>
        )}

        {cur.action && (
          <button className="btn-primary full-width onboard-action" onClick={() => goAndMinimize(cur.action.path)}>
            {cur.action.label} <ChevronRight size={15} />
          </button>
        )}

        <div className="onboard-dots">
          {steps.map((_, i) => (
            <span key={i} className={`onboard-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        <div className="onboard-nav">
          <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={step === 0}>
            <ChevronLeft size={15} /> 上一步
          </button>
          {isLast ? (
            <button className="btn-primary" onClick={complete}>開始使用 →</button>
          ) : (
            <button className="btn-primary" onClick={() => setStep(step + 1)}>
              下一步 <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
