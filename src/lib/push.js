// Web Push subscription helper.
// Registers the service worker, subscribes the browser to push using the
// backend's VAPID public key, and uploads the subscription (with the user's
// Supabase access token so the server can attach it to the right account).
import { supabase } from './supabase';

// Push works only over https (or localhost) with SW + PushManager support.
export function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// On iOS, push requires the app be installed to the home screen (standalone).
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registerSW() {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return reg;
}

// Enable push: request permission, subscribe, upload. Throws with a Chinese
// message on any failure so the UI can surface it directly.
export async function enablePush() {
  if (!pushSupported()) throw new Error('此瀏覽器不支援推播通知');
  if (isIOS() && !isStandalone()) {
    throw new Error('iPhone 請先用 Safari 將本 App「加入主畫面」，再從主畫面開啟並啟用推播');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('未授予通知權限');

  const reg = await registerSW();

  // Fetch VAPID public key from backend.
  const keyRes = await fetch('/api/push/vapid-public-key');
  const keyJson = await keyRes.json().catch(() => ({}));
  if (!keyRes.ok || !keyJson.key) throw new Error(keyJson.error || '伺服器未設定推播金鑰');

  // Reuse existing subscription if present, else create one.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyJson.key),
    });
  }

  // Upload subscription tied to the logged-in user.
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('請先登入再啟用推播');

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ subscription: sub }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || '訂閱上傳失敗');
  }
  return true;
}

// Whether this browser already holds a push subscription.
export async function pushSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// Disable push: unsubscribe locally and tell the backend to drop it.
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (token) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  }
  return true;
}
