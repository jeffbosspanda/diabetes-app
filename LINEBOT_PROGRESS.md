# DiaGuide LINE Bot — 開發進度

> 透過 LINE 聊天記錄胰島素注射與飲食，不需開啟 DiaGuide App。
> 最後更新：2026-06-21

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

### 綁定
1. LINE 加 DiaGuide Bot 好友（Console 的 QR code）
2. 傳「綁定」→ Bot 回 6 位數碼（10 分鐘有效）
3. DiaGuide →「設定」→「其他裝置整合」下方「LINE Bot 綁定」輸入碼
4. 綁定成功，Bot 推送歡迎訊息 + 選單卡片

### 記錄注射
選單「💉 注射」→ 選類型（速效/短效/長效）→ 打字輸入單位（可含 .5）→ 時間卡片（確認現在 / 改時間）→ 確認卡

### 記錄飲食
選單「🍽 飲食」→ 選餐別（早/午/晚/點心）→ 打字輸入內容 → 時間卡片 → 確認卡

### 直接指令（免走流程）
- `速效 8U`、`短效 6U`、`長效 20U`
- `早餐 白飯一碗 雞蛋`、`午餐 便當`
- 其他關鍵字：`說明`/`選單`/`綁定`/`取消`

---

## 5. Rich Menu（聊天室底部常駐選單）
- 圖片：`server/assets/line-richmenu.png`（2500×843，由瀏覽器 Canvas 產生，內建中文字型 + emoji）
- 目前 3 欄：**注射 / 飲食 / 說明**（原本 4 欄含血糖，已移除血糖）
- 各區塊送出 postback：`action=menu_insulin` / `action=menu_meal` / `action=menu_help`
- 定義於 `RICH_MENU_DEF`，由 `/api/line/setup-richmenu` 上傳註冊

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
