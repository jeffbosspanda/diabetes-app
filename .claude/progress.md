# DiaGuide 進度存檔

存檔時間：2026-06-20

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

### 新手教學 onboarding
- `src/components/Onboarding.jsx`（新）：首次登入引導（6 步：歡迎→基本資料→LibreLink→記錄→劑量→區塊總覽），每步有「跳過教學，直接使用」，動作步可直接跳對應頁。
- 觸發條件：`loaded && !settings.onboardingCompleted && 無 profile/血糖/飲食/注射`（既有用戶不顯示）。完成/跳過 → `UPDATE_SETTINGS {onboardingCompleted:true}` 持久化雲端。
- `src/App.jsx`：Layout 內掛 `<Onboarding/>`（在 router + AppProvider 內）。
- `src/App.css`：`.onboard-*` 樣式。

### 參數回歸修正準確化（考量飲食、胰島素）
- `src/utils/insulinCalculator.js` `adaptICRandISF()` 重寫：用碳水計數反推每餐 ICR `ICR=carbs/(dose+(postBG−preBG)/ISF)`，取中位數，阻尼 50% + 單次變動上限 ±20%。
  - 排除混淆對：餐後窗內有疊加速效/短效注射（IOB）、窗內第二餐（額外碳水）、高脂(≥20g)/高蛋白(≥25g)延遲消化餐、低碳水(<15g)、離群 ICR。回傳 `n`（乾淨樣本數）。
- `proposeICRCorrection()`：要求 `n>=3` 才建議；reason 顯示樣本餐數。

### 設定 Q&A
- `src/components/Settings.jsx`：加「常見問題 Q&A」卡片（7 題 `<details>` 摺疊：血糖來源/LibreLinkUp/劑量準確度/ICR-ISF/推播/出生日/資料安全）。
- `src/App.css`：`.qa-*` 樣式。

### 多帳號資料隔離 bug 修正（重要）
症狀：同一瀏覽器註冊新帳號，卻看到舊帳號資料。
根因（**非 DB／RLS**，純前端 `src/store/AppContext.jsx`）：
1. localStorage 是整台瀏覽器共用，舊的 `LOAD` 用未命名 key `diabetesApp` 存舊帳號資料；新帳號（雲端無 row）登入時「遷移」這份本機資料上傳到新帳號 → 汙染。
2. 切帳號時若新帳號無雲端資料，從不 dispatch `LOAD_STATE`，reducer 仍留舊帳號 state。
修法：
- reducer 加 `RESET_STATE` → 回 `initialState`。
- cache key 依 user 命名：`cacheKeyFor(user)` = `diabetesApp::<user.id>`（未登入才用 legacy key）。
- `load()`：先 `RESET_STATE`；雲端為來源；無雲端時只還原**本帳號 namespaced cache**，**移除跨帳號遷移 legacy key**。
- save 寫入 `cacheKeyFor(user)`。
踩坑：**已被汙染的測試帳號雲端 row 仍有舊資料**，需登入該測試帳號後「設定→清除全部資料」或於 Supabase 刪該 row／帳號。原帳號雲端資料安全。RLS 本就以 user_id 隔離，無需改 schema。

### 登出二次確認
- `src/App.jsx`：登出鈕改先彈 `ConfirmDialog`（帶帳號 email），確認才 signOut。

### 新手教學改版（不中斷 + 設定入口）
- `src/components/Onboarding.jsx` 重寫：7 步（歡迎→基本資料→LibreLink→飲食→血糖→劑量→總覽）。
  - **不中斷**：動作步按「前往◯◯」→ 導頁 + 縮小成浮動「繼續教學（n/總）」pill（不結束教學），操作完點 pill 回到下一步。
  - 進度持久化於 `settings.onboardingStep`；完成/跳過設 `onboardingCompleted:true`。
  - 顯示條件：`onboardingCompleted!==true && (新用戶空資料 || onboardingCompleted===false)`。`===false` 為設定頁手動重啟旗標（既有用戶 undefined 不會自動跳）。
