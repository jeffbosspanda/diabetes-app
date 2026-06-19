# DiaGuide 進度存檔

存檔時間：2026-06-19

## 本輪任務：上線到雲端 + 多人帳號 + 自動同步

把 DiaGuide 從「本機 localStorage 單機 App」變成「別人手機可用、可雲端持久、每人各自帳號、後端自動同步血糖」的線上系統。

部署網址：https://diaguide-4r5o.onrender.com
GitHub：https://github.com/jeffbosspanda/diabetes-app（branch main）
Supabase 專案：submadhgvbiblcurnktt（https://submadhgvbiblcurnktt.supabase.co）

## 架構

- **單一 Node 服務**：Express（`server/libre-proxy.js`）同時供前端靜態檔（`dist/`）+ `/api/*`，部署在 Render free。
- **前端**：Vite/React SPA，`/api/...` 同源呼叫後端。
- **登入 + 雲端儲存**：Supabase Auth（email 註冊/登入/重設）+ Postgres 表 `app_state`（每人一列 JSONB，RLS 保護）。
- **血糖來源**：LibreLinkUp（follower 帳密）經後端 proxy 抓取。
- **自動同步**：後端排程（`/api/cron/sync-all`）+ 外部 cron-job.org 每 6h 觸發。

## 已修改 / 新增檔案

### 部署
- `server/libre-proxy.js`：供 `dist/` 靜態檔 + SPA fallback；用 `process.env.PORT`；`/api/analyze-food` 加 `ACCESS_KEY` 守門。
- `package.json`：加 `start` script、`engines.node>=20`。
- `render.yaml`（新）：Blueprint，列出所有環境變數。

### 登入 + 雲端
- `src/lib/supabase.js`（新）：建 client；**正規化 URL**（去尾斜線 + 去誤貼的 `/rest/v1`、`/auth/v1` 等子路徑）。
- `src/store/AuthContext.jsx`（新）：session 管理（signUp/signIn/signOut/resetPassword）。
- `src/components/Auth.jsx`（新）：登入/註冊/忘記密碼畫面，Supabase 錯誤中文化。
- `src/store/AppContext.jsx`：改成綁登入用戶讀寫雲端 `app_state`；首次登入把 localStorage 遷移上雲；debounce 800ms 存雲端 + localStorage 快取。
- `src/App.jsx`：`AuthProvider` 包裹 + `Gate` 登入閘；header 加登出鈕。
- `src/App.css`：auth 畫面樣式。
- `supabase-setup.sql`（新）：建 `app_state` 表 + RLS policies（select/insert/update own row）。

### 血糖時間戳修正
- `server/libre-proxy.js`：`parseLibreUTC()` 以 UTC 明確解析 LibreLink 的 `FactoryTimestamp`（UTC），取代 `new Date(Timestamp)`（會被伺服器時區誤判）。

### LibreView 限流處理
- `server/libre-proxy.js`：`libreFetch()` 遇 429 退避重試一次（上限 6 秒）；快取 patientId 省 `/connections` 呼叫；**每帳號讀取快取**（60s 內不重打）+ **限流/錯誤時回傳上一筆好資料**（最長 30 分鐘）。

### 資料遺失 bug 修正
- `src/store/AppContext.jsx`：`LOAD_STATE` 改回 `{...state, ...payload}`（合併），先前誤改成 `{...initialState, ...payload}` 導致「清除血糖」連帶清掉飲食/注射。

### 伺服器排程同步（90 天累積）
- `server/libre-proxy.js`：
  - `supabaseAdmin`（service_role，繞 RLS）。
  - `mergeGlucose()`：合併去重 + 裁掉 `RETAIN_DAYS=90` 天前。
  - `syncOneUser()` / `syncAllUsers()`：跑遍所有 `app_state`，取各人 `settings.libreCredentials` 同步、合併、寫回；用戶間隔 3 秒。
  - `POST/GET /api/cron/sync-all`：`CRON_SECRET` 守門（header `x-cron-secret` 或 `?key=`）；區分「未設定」vs「key 不符」。
  - 內建 6h `setInterval`（best-effort；免費版會休眠，靠外部 cron 才可靠）。
- `render.yaml`：加 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`CRON_SECRET`。

### 註冊畫面確認密碼
- `src/components/Auth.jsx`：register 模式加「再次輸入密碼」欄位；送出前比對不一致則擋下並提示「兩次輸入的密碼不一致」；切換模式清空。

### 意見回饋
- `src/components/Settings.jsx`：加「意見回饋」卡片，`mailto:wuborjenn@gmail.com`（主旨/內文預填）+ 明列來信信箱。

### 手機推播（Web Push — 高低血糖警報）
全套 Web Push 管線，App 關著也收得到（iOS 需加主畫面 PWA + 16.4+；Android Chrome 直接可）。
- `public/sw.js`（新）：service worker，`push`→showNotification、`notificationclick`→聚焦/開 App。
- `public/manifest.webmanifest`（新）：PWA manifest（standalone）。
- `index.html`：加 manifest link + apple-touch-icon + apple-mobile-web-app-* meta。
- `src/main.jsx`：load 時註冊 `/sw.js`。
- `src/lib/push.js`（新）：`enablePush/disablePush/pushSubscribed/pushSupported/isIOS/isStandalone`；訂閱帶 Supabase access token 上傳。
- `server/libre-proxy.js`：
  - `web-push` + VAPID 初始化（`PUSH_ENABLED` 視 env 而定）。
  - `GET /api/push/vapid-public-key`、`POST /api/push/subscribe`、`/unsubscribe`、`/test`（Bearer token → `supabaseAdmin.auth.getUser` 驗證 → 存入 `app_state.data.pushSubscriptions[]`）。
  - `evalGlucoseAlert()`：latest <70=low / >180=high，cooldown 1h，回正常清狀態。
  - `sendPushToUser()`：發給所有訂閱，404/410 自動移除失效訂閱。
  - 整合進 `syncOneUser()`：每次排程同步檢查最新血糖，超標推播 + 寫回 `lastGlucoseAlert`；cron summary 加 `pushed`。
