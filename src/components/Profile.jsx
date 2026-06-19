import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { User, Save, AlertCircle } from 'lucide-react';

export default function Profile() {
  const { state, dispatch } = useApp();
  const [form, setForm] = useState(state.profile || {
    name: '', age: '', gender: '', weight: '', height: '',
    bodyFat: '', muscleMass: '', diabetesType: 'type1',
    diagnosedYear: '', tdd: '', notes: '',
  });
  const [saved, setSaved] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    dispatch({ type: 'SET_PROFILE', payload: { ...form, updatedAt: new Date().toISOString() } });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const bmi = form.weight && form.height
    ? (form.weight / ((form.height / 100) ** 2)).toFixed(1) : null;

  return (
    <div className="page">
      <div className="page-header">
        <User size={22} /> <h2>病患基本資料</h2>
      </div>

      {!state.profile && (
        <div className="alert alert-warning">
          <AlertCircle size={16} />
          <span>請先填寫基本資料，系統才能提供個人化的胰島素劑量建議。</span>
        </div>
      )}

      <div className="card">
        <h3>個人資訊</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>姓名</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="輸入姓名" />
          </div>
          <div className="form-group">
            <label>年齡</label>
            <input type="number" value={form.age} onChange={e => set('age', e.target.value)} placeholder="歲" />
          </div>
          <div className="form-group">
            <label>性別</label>
            <select value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">請選擇</option>
              <option value="male">男</option>
              <option value="female">女</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div className="form-group">
            <label>糖尿病類型</label>
            <select value={form.diabetesType} onChange={e => set('diabetesType', e.target.value)}>
              <option value="type1">第一型</option>
              <option value="type2">第二型</option>
              <option value="gestational">妊娠型</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div className="form-group">
            <label>確診年份</label>
            <input type="number" value={form.diagnosedYear} onChange={e => set('diagnosedYear', e.target.value)} placeholder="例: 2018" />
          </div>
        </div>
      </div>

      <div className="card">
        <h3>身體數據</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>體重 (kg)</label>
            <input type="number" step="0.1" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="kg" />
          </div>
          <div className="form-group">
            <label>身高 (cm)</label>
            <input type="number" value={form.height} onChange={e => set('height', e.target.value)} placeholder="cm" />
          </div>
          <div className="form-group">
            <label>體脂率 (%)</label>
            <input type="number" step="0.1" value={form.bodyFat} onChange={e => set('bodyFat', e.target.value)} placeholder="%" />
          </div>
          <div className="form-group">
            <label>肌肉量 (kg)</label>
            <input type="number" step="0.1" value={form.muscleMass} onChange={e => set('muscleMass', e.target.value)} placeholder="kg" />
          </div>
        </div>
        {bmi && (
          <div className="bmi-display">
            BMI: <strong>{bmi}</strong>
            <span className="bmi-label">{
              bmi < 18.5 ? ' 體重不足' : bmi < 24 ? ' 正常' : bmi < 27 ? ' 過重' : ' 肥胖'
            }</span>
          </div>
        )}
      </div>

      <div className="card">
        <h3>初始胰島素設定</h3>
        <div className="form-grid">
          <div className="form-group">
            <label>每日總劑量 TDD (U) — 選填</label>
            <input type="number" step="0.5" value={form.tdd} onChange={e => set('tdd', e.target.value)} placeholder="若已知可填入，系統將自動計算" />
          </div>
        </div>
        <p className="hint">若不確定 TDD，系統將在累積足夠的注射紀錄後自動計算。</p>
      </div>

      <div className="card">
        <h3>備註</h3>
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
          placeholder="其他病史、過敏、特殊狀況…" rows={3} />
      </div>

      <button className="btn-primary full-width" onClick={handleSave}>
        <Save size={16} /> {saved ? '已儲存！' : '儲存資料'}
      </button>
    </div>
  );
}