- `src/components/Settings.jsx`：加「新手教學」卡片，按鈕設 `{onboardingCompleted:false, onboardingStep:0}` 重啟（overlay 立即覆蓋當前頁）。
- `src/App.css`：`.onboard-pill` 浮動鈕樣式。

### 首頁事件標記防重疊（第二次）
- `src/components/Dashboard.jsx` `EventMarkerStrip`：加多車道貪婪堆疊（`MIN_GAP_PCT=8`、`MAX_LANES=3`），時間相近的餐點/胰島素標記垂直分層，strip 高度隨車道數成長。

### 女性生理期追蹤 + 生病用藥衛教
- `src/utils/cyclePhase.js`（新）：依上次經期日 + 週期長度推算階段（月經/濾泡/排卵/黃體）與血糖趨勢提示（黃體經前胰島素阻抗↑血糖偏高；月經期易低）。不自動改劑量。
- `src/components/Profile.jsx`：性別=女時顯示「🌸 生理期追蹤」（上次經期開始日 + 平均週期天數，存 `profile.lastPeriodStart/cycleLength`）。
- `src/components/Dashboard.jsx`：女性且有經期資料時顯示週期階段卡（階段/週期第幾天/血糖趨勢/距下次經期），點擊回 Profile。
- `src/components/Reminders.jsx`：加「🤒 生病時的血糖管理（Sick-day）」衛教卡（不停基礎胰島素、勤量、酮體、補水、用藥注意 + 就醫時機）。
- `src/App.css`：`.cycle-*`、`.sickday-*` 樣式。

### 食物升糖型態自動分類 + 預測/分析採用
- `src/utils/glycemicResponse.js`（新）：`classifyGlycemicResponse({carbs,protein,fat,highGICount})` / `classifyMeal(meal)` → 四型：
  - fast 快速升糖（高GI）peak~45 / abs90 / lag0
  - delayed 緩慢升糖（低GI 複合）abs180 / lag10
  - fatProtein 高脂高蛋白·延遲升糖（fat≥20 或 protein≥25）peak~180 / abs300 / lag30
  - minimal 低升糖（carbs<10）
- `src/utils/bgPredictor.js`：碳水吸收改三角前傾曲線 + 依型態的 `absMin`/`lagMin`（高脂高蛋白延後起效、拉長吸收）；`activeMeals` 回傳 `glycemic`/`glycemicType`。
- UI 標示：`MealLog`（分析卡 glycemic-box + 紀錄列 tag）、`InsulinAdvisor`（食物分析卡）、`Dashboard`（預測 activeMeals chip 附型態）。
- `src/App.css`：`.glycemic-*`、`.tag-glycemic`。

### 血糖預測改顯示分級（不顯示精確數值）
- `src/utils/bgPredictor.js`：加 `bgCategory(v)` → 低血糖(<70)/正常偏低(<90)/正常(≤140)/正常偏高(≤180)/高血糖；回傳 `predictedCategory`；警語改用趨勢/分級用語，不再寫精確 mg/dL。
- `src/components/Dashboard.jsx`：30 分預測顯示分級文字（`bgp-predict-cat`）取代數字；因素拆解改定性 `influence()`（影響小／↑↓中等／明顯），移除精確 mg/dL。
- `src/App.css`：`.bgp-predict-cat`。
- 理由：點預測本質不精確，改用區間分級避免假精確。`predicted` 數值仍內部保留供警語門檻判斷。

### 逐項食物升糖分類（每筆飲食紀錄）
- `src/utils/foodParser.js` `parseMealFoods()`：每項食物加回 `gi`。
- `src/utils/glycemicResponse.js`：加 `classifyFood(food)`（單品，gi≥70 視為高GI）。
- `src/components/MealLog.jsx`：每筆飲食紀錄列出**逐項食物**的升糖型態（白飯快速／雞腿高脂高蛋白延遲／青菜低升糖…）；新增分析卡同時顯示「整餐」+「逐項」。
- `src/App.css`：`.food-glycemic-list`、`.fg-*`。
- 註：靠本機 foodDatabase 比對；未識別或手動輸入餐點則只顯示整餐分類。

