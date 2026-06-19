import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { Settings as SettingsIcon, Link, Trash2, CheckCircle, FileText } from 'lucide-react';
import { INSULIN_BRANDS } from '../utils/insulinCalculator';
import { openReport } from '../utils/reportGenerator';
import LibreSync from './LibreSync';

function BrandSelector({ label, colorClass, brands, confirmed, selectedBrand, onSelect, onConfirm, onChangeRequest }) {
  return (
    <div className="brand-section" style={{ marginBottom: 14 }}>
      <div className={`brand-section-label ${colorClass}`}>{label}</div>

      {confirmed ? (
        <div className="brand-confirmed-row">
          <div className="brand-confirmed-display">
            <CheckCircle size={14} color="var(--green)" />
            <span className="brand-confirmed-name">{selectedBrand}</span>
            <span className="brand-confirmed-sub">已設定</span>
          </div>
          <button className="btn-brand-change" onClick={onChangeRequest}>更改</button>
        </div>
      ) : (
        <>
          <div className="brand-pills">
            {brands.map(b => (
              <button key={b.name}
                className={`brand-pill ${selectedBrand === b.name ? `active ${colorClass === 'rapid-label' ? 'rapid-active' : colorClass === 'short-label' ? 'short-active' : 'long-active'}` : ''}`}
                onClick={() => onSelect(b.name)}>
                <div className="pill-name">{b.name}</div>
                <div className="pill-sub">{b.company}</div>
              </button>
            ))}
          </div>
          <button className="btn-confirm-brand" onClick={onConfirm}>
            確認使用 {selectedBrand}
          </button>
        </>
      )}
    </div>
  );
}

