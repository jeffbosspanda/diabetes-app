import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { Bell, Clock, Dumbbell, Syringe, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  pushSupported, pushSubscribed, enablePush, disablePush, isIOS, isStandalone,
} from '../lib/push';

export default function Reminders() {
  const { state, dispatch } = useApp();
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  const rem = state.reminders;
  const set = (path, value) => {
    const [section, key] = path.split('.');
    if (section === 'mealTimes') {
      dispatch({ type: 'UPDATE_REMINDERS', payload: { mealTimes: { ...rem.mealTimes, [key]: value } } });
    } else if (section === 'enabled') {
      dispatch({ type: 'UPDATE_REMINDERS', payload: { enabled: { ...rem.enabled, [key]: value } } });
    }
  };

  const supported = pushSupported();
  const needsInstall = isIOS() && !isStandalone();

  useEffect(() => {
    pushSubscribed().then(setPushOn).catch(() => {});
  }, []);

  const handleEnable = async () => {
    setPushBusy(true); setPushMsg('');
    try {
      await enablePush();
      setPushOn(true);
      setPushMsg('已啟用！高低血糖時手機會收到通知。');
    } catch (e) {
      setPushMsg(e.message);
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisable = async () => {
    setPushBusy(true); setPushMsg('');
    try {
      await disablePush();
      setPushOn(false);
      setPushMsg('已關閉手機推播。');
    } catch (e) {
      setPushMsg(e.message);
    } finally {
      setPushBusy(false);
    }
  };

  const handleTest = async () => {
    setPushBusy(true); setPushMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/push/test', {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || '測試失敗');
      setPushMsg(`已送出測試推播（${j.sent} 台裝置）。`);
    } catch (e) {
      setPushMsg(e.message);
    } finally {
      setPushBusy(false);
    }
  };

  const MEAL_LABELS = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜' };

  return (
    <div className="page">
      <div className="page-header">
        <Bell size={22} /> <h2>提醒設定</h2>
      </div>

      <div className="card">
        <div className="card-header-row">
          <h3>手機推播（高低血糖警報）</h3>
          <span className={`badge ${pushOn ? 'badge-green' : 'badge-red'}`}>
            {pushOn ? '已啟用' : '未啟用'}
          </span>
        </div>
        <p className="hint" style={{ marginBottom: 10 }}>
          啟用後，後端同步偵測到血糖低於 70 或高於 180 mg/dL 時，即使 App 沒開，手機也會收到系統通知。
        </p>

        {!supported ? (
          <p className="hint" style={{ color: 'var(--red)' }}>此瀏覽器不支援推播通知。</p>
        ) : needsInstall ? (
          <p className="hint" style={{ color: 'var(--orange, #e67e22)' }}>
            iPhone 請先用 Safari 開啟本頁 → 分享 → <b>加入主畫面</b>，再從主畫面圖示開啟 App 才能啟用推播（iOS 限制）。
          </p>
        ) : !pushOn ? (
          <button className="btn-primary" onClick={handleEnable} disabled={pushBusy}>
            {pushBusy ? '啟用中…' : '啟用手機推播'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={handleTest} disabled={pushBusy}>發送測試推播</button>
            <button className="btn-danger" onClick={handleDisable} disabled={pushBusy}>關閉推播</button>
          </div>
        )}

        {pushMsg && <p className="hint" style={{ marginTop: 8 }}>{pushMsg}</p>}
        <p className="hint" style={{ marginTop: 8, opacity: 0.7 }}>
          註：警報於後端排程同步時檢查（約每 6 小時），非即時連續監測。
        </p>
      </div>

      <div className="card">
        <h3><Clock size={16} /> 用餐時間設定</h3>
        {Object.entries(MEAL_LABELS).map(([key, label]) => (
          <div key={key} className="reminder-row">
            <span className="reminder-label">{label}</span>
            <input type="time" value={rem.mealTimes[key] || ''} onChange={e => set(`mealTimes.${key}`, e.target.value)} className="time-input" />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>提醒項目</h3>
        {[
          { key: 'meal',     icon: <span>🍽️</span>,      label: '用餐提醒',   desc: '到達設定時間時提醒記錄飲食' },
          { key: 'insulin',  icon: <Syringe size={14} />, label: '胰島素提醒', desc: '用餐時提醒是否已注射' },
          { key: 'exercise', icon: <Dumbbell size={14} />, label: '運動提醒',   desc: '提醒記錄今日運動量' },
        ].map(({ key, icon, label, desc }) => (
          <div key={key} className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">{icon} {label}</div>
              <div className="toggle-desc">{desc}</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={rem.enabled[key] || false} onChange={e => set(`enabled.${key}`, e.target.checked)} />
              <span className="toggle-slider" />
            </label>
          </div>
        ))}
      </div>

      <div className="card">
        <h3><Dumbbell size={16} /> 快速記錄運動</h3>
        <QuickExercise dispatch={dispatch} />
      </div>
    </div>
  );
}

function QuickExercise({ dispatch }) {
  const [form, setForm] = useState({ type: 'walking', duration: '', intensity: 'moderate', notes: '' });
  const [saved, setSaved] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    dispatch({ type: 'ADD_EXERCISE', payload: { ...form, timestamp: new Date().toISOString(), duration: parseInt(form.duration) || 0 } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setForm({ type: 'walking', duration: '', intensity: 'moderate', notes: '' });
  };

  return (
    <div>
      <div className="form-grid">
        <div className="form-group">
          <label>運動類型</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            <option value="walking">步行</option>
            <option value="running">慢跑</option>
            <option value="cycling">騎車</option>
            <option value="swimming">游泳</option>
            <option value="gym">重訓</option>
            <option value="yoga">瑜伽</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div className="form-group">
          <label>時長 (分鐘)</label>
          <input type="number" value={form.duration} onChange={e => set('duration', e.target.value)} placeholder="分鐘" />
        </div>
        <div className="form-group">
          <label>強度</label>
          <select value={form.intensity} onChange={e => set('intensity', e.target.value)}>
            <option value="light">輕度</option>
            <option value="moderate">中度</option>
            <option value="vigorous">高強度</option>
          </select>
        </div>
      </div>
      <button className="btn-primary" onClick={save}>{saved ? <><Check size={14} /> 已記錄</> : '記錄運動'}</button>
    </div>
  );
}