### 餐後第二波升糖分析
- `src/utils/secondWave.js`（新）：`analyzeSecondWave(meals,glucose,insulin,{days})`。每餐取餐前基準、前段(0–2h)峰、2h 值、2–5h 峰與中間谷；判定第二波＝2h 後再升 ≥25 且峰 ≥160 且（有谷時）較谷高 ≥25 且峰在 130min 後。產出原因（高脂高蛋白延遲消化／餐前胰島素藥效已退／無餐前胰島素）與建議（分次注射、餐後 2–3h 補打校正）。回傳 summary（count/examined/pct）。
- `src/components/GlucoseLog.jsx`：加「餐後第二波升糖分析」卡（預設 3 筆 + 顯示更多），days 依所選範圍推算。
- 單測：早峰140→2h回落120→第二波175@210min → 正確判定。

### ⚠️ 部署狀態（待處理）— Render deploy 失敗
- 最新 commit `7da291d`（餐後第二波/逐項食物/預測分級）Render 部署回報失敗，「latest changes may not be live」。
- 本機已驗證**程式碼無誤**：`npm run build` 過（2710 模組全轉譯）、`node --check server/libre-proxy.js` OK、`package-lock.json` 含全平台 rolldown binding（含 linux-x64-gnu）、新檔名大小寫正確。本 commit 未改 server。
- 結論：失敗在 **Render 端**，非程式碼。最可能：(1) build OOM（free tier 記憶體小，vite8/rolldown 吃記憶體，bundle 已 ~1MB；log 會見 `JavaScript heap out of memory`）；(2) health check 逾時（free 冷啟動慢）；(3) 暫時性 infra。
- **下一步（待使用者）**：貼 Render deploy 失敗 log 紅字（`==> Build failed` / `Exited with status` 前後幾行）以定位；或先試 Render → Manual Deploy → **Clear build cache & deploy**。
- 若確認 OOM：可在 vite.config.js 加 `manualChunks` 拆分（recharts 等）降低記憶體尖峰，或升級 Render 方案。
- 註：本機 `npm ci` 會 EPERM（vite 預覽程序鎖住 rolldown binding），與 Render 無關。

### 2026-06-20 批次（忘記/修改密碼、長效低血糖、教學通知、生理期個人化、生病用藥）

#### 忘記密碼閉環 + 設定修改密碼
- `src/store/AuthContext.jsx`：加 `recovery` state（監聽 `PASSWORD_RECOVERY` 事件）+ `updatePassword(newPw)`（`supabase.auth.updateUser`，成功清 recovery）。
- `src/components/ResetPassword.jsx`（新）：點重設信回 App 後的「設定新密碼」畫面（新密碼 + 再次輸入比對，錯誤中文化）。
- `src/App.jsx` `Gate`：`recovery` 為真時優先顯示 `<ResetPassword/>`（先於登入閘）。
- `src/components/Settings.jsx`：加「🔑 修改密碼」卡（`ChangePassword` 子元件，session 內直接改、免 email；新密碼+確認）。
- `src/App.css`：`.change-pw-form`。
- 註：登入頁「忘記密碼」按鈕本就送重設信，缺的是點信後設新密碼這半段，已補齊。
- **待設定**：Supabase → Auth → URL Configuration 把 `https://diaguide-4r5o.onrender.com` 加進 Redirect URLs，否則點信跳不回（`redirectTo` 用 `window.location.origin`）。

#### 長效胰島素評估強化（飯前/夜間低血糖 → 請使用者降劑量）
- `src/utils/insulinCalculator.js` `analyzeBasalAdequacy()` 重寫：夜間（00–07）+ 空腹（06–09:30）**兩窗各自獨立**掃低血糖（舊版只取其一→漏掉另一窗）。任一窗出現低血糖即優先回 `too_high` + `reduceDose:true`，明確提示減少長效劑量。
  - 嚴重度：最低<54 或反覆≥2 次 → `danger`（減 2 U）；單次 → `warning`（減 1–2 U）。訊息標明地點/次數/最低值 + 目前劑量，附「先補速效糖」「與醫師確認」。
  - 新欄位：`nightLowCount`/`fastingLowCount`/`minLow`/`reduceDose`（不影響既有 UI，照讀 message/suggestion/severity/avgBG/avgLongDose）。