- `package.json`：加 `web-push@^3.6.7`。
- `render.yaml`：加 `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`。

**已產生的 VAPID 金鑰（填到 Render env，私鑰機密）：**
- `VAPID_PUBLIC_KEY=BE4Qmgp_YA-oKlVZy9mBA1LBrViw_ZhftBFP8_T7XmZx2oaHvr02natb0JVCkCwObQdKD6vy8861lEH8rfZPPnA`
- `VAPID_PRIVATE_KEY=JTegyOtbQfq1O9rJ8IJ6D6gTp1SHN9EIx3JWbyfuMtg`
- `VAPID_SUBJECT=mailto:wuborjenn@gmail.com`

### UI 調整批次（4 項）
- `src/App.css`：`.timeline-header` 加 `flex-wrap`、`.timeline-legend` 換行 → 圖例不壓標題；`.ev-chip-tri span` 白底 + `.ev-chip-circle` 白邊 → 標記密集不重疊。
- `src/components/Settings.jsx`：`withNone()` 在速效/短效/長效品牌選單各加「無／不使用此類」。
- `src/components/Profile.jsx`：年齡欄改「出生年月日」date 欄，`computeAge()` 自動算齡並同步 `form.age`（下游 dietaryAdvisor/reportGenerator/checkDataSufficiency 讀 age 不動）；舊資料只有 age 仍相容。
- `src/components/GlucoseLog.jsx`：急速升降 / 血糖事件原因分析各預設只列 3 筆（`PREVIEW_N`），>3 筆顯示「顯示更多／收合」按鈕。

## Render 環境變數（在 Dashboard 設，勿進版控）

- `ANTHROPIC_API_KEY`（食物辨識，前端尚未接，可留空）
- `ACCESS_KEY`（食物端點守門）
- `VITE_SUPABASE_URL` = https://submadhgvbiblcurnktt.supabase.co（**build 時**注入前端）
- `VITE_SUPABASE_ANON_KEY` = anon/publishable key（可公開）
- `SUPABASE_URL` = 同上（**後端執行時**讀，與 VITE_ 那個是不同變數，兩個都要）
- `SUPABASE_SERVICE_ROLE_KEY` = service_role 金鑰（機密！繞 RLS）
- `CRON_SECRET` = `3Qeeq9GHC2iPn41ZgWDUkHc7gnkNv7Vd`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`（手機推播；見上方已產生的金鑰）

本機 `.env` 另有 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`（已 gitignore）供 `npm run dev` 用。

## 測試指令與結果

- `npm run build` → 通過（僅既有 chunk >500kB 警告）。
- 線上驗證（curl）：health 200；`/api/cron/sync-all`（帶 key）→ `{"users":1,"synced":1,"added":0,"errors":[]}`（added:0 因前端剛同步過，無新資料，正常）。
- 時間戳：診斷實測 `FactoryTimestamp 9:06AM(UTC)` → `parsedISO 09:06Z` → 台灣瀏覽器顯示「下午5:06」✓，與手機 LibreLink 一致。
- 一次同步實測：45 筆 / 跨 11.3 小時（證實 LibreLinkUp graph 只回 ~12h）。

## 待辦 / 待確認

- 使用者需在 cron-job.org 建好每 6h 排程打 `/api/cron/sync-all?key=...`（外部觸發，喚醒 + 觸發）。**待使用者確認 History 顯示 HTTP 200。**
- 食物辨識前端 UI 尚未接（後端 `/api/analyze-food` 已就緒，需傳 `x-access-key` header）。

## 踩坑點

- **嚴禁修改血糖資料**：只能經 LibreLink sync 進來；勿注入/編輯。清除後重新同步是合法修正（資料源頭不動）。
- **LibreLinkUp graph 只回 ~12 小時**，無 90 天端點。90 天靠「持續累積」：後端排程每 6h 同步、12h 視窗重疊、不裁切（除 90 天前）→ 自然累積。前端觸發不可靠（App 沒開就斷），故需後端排程。
- **時區**：LibreLink `Timestamp` 是帳號當地時間字串（無時區）；`FactoryTimestamp` 是 UTC。務必用 `FactoryTimestamp` 並以 `Date.UTC` 解析，否則 Render（UTC）會整批偏 +8h。
- **VITE_ 變數 build 時注入**：改了要重建才生效；`SUPABASE_URL`（runtime）與 `VITE_SUPABASE_URL`（build）是兩個不同變數。
- **Supabase URL 別貼成 `.../rest/v1`**：會造成 `invalid path specified in request URL`。`src/lib/supabase.js` 已自動清子路徑防呆。
- **service_role 金鑰機密**：只放後端 env，繞過 RLS，絕不外洩、絕不進前端 bundle。
- **Render free 會休眠**（閒置 15 分），首次喚醒慢 ~30s；in-process timer 不可靠，靠外部 cron。
- **`LOAD_STATE` 必須是合併語意**（`{...state, ...payload}`），Settings 的「清除單項」依賴它做局部清除；改成重置會清掉其他資料（已踩過，造成飲食/注射遺失）。
- **資料遺失教訓**：目前無完整備份機制（使用者選擇不加）。誤清後雲端 + 本機都會被空狀態覆蓋，手動紀錄不可救。
- **此專案現在是 git repo**（main → GitHub jeffbosspanda/diabetes-app）；`git push` 觸發 Render 自動重部署 = 更新方式。
