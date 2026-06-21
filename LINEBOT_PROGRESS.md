# DiaGuide LINE Bot — 開發進度

> 透過 LINE 聊天記錄胰島素注射與飲食，不需開啟 DiaGuide App。
> 最後更新：2026-06-21（Flex 卡片改版 + 注射用途 / 飲食宵夜）

---

## 1. 功能總覽

使用者在 LINE 與 DiaGuide Bot 對話，即可把資料寫入自己的 DiaGuide（Supabase）帳號。

- **帳號綁定**：LINE 帳號 ↔ DiaGuide 帳號（一次性綁定碼）
- **引導式記錄**：點 Rich Menu / Flex 卡片按鈕，全程用點選，免記指令
- **時間選擇**：每筆記錄可選時間，預設「現在」，可改實際發生時間（台北時區）
- **直接指令**：老手可直接打字（例：`速效 8U`、`早餐 白飯一碗`）
- **血糖不在此記錄**：血糖只能由 LibreLink 自動同步，刻意不提供 LINE 手動輸入

---

## 2. 架構與資料流

```
使用者 LINE 訊息／點按鈕
      ↓
LINE Platform
      ↓ POST /linebot/webhook（HMAC-SHA256 簽名驗證）
Express Server (Render, server/libre-proxy.js)
      ↓ 解析訊息 / postback → 狀態機
Supabase app_state（依 data.lineUserId 找到對應 user）
      ↓
LINE 回覆 Flex 卡片確認
```

- 綁定關係存在使用者的 `app_state.data.lineUserId`。
- 伺服器用既有的 `supabaseAdmin`（service role）讀寫，繞過 RLS。
- 對話狀態 `lineConvState` 為記憶體 Map，TTL 5 分鐘（重啟即失效，使用者重點選單即可）。

---

## 3. 一次性設定步驟（已完成）

### 3.1 LINE Developers Console
- 建立 Provider：`DiaGuide`
- 建立 **Messaging API channel**（非 LINE Login / 非 MINI App）
- 取得 **Channel Secret**（Basic settings）
- 產生 **Channel Access Token**（Messaging API 分頁 → Issue）

### 3.2 Render 環境變數
| Key | 說明 |
|-----|------|
| `LINE_CHANNEL_SECRET` | webhook 簽名驗證 |
| `LINE_CHANNEL_ACCESS_TOKEN` | 呼叫 LINE API（reply/push/richmenu） |
| `CRON_SECRET` | 保護 setup-richmenu 端點（與排程同步共用） |

### 3.3 Webhook URL（LINE Console → Messaging API）
```
https://diaguide-4r5o.onrender.com/linebot/webhook
```
- 按 Update → Verify（需回 Success）→ 開啟「Use webhook」

### 3.4 註冊 Rich Menu（每次選單版面/圖片改動都要重跑）
部署完成後，瀏覽器開啟：
```
https://diaguide-4r5o.onrender.com/api/line/setup-richmenu?key=<CRON_SECRET>
```
成功回傳 `{"ok":true,"richMenuId":"..."}`，再完全關閉 LINE 聊天視窗重開即生效。

---

## 4. 使用者操作流程

### 加入好友（follow 事件）
- Bot 回覆歡迎文字 + **介紹卡片** `introBubble()`：DiaGuide 六大功能 + 官網 `https://diaguide-4r5o.onrender.com/`，引導用 **Email 免費註冊**
- 卡片按鈕：「🌐 前往註冊 DiaGuide」(uri) / 「📋 開啟記錄選單」(`menu_open`)

### 說明（介紹卡片）
- 文字 `說明`/`介紹`/`help`/`?` 或 Rich Menu「說明」(`menu_help`) → 顯示同一張 `introBubble()`
- 「記錄選單」改由 `選單`/`menu`/`menu_open` 觸發；「繼續記錄」按鈕也改打 `menu_open`

### 綁定
1. 用 Email 在官網註冊 DiaGuide 帳號
2. 傳「綁定」→ Bot 回 6 位數碼（10 分鐘有效）
3. DiaGuide →「設定」→「其他裝置整合」下方「LINE Bot 綁定」輸入碼
4. 綁定成功，Bot 推送歡迎訊息 + 選單卡片

### 記錄注射（4 步驟）
選單「💉 注射」→ ①選類型（速效/短效/長效）→ ②選用途 → ③打字輸入單位（可含 .5）→ ④時間卡片（確認現在 / 改時間）→ 確認卡
- 用途（速效/短效）：早餐 / 午餐 / 晚餐 / 宵夜 / 點心 / **校正劑量**
- 用途（長效，非餐別）：睡前 / 早晨 / 其他
- 用途寫入 dose 的 `mealType` 欄位（與 App 一致）；同時寫入 `brandType`/`brand`，讓 App 正確顯示類型

### 記錄飲食
選單「🍽 飲食」→ 選餐別（早/午/晚/**宵夜**/點心）→ 打字輸入內容 → 時間卡片 → 確認卡
- 宵夜寫入 `lateSnack`（與 App `MEAL_LABELS` 一致）

### 直接指令（免走流程）
- `速效 8U`、`短效 6U`、`長效 20U`
- `早餐 白飯一碗 雞蛋`、`午餐 便當`、`宵夜 泡麵`（宵夜→`lateSnack`）
- 其他關鍵字：`說明`/`介紹`（介紹卡）、`選單`/`menu`（記錄選單）、`綁定`、`取消`
- 註：直接指令不帶用途/餐別細節以外的標記，注射指令不含 `mealType`

---