- UI（`InsulinAdvisor.jsx`「長效胰島素評估」卡）自動吃新 message/suggestion，未改。
- node 實測 3 案通過（空腹單低→warning、夜間嚴重低→danger、全好→adequate）。
- 已知：badge 文字寫死「夜間均值」，樣本退用空腹時字面略不符（未改）。

#### 新手教學加「開啟手機通知」步驟
- `src/components/Onboarding.jsx`：第⑥步「開啟手機通知」（`body:'NOTIFY'` sentinel），iOS/Android 各自步驟卡，action 導 `/reminders`。
  - 用 `isIOS()`/`isStandalone()`（`src/lib/push.js`）偵測：Safari 分頁開→紅字警告先加主畫面；已 standalone→綠字可直接啟用。偵測到的系統卡片紫框高亮。
  - 步驟數變 8（onboardingStep 動態長度，相容）。提醒頁啟用鈕本就存在，action 路徑有效。
- `src/App.css`：`.notify-os`/`.notify-steps`/`.notify-warn`/`.notify-ok`。

#### 女性生理期「個人化」血糖影響 + 生病用藥
重點：讓使用者用**自己的血糖數字**親眼看見生理期影響。
- `src/utils/cyclePhase.js`：
  - 抽出 `phaseForDayInCycle(dayInCycle,len)` + `CYCLE_PHASE_META`（label/short/bgTrend/level/color），`computeCyclePhase` 改用、去重。
  - 新 `analyzeCycleGlucoseImpact(readings, lastPeriodStart, cycleLength)`：近 120 天血糖依「發生在週期哪階段」模運算分桶 → 各階段 n/平均/低血糖%/高血糖%/TIR%（每階段需 ≥8 筆才報）。產生洞見：黃體 vs 濾泡平均差 ≥8→「你的黃體期平均 X，比濾泡期高 N」；月經期低血糖 ≥12%→補糖提醒。回 `phases`/`byKey`/`lutealDelta`/`insights`/`enoughForCompare`。
- `src/components/Dashboard.jsx`：生理期卡加 `cycleImpact` useMemo + 渲染「📊 各階段平均血糖橫條圖」（當前階段高亮、配色）+ 個人化洞見文字；資料不足顯示「記錄滿一個完整週期就能對比」提示（給動機）。卡內互動加 `stopPropagation` 避免誤觸導頁。
- `src/App.css`：`.cycle-impact`/`.cycle-bars`/`.cycle-bar-row.cur`/`.cb-*`/`.cycle-insight-*`/`.cycle-impact-hint`。
- `src/components/Reminders.jsx`：sick-day 卡擴充——拆出獨立「💊 生病用藥對血糖的影響」段（會升血糖：類固醇/含糖糖漿；相對安全：普拿疼；生病需暫停：metformin/SGLT2 脫水＋正常血糖型酮酸；抗生素）；補強胰島素更需要、酮體高需額外速效、就醫時機加「喝不下水/喘/嗜睡」。
- `src/App.css`：`.sickday-med-head`。
- node 實測 `analyzeCycleGlucoseImpact`：黃體比濾泡高 50 → headline 洞見正確觸發、各桶分類正確。

#### 本批驗證
- 全部改動經 Vite HMR 熱更新無錯（dev server 持續運行）。`insulinCalculator`/`cyclePhase` 兩支純函式以 node 單測通過。
- 密碼/教學/生理期卡多在登入或特定條件後（女性+經期資料），preview 未登入未做互動截圖。

### 2026-06-20 批次 2（餐點解析強化、LibreLink 對帳、彈窗、官方營養表）

已 push 到 main，每筆觸發 Render 重部署。

