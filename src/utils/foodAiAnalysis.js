// Frontend service — HYBRID meal analysis.
//
// Strategy: the curated local DB (foodDatabase.js) holds accurate, ground-truth
// portions + GI for ~90 common Taiwanese foods, so we trust it for anything it
// recognizes and only spend an AI call on the "long tail" it can't resolve.
//
//   1. Run the local rule-based parser → exact DB numbers for matched foods +
//      a list of `unmatched` names it couldn't resolve.
//   2. Nothing unmatched → return DB result directly (fast, free, accurate).
//   3. Some unmatched → ask the AI to estimate ONLY those, then merge AI's
//      subtotal onto the DB subtotal.
//
// Any AI failure degrades gracefully to whatever the local parser produced.
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

  const local = parseMealText(text);
  const focus = local.unmatched || [];

  // ① Fully covered by the curated DB → trust ground-truth numbers, skip AI.
  if (focus.length === 0 && !local.undetermined) {
    return { ...local, micros: [], source: 'db' };
  }

  // ② Long tail → estimate only the foods the DB couldn't resolve.
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ text, foods: focus }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const ai = await res.json();

    // DB subtotal (0 when nothing matched) + AI subtotal for the long tail.
    const dbMatched = !local.undetermined;
    const sum = (a, b) => Math.round((Number(a) || 0) + (Number(b) || 0));
    const merged = {
      foods:   [...(local.foods || []), ...(ai.foods || focus)],
      carbs:   sum(dbMatched ? local.carbs : 0,    ai.carbs),
      protein: sum(dbMatched ? local.protein : 0,  ai.protein),
      fat:     sum(dbMatched ? local.fat : 0,      ai.fat),
      calories:sum(dbMatched ? local.calories : 0, ai.calories),
      fiber:   ai.fiber ?? null,
      micros:  ai.micros || [],
      highGI:  [...(local.highGI || []), ...(ai.highGI || [])],
      diabetesNotes: ai.diabetesNotes || (dbMatched ? local.diabetesNotes : '') || '',
      // Pure-DB part is exact; the meal is high-confidence only if the AI was too.
      confidence: dbMatched ? (ai.confidence === 'low' ? 'medium' : 'high') : (ai.confidence || 'medium'),
      undetermined: false,
      partial: false,
      unmatched: [],
      // 'hybrid' = DB + AI; 'ai' = nothing matched the DB, AI did it all.
      source: dbMatched ? 'hybrid' : 'ai',
    };
    return merged;
  } catch (err) {
    console.warn('[FoodAI] 長尾估算失敗，沿用本地解析：', err.message);
    return { ...local, source: 'local' };
  }
}
