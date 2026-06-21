// LibreLinkUp proxy — custom HTTP client + food vision analysis
// Start: node server/libre-proxy.js
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Web Push (VAPID). Configured only when keys are present; generate a pair with
// `npx web-push generate-vapid-keys` and set them as env vars on Render.
const PUSH_ENABLED = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:wuborjenn@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

// Clinical thresholds for glucose alerts (mg/dL), matching the app's TIR 70–180.
const BG_LOW = 70;
const BG_HIGH = 180;
// Don't re-alert the same condition more often than this.
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1h

// Service-role Supabase client for server-side scheduled sync (bypasses RLS).
// Only created when configured; never expose the service key to the frontend.
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const RETAIN_DAYS = 90;

const app = express();
app.use(cors());
// Capture raw body into req.rawBody before JSON parsing — needed for LINE
// webhook signature verification (HMAC-SHA256 of exact request bytes).
app.use(express.json({
  limit: '20mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Lazy init — avoid crash when ANTHROPIC_API_KEY not set at startup
let _anthropic = null;
function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('未設定 ANTHROPIC_API_KEY。請以 ANTHROPIC_API_KEY=sk-ant-xxx node server/libre-proxy.js 啟動');
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Known working app versions (try newest first)
const CLIENT_VERSION = '4.16.0';
const PRODUCT = 'llu.android';

// Regional base URLs — initial login always hits api.libreview.io which redirects
const REGION_URLS = {
  AP:  'https://api-ap.libreview.io',
  EU:  'https://api-eu.libreview.io',
  EU2: 'https://api-eu2.libreview.io',
  US:  'https://api-us.libreview.io',
  AU:  'https://api-au.libreview.io',
  CA:  'https://api-ca.libreview.io',
  JP:  'https://api-jp.libreview.io',
};
const DEFAULT_URL = 'https://api.libreview.io';

async function sha256hex(str) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(str).digest('hex');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parse a LibreLink timestamp as UTC, independent of the server's timezone.
// LibreLink formats: "M/D/YYYY h:mm:ss A" (FactoryTimestamp is UTC). Falls back
// to Date parsing for ISO strings.
function parseLibreUTC(str) {
  if (!str) return new Date().toISOString();
  const m = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)?$/i);
  if (m) {
    let [, mo, d, y, h, mi, s, ap] = m;
    h = parseInt(h, 10);
    if (ap) {
      const pm = /P/i.test(ap);
      if (pm && h !== 12) h += 12;
      if (!pm && h === 12) h = 0;
    }
    return new Date(Date.UTC(+y, +mo - 1, +d, h, +mi, +s)).toISOString();
  }
  // Unknown format → best-effort (already ISO/with-tz)
  const dt = new Date(str);
  return isNaN(dt) ? new Date().toISOString() : dt.toISOString();
}

// fetch wrapper that retries once on Cloudflare 429 (rate limit) honoring
// retry_after. Render runs on a shared datacenter IP that LibreView throttles
// aggressively, so a single polite backoff prevents most transient failures.
async function libreFetch(url, opts) {
  let res = await fetch(url, opts);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '30', 10);
    const waitMs = Math.min(Math.max(retryAfter, 5), 35) * 1000;
    // cap the in-request wait so the HTTP call doesn't hang for 30s; stale-cache
    // serving (below) is what really absorbs rate limits.
    const cappedMs = Math.min(waitMs, 6000);
    console.warn(`[LibreProxy] 429 rate-limited, 等 ${cappedMs / 1000}s 後重試一次 ${url}`);
    await sleep(cappedMs);
    res = await fetch(url, opts);
  }
  return res;
}