#### 餐點解析：自述碳水 / 單位 / 無法判斷（commit a6fb97d）
- `src/utils/foodParser.js`：
  - 重量單位加 **斤/台斤/臺斤=600g、兩=37.5g**（順序排好避免 公斤≠斤、kg≠g）。
  - **自述碳水** `extractCarbDeclaration`：「碳水50」「50克碳水」「醣30」直接採用，系統不猜。
  - **尾綴數量**：方糖兩顆=10、香蕉3根、水餃10顆（之前只解析前綴數量）。
  - **無法判斷**：完全無法辨識且無自述碳水 → 回 `undetermined`（不再假報 0g 誤導劑量）；部分辨識 → `partial`（標示低估）。
  - 修兩個既有 bug：單字模糊比對亂中（料→含糖飲料）→ 限 ≥2 字；模糊比對取**最長**鍵（葡萄糖一包不再被當葡萄）。
- `src/utils/foodDatabase.js`：加葡萄糖（包=15g GI100）/方糖/蜂蜜/黑糖 + ~30 常見食物。`lookupFood` 改最長鍵 + ≥2 字防呆。
- `src/components/MealLog.jsx`：碳水無法判斷顯示「無法判斷」+ 紅橫幅 + 一鍵改手動 + 擋存；部分→黃橫幅；逐項列加「❓無法判斷」；輸入提示更新。

#### LibreLink 圖表＝來源（三次修正，重要）
症狀：LibreLink 同步資料與系統圖表不一致。
- **commit 79663fd**：(1) proxy 改用 `ValueInMgPerDl`（`Value` 是帳號顯示單位，mmol 帳號會與 mg/dL 圖表打架）。(2) 去重改「最新抓取為準」覆寫舊值（LibreLinkUp 會回補/平滑近 1h 數值）。
- **commit 1758e59（最終解法）**：**整窗權威對帳**。每次同步取 LibreLink 回傳 12h 窗 [最早,最晚]：窗外累積歷史不動，**窗內整段用最新資料整批取代**。自動：值變了→修正、新點→新增、系統多餘/重複點→清除。
  - `src/store/AppContext.jsx`：`RECONCILE_GLUCOSE` reducer（窗內整批換）。
  - `src/components/LibreSync.jsx`：前端即時同步用之，訊息「新增/修正/清除過時」。
  - `server/libre-proxy.js` `mergeGlucose`：後端排程同邏輯（保留 90 天累積、窗內權威）。
- 注意：>12h 舊歷史無法自動修（LibreLink 無此端點）；要全淨化 → 設定→清除血糖→重新同步。**須部署 + 手動同步一次才見效**。

#### 編輯餐點改彈窗（commit 6180c72）
- `src/components/MealLog.jsx`：新增/編輯表單包進 `.meal-form-overlay` 置中 modal（自帶捲動 + ✕ 關閉 + 鎖 body 捲動），不再捲回上方輸入區搞混。移除 scrollIntoView effect。
- `src/App.css`：`.meal-form-overlay`/`.meal-form-modal*`。

#### 官方營養表 1647 筆（commit 58434c5）
- 來源：使用者提供 `nutrition_table_ai_friendly.csv`（台灣官方 per-100g 淨碳水/蛋白/熱量/纖維）。
- `src/utils/nutritionExt.js`（**自動產生**，67KB）：生成器 NFKC 正規化（番⽯榴→番石榴）、濾雜訊列、拆主名/別名；2156 列→1647 筆。格式 `[主名,[別名],淨碳水100g,蛋白100g,熱量100g,纖維100g]`。
- `src/utils/foodDatabase.js`：`lookupFood` 加官方表**後備**（手刻庫優先：有真實份量+GI；查無才落官方表，以 100g 為基準依重量/份數換算）。
- 限制：官方表**無 GI、無脂肪**（gi:null、fat:0）→ 升糖分類退為碳水量判斷；碳水用淨碳水。bundle +67KB（gzip ~15-20KB），留意 Render OOM。

