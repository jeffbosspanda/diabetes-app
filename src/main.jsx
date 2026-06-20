import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Register the push service worker (no-op where unsupported / non-secure origin).
if ('serviceWorker' in navigator) {
  // When a new SW takes control (new deploy), reload once so an installed PWA
  // picks up the fresh shell instead of showing a stale version. Only reload if
  // the page was ALREADY controlled (a real update) — skip the first-ever
  // install, which would otherwise cause a needless reload on first visit.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update(); // check for a newer SW on every app load
    }).catch((err) => {
      console.warn('[SW] 註冊失敗:', err.message);
    });
  });
}
