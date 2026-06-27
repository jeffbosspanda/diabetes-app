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

// ── NVIDIA NIM (OpenAI-compatible) for food text analysis ──────────
// The API key comes from build.nvidia.com (NOT Anthropic). NVIDIA hosts open
// models behind an OpenAI-shaped /chat/completions endpoint. Reads NVIDIA_API_KEY,
// falling back to ANTHROPIC_API_KEY so an already-set Render var keeps working.
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const NVIDIA_MODEL    = process.env.NVIDIA_MODEL || 'meta/llama-3.3-70b-instruct';
function getNvidiaKey() {
  const k = process.env.NVIDIA_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!k) throw new Error('未設定 NVIDIA_API_KEY（食物分析用）');
  return k;
}
async function callNvidiaChat(prompt) {
  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getNvidiaKey()}` },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NVIDIA ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('NVIDIA 回傳格式錯誤');
  return text;
}

// Vision call — same OpenAI-compatible endpoint, a vision-capable model, and an
// image_url data-URL part. The frontend compresses the photo to stay inline.
const NVIDIA_VISION_MODEL = process.env.NVIDIA_VISION_MODEL || 'meta/llama-3.2-90b-vision-instruct';
async function callNvidiaVision(prompt, dataUrl) {
  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getNvidiaKey()}` },
    body: JSON.stringify({
      model: NVIDIA_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }],
      temperature: 0.2,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`NVIDIA ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('NVIDIA 回傳格式錯誤');
  return text;
}

// Shared nutrition prompt pieces (used by both text and photo endpoints).
const FOOD_ANCHORS = `【常見台灣食物份量錨點（每份熟重與營養，供校準，依實際份量比例調整，勿照抄）】
主食：
- 白飯一碗≈200g/碳水53g；糙米飯一碗≈200g/碳水42g；稀飯一碗≈250g/碳水28g
- 麵條一碗(熟)≈200g/碳水55g；米粉/冬粉一份≈碳水40-46g；烏龍麵一碗≈碳水52g
- 吐司1片≈30g/碳水15g；饅頭1個≈80g/碳水38g；貝果1個≈碳水50g；麵包1個≈碳水40g
- 水餃1顆≈25g/碳水9g(10顆≈90g碳水)；蛋餅一份≈碳水30g；抓餅/蔥油餅一份≈碳水38g/脂肪14g
- 地瓜1條≈150g/碳水36g；玉米1根≈碳水30g；馬鈴薯1顆≈碳水30g
便當/小吃：
- 雞腿/排骨便當一份≈碳水65-75g/蛋白25g/脂肪20g
- 滷肉飯/肉燥飯一碗≈碳水50g/脂肪15g；炒飯一份≈碳水58g/脂肪12g；咖哩飯一份≈碳水70g
- 牛肉麵一碗≈碳水62g/蛋白25g；鹽酥雞一份≈碳水20g/蛋白20g/脂肪18g
- 滷味/關東煮依品項；蚵仔煎一份≈碳水30g/脂肪12g
蛋白質(碳水近0)：
- 雞蛋1顆≈蛋白7g/脂肪5g；雞胸肉150g≈蛋白35g；雞腿150g≈蛋白28g/脂肪10g
- 魚一份150g≈蛋白28g；豬里肌150g≈蛋白30g；豆腐一塊150g≈碳水3g/蛋白8g
蔬菜(每份100g)：葉菜≈碳水4g；花椰菜≈碳水5g；菇類≈碳水4-6g
水果：香蕉1根≈碳水27g；蘋果1顆≈碳水28g；芭樂1顆≈碳水16g；橘子1顆≈碳水23g；西瓜一份≈碳水14g
飲料/甜點：珍珠奶茶中杯≈碳水60g；含糖飲料一杯≈碳水42g；無糖茶/黑咖啡≈碳水0；蛋糕1片≈碳水36g
補糖：葡萄糖1包≈碳水15g；方糖1顆≈碳水5g；蜂蜜1匙≈碳水17g`;

const FOOD_JSON_SPEC = `僅回傳以下 JSON（不要其他文字、不要 markdown 圍欄、不要註解）：
{
  "items": [ { "name": "食物名", "grams": 份量克數, "carbs": 該項碳水g, "protein": 該項蛋白g, "fat": 該項脂肪g } ],
  "foods": ["食物名稱列表"],
  "carbs": 總碳水g,
  "protein": 總蛋白g,
  "fat": 總脂肪g,
  "calories": 總熱量kcal,
  "fiber": 膳食纖維g,
  "highGI": [ { "name": "食物名", "gi": GI整數, "warning": "對血糖影響與建議(30字內)" } ],
  "micros": [ { "name": "營養素(鈉/鉀/鈣/鐵/維生素C/Omega-3等)", "amount": "概略量或豐富/中等/少量", "note": "簡短說明(20字內)" } ],
  "diabetesNotes": "給糖尿病患者的整體建議(100字內)",
  "confidence": "high|medium|low"
}`;

// Parse the model's JSON reply, normalize numeric fields, and guard calories.
function finalizeNutrition(out) {
  const jsonMatch = out.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('模型回傳格式錯誤');
  const result = JSON.parse(jsonMatch[0]);
  for (const k of ['carbs', 'protein', 'fat', 'calories', 'fiber']) {
    result[k] = Math.round(Number(result[k]) || 0);
  }
  const macroCal = 4 * result.carbs + 4 * result.protein + 9 * result.fat;
  if (macroCal > 0 && (!result.calories || Math.abs(result.calories - macroCal) / macroCal > 0.25)) {
    result.calories = Math.round(macroCal);
  }
  return result;
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

// ── Food PHOTO analysis (NVIDIA vision) ───────────────────────────
// User uploads a meal photo; a vision model identifies the foods and estimates
// the same nutrition JSON shape as the text endpoint.
app.post('/api/analyze-food', async (req, res) => {
  try {
    await gateFoodEndpoint(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }
  const { imageBase64, mediaType = 'image/jpeg' } = req.body;
  if (!imageBase64) return res.status(400).json({ error: '需要圖片資料' });

  try {
    const prompt = `你是專業糖尿病營養師。請辨識這張食物照片中的所有食物並估算整餐營養。