#### 升糖標籤矛盾修正（commit f06ae52）
- 症狀：葡萄糖整餐顯示「緩慢升糖」、逐項顯示「快速升糖」同畫面打架。
- 根因：`classifyGlycemicResponse` 只讀 `highGICount`（數字），但分析卡傳整個 `analysis`（含 `highGI` 陣列）→ count 讀成 0 → 高 GI 餐誤判緩慢。
- 修 `src/utils/glycemicResponse.js`：同時接受 `highGICount` 或 `highGI` 陣列自動取數。整餐/逐項/classifyMeal 三路徑同源一致。

#### 本批驗證
- 純函式（foodParser/foodDatabase/glycemicResponse/cyclePhase/mergeGlucose）皆以 node 單測通過。

### 2026-06-22 批次（UI 配色對齊主視覺、注射改彈窗、快取修正、首頁直接同步）

皆已 push main，逐筆觸發 Render 重部署。

#### 飲食頁配色/彈窗對齊主視覺（commit 896c012、cea3737、64548eb）
- `.btn-icon`（飲食/血糖/Dashboard 三處 header 共用 +/👤 鈕）：灰底 → 主色 teal 漸層填色 + 白 icon + 放大（padding 6→9、radius 8→12、加陰影）；hover/active/focus 對齊主視覺（取代瀏覽器預設藍焦點框）。飲食 add Plus `size 20→24` 加粗。
- 新增食物 modal：原 `.card` glass 半透明（62% 白）疊暗 backdrop → 文字糊；改 `--surface-solid` 實心白底 + 去 blur。
- off-brand 紫 `#6366f1` 全換 teal：`.analysis-card`、`.btn-analyze`、`.mode-tab-active`、`.bg-time-badge`。
- 低對比淺黃字 `#f59e0b/--yellow` 壓淺底 → 深化 `#b45309`（可讀）：`auto-bg-warn`、`conf-medium`、`meal-feedback-note`、`tag-yellow`。
- `.btn-primary:disabled` 原灰綠底 `#cdded9`+白字 → 白底 + teal 字 + 淡 teal 框（「記錄這餐」未填好時清楚可讀、符主視覺）。

#### 手動記錄注射改 modal（commit 93a0b9b）
- `src/components/InsulinAdvisor.jsx`：原頁面內 inline card → header「+」鈕觸發置中 modal（複用 `meal-form-overlay`/`meal-form-modal`，參考「記錄這餐」）；存檔後自動關閉、body 鎖捲動、加取消鈕。表單欄位/邏輯不變。

#### ⚠️ 手機看不到更新 → 快取修正（commit 0ee9a0c）（重要；先前 Render deploy 失敗疑慮已解，deploy 正常）
- 症狀：新部署後手機看不到改動。診斷：線上 bundle 其實已是最新（curl 驗 CSS teal、JS `meal-form-overlay`=2），SW 不快取資產 → 根因是**手機快取舊 app shell**（PWA/瀏覽器 HTTP cache 存舊 index.html，指向舊 hashed bundle）。
- `server/libre-proxy.js`：hashed `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`；`index.html`/`sw.js`/`manifest` + SPA fallback → `no-store, no-cache, must-revalidate`（shell 每次重抓 → 永遠指向最新 bundle）。
- `src/main.jsx`：每次 load `reg.update()` 查新 SW；新 SW 取得控制權（`controllerchange`，真更新）時自動 `reload()` 一次（用 `hadController` 旗標避開首次安裝的無謂 reload）。
- 踩坑：**no-store 規則生效前手機已快取的舊 shell 對新規則無效**，需手動清一次（瀏覽器強制重整/清網站資料；PWA 移除圖示再重加），之後每次部署自動更新。

#### 注射紀錄/營養建議「顯示更多」（commit 7d01964）
- `InsulinAdvisor.jsx` 最近注射紀錄：預設 5 筆，>5 顯示「顯示更多（共 N 筆）」/收合（`showAllLogs`）。
- `MealLog.jsx` 營養素分析與建議：合併營養+飲食建議成單一陣列，預設 3 個，>3 顯示「顯示更多（共 N 個建議）」/收合（`showAllAdvice`）。

