// Frontend service — calls Vite proxy → Express → Abbott API
const PROXY = '/api/libre';

export const LIBRE_REGIONS = [
  { value: 'US', label: '美國 (US)' },
  { value: 'EU', label: '歐洲 (EU)' },
  { value: 'EU2', label: '歐洲 2 (EU2)' },
  { value: 'AU', label: '澳洲 (AU)' },
  { value: 'CA', label: '加拿大 (CA)' },
  { value: 'JP', label: '日本 (JP)' },
  { value: 'AP', label: '亞太 (AP)' },
];

export const TREND_LABELS = {
  SingleDown: '↓↓ 急速下降',
  FortyFiveDown: '↘ 下降',
  Flat: '→ 穩定',
  FortyFiveUp: '↗ 上升',
  SingleUp: '↑↑ 急速上升',
  NotComputable: '— 無法計算',
};

export async function syncLibreData(username, password) {
  const res = await fetch(`${PROXY}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '同步失敗');
  return data; // { readings: [...], count: N }
}

export async function checkProxyHealth() {
  try {
    const res = await fetch(`${PROXY}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
