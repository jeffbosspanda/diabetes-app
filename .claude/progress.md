# DiaGuide 進度存檔

存檔時間：2026-06-19

## 目前任務

本輪完成三項需求（全部已實作並驗證）：

1. **合併飲食卡** — 「飲食建議」併入「營養素分析與建議」，移除重複卡片
2. **急速升降原因分析（新功能）** — 分析每段血糖急升/急降的原因
3. **速效 / 短效分清楚** — 新增獨立短效（Regular）品牌類別，與速效 analog 區分

## 已修改檔案

### 需求 1：合併飲食卡
- `src/components/MealLog.jsx` — 兩張卡（營養素分析與建議＋飲食建議）合併成一張，render `nutrientAdvice` 後接 `dietaryTips`；移除未用的 `Info` import

### 需求 2：急速升降原因分析
- `src/utils/insulinCalculator.js` — 新增 `analyzeGlucoseExcursions()` ＋ `analyzeOneExcursion()`：
  - 偵測連續血糖陡段（≥2 mg/dL/分起始、≥1 延續、間隔≤30min），同方向合併成一段 excursion，累積變化≥30 mg/dL 才列入
  - 對照事件前 3h 的飲食、速效/短效注射、長效、運動推因
  - 急升因：高GI食物、進食未打餐前胰島素、劑量相對碳水不足、注射過晚、黎明現象
  - 急降因：餐前胰島素作用中、劑量疊加(stacking)、運動增敏、劑量相對碳水偏高
- `src/components/GlucoseLog.jsx` — import `analyzeGlucoseExcursions`、加 `excursionAnalysis` useMemo、「血糖變化速率」卡下方新增「急速升降原因分析」卡

### 需求 3：速效 / 短效分類
- `src/utils/insulinCalculator.js`：
  - `INSULIN_BRANDS.short` 新增（Humulin R / Actrapid / Novolin R / Insuman Rapid）
  - `BRAND_PHARMA` 加短效各品牌項（kind:'short', prebolus:30, iobHours:7-8）
  - 新增 helper：`BOLUS_TYPES`、`isBolus()`、`bolusLabel()`、`bolusIOBHours()`
  - 餐前胰島素分析（`analyzeRapidDosingHistory`、`analyzeOneEvent`）filter 改 `isBolus()`；文字「短效」→「餐前胰島素」（特定單筆用 `bolusLabel`）
- `src/store/AppContext.jsx` — settings 加 `shortBrand:'Humulin R'`、`shortBrandConfirmed:false`
- `src/components/Settings.jsx` — 第三個 BrandSelector（短效）；修正速效標籤；加 short pending/confirm/change handlers；BrandSelector active class 支援 short
- `src/components/InsulinAdvisor.jsx` — `shortBrand` + `brandFor()` 對應；手動記錄與編輯改 3 分頁（速效/短效/長效）；confirmed-brand-bar 加短效 tag；紀錄列徽章 3 類（速效/短效/長效）；ICR/ISF/分析文字「短效」→「餐前胰島素」
- `src/utils/bgPredictor.js` — IOB 迴圈納入短效，依 brandType 設 DIA（短效 360min、速效 240min）
- `src/utils/insulinReminder.js` — 餐後未打覆蓋檢查納入 short
- `src/utils/reportGenerator.js` — 拆速效/短效統計列；事件列與標題「短效」→「餐前胰島素」
- `src/components/Dashboard.jsx` — 加 `SHORT_COLOR`(#0ea5e9 天藍)、`insulinColor()`/`insulinTypeLabel()` helper；時間軸標記/連線/事件列/圖例 3 類
- `src/App.css` — 追加 `.short-label`/`.short-active`/`.short-tag`/`.inject-tab.active-short`/`.active-short` 樣式

## 待辦事項

- 無未完成項目。三項需求皆已完成並通過驗證。
- 可選後續：劑量計算器目前固定用速效品牌計時機，若使用者主用短效可加品牌切換；短效注射的注射時機卡（餐前30分鐘提醒）。

## 測試指令與結果

- `npm run build` → `✓ built in ~894ms`，無錯誤（僅既有 chunk >500kB 警告）
- preview 實測（localhost:5173）：
  - 設定頁 3 個品牌類別標籤：「⚡ 速效…」「🕒 短效（一般人胰島素 Regular，餐前 30 分鐘）」「🌙 長效…」✓
  - 劑量頁手動記錄 3 分頁：速效（NovoRapid）/ 短效（Humulin R）/ 長效（Tresiba）✓
  - 血糖頁「急速升降原因分析」卡正常：例「急速下降 145→67 mg/dL（-78）」、cause「速效胰島素作用中，下降前 42 分鐘注射 9U 速效，正值作用高峰」✓
  - 無 console error

## 踩坑點

- **嚴禁修改血糖資料**：血糖只能經 LibreLink sync（`npm run proxy`，localhost:3001）匯入；勿注入/編輯 localStorage `diabetesApp.glucoseReadings`。僅信任 `source: 'FreeStyleLibre'`。
- 速效（rapid analog）≠ 短效（Regular / R）：速效餐前 0–15min、IOB≈4h；短效餐前 30min、IOB≈7h、DIA≈6h。兩者每單位降糖力相同，ICR/ISF 計算一致，差別只在時機與 IOB 持續。
- `brandType` 現有三值：`'rapid'`（速效）、`'short'`（短效）、`'long'`（長效）。餐前胰島素分析一律用 `isBolus()` = rapid OR short。
- 舊 `brandType:'rapid'` 紀錄不受影響，仍歸速效；舊資料無 `short`。
- excursion 偵測門檻：STEEP_RATE=2、CONT_RATE=1、SEG_GAP=30min、MIN_DELTA=30 mg/dL；最多顯示 12 段。
- 此專案目錄非 git repo（`git status` 會 fatal），存檔靠手動整理。
- preview 切路由用 `history.pushState` + `popstate` 事件較穩（`location.href` 偶爾回跳）。