#### 最近飲食紀錄移除整餐 tag + 柔化升糖配色（commit 92ba301）
- `MealLog.jsx`：最近飲食紀錄列移除「整餐」升糖 tag（`classifyMeal`），只留逐項食物升糖；移除已無用的 `classifyMeal` import。
- `src/utils/glycemicResponse.js`：升糖型態色降飽和、對齊主視覺（共用全 app）：fast `#ef4444→#e08585`、delayed `#f59e0b→#d4a85c`、minimal `#22c55e→#5cb89a`、fatProtein `#a855f7→#7f9cc4`（off-brand 紫 → 柔藍）。

#### 首頁「同步 LibreLink」直接同步（commit 8fb5b46）
- `Dashboard.jsx`：30分預測卡 + 空時間軸的「同步 LibreLink」按鈕原 `nav('/glucose')` 跳轉 → 改就地 `syncLibreData` + `RECONCILE_GLUCOSE`（與 LibreSync 同源整窗對帳）+ 標記 integration；含 spinner + 錯誤訊息。未存帳密時才退回導向血糖頁。

#### 本批環境/驗證
- **本機 vite 已修復可跑**：先前 `vite` 不在 PATH 是 `node_modules` 不完整（vite 套件未裝），`npm install` 補裝 259 包後正常（這次無 EPERM）。dev server `preview_start` 跑在 5173。
- 驗證手法：因登入閘擋頁，本機驗 UI 時暫時 bypass `App.jsx` Gate（`if(false && ...)`），截圖/inspect 後**還原**（未進版控）。配色/彈窗/disabled 鈕/注射 modal/移除整餐 tag/柔色 皆截圖或 inspect 確認。
- 線上輪詢確認部署到位（curl 抓 hashed bundle 比對新字串）；HTML header 已驗 `no-store`。
- 注射同步、首頁直接同步需後端 proxy + 已存帳密，本機無法完整實測，邏輯與血糖頁「立即同步」同源。

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

---

### 2026-06-22 批次（首頁圖表進階 + 劑量參數自動值按鈕）

#### 首頁血糖時間軸圖表（已完成並推送）
- 下方甘特圖改為「作用曲線」模式：每筆飲食／胰島素依藥動學畫平滑曲線
  （開始→增強→峰值→減弱→結束）；同時段重疊者自動分列避免覆蓋。
- 長效改為單列甘特長條（半透明區分不同注射、漸層深淺表強度，依劑量縮放）。
- 新增「飲食綜合影響」「速短效綜合影響」累加曲線；食物峰值依升糖負荷
  (GL=GI/100×碳水) 高低分別，胰島素峰值依注射量分別。
- 血糖斜率列：紅＝上升、藍＝下降，零線面積填色；並由模型推算「模擬血糖
  斜率」虛線與實際斜率比較。
- 由模擬斜率積分出「模擬血糖曲線」疊在血糖圖與實際比較（以第一筆實際
  血糖為錨點）。
- 模型用 OpenAPS/Loop BGI：slope = Σcarbs×CSF×rate − Σunits×ISF×rate
  − 基礎偏離；CSF=ISF/ICR。發現預測擺幅遠大於實際，新增 calibrateSimGain
  以最小平方（過原點 k=Σ實際·模擬/Σ模擬²，夾 0.25–1.5）把模型校正到
  使用者真實血糖反應，校正倍率顯示於甘特圖提示。

#### 劑量參數「使用系統自動運算數值」按鈕
- `src/components/InsulinAdvisor.jsx`：參數編輯面板新增 `useSystemAutoParams()`
  與「⚡ 使用系統自動運算數值」按鈕，一鍵 dispatch `UPDATE_ICR_ISF {icr:null,
  isf:null}` 清除手動覆蓋、還原 `deriveICRandISF(tdd)`（500／1700 法則）的
  自動值並填回輸入欄。
- `src/App.css`：新增 `.param-auto-hint`。
- 測試：preview override icr=8/isf=30、TDD=40 → 點按鈕後輸入欄變 13/43/100、
  摘要卡 1:13/43、state.icr/isf 清為 null；驗證通過、測試資料已清除。

