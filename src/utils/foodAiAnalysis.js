// Frontend service — AI meal analysis.
//
// Sends the whole meal description to the AI (Claude) and uses its estimate
// directly. The local rule-based parser is kept ONLY as a graceful fallback for
// when the AI call fails (offline / API key unset) so the feature never hard-breaks.
import { supabase } from '../lib/supabase';
import { parseMealText } from './foodParser';

const ENDPOINT = '/api/analyze-food-text';

async function authHeader() {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function analyzeFoodText(text) {
  if (!text?.trim()) return null;

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ text }), // no `foods` → AI estimates the whole meal
      // NVIDIA 70B inference + Render free-tier cold start can exceed 30s.
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const ai = await res.json();
    return {
      foods: ai.foods || [],
      carbs: ai.carbs ?? 0,
      protein: ai.protein ?? 0,
      fat: ai.fat ?? 0,
      calories: ai.calories ?? 0,
      fiber: ai.fiber ?? null,
      highGI: ai.highGI || [],
      micros: ai.micros || [],
      diabetesNotes: ai.diabetesNotes || '',
      confidence: ai.confidence || 'medium',
      undetermined: false,
      partial: false,
      unmatched: [],
      source: 'ai',
    };
  } catch (err) {
    console.warn('[FoodAI] AI 分析失敗，改用本地解析：', err.message);
    // Surface the reason so the UI can show why it fell back (401 未登入 /
    // 500 金鑰或模型錯誤 / timeout) instead of silently showing 本地.
    return { ...parseMealText(text), source: 'local', aiError: err.message };
  }
}
