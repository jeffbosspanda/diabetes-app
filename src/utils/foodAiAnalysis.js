// Frontend service — AI text analysis of a meal description.
// Calls the same-origin Express proxy (→ Anthropic), gated by the user's
// Supabase login. Falls back to the local rule-based parser on any error so
// the feature degrades gracefully offline / when the API key is unset.
import { supabase } from '../lib/supabase';
import { parseMealText } from './foodParser';

const ENDPOINT = '/api/analyze-food-text';

export async function analyzeFoodText(text) {
  const local = () => ({ ...parseMealText(text), source: 'local' });
  if (!text?.trim()) return null;

  try {
    const { data } = supabase ? await supabase.auth.getSession() : { data: null };
    const token = data?.session?.access_token;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const ai = await res.json();
    // Map AI result onto the shape the analysis card expects.
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
    console.warn('[FoodAI] 文字分析失敗，改用本地解析：', err.message);
    return local();
  }
}