#### 踩坑點
- 存檔時本機 `.claude/progress.md` 曾比 origin 少行且編碼亂碼；務必先
  `git checkout origin/main -- .claude/progress.md` 還原 GitHub 完整版再附加，
  純新增不刪除原內容。push 前若被 reject，先 fetch 並把變更 rebase 到最新
  origin 的 progress.md 上重新附加，避免覆蓋他人批次。

---

## 2026-06-27 批次：食物分析修正 + 新增餐點文字 AI 辨識

### 任務
1. 修正食物 GI 誤判（九層塔抓餅被當低 GI、開頭「九」被當數量 9）。
2. 新增餐點「自動分析」改由 AI 辨識碳水/蛋白/脂肪/纖維/各種營養素。
3. AI 數值離譜 → 升級模型 + 逐項計算 + 熱量自檢。

### 已修改檔案
- `src/utils/foodDatabase.js`：蔥油餅/抓餅系列 GI 65→82，新增別名（九層塔抓餅等）；
  新增 `lookupFoodExact()`（整字精確比對，不做 substring）。
- `src/utils/foodParser.js`：parseMealText / parseMealFoods 在拆數量前先做整字精確比對，
  避免「九層塔抓餅」開頭「九」被誤判為數量 9；未填單位預設一份（scale=1）。
- `server/libre-proxy.js`：新增 `POST /api/analyze-food-text`（Claude 文字營養分析），
  以 Supabase 登入 JWT 守門（`gateFoodEndpoint` → `userFromBearer`，無 Supabase/ACCESS_KEY 才開放）；
  模型 haiku-4-5 → **sonnet-4-6**；prompt 強制逐項拆解（食物→份量 g→每項 macros→加總）＋
  台灣份量錨點＋熱量一致性自檢；後端再加防線：kcal 偏離 4C+4P+9F 超過 25% 即以 macro 重算。
- `src/utils/foodAiAnalysis.js`（新）：帶 Supabase token 呼叫端點，任何錯誤自動 fallback 本地 parseMealText。
- `src/components/MealLog.jsx`：handleAnalyze 改 async（先本地即時、AI 再升級）；spinner、
  AI/本地來源徽章、膳食纖維＋micros chips；存檔保存 fiber/micros/analysisSource。
- `src/App.css`：.ai-badge / .btn-spinner / .micros-section / .micro-chip 樣式。

### 對應 commit
- 37509f4 抓餅 GI 修正 + 開頭數字防誤判
- 87a455f 文字輸入 AI 辨識營養（端點 + 前端接線）
- 425ce73 修數值離譜（sonnet-4-6 + 逐項計算 + 熱量自檢）

### 測試指令與結果
- `npm run build` → 通過（僅既有 chunk >500kB 警告）。
- preview 本機實測：輸入「九層塔抓餅、雞胸肉一份、青菜」→分析，食物正確拆解、
  九層塔抓餅顯示 GI 82 高GI；本機無後端故走 fallback 顯示「本地」。
- AI 路徑無法本機測（需 Render 上的 ANTHROPIC_API_KEY），須部署後實測。

### 待辦 / 待確認
- 部署後實測 AI 數值是否合理（建議測「白飯一碗」「便當」「珍奶」）。
- 若仍偏差 → 改混合架構：本地精選 DB（~90 種台灣食物實測份量+GI）為 ground truth，
  命中項目直接採 DB 值，僅長尾交 AI 估算。

### 踩坑點
- `/api/analyze-food-text` 靠 Supabase 登入守門 → Render 需有 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（已設）；
  此端點不依賴 ACCESS_KEY。前端同源以相對路徑 /api 呼叫，dev 由 vite proxy 到 localhost:3001。
- 食物名開頭含中文數字（九層塔…）會被解析器當數量 → 已用整字精確比對擋掉，新增同類食物時優先放進 DB 名稱/別名。
- 模型營養估算用 haiku 會數值離譜，需 sonnet 等級；務必要求逐項計算＋熱量自檢，否則易亂給克數。
