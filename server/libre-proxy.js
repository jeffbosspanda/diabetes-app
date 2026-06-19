// LibreLinkUp proxy — custom HTTP client + food vision analysis
// Start: node server/libre-proxy.js
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' })); // large for base64 images

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
    console.warn(`[LibreProxy] 429 rate-limited, 等 ${waitMs / 1000}s 後重試 ${url}`);
    await sleep(waitMs);
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
    value: r.Value,
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

  const current = connection?.glucoseMeasurement ? mapReading(connection.glucoseMeasurement) : null;
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

app.post('/api/libre/sync', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '需要帳號密碼' });

  try {
    const session = await getSession(username, password);
    const { current, history } = await libre_read(session);

    const readings = [current, ...history].filter(Boolean);
    res.json({ readings, count: readings.length });
  } catch (err) {
    console.error('[LibreProxy] ERROR:', err.message);
    // Invalidate cached session on error
    sessions.delete(`${username}::${password}`);
    const status = err.message.includes('帳號或密碼') ? 401 : 502;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/libre/health', (_req, res) => res.json({ ok: true, version: CLIENT_VERSION }));

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

// ── Serve built frontend (production) ────────────────────────────
// In production Render runs `npm run build` then this server hosts dist/.
// In local dev, Vite serves the frontend and proxies /api here, so dist/
// may not exist — guard with existsSync.
import { existsSync } from 'node:fs';
const distDir = path.join(__dirname, '..', 'dist');
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: any non-/api GET returns index.html for client routing
  app.get(/^(?!\/api).*/, (_req, res) => {
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
