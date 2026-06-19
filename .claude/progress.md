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
