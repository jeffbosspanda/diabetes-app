import { useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { Lock, KeyRound } from 'lucide-react';

// Map common Supabase auth errors to Chinese
function zhError(msg = '') {
  if (/Password should be at least/i.test(msg)) return '密碼至少需 6 個字元';
  if (/New password should be different/i.test(msg)) return '新密碼不可與舊密碼相同';
  if (/session|expired|invalid/i.test(msg)) return '重設連結已失效，請重新申請忘記密碼';
  if (/rate limit|too many/i.test(msg)) return '嘗試太頻繁，請稍後再試';
  return msg || '發生錯誤，請重試';
}

// Shown after the user opens a password-reset email link (recovery session active)
export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setNotice('');
    if (password !== confirmPassword) {
      setError('兩次輸入的密碼不一致');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setNotice('密碼已更新，正在進入…');
      // updatePassword clears recovery → Gate unmounts this screen into the app
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
        <p className="auth-sub">設定新密碼</p>

        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="auth-error">{error}</div>}

        <label className="auth-field">
          <Lock size={16} />
          <input
            type="password" placeholder="新密碼（至少 6 字元）" required minLength={6}
            value={password} autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <label className="auth-field">
          <Lock size={16} />
          <input
            type="password" placeholder="再次輸入新密碼" required minLength={6}
            value={confirmPassword} autoComplete="new-password"
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>

        <button className="auth-btn" type="submit" disabled={busy}>
          <KeyRound size={16} /> 更新密碼
        </button>
      </form>
    </div>
  );
}
