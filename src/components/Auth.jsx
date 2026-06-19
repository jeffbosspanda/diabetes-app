import { useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { supabaseReady, supabaseUrl, supabaseKeyHint } from '../lib/supabase';
import { Mail, Lock, LogIn, UserPlus } from 'lucide-react';

// Map common Supabase auth errors to Chinese
function zhError(msg = '') {
  if (/Invalid login credentials/i.test(msg)) return '帳號或密碼錯誤';
  if (/User already registered/i.test(msg)) return '此 email 已註冊，請直接登入';
  if (/Password should be at least/i.test(msg)) return '密碼至少需 6 個字元';
  if (/Unable to validate email|invalid format/i.test(msg)) return 'email 格式不正確';
  if (/Email not confirmed/i.test(msg)) return '請先到信箱點擊驗證連結再登入';
  if (/rate limit|too many/i.test(msg)) return '嘗試太頻繁，請稍後再試';
  return msg || '發生錯誤，請重試';
}

export default function Auth() {
  const { signUp, signIn, resetPassword } = useAuth();
  const [mode, setMode] = useState('login'); // login | register | forgot
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [diag, setDiag] = useState('');

  // Diagnostic: hit Supabase auth health straight from this device and show
  // the raw outcome — pinpoints "invalid path" / network / CORS issues.
  const testConn = async () => {
    setDiag('測試中…');
    const target = `${supabaseUrl}/auth/v1/health`;
    try {
      const r = await fetch(target);
      const body = await r.text();
      setDiag(`URL: ${supabaseUrl}\nHTTP ${r.status}\n${body.slice(0, 200)}`);
    } catch (e) {
      setDiag(`URL: ${supabaseUrl}\nFETCH FAILED: ${e.message}`);
    }
  };

  if (!supabaseReady) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-title">DiaGuide</h1>
          <p className="auth-error">
            登入功能尚未設定。請設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY 環境變數。
          </p>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice(''); setBusy(true);
    try {
      if (mode === 'register') {
        await signUp(email.trim(), password);
        setNotice('註冊成功！若需 email 驗證，請到信箱點擊連結後再登入。');
        setMode('login');
      } else if (mode === 'login') {
        await signIn(email.trim(), password);
        // success → AuthProvider session change unmounts this screen
      } else {
        await resetPassword(email.trim());
        setNotice('已寄出密碼重設信，請查收信箱。');
        setMode('login');
      }
    } catch (err) {
      setError(zhError(err.message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h1 className="auth-title">DiaGuide</h1>
        <p className="auth-sub">糖尿病管理系統</p>

        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          <Mail size={16} />
          <input
            type="email" placeholder="email" required value={email}
            autoComplete="email" onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        {mode !== 'forgot' && (
          <label className="auth-field">
            <Lock size={16} />
            <input
              type="password" placeholder="密碼（至少 6 字元）" required minLength={6}
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}

        <button className="auth-btn" type="submit" disabled={busy}>
          {mode === 'register' ? <><UserPlus size={16} /> 註冊</>
            : mode === 'forgot' ? '寄送重設信'
            : <><LogIn size={16} /> 登入</>}
        </button>

        <div className="auth-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => { setMode('register'); setError(''); setNotice(''); }}>
                還沒有帳號？註冊
              </button>
              <button type="button" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>
                忘記密碼
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button type="button" onClick={() => { setMode('login'); setError(''); setNotice(''); }}>
              ← 回登入
            </button>
          )}
        </div>

        {/* 診斷區（暫時）：確認連線設定 */}
        <div className="auth-diag">
          <div>host: {supabaseUrl || '(未設定)'}</div>
          <div>key: {supabaseKeyHint}</div>
          <button type="button" onClick={testConn}>測試連線</button>
          {diag && <pre>{diag}</pre>}
        </div>
      </form>
    </div>
  );
}