## 5. Rich Menu（聊天室底部常駐選單）
- 圖片：`server/assets/line-richmenu.png`（2500×843，由瀏覽器 Canvas 產生）
- **專業改版**：白色卡片 + 頂部彩色 accent 條 + 淡色圓角 icon 徽章 + 標題/副標，淺灰漸層底
- 目前 3 欄：**注射 / 飲食 / 說明**（原本 4 欄含血糖，已移除血糖）
- 各區塊送出 postback：`action=menu_insulin` / `action=menu_meal` / `action=menu_help`
- 定義於 `RICH_MENU_DEF`；註冊邏輯抽成 `applyRichMenu()`
- **開機自動註冊**：`app.listen` 啟動時呼叫 `applyRichMenu()`，部署即更新選單（免手動打 setup URL）。可設 `AUTO_RICHMENU=off` 關閉
- ⚠️ Rich Menu 存在 LINE 伺服器，**單純部署程式碼不會更新**；需重新註冊（現由開機 hook 自動處理）。手動端點 `/api/line/setup-richmenu?key=<CRON_SECRET>` 仍保留

---

## 6. 後端 API 端點（server/libre-proxy.js）
| 方法 | 路徑 | 用途 | 保護 |
|------|------|------|------|
| POST | `/linebot/webhook` | 接收 LINE 事件 | LINE 簽名 |
| POST | `/api/line/bind` | 前端輸入綁定碼 | Supabase Bearer |
| POST | `/api/line/unbind` | 解除綁定 | Supabase Bearer |
| GET | `/api/line/status` | 查詢綁定狀態 | Supabase Bearer |
| ALL | `/api/line/setup-richmenu` | 註冊 Rich Menu | CRON_SECRET |

---

## 7. 異動檔案
- `server/libre-proxy.js` — webhook、狀態機、Flex 卡片、記錄寫入、綁定/RichMenu API
- `server/assets/line-richmenu.png` — Rich Menu 圖片（3 欄）
- `src/components/Settings.jsx` — `LineBindCard`（綁定 UI，位於「其他裝置整合」下方）
- `package.json` — 加入 `@line/bot-sdk`（實際以原生 fetch 呼叫，SDK 目前未使用）

---

## 8. 重要技術點 / 踩坑
- **簽名驗證**需 raw body：`express.json({ verify })` 把原始位元組存到 `req.rawBody`，再用 `createHmac('sha256', SECRET)` 比對 `x-line-signature`。
- **webhook 一律回 200**：LINE 對非 200 會重送，故先 `res.status(200).end()` 再處理。
- **圖片上傳走 data 網域**：`https://api-data.line.me/v2/bot/richmenu/{id}/content`（非 api.line.me）。
- **時區**：伺服器（Render）為 UTC。顯示與 datetimepicker 都用 `Asia/Taipei`；picker 回傳 `yyyy-MM-ddTHH:mm` 視為 +08:00 再轉 UTC 儲存。
- **無下拉選單**：LINE 聊天室無原生 dropdown，劑量採打字輸入。
- **Rich Menu 圖片產生**：未用 sharp（安裝被拒），改用瀏覽器 Canvas `toDataURL` 產 PNG，再 base64 解碼寫檔，避開伺服器缺中文字型問題。
- 找使用者：`supabaseAdmin.from('app_state').filter('data->>lineUserId','eq',lineUserId)`。
- **Flex 卡片設計系統**：`proBubble()`（彩色 header band + padding body + footer）、`menuItem()`（可點 list row：emoji 圓徽章 + 標題/副標 + accent chevron）、`detailRow()`。色票對齊 App：品牌紫 `#863bff`、注射藍 `#4a90d9`、飲食綠 `#34b97f`。
- **注射資料模型對齊 App**：`recordInsulin` 寫入 `brandType`（App 讀此判斷類型）、`brand`（中文標籤，避免 log-tag 空白）、`mealType`（用途/校正）；保留 `insulinType` 向後相容。先前只寫 `insulinType`，App 會一律顯示「速效」。
- **餐別值對齊 App**：宵夜 = `lateSnack`（非 `snack`），對應 `Dashboard.jsx` 的 `MEAL_LABELS`。
- **血糖文案**：綁定成功推播與選單卡片不再出現「記錄血糖」字樣；選單 footer 註明「血糖由 LibreLink 自動同步」。

---

## 9. 待辦 / 可優化（未做）
- [ ] LINE 推送高低血糖警報（目前警報走 Web Push，可考慮併入 LINE）
- [ ] 飲食記錄串接營養分析（目前 LINE 端 `carbs:0, confidence:'undetermined'`，需開 App 看完整分析）
- [ ] 查詢類功能（今日摘要、最近血糖）— 目前 Bot 僅記錄不查詢
- [ ] 綁定碼改存 Supabase（目前記憶體，伺服器重啟會失效）
- [ ] 移除未使用的 `@line/bot-sdk` 依賴（或改用 SDK）

---

## 10. 相關 Commit
- `9ff3cb2` feat: LINE Bot — 透過 LINE 記錄注射/血糖/飲食（初版，文字指令）
- `e47cb73` fix: LINE 綁定卡片移到「其他裝置整合」下方
- `32105cb` feat: Rich Menu + 引導式按鈕介面
- `c3c31b7` feat: 改用 Flex 卡片訊息
- `91ff5ba` feat: 時間選擇、劑量改打字、移除血糖記錄
- `f3dd106` feat: 注射加選用途、飲食加宵夜、Flex 卡片改版
- `e7ff9e4` feat: Rich Menu 專業改版 + 開機自動註冊（修正血糖殘留）
- `4c3f962` feat: 加入好友歡迎卡 + 說明改為 DiaGuide 介紹與 Email 註冊引導
