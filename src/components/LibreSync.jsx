import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../store/AppContext';
import { syncLibreData, checkProxyHealth, TREND_LABELS } from '../utils/libreLinkUp';
import { Activity, RefreshCw, AlertTriangle, CheckCircle, Server, Unlink } from 'lucide-react';

const AUTO_SYNC_MS = 15 * 60 * 1000; // 15 minutes = LibreLink sensor update frequency

export default function LibreSync() {
  const { state, dispatch } = useApp();

  const savedCreds = state.settings.libreCredentials || null;

  const [form, setForm]               = useState({ username: savedCreds?.username || '', password: savedCreds?.password || '' });
  const [status, setStatus]           = useState('idle');
  const [message, setMessage]         = useState('');
  const [proxyOk, setProxyOk]         = useState(null);
  const [lastSync, setLastSync]       = useState(null);
  const [latestReading, setLatestReading] = useState(null);
  const [autoSyncActive, setAutoSyncActive] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Check proxy on mount
  useEffect(() => {
    checkProxyHealth().then(ok => setProxyOk(ok));
  }, []);

  // ── Core sync logic ── kept in a ref so the setInterval callback is never stale
  const stateRef = useRef(state);
  stateRef.current = state;

  const doSync = useCallback(async (username, password) => {
    if (!username || !password) return;
    setStatus('syncing');
    try {
      const { readings, count } = await syncLibreData(username, password);
      const existing = new Set(stateRef.current.glucoseReadings.map(r => r.timestamp));
      const newReadings = readings.filter(r => !existing.has(r.timestamp));
      newReadings.forEach(r => dispatch({ type: 'ADD_GLUCOSE', payload: r }));
      dispatch({ type: 'UPDATE_SETTINGS', payload: {
        integrations: { ...stateRef.current.settings.integrations, freestyleLibre: true },
      }});
      setLatestReading(readings[0] || null);
      setLastSync(new Date());
      setStatus('success');
      setMessage(`已同步 ${count} 筆，新增 ${newReadings.length} 筆`);
    } catch (err) {
      setStatus('error');
      setMessage(err.message);
    }
  }, [dispatch]);

  // ── Auto-sync: start when proxy OK + saved credentials exist ──
  useEffect(() => {
    if (!proxyOk || !savedCreds?.username || !savedCreds?.password) {
      setAutoSyncActive(false);
      return;
    }
    // Immediate sync on startup / credential change
    doSync(savedCreds.username, savedCreds.password);
    // Then every 15 min
    const timer = setInterval(() => doSync(savedCreds.username, savedCreds.password), AUTO_SYNC_MS);
    setAutoSyncActive(true);
    return () => { clearInterval(timer); setAutoSyncActive(false); };
  }, [proxyOk, savedCreds?.username, doSync]);

  // ── Manual sync: save credentials + trigger ──
  const handleSync = async () => {
    if (!form.username || !form.password) {
      setMessage('請填寫 LibreLinkUp 帳號密碼');
      setStatus('error');
      return;
    }
    // Persist credentials so auto-sync takes over after this
    dispatch({ type: 'UPDATE_SETTINGS', payload: {
      libreCredentials: { username: form.username, password: form.password },
    }});
    await doSync(form.username, form.password);
  };

  // ── Disconnect: clear saved credentials ──
  const handleDisconnect = () => {
    if (!window.confirm('確定要斷開 LibreLink 連接並刪除儲存的帳號資料？')) return;
    dispatch({ type: 'UPDATE_SETTINGS', payload: {
      libreCredentials: null,
      integrations: { ...state.settings.integrations, freestyleLibre: false },
    }});
    setForm({ username: '', password: '' });
    setLatestReading(null);
    setLastSync(null);
    setStatus('idle');
    setMessage('');
  };

  const isConnected = !!savedCreds?.username;

  return (
    <div className="card">
      <div className="card-header-row">
        <h3><Activity size={16} /> FreeStyle Libre 同步</h3>
        <span className={`badge ${isConnected ? 'badge-green' : 'badge-gray'}`}>
          {autoSyncActive ? '自動同步中' : isConnected ? '已連接' : '未連接'}
        </span>
      </div>

      {/* Proxy status */}
      <div className={`proxy-status ${proxyOk ? 'proxy-ok' : 'proxy-err'}`}>
        <Server size={13} />
        {proxyOk === null && '檢查代理伺服器…'}
        {proxyOk === true && '代理伺服器運作中 (localhost:3001)'}
        {proxyOk === false && <><code>npm run proxy</code> 尚未啟動</>}
      </div>

      {/* Latest reading + last sync time */}
      {latestReading && (
        <div className="libre-current">
          <div className="libre-value" style={{
            color: latestReading.isHigh ? 'var(--red)' : latestReading.isLow ? 'var(--yellow)' : 'var(--green)',
          }}>
            {latestReading.value} <span>mg/dL</span>
          </div>
          <div className="libre-trend">{TREND_LABELS[latestReading.trend] || latestReading.trend}</div>
          {lastSync && (
            <div className="libre-time">
              最後同步：{lastSync.toLocaleTimeString('zh-TW')}
              {autoSyncActive && <span className="auto-sync-badge">· 15 分鐘自動更新</span>}
            </div>
          )}
        </div>
      )}

      {/* Credentials — shown collapsed when already connected */}
      {!isConnected ? (
        <>
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label>LibreLinkUp 帳號 (Email)</label>
            <input type="email" value={form.username} onChange={e => set('username', e.target.value)}
              placeholder="與手機 LibreLinkUp App 相同帳號" autoComplete="username" />
          </div>
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label>密碼</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
              placeholder="LibreLinkUp 密碼" autoComplete="current-password" />
          </div>
        </>
      ) : (
        <div className="libre-account-row">
          <CheckCircle size={13} color="var(--green)" />
          <span className="libre-account-email">{savedCreds.username}</span>
          <button className="btn-row-action btn-row-delete" title="斷開連接" onClick={handleDisconnect}>
            <Unlink size={13} />
          </button>
        </div>
      )}

      {/* Status message */}
      {message && (
        <div className={`sync-msg ${status === 'success' ? 'sync-ok' : 'sync-err'}`}>
          {status === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
          {message}
        </div>
      )}

      <div className="btn-row">
        {!isConnected ? (
          <button className="btn-primary" onClick={handleSync}
            disabled={status === 'syncing' || !proxyOk} style={{ flex: 1 }}>
            <RefreshCw size={15} className={status === 'syncing' ? 'spin' : ''} />
            {status === 'syncing' ? '同步中…' : '連接並同步'}
          </button>
        ) : (
          <button className="btn-secondary" onClick={() => doSync(savedCreds.username, savedCreds.password)}
            disabled={status === 'syncing' || !proxyOk} style={{ flex: 1 }}>
            <RefreshCw size={15} className={status === 'syncing' ? 'spin' : ''} />
            {status === 'syncing' ? '同步中…' : '立即同步'}
          </button>
        )}
      </div>

      <p className="hint" style={{ marginTop: 8 }}>
        {isConnected
          ? `帳號已儲存，每 15 分鐘自動更新血糖。啟動 npm run proxy 即可持續同步。`
          : `輸入帳號後，系統每 15 分鐘自動同步一次，無需再手動操作。需先開啟手機 LibreLink「連線共享」並建立 LibreLinkUp 帳號。`
        }
      </p>
    </div>
  );
}