async function libre_login(username, password, baseURL = DEFAULT_URL) {
  const res = await libreFetch(`${baseURL}/llu/auth/login`, {
    method: 'POST',
    headers: {
      'User-Agent': `LibreLinkUp/${CLIENT_VERSION} CFNetwork/1490.0.4 Darwin/23.2.0`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'Cache-Control': 'no-cache',
      'product': PRODUCT,
      'version': CLIENT_VERSION,
    },
    body: JSON.stringify({ email: username, password }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(`Login HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  if (json.status === 2) throw new Error('帳號或密碼錯誤（確認使用 LibreLinkUp 帳號，非 LibreLink）');
  if (json.status === 4) throw new Error(`帳號需要額外操作：${json.data?.step?.componentName || '請先在 App 完成驗證'}`);

  // Handle region redirect
  if (json.data?.redirect) {
    const region = json.data.region?.toUpperCase();
    const regionURL = REGION_URLS[region];
    if (!regionURL) throw new Error(`未知地區: ${region}。可用: ${Object.keys(REGION_URLS).join(', ')}`);
    console.log(`[LibreProxy] 重導至 ${region} 地區: ${regionURL}`);
    return libre_login(username, password, regionURL);
  }

  return {
    token: json.data.authTicket.token,
    accountId: json.data.user.id,
    baseURL,
  };
}

async function libre_read(session) {
  const { token, accountId, baseURL } = session;
  const accountHash = await sha256hex(accountId);

  const headers = {
    'User-Agent': `LibreLinkUp/${CLIENT_VERSION} CFNetwork/1490.0.4 Darwin/23.2.0`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'Authorization': `Bearer ${token}`,
    'account-id': accountHash,
    'product': PRODUCT,
    'version': CLIENT_VERSION,
  };

  // patientId is stable per account — cache it on the session so repeat syncs
  // skip the /connections call entirely (halves API requests = fewer 429s).
  let patientId = session.patientId;
  if (!patientId) {
    const connRes = await libreFetch(`${baseURL}/llu/connections`, { headers });
    const connJson = await connRes.json();

    if (!connRes.ok) throw new Error(`connections HTTP ${connRes.status}: ${JSON.stringify(connJson)}`);
    if (!connJson.data?.length) throw new Error('無連線患者。請在手機 LibreLinkUp 開啟「連線共享」並確認連接');

    patientId = connJson.data[0].patientId;
    session.patientId = patientId;
  }

  // Get graph data
  const graphRes = await libreFetch(`${baseURL}/llu/connections/${patientId}/graph`, { headers });
  const graphJson = await graphRes.json();

  if (!graphRes.ok) throw new Error(`graph HTTP ${graphRes.status}: ${JSON.stringify(graphJson)}`);

  const { connection, graphData } = graphJson.data;

  const mapReading = (r) => ({
    // ALWAYS use ValueInMgPerDl. `Value` is in the LibreLinkUp account's DISPLAY
    // unit — if that account is set to mmol/L, `Value` is mmol (e.g. 5.5) while we
    // label everything mg/dL, so the chart would disagree with the LibreLink app.
    // ValueInMgPerDl is the unit-independent mg/dL field (fallback to Value only
    // if absent, for robustness).
    value: (typeof r.ValueInMgPerDl === 'number') ? r.ValueInMgPerDl : r.Value,
    // FactoryTimestamp is UTC; Timestamp is patient-local. Parse explicitly as
    // UTC so the result is correct regardless of the server's timezone (Render
    // runs UTC, a dev laptop may not) — `new Date(str)` would misread it.
    timestamp: parseLibreUTC(r.FactoryTimestamp || r.Timestamp),
    unit: 'mg/dL',
    mealContext: 'cgm',
    source: 'FreeStyleLibre',
    trend: r.TrendArrow,
    isHigh: r.isHigh,
    isLow: r.isLow,
  });

  const gm = connection?.glucoseMeasurement;
  const current = gm ? mapReading(gm) : null;
  const history = (graphData || []).map(mapReading);

  return { current, history };
}

// Session cache: key → { token, accountId, baseURL, expiresAt }
const sessions = new Map();

async function getSession(username, password) {
  const key = `${username}::${password}`;
  const cached = sessions.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  console.log(`[LibreProxy] 登入 ${username}`);
  const session = await libre_login(username, password);
  session.expiresAt = Date.now() + 55 * 60 * 1000; // 55min token lifetime
  sessions.set(key, session);
  return session;
}

// Per-account read cache. LibreView rate-limits the shared datacenter IP hard,
// so we (a) serve a fresh cache within TTL without hitting LibreView at all,
// and (b) on any fetch error (429 etc.) fall back to the last good data so the
// user keeps seeing readings instead of an error.
const readCache = new Map(); // username -> { data, fetchedAt }
const READ_TTL = 60 * 1000;        // skip refetch within 60s
const STALE_MAX = 30 * 60 * 1000;  // serve stale up to 30min on error

app.post('/api/libre/sync', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '需要帳號密碼' });

  const cached = readCache.get(username);
  if (cached && Date.now() - cached.fetchedAt < READ_TTL) {
    return res.json({ ...cached.data, cached: true });
  }

  try {
    const session = await getSession(username, password);
    const { current, history } = await libre_read(session);

    const readings = [current, ...history].filter(Boolean);
    const data = { readings, count: readings.length };
    readCache.set(username, { data, fetchedAt: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('[LibreProxy] ERROR:', err.message);
    // Wrong credentials → no point serving stale; surface immediately.
    if (err.message.includes('帳號或密碼')) {
      sessions.delete(`${username}::${password}`);
      return res.status(401).json({ error: err.message });
    }
    // Rate-limited / transient → serve last good data if we have it.
    const stale = readCache.get(username);
    if (stale && Date.now() - stale.fetchedAt < STALE_MAX) {
      console.warn('[LibreProxy] 回傳快取 (limit/錯誤)');
      return res.json({ ...stale.data, stale: true });
    }
    sessions.delete(`${username}::${password}`);
    const friendly = /429|rate.?limit|1015/i.test(err.message)
      ? 'LibreView 暫時限流（雲端 IP），請稍等 1–2 分鐘再同步'
      : err.message;
    res.status(502).json({ error: friendly });
  }
});

app.get('/api/libre/health', (_req, res) => res.json({ ok: true, version: CLIENT_VERSION }));

// ── Server-side scheduled sync ───────────────────────────────────
// Syncs every user's LibreLink data into their Supabase row on a schedule,
// independent of whether the client app is open — so the 12h windows always
// overlap and history accumulates to RETAIN_DAYS with no gaps.

// Merge a fresh LibreLink fetch into accumulated history.
// AUTHORITATIVE WINDOW RECONCILIATION: the fetch covers a ~12h window, and within
// it LibreLink is the single source of truth. Keep accumulated history OUTSIDE the
// window, and replace the ENTIRE in-window slice with the incoming readings — this
// corrects revised values AND drops stale/duplicate points so every in-window
// reading matches LibreLink exactly. Source reconciliation, not manual editing.
function mergeGlucose(existing = [], incoming = []) {
  const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000;
  const inRetain = (r) => new Date(r.timestamp).getTime() >= cutoff;
  if (!incoming.length) return existing.filter(inRetain);

  const times = incoming.map(r => new Date(r.timestamp).getTime());
  const lo = Math.min(...times), hi = Math.max(...times);
  const outside = existing.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t < lo || t > hi;
  });
  return [...outside, ...incoming].filter(inRetain);
}

// Send a push payload to every subscription a user has registered. Returns the
// surviving subscriptions (dead ones — 404/410 — are pruned).
async function sendPushToUser(subscriptions = [], payload) {
  if (!PUSH_ENABLED || !subscriptions.length) return { survivors: subscriptions, sent: 0, changed: false };
  const survivors = [];
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      survivors.push(sub);
      sent++;
    } catch (e) {
      // 404/410 = subscription gone (uninstalled / expired) → drop it.
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.warn('[Push] 移除失效訂閱', e.statusCode);
      } else {
        console.warn('[Push] 發送失敗:', e.statusCode || e.message);
        survivors.push(sub); // transient error — keep for next time
      }
    }
  }
  return { survivors, sent, changed: survivors.length !== subscriptions.length };
}

// Decide whether the latest reading warrants an alert, honoring a cooldown so we
// don't spam the same condition. Returns { payload, nextAlert } or null.
function evalGlucoseAlert(latest, lastAlert) {
  if (!latest || typeof latest.value !== 'number') return null;
  const v = latest.value;
  const level = v < BG_LOW ? 'low' : v > BG_HIGH ? 'high' : 'normal';
  const now = Date.now();

  // Back in range → clear state so the next out-of-range event alerts immediately.
  if (level === 'normal') {
    return lastAlert?.level && lastAlert.level !== 'normal'
      ? { payload: null, nextAlert: { level: 'normal', at: now } }
      : null;
  }

  // Same condition still active and within cooldown → stay quiet.
  if (lastAlert?.level === level && now - (lastAlert.at || 0) < ALERT_COOLDOWN_MS) {
    return null;
  }

  const payload = level === 'low'
    ? { title: '⚠️ 低血糖警報', body: `目前血糖 ${v} mg/dL（低於 ${BG_LOW}），請盡快補充糖分。`, tag: 'bg-low', url: '/' }
    : { title: '⚠️ 高血糖警報', body: `目前血糖 ${v} mg/dL（高於 ${BG_HIGH}），請留意並依醫囑處理。`, tag: 'bg-high', url: '/' };
  return { payload, nextAlert: { level, at: now, value: v } };
}

async function syncOneUser(row) {
  const data = row.data || {};
  const creds = data.settings?.libreCredentials;
  if (!creds?.username || !creds?.password) return { skipped: true };

  const session = await getSession(creds.username, creds.password);
  const { current, history } = await libre_read(session);
  const incoming = [current, ...history].filter(Boolean);

  const before = data.glucoseReadings?.length || 0;
  const glucoseReadings = mergeGlucose(data.glucoseReadings, incoming);
  const added = glucoseReadings.length - before;

  // Glucose alert: evaluate the most recent reading and push if out of range.
  let nextData = { ...data, glucoseReadings };
  let dirty = added !== 0 || glucoseReadings.length !== before;
  let pushed = 0;

  const alert = evalGlucoseAlert(current, data.lastGlucoseAlert);
  if (alert) {
    if (alert.payload) {
      const subs = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
      const { survivors, sent, changed } = await sendPushToUser(subs, alert.payload);
      pushed = sent;
      if (changed) { nextData.pushSubscriptions = survivors; dirty = true; }
    }
    nextData.lastGlucoseAlert = alert.nextAlert;
    dirty = true;
  }

  // Only write when something changed (avoid needless clobber of client writes).
  if (dirty) {
    const { error } = await supabaseAdmin
      .from('app_state')
      .update({ data: nextData, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id);
    if (error) throw new Error(error.message);
  }
  return { added, total: glucoseReadings.length, pushed };
}

let cronRunning = false;
async function syncAllUsers() {
  if (!supabaseAdmin) { console.warn('[Cron] Supabase service role 未設定，略過'); return { error: 'not configured' }; }
  if (cronRunning) { console.warn('[Cron] 上一輪仍在執行，略過'); return { busy: true }; }
  cronRunning = true;
  const summary = { users: 0, synced: 0, added: 0, pushed: 0, errors: [] };
  try {
    const { data: rows, error } = await supabaseAdmin.from('app_state').select('user_id, data');
    if (error) throw new Error(error.message);
    summary.users = rows.length;
    for (const row of rows) {
      try {
        const r = await syncOneUser(row);
        if (!r.skipped) { summary.synced++; summary.added += r.added || 0; summary.pushed += r.pushed || 0; }
      } catch (e) {
        summary.errors.push(`${row.user_id.slice(0, 8)}: ${e.message}`);
      }
      await sleep(3000); // space out requests — one shared IP vs LibreView rate limits
    }
    console.log('[Cron] 同步完成', JSON.stringify(summary));
  } finally {
    cronRunning = false;
  }
  return summary;
}

// Triggered by an external scheduler (e.g. cron-job.org) every ~6h. Guarded by
// CRON_SECRET via header or ?key= so randoms can't run it.
app.all('/api/cron/sync-all', async (req, res) => {
  const configured = (process.env.CRON_SECRET || '').trim();
  const secret = (req.get('x-cron-secret') || req.query.key || '').trim();
  if (!configured) {
    return res.status(503).json({ error: 'CRON_SECRET 未設定（Render 環境變數）' });
  }
  if (secret !== configured) {
    return res.status(401).json({ error: 'key 不符', gotLen: secret.length, expectLen: configured.length });
  }
  const summary = await syncAllUsers();
  res.json(summary);
});

// ── Web Push subscription endpoints ──────────────────────────────
// Auth: the frontend sends the user's Supabase access token as a Bearer; we
// verify it with the service-role client to resolve the user id, then store the
// subscription inside that user's app_state row (data.pushSubscriptions[]).

// Public VAPID key — safe to expose; frontend needs it to subscribe.
app.get('/api/push/vapid-public-key', (_req, res) => {
  if (!PUSH_ENABLED) return res.status(503).json({ error: '伺服器未設定推播（VAPID 金鑰）' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

async function userFromBearer(req) {
  if (!supabaseAdmin) throw Object.assign(new Error('伺服器未設定 Supabase'), { status: 503 });
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) throw Object.assign(new Error('未登入'), { status: 401 });
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw Object.assign(new Error('登入憑證無效'), { status: 401 });
  return data.user;
}

// Read-modify-write the user's app_state JSONB.
async function updateUserData(userId, mutate) {
  const { data: row, error } = await supabaseAdmin
    .from('app_state').select('data').eq('user_id', userId).single();
  if (error) throw new Error(error.message);
  const data = row?.data || {};
  const next = mutate(data);
  const { error: upErr } = await supabaseAdmin
    .from('app_state')
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (upErr) throw new Error(upErr.message);
}

app.post('/api/push/subscribe', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    const sub = req.body?.subscription;
    if (!sub?.endpoint) return res.status(400).json({ error: '訂閱資料無效' });
    await updateUserData(user.id, (data) => {
      const subs = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
      const others = subs.filter(s => s.endpoint !== sub.endpoint); // dedupe by endpoint
      return { ...data, pushSubscriptions: [...others, sub] };
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    const endpoint = req.body?.endpoint;
    await updateUserData(user.id, (data) => {
      const subs = Array.isArray(data.pushSubscriptions) ? data.pushSubscriptions : [];
      return { ...data, pushSubscriptions: endpoint ? subs.filter(s => s.endpoint !== endpoint) : [] };
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Send a test push to the caller's own devices — lets the user confirm the
// whole pipeline (subscription + SW) works without waiting for a real alert.
app.post('/api/push/test', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    const { data: row, error } = await supabaseAdmin
      .from('app_state').select('data').eq('user_id', user.id).single();
    if (error) throw new Error(error.message);
    const subs = Array.isArray(row?.data?.pushSubscriptions) ? row.data.pushSubscriptions : [];
    if (!subs.length) return res.status(400).json({ error: '尚無已訂閱的裝置' });
    const { survivors, sent, changed } = await sendPushToUser(subs, {
      title: 'DiaGuide', body: '測試推播成功！高低血糖時會像這樣通知你。', tag: 'test', url: '/',
    });
    if (changed) await updateUserData(user.id, (data) => ({ ...data, pushSubscriptions: survivors }));
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Best-effort in-process timer (fires only while the instance is awake; the
// external cron is the reliable trigger on Render's sleepy free tier).
if (supabaseAdmin) {
  setInterval(() => { syncAllUsers().catch(e => console.error('[Cron]', e.message)); }, 6 * 60 * 60 * 1000);
}

// ── Food photo analysis ──────────────────────────────────────────
app.post('/api/analyze-food', async (req, res) => {
  // Optional shared-secret gate to protect the paid Anthropic endpoint.
  // If ACCESS_KEY is unset, endpoint stays open (local dev).
  if (process.env.ACCESS_KEY && req.get('x-access-key') !== process.env.ACCESS_KEY) {
    return res.status(401).json({ error: '存取金鑰錯誤' });
  }
  const { imageBase64, mediaType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '需要圖片資料' });

  try {
    const anthropic = getAnthropicClient();
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `你是糖尿病營養分析師。請分析這張食物照片，回傳以下 JSON（僅回傳 JSON，不要其他文字）：
{
  "foods": ["食物名稱列表"],
  "carbs": 數字(g),
  "protein": 數字(g),
  "fat": 數字(g),
  "calories": 數字(kcal),
  "highGI": [
    { "name": "食物名", "gi": GI指數, "warning": "對血糖的影響說明" }
  ],
  "diabetesNotes": "給糖尿病患者的整體飲食建議（100字內）",
  "confidence": "high|medium|low"
}
GI > 70 為高GI，需列入 highGI 陣列。碳水估算請考慮烹調方式與份量。`,
          },
        ],
      }],
    });

    const text = message.content[0].text.trim();
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('模型回傳格式錯誤');
    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch (err) {
    console.error('[FoodAnalysis]', err.message);
    res.status(500).json({ error: `分析失敗：${err.message}` });
  }
});

// ── LINE Bot ──────────────────────────────────────────────────────
// Webhook receives events from LINE Platform, verifies HMAC-SHA256 signature,
// then parses insulin / glucose / meal commands and writes to Supabase.

const LINE_CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET || '';
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const LINE_API = 'https://api.line.me/v2/bot';
const LINE_API_DATA = 'https://api-data.line.me/v2/bot'; // image upload uses the data domain

// Rich Menu definition — 4 equal columns (each 625×843) tapping into the guided
// flows via postback. The image (server/assets/line-richmenu.png) is registered
// by POST /api/line/setup-richmenu.
const RICH_MENU_DEF = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'DiaGuide Menu',
  chatBarText: '開啟記錄選單',
  areas: [
    { bounds: { x: 0,    y: 0, width: 625, height: 843 }, action: { type: 'postback', data: 'action=menu_glucose', displayText: '🩸 記錄血糖' } },
    { bounds: { x: 625,  y: 0, width: 625, height: 843 }, action: { type: 'postback', data: 'action=menu_insulin', displayText: '💉 記錄注射' } },
    { bounds: { x: 1250, y: 0, width: 625, height: 843 }, action: { type: 'postback', data: 'action=menu_meal',    displayText: '🍽 記錄飲食' } },
    { bounds: { x: 1875, y: 0, width: 625, height: 843 }, action: { type: 'postback', data: 'action=menu_help',    displayText: '❓ 說明' } },
  ],
};

// Binding codes: 6-digit code → { lineUserId, expiresAt }. In-memory only;
// codes expire in 10 min so a server restart simply forces a re-bind.
const lineBindingCodes = new Map();
const BIND_CODE_TTL = 10 * 60 * 1000;

function checkLineSignature(rawBody, signature) {
  if (!LINE_CHANNEL_SECRET || !signature) return false;
  const digest = createHmac('sha256', LINE_CHANNEL_SECRET).update(rawBody).digest('base64');
  return digest === signature;
}

async function lineReply(replyToken, text) {
  try {
    await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  } catch (e) {
    console.error('[LINE] reply error:', e.message);
  }
}

async function linePush(lineUserId, text) {
  try {
    await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text }] }),
    });
  } catch (e) {
    console.error('[LINE] push error:', e.message);
  }
}

// Reply with a text message that carries quick-reply buttons above the keyboard.
// `buttons` = [{ label, data, displayText? }] → rendered as postback actions.
async function lineReplyQuick(replyToken, text, buttons = []) {
  const items = buttons.slice(0, 13).map(b => ({
    type: 'action',
    action: { type: 'postback', label: b.label, data: b.data, displayText: b.displayText || b.label },
  }));
  const message = { type: 'text', text };
  if (items.length) message.quickReply = { items };
  try {
    await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ replyToken, messages: [message] }),
    });
  } catch (e) {
    console.error('[LINE] quick reply error:', e.message);
  }
}

// Per-user guided-flow state. flow = 'insulin'|'glucose'|'meal'; step names the
// field we're waiting for; data holds choices already made. In-memory with TTL,
// so a restart simply drops half-finished flows (user re-taps the menu).
const lineConvState = new Map();
const CONV_TTL = 5 * 60 * 1000;
function setConv(lineUserId, state) {
  lineConvState.set(lineUserId, { ...state, expiresAt: Date.now() + CONV_TTL });
}
function getConv(lineUserId) {
  const s = lineConvState.get(lineUserId);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { lineConvState.delete(lineUserId); return null; }
  return s;
}
function clearConv(lineUserId) { lineConvState.delete(lineUserId); }

const CANCEL_BTN = { label: '✖ 取消', data: 'action=cancel' };

// ── Message parsers ──
// Insulin: "速效 8U" / "長效 20u" / "短效 6U"
function parseInsulinMsg(text) {
  const TYPE_MAP = {
    速效: 'rapid', 超速效: 'rapid',
    短效: 'short', 普通: 'short',
    長效: 'long',  基礎: 'long',
  };
  const m = text.match(/^(速效|超速效|短效|普通|長效|基礎)\s+([\d.]+)\s*[Uu]/);
  if (!m) return null;
  return { insulinType: TYPE_MAP[m[1]], units: parseFloat(m[2]), timestamp: new Date().toISOString(), source: 'line' };
}

// Blood glucose: "血糖 120" / "血糖120" / "BG 120"
function parseGlucoseMsg(text) {
  const m = text.match(/^(?:血糖|BG|bg)\s*([\d.]+)/i);
  if (!m) return null;
  return { value: parseFloat(m[1]), unit: 'mg/dL', mealContext: 'other', timestamp: new Date().toISOString(), source: 'line' };
}

// Meal: "早餐 白飯一碗 雞蛋兩顆"
function parseMealMsg(text) {
  const MEAL_MAP = { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner', 點心: 'snack', 宵夜: 'snack', 零食: 'snack' };
  const m = text.match(/^(早餐|午餐|晚餐|點心|宵夜|零食)\s+(.+)/);
  if (!m) return null;
  return { mealType: MEAL_MAP[m[1]], foods: m[2].trim(), timestamp: new Date().toISOString(), source: 'line', carbs: 0, confidence: 'undetermined' };
}

// Find a user row whose data.lineUserId matches
async function findUserByLineId(lineUserId) {
  if (!supabaseAdmin) return null;
  const { data: rows } = await supabaseAdmin
    .from('app_state')
    .select('user_id, data')
    .filter('data->>lineUserId', 'eq', lineUserId)
    .limit(1);
  return rows?.[0] || null;
}

const INSULIN_LABEL = { rapid: '速效', short: '短效', long: '長效' };
const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '點心' };
const nowTime = () => new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

// ── Record helpers — used by BOTH direct text commands AND the guided flow.
// Each writes to Supabase and returns a confirmation string.
async function recordInsulin(userRow, insulinType, units) {
  const { user_id, data } = userRow;
  const logs = Array.isArray(data.insulinLogs) ? data.insulinLogs : [];
  logs.push({ insulinType, units, timestamp: new Date().toISOString(), source: 'line', id: `line-${Date.now()}` });
  await updateUserData(user_id, d => ({ ...d, insulinLogs: logs }));
  return `✅ 已記錄注射\n💉 ${INSULIN_LABEL[insulinType]} ${units} U\n⏰ ${nowTime()}`;
}

async function recordGlucose(userRow, value) {
  const { user_id, data } = userRow;
  const readings = Array.isArray(data.glucoseReadings) ? data.glucoseReadings : [];
  readings.push({ value, unit: 'mg/dL', mealContext: 'other', timestamp: new Date().toISOString(), source: 'line', id: `line-${Date.now()}` });
  await updateUserData(user_id, d => ({ ...d, glucoseReadings: readings }));
  const flag = value < 70 ? '⚠️ 低血糖，請補充糖分！' : value > 180 ? '⚠️ 偏高，注意觀察' : '✅ 正常範圍';
  return `✅ 已記錄血糖\n🩸 ${value} mg/dL\n${flag}`;
}

async function recordMeal(userRow, mealType, foods) {
  const { user_id, data } = userRow;
  const meals = Array.isArray(data.meals) ? data.meals : [];
  meals.push({ mealType, foods, timestamp: new Date().toISOString(), source: 'line', carbs: 0, confidence: 'undetermined', id: `line-${Date.now()}` });
  await updateUserData(user_id, d => ({ ...d, meals }));
  return `✅ 已記錄${MEAL_LABEL[mealType]}\n🍽 ${foods}\n\n💡 開啟 DiaGuide 可查看完整營養分析`;
}

// Quick-reply buttons that open each guided flow — shown on the help / fallback
// messages so the menu is reachable even without tapping the Rich Menu.
const MENU_BTNS = [
  { label: '🩸 血糖', data: 'action=menu_glucose' },
  { label: '💉 注射', data: 'action=menu_insulin' },
  { label: '🍽 飲食', data: 'action=menu_meal' },
  { label: '❓ 說明', data: 'action=menu_help' },
];

const LINE_HELP = `📖 DiaGuide 使用說明

點下方選單或快速按鈕即可記錄，全程用點的：

🩸 血糖 — 輸入數值
💉 注射 — 選類型 → 輸入單位
🍽 飲食 — 選餐別 → 輸入內容

也可直接打字快速記錄：
「血糖 120」「速效 8U」「早餐 白飯一碗」

🔗 重新綁定：傳「綁定」`;

app.post('/linebot/webhook', async (req, res) => {
  // Always 200 immediately — LINE retries on non-200
  res.status(200).end();

  if (!LINE_CHANNEL_SECRET || !LINE_CHANNEL_ACCESS_TOKEN) return;

  const signature = req.get('x-line-signature');
  if (!req.rawBody || !checkLineSignature(req.rawBody, signature)) {
    console.warn('[LINE] 簽名驗證失敗');
    return;
  }

  const events = req.body?.events || [];
  for (const event of events) {
    const lineUserId = event.source?.userId;
    const replyToken = event.replyToken;
    if (!lineUserId || !replyToken) continue;

    // Normalize input: postback (button tap) carries `data`; text carries words.
    let postbackData = null, text = null;
    if (event.type === 'postback') postbackData = event.postback?.data || '';
    else if (event.type === 'message' && event.message?.type === 'text') text = (event.message.text || '').trim();
    else continue;
    const action = postbackData ? new URLSearchParams(postbackData).get('action') : null;
    const pbType = postbackData ? new URLSearchParams(postbackData).get('type') : null;

    // ── 綁定（純文字，任何時候可用）──
    if (text === '綁定' || text === '綁定帳號') {
      clearConv(lineUserId);
      for (const [k, v] of lineBindingCodes) { if (v.expiresAt < Date.now()) lineBindingCodes.delete(k); }
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      lineBindingCodes.set(code, { lineUserId, expiresAt: Date.now() + BIND_CODE_TTL });
      await lineReply(replyToken,
        `🔗 綁定碼：${code}\n\n請開啟 DiaGuide →「設定」→「其他裝置整合」下方的「LINE Bot 綁定」輸入此碼。\n⏱ 10 分鐘內有效`
      );
      continue;
    }

    // ── 取消目前流程 ──
    if (action === 'cancel') {
      clearConv(lineUserId);
      await lineReplyQuick(replyToken, '已取消 ✖\n\n要記錄什麼？', MENU_BTNS);
      continue;
    }

    // ── 說明 ──
    if (text === '說明' || text === 'help' || text === '?' || action === 'menu_help') {
      await lineReplyQuick(replyToken, LINE_HELP, MENU_BTNS);
      continue;
    }

    // ── 需要綁定才能記錄 ──
    const userRow = await findUserByLineId(lineUserId);
    if (!userRow) {
      clearConv(lineUserId);
      await lineReply(replyToken, '請先傳「綁定」來連結你的 DiaGuide 帳號 🔗');
      continue;
    }

    // ── 選單入口：開始一段引導流程 ──
    if (action === 'menu_glucose') {
      setConv(lineUserId, { flow: 'glucose', step: 'value' });
      await lineReplyQuick(replyToken, '🩸 請輸入血糖數值（mg/dL）\n例如：120', [CANCEL_BTN]);
      continue;
    }
    if (action === 'menu_insulin') {
      setConv(lineUserId, { flow: 'insulin', step: 'type' });
      await lineReplyQuick(replyToken, '💉 請選擇胰島素類型', [
        { label: '⚡ 速效', data: 'action=ins_type&type=rapid' },
        { label: '💧 短效', data: 'action=ins_type&type=short' },
        { label: '🌙 長效', data: 'action=ins_type&type=long' },
        CANCEL_BTN,
      ]);
      continue;
    }
    if (action === 'menu_meal') {
      setConv(lineUserId, { flow: 'meal', step: 'type' });
      await lineReplyQuick(replyToken, '🍽 請選擇餐別', [
        { label: '🌅 早餐', data: 'action=meal_type&type=breakfast' },
        { label: '☀️ 午餐', data: 'action=meal_type&type=lunch' },
        { label: '🌆 晚餐', data: 'action=meal_type&type=dinner' },
        { label: '🍪 點心', data: 'action=meal_type&type=snack' },
        CANCEL_BTN,
      ]);
      continue;
    }

    // ── 流程中途選擇（按鈕）──
    if (action === 'ins_type' && pbType) {
      setConv(lineUserId, { flow: 'insulin', step: 'units', data: { type: pbType } });
      await lineReplyQuick(replyToken, `💉 ${INSULIN_LABEL[pbType] || ''}\n請輸入單位數（U）\n例如：8`, [CANCEL_BTN]);
      continue;
    }
    if (action === 'meal_type' && pbType) {
      setConv(lineUserId, { flow: 'meal', step: 'foods', data: { type: pbType } });
      await lineReplyQuick(replyToken, `${MEAL_LABEL[pbType] || ''}\n請輸入吃了什麼\n例如：白飯一碗 雞蛋兩顆`, [CANCEL_BTN]);
      continue;
    }

    // ── 文字輸入 ──
    if (text != null) {
      const conv = getConv(lineUserId);

      // 流程中：填入正在等待的欄位
      if (conv) {
        if (conv.flow === 'glucose' && conv.step === 'value') {
          const v = parseFloat(text.replace(/[^\d.]/g, ''));
          if (isNaN(v) || v <= 0) { await lineReplyQuick(replyToken, '請輸入數字，例如 120', [CANCEL_BTN]); continue; }
          clearConv(lineUserId);
          await lineReply(replyToken, await recordGlucose(userRow, v));
          continue;
        }
        if (conv.flow === 'insulin' && conv.step === 'units') {
          const v = parseFloat(text.replace(/[^\d.]/g, ''));
          if (isNaN(v) || v <= 0) { await lineReplyQuick(replyToken, '請輸入單位數，例如 8', [CANCEL_BTN]); continue; }
          clearConv(lineUserId);
          await lineReply(replyToken, await recordInsulin(userRow, conv.data.type, v));
          continue;
        }
        if (conv.flow === 'meal' && conv.step === 'foods') {
          clearConv(lineUserId);
          await lineReply(replyToken, await recordMeal(userRow, conv.data.type, text.trim()));
          continue;
        }
      }

      // 無進行中流程：仍支援老手直接打指令
      const insulin = parseInsulinMsg(text);
      if (insulin) { await lineReply(replyToken, await recordInsulin(userRow, insulin.insulinType, insulin.units)); continue; }
      const glucose = parseGlucoseMsg(text);
      if (glucose) { await lineReply(replyToken, await recordGlucose(userRow, glucose.value)); continue; }
      const meal = parseMealMsg(text);
      if (meal) { await lineReply(replyToken, await recordMeal(userRow, meal.mealType, meal.foods)); continue; }

      // 看不懂 → 顯示選單按鈕
      await lineReplyQuick(replyToken, '請點下方按鈕選擇要記錄的項目 👇', MENU_BTNS);
      continue;
    }

    // 其他未知 postback
    await lineReplyQuick(replyToken, '請點下方按鈕選擇要記錄的項目 👇', MENU_BTNS);
  }
});

// ── LINE 綁定 API（前端呼叫）──────────────────────────────────────
app.post('/api/line/bind', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: '請輸入綁定碼' });

    const entry = lineBindingCodes.get(code);
    if (!entry) return res.status(400).json({ error: '綁定碼無效或已過期' });
    if (entry.expiresAt < Date.now()) {
      lineBindingCodes.delete(code);
      return res.status(400).json({ error: '綁定碼已過期，請在 LINE 重新傳「綁定」' });
    }

    await updateUserData(user.id, d => ({ ...d, lineUserId: entry.lineUserId }));
    lineBindingCodes.delete(code);

    // 通知 LINE 綁定成功
    await linePush(entry.lineUserId,
      '🎉 綁定成功！\n\n現在可以用 LINE 直接記錄血糖、注射和飲食，不需要開 App。\n\n傳「說明」查看所有指令。'
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 解除綁定
app.post('/api/line/unbind', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    await updateUserData(user.id, ({ lineUserId: _rm, ...rest }) => rest);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// 查詢綁定狀態
app.get('/api/line/status', async (req, res) => {
  try {
    const user = await userFromBearer(req);
    const { data: row } = await supabaseAdmin
      .from('app_state').select('data').eq('user_id', user.id).single();
    res.json({ bound: !!row?.data?.lineUserId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── Rich Menu 一次性設定 ──────────────────────────────────────────
// Registers the bottom persistent menu on the LINE account. Run once (and again
// whenever the menu layout/image changes). Guarded by CRON_SECRET so randoms
// can't reset the menu. Trigger: GET/POST /api/line/setup-richmenu?key=<secret>
app.all('/api/line/setup-richmenu', async (req, res) => {
  const configured = (process.env.CRON_SECRET || '').trim();
  const secret = (req.get('x-cron-secret') || req.query.key || '').trim();
  if (!configured) return res.status(503).json({ error: 'CRON_SECRET 未設定（Render 環境變數）' });
  if (secret !== configured) return res.status(401).json({ error: 'key 不符' });
  if (!LINE_CHANNEL_ACCESS_TOKEN) return res.status(503).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' });

  const auth = { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` };
  try {
    // 1) Remove any existing rich menus (avoid accumulation on re-run)
    const listRes = await fetch(`${LINE_API}/richmenu/list`, { headers: auth });
    const list = await listRes.json();
    for (const rm of (list.richmenus || [])) {
      await fetch(`${LINE_API}/richmenu/${rm.richMenuId}`, { method: 'DELETE', headers: auth });
    }

    // 2) Create the rich menu object
    const createRes = await fetch(`${LINE_API}/richmenu`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(RICH_MENU_DEF),
    });
    const created = await createRes.json();
    if (!createRes.ok) throw new Error(`create: ${JSON.stringify(created)}`);
    const richMenuId = created.richMenuId;

    // 3) Upload the image (data domain)
    const img = readFileSync(path.join(__dirname, 'assets', 'line-richmenu.png'));
    const upRes = await fetch(`${LINE_API_DATA}/richmenu/${richMenuId}/content`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'image/png' },
      body: img,
    });
    if (!upRes.ok) throw new Error(`upload: ${upRes.status} ${await upRes.text()}`);

    // 4) Set as the default menu for all users
    const defRes = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, { method: 'POST', headers: auth });
    if (!defRes.ok) throw new Error(`setDefault: ${defRes.status} ${await defRes.text()}`);

    console.log('[LINE] Rich Menu 已設定', richMenuId);
    res.json({ ok: true, richMenuId });
  } catch (e) {
    console.error('[LINE] richmenu setup 失敗:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Serve built frontend (production) ────────────────────────────
// In production Render runs `npm run build` then this server hosts dist/.
// In local dev, Vite serves the frontend and proxies /api here, so dist/
// may not exist — guard with existsSync.
import { existsSync } from 'node:fs';
const distDir = path.join(__dirname, '..', 'dist');
if (existsSync(distDir)) {
  // Hashed build assets (/assets/index-XXize.js) are content-addressed and
  // immutable → cache hard. Everything else (index.html, sw.js, manifest) must
  // NOT be cached, or phones/PWAs keep loading a stale shell that points at old
  // bundles and never picks up new deploys.
  app.use(express.static(distDir, {
    setHeaders: (res, filePath) => {
      if (/[\\/]assets[\\/]/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  }));
  // SPA fallback: any non-/api GET returns index.html for client routing.
  // Always no-store so the app shell is re-fetched fresh on every load.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.sendFile(path.join(distDir, 'index.html'));
  });
  console.log('[LibreProxy] serving static frontend from dist/');
}

// Global JSON error handler — must be LAST, catches anything Express 5 async throws
app.use((err, req, res, _next) => {
  console.error('[LibreProxy] Unhandled:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || process.env.PROXY_PORT || 3001;
app.listen(PORT, () => {
  console.log(`[LibreProxy] http://localhost:${PORT}`);
  console.log(`[LibreProxy] version=${CLIENT_VERSION} product=${PRODUCT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[LibreProxy] ⚠️  ANTHROPIC_API_KEY 未設定，食物照片分析功能將無法使用');
  }
});