export default function Settings() {
  const { state, dispatch } = useApp();
  const s = state.settings;
  const set = (k, v) => dispatch({ type: 'UPDATE_SETTINGS', payload: { [k]: v } });

  // Pending selections (before confirm)
  const [pendingRapid, setPendingRapid] = useState(s.rapidBrand || 'NovoRapid');
  const [pendingShort, setPendingShort] = useState(s.shortBrand || 'Humulin R');
  const [pendingLong, setPendingLong]   = useState(s.longBrand  || 'Tresiba');

  const handleConfirmRapid = () => {
    set('rapidBrand', pendingRapid);
    set('insulinBrand', pendingRapid);
    set('rapidBrandConfirmed', true);
  };

  const handleConfirmShort = () => {
    set('shortBrand', pendingShort);
    set('shortBrandConfirmed', true);
  };

  const handleConfirmLong = () => {
    set('longBrand', pendingLong);
    set('longBrandConfirmed', true);
  };

  const handleChangeRapid = () => {
    if (!window.confirm(`確定要更改速效胰島素品牌？目前設定為 ${s.rapidBrand}`)) return;
    set('rapidBrandConfirmed', false);
    setPendingRapid(s.rapidBrand);
  };

  const handleChangeShort = () => {
    if (!window.confirm(`確定要更改短效胰島素品牌？目前設定為 ${s.shortBrand}`)) return;
    set('shortBrandConfirmed', false);
    setPendingShort(s.shortBrand);
  };

  const handleChangeLong = () => {
    if (!window.confirm(`確定要更改長效胰島素品牌？目前設定為 ${s.longBrand}`)) return;
    set('longBrandConfirmed', false);
    setPendingLong(s.longBrand);
  };

  const [reportDays, setReportDays] = useState(14);

  const clearData = (type) => {
    if (!window.confirm(`確定要永久清除所有${type}紀錄？此操作無法復原。`)) return;
    if (type === '血糖') dispatch({ type: 'LOAD_STATE', payload: { glucoseReadings: [] } });
    if (type === '飲食') dispatch({ type: 'LOAD_STATE', payload: { meals: [] } });
    if (type === '胰島素') dispatch({ type: 'LOAD_STATE', payload: { insulinLogs: [] } });
    if (type === '飲水') dispatch({ type: 'LOAD_STATE', payload: { waterLogs: [] } });
    if (type === '全部') dispatch({ type: 'LOAD_STATE', payload: { glucoseReadings: [], meals: [], insulinLogs: [], waterLogs: [], exerciseLogs: [] } });
  };

  const toggleIntegration = (key) => {
    set('integrations', { ...s.integrations, [key]: !s.integrations[key] });
  };

  return (
    <div className="page">
      <div className="page-header">
        <SettingsIcon size={22} /> <h2>設定</h2>
      </div>

      <div className="card">
        <h3>預設胰島素品牌</h3>
        <p className="hint" style={{ marginBottom: 12 }}>設定後用於劑量建議頁面，更改需二次確認。</p>

        <BrandSelector
          label="⚡ 速效 / 超速效（analog，餐前 0–15 分鐘）"
          colorClass="rapid-label"
          brands={INSULIN_BRANDS.rapid}
          confirmed={s.rapidBrandConfirmed}
          selectedBrand={s.rapidBrandConfirmed ? s.rapidBrand : pendingRapid}
          onSelect={setPendingRapid}
          onConfirm={handleConfirmRapid}
          onChangeRequest={handleChangeRapid}
        />

        <BrandSelector
          label="🕒 短效（一般人胰島素 Regular，餐前 30 分鐘）"
          colorClass="short-label"
          brands={INSULIN_BRANDS.short}
          confirmed={s.shortBrandConfirmed}
          selectedBrand={s.shortBrandConfirmed ? s.shortBrand : pendingShort}
          onSelect={setPendingShort}
          onConfirm={handleConfirmShort}
          onChangeRequest={handleChangeShort}
        />

        <BrandSelector
          label="🌙 長效 / 超長效（基礎注射）"
          colorClass="long-label"
          brands={INSULIN_BRANDS.long}
          confirmed={s.longBrandConfirmed}
          selectedBrand={s.longBrandConfirmed ? s.longBrand : pendingLong}
          onSelect={setPendingLong}
          onConfirm={handleConfirmLong}
          onChangeRequest={handleChangeLong}
        />
      </div>

      <div className="card">
        <h3><FileText size={16} /> 數據報告（PDF）</h3>
        <p className="hint" style={{ marginBottom: 10 }}>
          一鍵產生完整統計報告，含血糖控制、飯前/飯後/深夜血糖、低/高血糖分布、胰島素參數與事件分析，方便提供醫師或衛教師。
        </p>
        <div className="report-period">
          <span>報告期間</span>
          <div className="report-period-tabs">
            {[7, 14, 30, 90].map(d => (
              <button key={d} className={`range-tab ${reportDays === d ? 'active' : ''}`} onClick={() => setReportDays(d)}>
                {d} 天
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary full-width" style={{ marginTop: 10 }} onClick={() => openReport(state, { days: reportDays })}>
          <FileText size={15} /> 產生 PDF 報告（近 {reportDays} 天）
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          將開啟列印視窗，選擇「另存為 PDF」即可儲存或列印。
        </p>
      </div>

      <LibreSync />

      <div className="card">
        <h3><Link size={16} /> 其他裝置整合</h3>
        <p className="hint">連接外部裝置以自動匯入資料</p>

        {[
          { key: 'freestyleLibre', label: 'FreeStyle Libre CGM', desc: '持續血糖監測，自動同步血糖數值', icon: '📡' },
          { key: 'strava', label: 'Strava', desc: '自動匯入跑步、騎車等運動紀錄', icon: '🏃' },
          { key: 'appleHealth', label: 'Apple 健康', desc: '同步步數、心率、睡眠等健康資料', icon: '🍎' },
        ].map(({ key, label, desc, icon }) => (
          <div key={key} className="toggle-row">
            <div className="toggle-info">
              <div className="toggle-label">{icon} {label}</div>
              <div className="toggle-desc">{desc}</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={s.integrations[key] || false} onChange={() => toggleIntegration(key)} />
              <span className="toggle-slider" />
            </label>
          </div>
        ))}

        <div className="integration-note">
          注意：FreeStyle Libre 需使用 LibreLink SDK 或 NFC 讀取；Strava 需 OAuth 授權；Apple 健康僅支援 iOS 裝置。
        </div>
      </div>

      <div className="card">
        <h3>資料管理</h3>
        <div className="danger-zone">
          {['血糖', '飲食', '胰島素', '飲水'].map(t => (
            <button key={t} className="btn-danger" onClick={() => clearData(t)}>
              <Trash2 size={14} /> 清除{t}
            </button>
          ))}
          <button className="btn-danger btn-danger-all" onClick={() => clearData('全部')}>
            <Trash2 size={14} /> 清除全部資料
          </button>
        </div>
      </div>

      <div className="card">
        <h3>關於</h3>
        <p>DiaGuide — 糖尿病管理系統 v1.0</p>
        <p className="hint">本應用程式僅供輔助參考，所有醫療決策請諮詢您的醫師或衛教師。</p>
      </div>
    </div>
  );
}
