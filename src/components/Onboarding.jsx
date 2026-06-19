import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  User, Activity, Utensils, Syringe, Bell, Settings as Gear, X, ChevronRight, ChevronLeft,
} from 'lucide-react';

// First-login guided tour. Shows once for a brand-new account (no profile and no
// data yet). Every step offers「跳過教學，直接使用」; action steps can jump straight
// to the relevant page. Completion is persisted via settings.onboardingCompleted.
export default function Onboarding() {
  const { state, dispatch, loaded } = useApp();
  const nav = useNavigate();
  const [step, setStep] = useState(0);

  const s = state.settings || {};
  const isNewUser =
    !s.onboardingCompleted &&
    !state.profile &&
    state.glucoseReadings.length === 0 &&
    state.meals.length === 0 &&
    state.insulinLogs.length === 0;

  if (!loaded || !isNewUser) return null;

  const complete = () => dispatch({ type: 'UPDATE_SETTINGS', payload: { onboardingCompleted: true } });
  const goAndFinish = (path) => { complete(); nav(path); };

  const steps = [
    {
      icon: '👋',
      title: '歡迎使用 DiaGuide',
      body: '這是你的糖尿病管理助手：自動同步血糖、記錄飲食與胰島素、提供劑量參考與高低血糖手機推播。花一分鐘帶你快速上手。',
      action: null,
    },
    {
      icon: <User size={26} />,
      title: '① 填寫基本資料',
      body: '輸入出生年月日、體重、身高、糖尿病類型等，系統才能算出個人化的 ICR／ISF 與劑量建議。',
      action: { label: '前往填寫基本資料', path: '/profile' },
    },
    {
      icon: <Activity size={26} />,
      title: '② 連接 LibreLink',
      body: '在「設定」輸入 LibreLinkUp 帳密，血糖會自動同步進來（背景每 6 小時也會同步累積）。血糖資料只能由 LibreLink 進入，不會手動竄改。',
      action: { label: '前往連接 LibreLink', path: '/settings' },
    },
    {
      icon: <Utensils size={26} />,
      title: '③ 記錄血糖與飲食',
      body: '在「飲食」描述餐點即可分析碳水與營養；血糖頁可檢視趨勢與高低血糖原因分析。記錄越完整，建議越準。',
      action: { label: '前往記錄飲食', path: '/meals' },
    },
    {
      icon: <Syringe size={26} />,
      title: '④ 劑量建議',
      body: '「劑量」頁依本餐碳水、餐前血糖、運動算出參考劑量與注射時機，並會依你的實際反應提出參數回歸修正建議。',
      action: { label: '前往劑量頁', path: '/insulin' },
    },
    {
      icon: '🧭',
      title: '各區塊功能總覽',
      body: 'AREAS',
      action: null,
    },
  ];

  const AREAS = [
    { icon: <Activity size={16} />, name: '血糖', desc: '趨勢圖、達標率、高低血糖分析' },
    { icon: <Utensils size={16} />, name: '飲食', desc: '餐點營養分析與記錄' },
    { icon: <Syringe size={16} />, name: '劑量', desc: '劑量建議與注射紀錄' },
    { icon: <Bell size={16} />, name: '提醒', desc: '用餐提醒、手機推播警報' },
    { icon: <Gear size={16} />, name: '設定', desc: '品牌、LibreLink、報告、Q&A' },
  ];

  const cur = steps[step];
  const isLast = step === steps.length - 1;

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
          <button className="btn-primary full-width onboard-action" onClick={() => goAndFinish(cur.action.path)}>
            {cur.action.label} <ChevronRight size={15} />
          </button>
        )}

        <div className="onboard-dots">
          {steps.map((_, i) => (
            <span key={i} className={`onboard-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        <div className="onboard-nav">
          <button className="btn-secondary" onClick={() => setStep(s => s - 1)} disabled={step === 0}>
            <ChevronLeft size={15} /> 上一步
          </button>
          {isLast ? (
            <button className="btn-primary" onClick={complete}>開始使用 →</button>
          ) : (
            <button className="btn-primary" onClick={() => setStep(s => s + 1)}>
              下一步 <ChevronRight size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
