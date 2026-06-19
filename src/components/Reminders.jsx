import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { Bell, Clock, Dumbbell, Syringe, Check } from 'lucide-react';

export default function Reminders() {
  const { state, dispatch } = useApp();
  const [permGranted, setPermGranted] = useState(false);

  const rem = state.reminders;
  const set = (path, value) => {
    const [section, key] = path.split('.');
    if (section === 'mealTimes') {
      dispatch({ type: 'UPDATE_REMINDERS', payload: { mealTimes: { ...rem.mealTimes, [key]: value } } });
    } else if (section === 'enabled') {
      dispatch({ type: 'UPDATE_REMINDERS', payload: { enabled: { ...rem.enabled, [key]: value } } });
    }
  };

  useEffect(() => {
    if ('Notification' in window) {
      Notification.requestPermission().then(p => setPermGranted(p === 'granted'));
    }
  }, []);

  const sendTestNotification = () => {
    if (!permGranted) {
      Notification.requestPermission().then(p => {
        if (p === 'granted') { setPermGranted(true); new Notification('DiaGuide', { body: '通知功能已啟用！' }); }
      });
    } else {
      new Notification('DiaGuide', { body: '測試通知成功！' });
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
          <h3>推播通知</h3>
          <span className={`badge ${permGranted ? 'badge-green' : 'badge-red'}`}>
            {permGranted ? '已啟用' : '未啟用'}
          </span>
        </div>
        <button className="btn-secondary" onClick={sendTestNotification}>
          {permGranted ? '發送測試通知' : '啟用通知'}
        </button>
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