【務必逐項計算】先辨識照片中每樣食物與其份量（公克，依餐具大小與比例判斷），再依下方錨點換算每項碳水/蛋白/脂肪後加總。

${FOOD_ANCHORS}

【一致性自檢（重要）】總熱量必須 ≈ 4×總碳水 + 4×總蛋白 + 9×總脂肪（誤差±10%）。

${FOOD_JSON_SPEC}

規則：所有數字為阿拉伯數字。GI>70 才列入 highGI，精緻/油煎澱粉(抓餅/蛋餅/白飯/饅頭/稀飯)GI偏高勿低估。照片看不清或無法判斷時 confidence 設 "low" 並在 diabetesNotes 說明。`;

    const out = (await callNvidiaVision(prompt, `data:${mediaType};base64,${imageBase64}`)).trim();
    const result = finalizeNutrition(out);
    result.source = 'ai';
    res.json(result);
  } catch (err) {
    console.error('[FoodPhotoAnalysis]', err.message);
    res.status(500).json({ error: `分析失敗：${err.message}` });
  }
});

// Gate the paid Anthropic food endpoints. Prefer a valid Supabase login
// (frontend already holds a session); fall back to the shared ACCESS_KEY header;
// stay open only when neither is configured (local dev).
async function gateFoodEndpoint(req) {
  if (supabaseAdmin) { await userFromBearer(req); return; }
  if (process.env.ACCESS_KEY) {
    if (req.get('x-access-key') !== process.env.ACCESS_KEY) {
      throw Object.assign(new Error('存取金鑰錯誤'), { status: 401 });
    }
  }
}

// ── Food TEXT analysis ───────────────────────────────────────────
// User types a free-text meal description; Claude estimates macros + key
// micronutrients. Returns the same shape as the local parser (parseMealText)
// so the existing analysis card renders unchanged, plus `fiber` and `micros`.
app.post('/api/analyze-food-text', async (req, res) => {
  try {
    await gateFoodEndpoint(req);
  } catch (e) {
    return res.status(e.status || 401).json({ error: e.message });
  }
  const { text, foods } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: '需要餐點描述文字' });

  // Hybrid mode: the frontend already matched part of the meal against the
  // curated local DB (accurate, ground-truth) and passes ONLY the foods it
  // could NOT resolve. We then estimate just that long tail. `target` describes
  // exactly what to estimate so the model stays focused and doesn't double-count.
  const focus = Array.isArray(foods) ? foods.filter(f => f && f.trim()) : [];
  const focusMode = focus.length > 0;
  const target = focusMode
    ? `這餐的部分食物已由資料庫精確計算，你只需估算以下「資料庫未收錄」的食物（其餘請完全忽略、不要列入）：\n${focus.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n（原始完整描述僅供判斷份量語境：「${text}」）`
    : `請估算整餐的營養。餐點描述：「${text}」`;

  try {
    const prompt = `你是專業糖尿病營養師。${target}

【務必逐項計算，不要直接猜總值】
1. 把要估算的食物逐項列出，標出每項份量（公克）。未指定份量時用台灣常見「一份」份量。
2. 對每一項，依「每100g 的營養」× 實際克數，算出該項碳水、蛋白、脂肪。
3. 加總得到${focusMode ? '「上述待估食物」的' : '整餐'}總碳水、總蛋白、總脂肪。

${FOOD_ANCHORS}

【一致性自檢（重要）】總熱量必須 ≈ 4×總碳水 + 4×總蛋白 + 9×總脂肪（誤差±10%）。若不符，回頭檢查各項克數是否離譜後再修正。

${FOOD_JSON_SPEC}

規則：所有數字為阿拉伯數字（不要範圍、不要文字）。${focusMode ? '上述各營養值只計「待估食物」，不要包含已由資料庫計算的部分。' : ''}GI>70 才列入 highGI，精緻/油煎澱粉(抓餅/蛋餅/白飯/饅頭/稀飯)GI偏高勿低估。完全無法判斷時 confidence 設 "low"。`;

    const out = (await callNvidiaChat(prompt)).trim();
    const result = finalizeNutrition(out);
    result.source = 'ai';
    res.json(result);
  } catch (err) {
    console.error('[FoodTextAnalysis]', err.message);
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

// Rich Menu definition — 3 columns tapping into the guided flows via postback
// (血糖由 LibreLink 自動同步，不在此記錄). The image
// (server/assets/line-richmenu.png) is registered by POST /api/line/setup-richmenu.
const RICH_MENU_DEF = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'DiaGuide Menu',
  chatBarText: '開啟記錄選單',
  areas: [
    { bounds: { x: 0,    y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=menu_insulin', displayText: '💉 記錄注射' } },
    { bounds: { x: 833,  y: 0, width: 834, height: 843 }, action: { type: 'postback', data: 'action=menu_meal',    displayText: '🍽 記錄飲食' } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: 'postback', data: 'action=menu_help',    displayText: '❓ 說明' } },
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

// Per-user guided-flow state. flow = 'insulin'|'meal'; step names the
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

// ── Flex (card) messages ──
async function lineReplyFlex(replyToken, altText, contents) {
  try {
    await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ replyToken, messages: [{ type: 'flex', altText, contents }] }),
    });
  } catch (e) {
    console.error('[LINE] flex error:', e.message);
  }
}

// Reply with several messages at once (text + flex etc., max 5).
async function lineReplyMsgs(replyToken, messages) {
  try {
    await fetch(`${LINE_API}/message/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }),
    });
  } catch (e) {
    console.error('[LINE] reply msgs error:', e.message);
  }
}

