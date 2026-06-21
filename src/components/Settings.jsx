import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { useAuth } from '../store/AuthContext';
import { supabase } from '../lib/supabase';
import { Settings as SettingsIcon, Link, Trash2, CheckCircle, FileText, MessageSquare, HelpCircle, GraduationCap, KeyRound, Lock } from 'lucide-react';
import { INSULIN_BRANDS } from '../utils/insulinCalculator';
import { openReport } from '../utils/reportGenerator';
import LibreSync from './LibreSync';

function zhPwError(msg = '') {
  if (/Password should be at least/i.test(msg)) return '密碼至少需 6 個字元';
  if (/New password should be different/i.test(msg)) return '新密碼不可與舊密碼相同';
  if (/session|expired|not.*authenticated/i.test(msg)) return '登入已過期，請重新登入後再修改';
  if (/rate limit|too many/i.test(msg)) return '嘗試太頻繁，請稍後再試';
  return msg || '發生錯誤，請重試';
}

// LINE Bot binding card
function LineBindCard() {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [bound, setBound] = useState(null); // null=loading, true/false
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const getToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token;
  };

  useEffect(() => {
    if (!user) return;
    getToken().then(token => {
      if (!token) return;
      fetch('/api/line/status', { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(d => setBound(d.bound))
        .catch(() => setBound(false));
    });
  }, [user]);

  const handleBind = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!code.trim()) return;
    setBusy(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/line/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBound(true);
      setMsg('✅ 綁定成功！現在可以用 LINE 記錄血糖、注射和飲食。');
      setCode('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUnbind = async () => {
    if (!confirm('確定要解除 LINE 綁定嗎？')) return;
    setBusy(true);
    try {
      const token = await getToken();
      await fetch('/api/line/unbind', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setBound(false);
      setMsg('已解除 LINE 綁定。');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div className="card">
      <h3><MessageSquare size={16} style={{ color: '#06c755' }} /> LINE Bot 綁定</h3>

      {bound ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', color: '#06c755' }}>
            <CheckCircle size={16} />
            <span style={{ fontWeight: 600 }}>已綁定 LINE 帳號</span>
          </div>
          <p className="hint" style={{ marginBottom: 12 }}>
            在 LINE 傳訊給 DiaGuide Bot 即可記錄資料：<br />
            💉 「速效 8U」「長效 20U」<br />
            🩸 「血糖 120」<br />
            🍽 「早餐 白飯一碗 雞蛋」<br />
            ❓ 傳「說明」查看所有指令
          </p>
          {msg && <div className="auth-notice">{msg}</div>}
          <button className="btn-danger" onClick={handleUnbind} disabled={busy}>
            解除 LINE 綁定
          </button>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 12 }}>
            綁定後可直接在 LINE 傳訊記錄胰島素注射、血糖與飲食，不需開啟 App。
          </p>
          <ol className="hint" style={{ paddingLeft: 18, marginBottom: 12, lineHeight: 2 }}>
            <li>加 DiaGuide Bot 為 LINE 好友</li>
            <li>在 LINE 傳送「<b>綁定</b>」取得 6 位數驗證碼</li>
            <li>在下方輸入驗證碼完成綁定</li>
          </ol>
          {msg && <div className="auth-notice">{msg}</div>}
          {err && <div className="auth-error">{err}</div>}
          <form onSubmit={handleBind} style={{ display: 'flex', gap: 8 }}>
            <input
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="輸入 6 位數驗證碼"
              maxLength={6}
              style={{ flex: 1, fontSize: 18, letterSpacing: 4, textAlign: 'center' }}
            />
            <button className="btn-primary" type="submit" disabled={busy || !code.trim()}>
              {busy ? '驗證中…' : '綁定'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

// In-app change-password card (uses the current session; no email round-trip)
function ChangePassword() {
  const { updatePassword } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (pw !== pw2) { setError('兩次輸入的密碼不一致'); return; }
    setBusy(true);
    try {
      await updatePassword(pw);
      setNotice('密碼已更新');
      setPw(''); setPw2('');
    } catch (err) {
      setError(zhPwError(err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3><KeyRound size={16} /> 修改密碼</h3>
      <p className="hint" style={{ marginBottom: 10 }}>更新登入密碼，立即生效。</p>
      <form onSubmit={submit} className="change-pw-form">
        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}
        <label className="auth-field">
          <Lock size={16} />
          <input type="password" placeholder="新密碼（至少 6 字元）" required minLength={6}
            value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="auth-field">
          <Lock size={16} />
          <input type="password" placeholder="再次輸入新密碼" required minLength={6}
            value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} />
        </label>
        <button className="btn-primary full-width" type="submit" disabled={busy} style={{ marginTop: 4 }}>
          <KeyRound size={15} /> 更新密碼
        </button>
      </form>
    </div>
  );
}

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

  // Append a「無」(none) option so users who don't use a given insulin type can say so.
  const NONE = { name: '無', company: '不使用此類' };
  const withNone = (arr) => [...arr, NONE];

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
          brands={withNone(INSULIN_BRANDS.rapid)}
          confirmed={s.rapidBrandConfirmed}
          selectedBrand={s.rapidBrandConfirmed ? s.rapidBrand : pendingRapid}
          onSelect={setPendingRapid}
          onConfirm={handleConfirmRapid}
          onChangeRequest={handleChangeRapid}
        />

        <BrandSelector
          label="🕒 短效（一般人胰島素 Regular，餐前 30 分鐘）"
          colorClass="short-label"
          brands={withNone(INSULIN_BRANDS.short)}
          confirmed={s.shortBrandConfirmed}
          selectedBrand={s.shortBrandConfirmed ? s.shortBrand : pendingShort}
          onSelect={setPendingShort}
          onConfirm={handleConfirmShort}
          onChangeRequest={handleChangeShort}
        />

        <BrandSelector
          label="🌙 長效 / 超長效（基礎注射）"
          colorClass="long-label"
          brands={withNone(INSULIN_BRANDS.long)}
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
        <h3><GraduationCap size={16} /> 新手教學</h3>
        <p className="hint" style={{ marginBottom: 10 }}>
          一步一步帶你完成基本資料、連接 LibreLink、記錄飲食與血糖，並介紹各區塊功能。
        </p>
        <button className="btn-primary full-width"
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { onboardingCompleted: false, onboardingStep: 0 } })}>
          <GraduationCap size={15} /> 開始 / 重看新手教學
        </button>
      </div>

      <div className="card">
        <h3><HelpCircle size={16} /> 常見問題 Q&A</h3>
        <div className="qa-list">
          {[
            { q: '血糖資料怎麼來？可以手動修改嗎？', a: '血糖只能透過 LibreLink 自動同步進來，系統不會也不允許手動竄改血糖數值。若資料有誤，請重新同步；同步來源（感測器）才是正確值。' },
            { q: '為什麼要連接 LibreLinkUp？和 LibreLink 一樣嗎？', a: '請使用「LibreLinkUp」(追蹤者) 帳號，非感測器本機的「LibreLink」App。連接後系統會自動抓取血糖，背景每約 6 小時也會同步累積，最長保留 90 天。' },
            { q: '劑量建議準確嗎？可以照著打嗎？', a: '建議值由 ICR／ISF、餐點碳水、餐前血糖與運動推算，僅供參考。系統也會依你的實際餐後反應提出參數修正建議。任何劑量調整務必先諮詢醫師或衛教師。' },
            { q: 'ICR / ISF 是什麼？', a: 'ICR（碳水比）= 每 1 U 餐前胰島素可覆蓋多少克碳水；ISF（敏感度）= 1 U 可使血糖下降多少 mg/dL。可在「劑量」頁查看與手動調整。' },
            { q: '手機推播收不到怎麼辦？', a: 'iPhone 需先用 Safari 將本 App「加入主畫面」，再從主畫面開啟並到「提醒」頁啟用；Android 用 Chrome 可直接啟用。高低血糖警報於背景同步時檢查（約每 6 小時），非即時連續監測。' },
            { q: '出生年月日要填嗎？', a: '填寫後系統會自動換算年齡，用於胰島素需求估算。年齡、體重等基本資料越完整，劑量建議越準確。' },
            { q: '資料安全嗎？換手機資料會在嗎？', a: '資料以你的帳號儲存在雲端（受 RLS 保護），換裝置登入同一帳號即可看到。建議定期用「設定 → 數據報告」匯出 PDF 備份。' },
          ].map((item, i) => (
            <details key={i} className="qa-item">
              <summary className="qa-q">{item.q}</summary>
              <p className="qa-a">{item.a}</p>
            </details>
          ))}
        </div>
      </div>

      <LineBindCard />
      <ChangePassword />

      <div className="card">
        <h3><MessageSquare size={16} /> 意見回饋</h3>
        <p className="hint" style={{ marginBottom: 10 }}>
          使用心得、功能建議，或遇到 bug，歡迎來信告知，協助我們改進。
        </p>
        <a
          className="btn-primary full-width"
          style={{ marginTop: 4, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          href="mailto:wuborjenn@gmail.com?subject=DiaGuide%20%E6%84%8F%E8%A6%8B%E5%9B%9E%E9%A5%8B&body=%E4%BD%BF%E7%94%A8%E5%BF%83%E5%BE%97%20%2F%20%E9%81%87%E5%88%B0%E7%9A%84%E5%95%8F%E9%A1%8C%EF%BC%9A%0A%0A"
        >
          <MessageSquare size={15} /> 寄送回饋
        </a>
        <p className="hint" style={{ marginTop: 6 }}>
          來信信箱：wuborjenn@gmail.com
        </p>
      </div>

      <div className="card">
        <h3>關於</h3>
        <p>DiaGuide — 糖尿病管理系統 v1.0</p>
        <p className="hint">本應用程式僅供輔助參考，所有醫療決策請諮詢您的醫師或衛教師。</p>
      </div>
    </div>
  );
}
