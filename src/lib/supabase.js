import { createClient } from '@supabase/supabase-js';

// Public anon key — safe to ship to the browser; row-level security in the
// database is what actually protects each user's data.
// trim whitespace + trailing slash — a stray slash makes Supabase's gateway
// return "invalid path specified in request URL"
const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseReady = Boolean(url && anonKey);

if (!supabaseReady) {
  console.warn('[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未設定，登入功能停用');
}

export const supabase = supabaseReady ? createClient(url, anonKey) : null;