async function linePushFlex(lineUserId, altText, contents) {
  try {
    await fetch(`${LINE_API}/message/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
      body: JSON.stringify({ to: lineUserId, messages: [{ type: 'flex', altText, contents }] }),
    });
  } catch (e) {
    console.error('[LINE] push flex error:', e.message);
  }
}

// A coloured postback button row item.
function flexBtn(label, data, color, style = 'primary') {
  return { type: 'button', style, color, height: 'sm',
    action: { type: 'postback', label, data, displayText: label } };
}

// ── Time helpers (Taiwan timezone) ──
const TZ = 'Asia/Taipei';
// Format an ISO/epoch as Taipei "MM/DD HH:mm".
function fmtTime(iso) {
  return new Date(iso ?? Date.now()).toLocaleString('zh-TW', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ,
  });
}
// Current Taipei wall-clock as "yyyy-MM-ddTHH:mm" for datetimepicker initial/max.
function nowPickerStr() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  let hour = g('hour'); if (hour === '24') hour = '00'; // some engines emit 24 at midnight
  return `${g('year')}-${g('month')}-${g('day')}T${hour}:${g('minute')}`;
}
// datetimepicker value "yyyy-MM-ddTHH:mm" (Taipei wall time) → UTC ISO for storage.
function pickerToISO(s) {
  if (!s) return new Date().toISOString();
  const d = new Date(`${s}:00+08:00`);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

// ── Design tokens (match the DiaGuide app: purple accent #863bff) ──
const C_BRAND   = '#863bff'; // DiaGuide accent
const C_INSULIN = '#4a90d9'; // injection blue
const C_MEAL    = '#34b97f'; // meal green
const C_SUCCESS = '#34b97f';
const C_TEXT    = '#2b2f36';
const C_MUTED   = '#9aa0aa';
const C_SURFACE = '#f5f6f8'; // light row background

// Assemble a bubble with a coloured header band, padded body, optional footer.
function proBubble({ headerTitle, headerSub, headerColor = C_BRAND, body = [], footer = null }) {
  const headerContents = [
    { type: 'text', text: headerTitle, weight: 'bold', size: 'lg', color: '#ffffff', wrap: true },
  ];
  if (headerSub) headerContents.push({ type: 'text', text: headerSub, size: 'xs', color: '#ffffff', margin: 'sm', wrap: true });
  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', spacing: 'none', paddingAll: 'xl', contents: headerContents },
    body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: 'xl', contents: body },
    styles: { header: { backgroundColor: headerColor } },
  };
  if (footer) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'xl', paddingTop: 'md', contents: footer };
  return bubble;
}

// A tappable list row: emoji badge + title/subtitle + accent chevron.
function menuItem(emoji, title, subtitle, data, accent) {
  return {
    type: 'box', layout: 'horizontal', spacing: 'md', alignItems: 'center',
    paddingAll: 'md', cornerRadius: 'lg', backgroundColor: C_SURFACE,
    action: { type: 'postback', data, displayText: title },
    contents: [
      { type: 'box', layout: 'vertical', width: '46px', height: '46px', cornerRadius: '23px',
        backgroundColor: '#ffffff', justifyContent: 'center', flex: 0,
        contents: [{ type: 'text', text: emoji, size: 'xl', align: 'center' }] },
      { type: 'box', layout: 'vertical', spacing: 'xs', flex: 1, contents: [
        { type: 'text', text: title, weight: 'bold', size: 'md', color: C_TEXT },
        { type: 'text', text: subtitle, size: 'xs', color: C_MUTED, wrap: true },
      ]},
      { type: 'text', text: '›', size: 'xxl', color: accent, flex: 0, align: 'end', gravity: 'center' },
    ],
  };
}

// A label/value detail row used on confirmation cards.
function detailRow(label, value, color) {
  return { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
    { type: 'text', text: label, size: 'sm', color: C_MUTED, flex: 2 },
    { type: 'text', text: value, size: 'md', weight: 'bold', color: color || C_TEXT, flex: 5, align: 'end', wrap: true },
  ]};
}

const cancelBtnObj = { type: 'button', style: 'secondary', height: 'sm', color: '#eceef1',
  action: { type: 'postback', label: '✖ 取消', data: 'action=cancel', displayText: '取消' } };

// Main menu card — record actions. Blood glucose is intentionally absent
// (synced automatically from LibreLink); the footer note explains why.
function menuBubble() {
  return proBubble({
    headerTitle: 'DiaGuide 記錄',
    headerSub: '點選下方項目即可記錄，免記指令',
    body: [
      menuItem('💉', '記錄注射', '速效 ・ 短效 ・ 長效胰島素', 'action=menu_insulin', C_INSULIN),
      menuItem('🍽', '記錄飲食', '早餐 ・ 午餐 ・ 晚餐 ・ 點心', 'action=menu_meal', C_MEAL),
    ],
    footer: [
      { type: 'text', text: '🩸 血糖由 LibreLink 自動同步，無需手動輸入',
        size: 'xs', color: C_MUTED, wrap: true, align: 'center' },
    ],
  });
}

const DIAGUIDE_URL = 'https://diaguide-4r5o.onrender.com/';

// Intro / about card — DiaGuide feature overview + Email sign-up call to action.
// Shown for the 「說明」 action and as the new-friend welcome.
function introBubble() {
  const feat = (emoji, title, desc) => ({
    type: 'box', layout: 'horizontal', spacing: 'md', margin: 'md', contents: [
      { type: 'text', text: emoji, size: 'lg', flex: 0 },
      { type: 'box', layout: 'vertical', flex: 1, spacing: 'xs', contents: [
        { type: 'text', text: title, size: 'sm', weight: 'bold', color: C_TEXT },
        { type: 'text', text: desc, size: 'xs', color: C_MUTED, wrap: true },
      ]},
    ],
  });
  return proBubble({
    headerTitle: 'DiaGuide 智慧血糖管理',
    headerSub: '糖尿病的日常記錄與分析，一個 App 搞定',
    body: [
      feat('📈', '血糖追蹤', '自動同步 LibreLink 連續血糖，TIR 與趨勢一目了然'),
      feat('💉', '胰島素建議', '依血糖與飲食計算建議劑量，並記錄每次注射'),
      feat('🍽', '飲食分析', '辨識營養與升糖指數，輕鬆記錄三餐'),
      feat('🔮', '血糖預測', '預測 30 分鐘後的血糖變化，提前因應'),
      feat('💬', 'LINE 快速記錄', '用這個官方帳號直接記錄注射與飲食，免開 App'),
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: '第一步：用 Email 免費註冊', size: 'sm', weight: 'bold', color: C_BRAND, wrap: true, margin: 'lg' },
      { type: 'text', text: DIAGUIDE_URL, size: 'xs', color: C_INSULIN, wrap: true },
      { type: 'text', text: '註冊後在 App「設定」綁定本帳號，就能用 LINE 記錄了 👍', size: 'xs', color: C_MUTED, wrap: true, margin: 'sm' },
    ],
    footer: [
      { type: 'button', style: 'primary', color: C_BRAND, height: 'sm',
        action: { type: 'uri', label: '🌐 前往註冊 DiaGuide', uri: DIAGUIDE_URL } },
      { type: 'button', style: 'secondary', height: 'sm', color: '#eceef1',
        action: { type: 'postback', label: '📋 開啟記錄選單', data: 'action=menu_open', displayText: '記錄選單' } },
    ],
  });
}

// Insulin type chooser card.
function insulinTypeBubble() {
  return proBubble({
    headerTitle: '💉 記錄注射',
    headerSub: '步驟 1 / 4 ・ 選擇胰島素類型',
    headerColor: C_INSULIN,
    body: [
      menuItem('⚡', '速效', 'Rapid-acting', 'action=ins_type&type=rapid', C_INSULIN),
      menuItem('💧', '短效', 'Short-acting', 'action=ins_type&type=short', C_INSULIN),
      menuItem('🌙', '長效', 'Long-acting', 'action=ins_type&type=long', C_INSULIN),
    ],
    footer: [cancelBtnObj],
  });
}

// Meal type chooser card.
function mealTypeBubble() {
  return proBubble({
    headerTitle: '🍽 記錄飲食',
    headerSub: '步驟 1 / 3 ・ 選擇餐別',
    headerColor: C_MEAL,
    body: [
      menuItem('🌅', '早餐', 'Breakfast', 'action=meal_type&type=breakfast', C_MEAL),
      menuItem('☀️', '午餐', 'Lunch', 'action=meal_type&type=lunch', C_MEAL),
      menuItem('🌆', '晚餐', 'Dinner', 'action=meal_type&type=dinner', C_MEAL),
      menuItem('🌙', '宵夜', 'Late-night snack', 'action=meal_type&type=lateSnack', C_MEAL),
      menuItem('🍪', '點心', 'Snack', 'action=meal_type&type=snack', C_MEAL),
    ],
    footer: [cancelBtnObj],
  });
}

// Insulin context chooser — shown after picking a rapid/short type.
// Tags the dose with a meal or marks it as a correction dose.
function insulinContextBubble() {
  return proBubble({
    headerTitle: '💉 記錄注射',
    headerSub: '步驟 2 / 4 ・ 這劑是針對？',
    headerColor: C_INSULIN,
    body: [
      menuItem('🌅', '早餐', 'Breakfast', 'action=ins_ctx&meal=breakfast', C_INSULIN),
      menuItem('☀️', '午餐', 'Lunch', 'action=ins_ctx&meal=lunch', C_INSULIN),
      menuItem('🌆', '晚餐', 'Dinner', 'action=ins_ctx&meal=dinner', C_INSULIN),
      menuItem('🌙', '宵夜', 'Late-night snack', 'action=ins_ctx&meal=lateSnack', C_INSULIN),
      menuItem('🍪', '點心', 'Snack', 'action=ins_ctx&meal=snack', C_INSULIN),
      menuItem('🎯', '校正劑量', 'Correction dose', 'action=ins_ctx&meal=correction', C_INSULIN),
    ],
    footer: [cancelBtnObj],
  });
}

// Long-acting timing chooser — basal insulin isn't tied to a meal.
function longTimingBubble() {
  return proBubble({
    headerTitle: '💉 記錄注射',
    headerSub: '步驟 2 / 4 ・ 注射時機',
    headerColor: C_INSULIN,
    body: [
      menuItem('🛏', '睡前', 'Bedtime', 'action=ins_ctx&meal=bedtime', C_INSULIN),
      menuItem('🌄', '早晨', 'Morning', 'action=ins_ctx&meal=morning', C_INSULIN),
      menuItem('🕒', '其他', 'Other', 'action=ins_ctx&meal=other', C_INSULIN),
    ],
    footer: [cancelBtnObj],
  });
}

// Time chooser — shown right before saving. Defaults to "now"; a datetimepicker
// lets the user pick the actual time. saveData/timeData are the postback actions.
function timeChooserBubble(summary, saveData, timeData, accent = C_BRAND, stepLabel = '步驟 3 / 3 ・ 確認時間') {
  const now = nowPickerStr();
  return proBubble({
    headerTitle: '確認記錄',
    headerSub: stepLabel,
    headerColor: accent,
    body: [
      { type: 'box', layout: 'vertical', paddingAll: 'md', cornerRadius: 'lg', backgroundColor: C_SURFACE, contents: [
        { type: 'text', text: summary, weight: 'bold', size: 'md', color: C_TEXT, wrap: true },
      ]},
      { type: 'box', layout: 'baseline', spacing: 'sm', margin: 'md', contents: [
        { type: 'text', text: '⏰ 時間', size: 'sm', color: C_MUTED, flex: 2 },
        { type: 'text', text: `現在 ${fmtTime()}`, size: 'sm', color: accent, weight: 'bold', flex: 5, align: 'end' },
      ]},
      { type: 'text', text: '預設為現在，可改成實際發生的時間', size: 'xs', color: C_MUTED, wrap: true, margin: 'sm' },
    ],
    footer: [
      { type: 'button', style: 'primary', color: accent, height: 'sm',
        action: { type: 'postback', label: '✅ 確認（用現在時間）', data: saveData, displayText: '確認記錄' } },
      { type: 'button', style: 'secondary', height: 'sm', color: '#eceef1',
        action: { type: 'datetimepicker', label: '⏰ 改其他時間', data: timeData, mode: 'datetime', initial: now, max: now } },
      cancelBtnObj,
    ],
  });
}

// A "繼續記錄" footer button that reopens the menu — appended to confirmations.
function continueFooter() {
  return [
    { type: 'button', style: 'secondary', height: 'sm', color: '#eceef1',
      action: { type: 'postback', label: '➕ 繼續記錄', data: 'action=menu_open', displayText: '繼續記錄' } },
  ];
}

function insulinConfirmBubble(type, units, ts, mealType) {
  const body = [
    { type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'md', paddingAll: 'md',
      cornerRadius: 'lg', backgroundColor: C_SURFACE, contents: [
      { type: 'box', layout: 'vertical', width: '46px', height: '46px', cornerRadius: '23px',
        backgroundColor: '#ffffff', justifyContent: 'center', flex: 0,
        contents: [{ type: 'text', text: '💉', size: 'xl', align: 'center' }] },
      { type: 'box', layout: 'baseline', flex: 1, spacing: 'sm', contents: [
        { type: 'text', text: INSULIN_LABEL[type] || '', size: 'md', weight: 'bold', color: C_INSULIN, flex: 0 },
        { type: 'text', text: `${units} U`, size: 'xxl', weight: 'bold', color: C_INSULIN, align: 'end' },
      ]},
    ]},
  ];
  if (mealType) body.push(detailRow('用途', INSULIN_CTX_LABEL[mealType] || mealType, C_INSULIN));
  return proBubble({
    headerTitle: '✅ 已記錄注射',
    headerSub: fmtTime(ts),
    headerColor: C_SUCCESS,
    body,
    footer: continueFooter(),
  });
}

function mealConfirmBubble(type, foods, ts) {
  return proBubble({
    headerTitle: `✅ 已記錄${MEAL_LABEL[type] || '飲食'}`,
    headerSub: fmtTime(ts),
    headerColor: C_SUCCESS,
    body: [
      { type: 'box', layout: 'vertical', paddingAll: 'md', cornerRadius: 'lg', backgroundColor: C_SURFACE, contents: [
        { type: 'text', text: `🍽 ${foods}`, size: 'md', color: C_TEXT, wrap: true },
      ]},
      { type: 'text', text: '💡 開啟 DiaGuide 可查看完整營養分析', size: 'xs', color: C_MUTED, wrap: true, margin: 'md' },
    ],
    footer: continueFooter(),
  });
}

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

// Meal: "早餐 白飯一碗 雞蛋兩顆"
function parseMealMsg(text) {
  const MEAL_MAP = { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner', 點心: 'snack', 宵夜: 'lateSnack', 零食: 'snack' };
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
const MEAL_LABEL = { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜', snack: '點心' };
// Context tagged onto an insulin dose (matches the app's mealType field).
// rapid/short → a meal or a correction dose; long → injection timing.
const INSULIN_CTX_LABEL = {
  breakfast: '早餐', lunch: '午餐', dinner: '晚餐', lateSnack: '宵夜', snack: '點心',
  correction: '校正劑量', bedtime: '睡前', morning: '早晨', other: '其他',
};

// ── Record helpers — used by BOTH direct text commands AND the guided flow.
// `ts` (ISO string) defaults to now; the guided flow passes a user-picked time.
async function recordInsulin(userRow, insulinType, units, ts, mealType) {
  const timestamp = ts || new Date().toISOString();
  const { user_id, data } = userRow;
  const logs = Array.isArray(data.insulinLogs) ? data.insulinLogs : [];
  // The app reads `brandType` for the insulin type and `mealType` for the
  // meal/correction context; keep `insulinType` too for backward compat.
  const entry = {
    insulinType, brandType: insulinType, brand: INSULIN_LABEL[insulinType] || '',
    units, timestamp, source: 'line', id: `line-${Date.now()}`,
  };
  if (mealType) entry.mealType = mealType;
  logs.push(entry);
  await updateUserData(user_id, d => ({ ...d, insulinLogs: logs }));
}

async function recordMeal(userRow, mealType, foods, ts) {
  const timestamp = ts || new Date().toISOString();
  const { user_id, data } = userRow;
  const meals = Array.isArray(data.meals) ? data.meals : [];
  meals.push({ mealType, foods, timestamp, source: 'line', carbs: 0, confidence: 'undetermined', id: `line-${Date.now()}` });
  await updateUserData(user_id, d => ({ ...d, meals }));
}

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

    // ── 加入好友：先介紹 DiaGuide，再引導用 Email 註冊 ──
    if (event.type === 'follow') {
      await lineReplyMsgs(replyToken, [
        { type: 'text', text: '歡迎加入 DiaGuide 👋\n我是你的血糖管理小幫手，先帶你認識一下：' },
        { type: 'flex', altText: 'DiaGuide 功能介紹與註冊', contents: introBubble() },
      ]);
      continue;
    }

    // Normalize input: postback (button tap) carries `data` (+ params for the
    // datetimepicker); text carries words.
    let postbackData = null, text = null, pbParams = {};
    if (event.type === 'postback') { postbackData = event.postback?.data || ''; pbParams = event.postback?.params || {}; }
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
      await lineReplyFlex(replyToken, '已取消，要記錄什麼？', menuBubble());
      continue;
    }

    // ── 說明：DiaGuide 功能介紹 + Email 註冊引導 ──
    if (text === '說明' || text === 'help' || text === '?' || text === '介紹' || action === 'menu_help') {
      await lineReplyFlex(replyToken, 'DiaGuide 功能介紹與註冊', introBubble());
      continue;
    }

    // ── 開啟記錄選單 ──
    if (text === '選單' || text === 'menu' || action === 'menu_open') {
      await lineReplyFlex(replyToken, 'DiaGuide 記錄選單', menuBubble());
      continue;
    }

    // ── 需要綁定才能記錄 ──
    const userRow = await findUserByLineId(lineUserId);
    if (!userRow) {
      clearConv(lineUserId);
      await lineReply(replyToken, '請先傳「綁定」來連結你的 DiaGuide 帳號 🔗');
      continue;
    }

    // ── 選單入口：開始一段引導流程（血糖由 LibreLink 同步，不在此記錄）──
    if (action === 'menu_insulin') {
      setConv(lineUserId, { flow: 'insulin', step: 'type' });
      await lineReplyFlex(replyToken, '請選擇胰島素類型', insulinTypeBubble());
      continue;
    }
    if (action === 'menu_meal') {
      setConv(lineUserId, { flow: 'meal', step: 'type' });
      await lineReplyFlex(replyToken, '請選擇餐別', mealTypeBubble());
      continue;
    }

    // ── 注射：選完類型 → 選用途（餐別 / 校正 / 長效時機）──
    if (action === 'ins_type' && pbType) {
      setConv(lineUserId, { flow: 'insulin', step: 'context', data: { type: pbType } });
      const bubble = pbType === 'long' ? longTimingBubble() : insulinContextBubble();
      await lineReplyFlex(replyToken, '請選擇用途', bubble);
      continue;
    }
    // ── 注射：選完用途 → 請使用者輸入單位數 ──
    if (action === 'ins_ctx') {
      const conv = getConv(lineUserId);
      if (!conv || conv.flow !== 'insulin') { await lineReplyFlex(replyToken, '流程已逾時，請重新開始', menuBubble()); continue; }
      const meal = new URLSearchParams(postbackData).get('meal');
      setConv(lineUserId, { flow: 'insulin', step: 'units', data: { ...conv.data, mealType: meal } });
      await lineReplyQuick(replyToken,
        `💉 ${INSULIN_LABEL[conv.data.type] || ''}・${INSULIN_CTX_LABEL[meal] || ''}\n請輸入單位數（例如 8 或 7.5）`, [CANCEL_BTN]);
      continue;
    }
    // ── 飲食：選完餐別 → 請使用者輸入內容 ──
    if (action === 'meal_type' && pbType) {
      setConv(lineUserId, { flow: 'meal', step: 'foods', data: { type: pbType } });
      await lineReplyQuick(replyToken, `${MEAL_LABEL[pbType] || ''}\n請輸入吃了什麼\n例如：白飯一碗 雞蛋兩顆`, [CANCEL_BTN]);
      continue;
    }

    // ── 確認時間：用「現在」存檔 ──
    if (action === 'ins_save' || action === 'meal_save') {
      const conv = getConv(lineUserId);
      if (!conv || conv.step !== 'time') { await lineReplyFlex(replyToken, '流程已逾時，請重新開始', menuBubble()); continue; }
      clearConv(lineUserId);
      const ts = new Date().toISOString();
      if (action === 'ins_save') {
        await recordInsulin(userRow, conv.data.type, conv.data.units, ts, conv.data.mealType);
        await lineReplyFlex(replyToken, '已記錄注射', insulinConfirmBubble(conv.data.type, conv.data.units, ts, conv.data.mealType));
      } else {
        await recordMeal(userRow, conv.data.type, conv.data.foods, ts);
        await lineReplyFlex(replyToken, '已記錄飲食', mealConfirmBubble(conv.data.type, conv.data.foods, ts));
      }
      continue;
    }
    // ── 確認時間：使用者用 datetimepicker 選了其他時間 ──
    if (action === 'ins_time' || action === 'meal_time') {
      const conv = getConv(lineUserId);
      if (!conv || conv.step !== 'time') { await lineReplyFlex(replyToken, '流程已逾時，請重新開始', menuBubble()); continue; }
      clearConv(lineUserId);
      const ts = pickerToISO(pbParams.datetime);
      if (action === 'ins_time') {
        await recordInsulin(userRow, conv.data.type, conv.data.units, ts, conv.data.mealType);
        await lineReplyFlex(replyToken, '已記錄注射', insulinConfirmBubble(conv.data.type, conv.data.units, ts, conv.data.mealType));
      } else {
        await recordMeal(userRow, conv.data.type, conv.data.foods, ts);
        await lineReplyFlex(replyToken, '已記錄飲食', mealConfirmBubble(conv.data.type, conv.data.foods, ts));
      }
      continue;
    }

    // ── 文字輸入 ──
    if (text != null) {
      const conv = getConv(lineUserId);

      // 流程中：填入正在等待的欄位，填完進入「選時間」步驟
      if (conv) {
        if (conv.flow === 'insulin' && conv.step === 'units') {
          const v = parseFloat(text.replace(/[^\d.]/g, ''));
          if (isNaN(v) || v <= 0) { await lineReplyQuick(replyToken, '請輸入單位數，例如 8', [CANCEL_BTN]); continue; }
          setConv(lineUserId, { flow: 'insulin', step: 'time', data: { type: conv.data.type, units: v, mealType: conv.data.mealType } });
          const ctx = conv.data.mealType ? `・${INSULIN_CTX_LABEL[conv.data.mealType] || ''}` : '';
          await lineReplyFlex(replyToken, '選擇時間',
            timeChooserBubble(`💉 ${INSULIN_LABEL[conv.data.type]}${ctx} ${v} U`, 'action=ins_save', 'action=ins_time', C_INSULIN, '步驟 4 / 4 ・ 確認時間'));
          continue;
        }
        if (conv.flow === 'meal' && conv.step === 'foods') {
          const foods = text.trim();
          setConv(lineUserId, { flow: 'meal', step: 'time', data: { type: conv.data.type, foods } });
          await lineReplyFlex(replyToken, '選擇時間',
            timeChooserBubble(`🍽 ${MEAL_LABEL[conv.data.type]}：${foods}`, 'action=meal_save', 'action=meal_time', C_MEAL));
          continue;
        }
        // step === 'time' 但使用者打字而非用按鈕 → 提醒用卡片按鈕
        if (conv.step === 'time') {
          await lineReply(replyToken, '請點上方卡片的「✅ 確認」或「⏰ 改其他時間」完成記錄。');
          continue;
        }
      }

      // 無進行中流程：仍支援老手直接打指令（用現在時間）
      const insulin = parseInsulinMsg(text);
      if (insulin) { const ts = new Date().toISOString(); await recordInsulin(userRow, insulin.insulinType, insulin.units, ts); await lineReplyFlex(replyToken, '已記錄注射', insulinConfirmBubble(insulin.insulinType, insulin.units, ts)); continue; }
      const meal = parseMealMsg(text);
      if (meal) { const ts = new Date().toISOString(); await recordMeal(userRow, meal.mealType, meal.foods, ts); await lineReplyFlex(replyToken, '已記錄飲食', mealConfirmBubble(meal.mealType, meal.foods, ts)); continue; }

      // 看不懂 → 顯示選單卡片
      await lineReplyFlex(replyToken, 'DiaGuide 記錄選單', menuBubble());
      continue;
    }

    // 其他未知 postback
    await lineReplyFlex(replyToken, 'DiaGuide 記錄選單', menuBubble());
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

    // 通知 LINE 綁定成功 — 推送歡迎訊息 + 記錄選單卡片
    await linePush(entry.lineUserId,
      '🎉 綁定成功！\n\n現在可以用 LINE 直接記錄注射和飲食，不需要開 App。\n（血糖由 LibreLink 自動同步）\n點下方選單或卡片按鈕即可開始 👇'
    );
    await linePushFlex(entry.lineUserId, 'DiaGuide 記錄選單', menuBubble());
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
// Core registration: delete existing menus, create from RICH_MENU_DEF, upload
// the image, set as default. Used by the endpoint AND the boot hook so a deploy
// that changes the layout/image takes effect without a manual trigger.
async function applyRichMenu() {
  if (!LINE_CHANNEL_ACCESS_TOKEN) throw new Error('LINE_CHANNEL_ACCESS_TOKEN 未設定');
  const auth = { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` };

  // 1) Remove any existing rich menus (avoid accumulation / stale layouts)
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
  return richMenuId;
}

app.all('/api/line/setup-richmenu', async (req, res) => {
  const configured = (process.env.CRON_SECRET || '').trim();
  const secret = (req.get('x-cron-secret') || req.query.key || '').trim();
  if (!configured) return res.status(503).json({ error: 'CRON_SECRET 未設定（Render 環境變數）' });
  if (secret !== configured) return res.status(401).json({ error: 'key 不符' });
  if (!LINE_CHANNEL_ACCESS_TOKEN) return res.status(503).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN 未設定' });

  try {
    const richMenuId = await applyRichMenu();
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
  // Re-register the Rich Menu on boot so layout/image changes ship with a
  // deploy (no manual setup-richmenu call needed). Best-effort; set
  // AUTO_RICHMENU=off to skip. The manual endpoint remains available.
  if (LINE_CHANNEL_ACCESS_TOKEN && (process.env.AUTO_RICHMENU || 'on').toLowerCase() !== 'off') {
    applyRichMenu().catch(e => console.error('[LINE] 開機自動註冊 Rich Menu 失敗:', e.message));
  }
});
