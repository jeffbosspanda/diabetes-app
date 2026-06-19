import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../store/AppContext';
import {
  User, Activity, Utensils, Syringe, Bell, Settings as Gear, X, ChevronRight, ChevronLeft, GraduationCap,
} from 'lucide-react';
import { isIOS, isStandalone } from '../lib/push';

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
      icon: <Bell size={26} />,
      title: '⑥ 開啟手機通知',
      body: 'NOTIFY',
      action: { label: '前往「提醒」頁啟用推播', path: '/reminders' },
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

  const ios = isIOS();
  const standalone = isStandalone();

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
        ) : cur.body === 'NOTIFY' ? (
          <div className="onboard-notify">
            <p className="onboard-body">
              開啟手機通知，App 關著也能收到高低血糖警報。請依你的手機系統操作：
            </p>

            <div className={`notify-os ${ios ? 'notify-os-active' : ''}`}>
              <div className="notify-os-head">🍎 iPhone / iPad（iOS 16.4 以上）</div>
              <ol className="notify-steps">
                <li>用 <b>Safari</b> 開啟本網站</li>
                <li>點底部「分享」鈕 → <b>加入主畫面</b></li>
                <li>從主畫面的 App 圖示重新開啟（必須從主畫面開，Safari 分頁不行）</li>
                <li>到「提醒」頁點 <b>啟用推播</b> → 允許通知</li>
              </ol>
              {ios && !standalone && (
                <div className="notify-warn">
                  ⚠️ 偵測到你正用 Safari 分頁開啟，尚未加入主畫面。請先完成步驟 1–3 再啟用。
                </div>
              )}
              {ios && standalone && (
                <div className="notify-ok">✓ 已從主畫面開啟，可直接到「提醒」頁啟用推播。</div>
              )}
            </div>

            <div className={`notify-os ${!ios ? 'notify-os-active' : ''}`}>
              <div className="notify-os-head">🤖 Android</div>
              <ol className="notify-steps">
                <li>用 <b>Chrome</b> 開啟本網站（可選：選單 → 加入主畫面，更穩定）</li>
                <li>到「提醒」頁點 <b>啟用推播</b></li>
                <li>跳出系統視窗時選 <b>允許</b> 通知</li>
              </ol>
            </div>

            <p className="onboard-hint">
              註：警報於背景同步時檢查（約每 6 小時），非即時連續監測。
            </p>
          </div>
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
