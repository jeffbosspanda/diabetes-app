import { createClient } from '@supabase/supabase-js';

// Public anon key — safe to ship to the browser; row-level security in the
// database is what actually protects each user's data.
// Normalize the project URL. People often paste the REST/auth sub-path
// (".../rest/v1") by mistake — supabase-js appends its own path, so any
// suffix here produces "invalid path specified in request URL". Strip it.
const url = import.meta.env.VITE_SUPABASE_URL
  ?.trim()
  .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/i, '')
  .replace(/\/+$/, '');
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const supabaseReady = Boolean(url && anonKey);

if (!supabaseReady) {
  console.warn('[Supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 未設定，登入功能停用');
}

export const supabase = supabaseReady ? createClient(url, anonKey) : null;
