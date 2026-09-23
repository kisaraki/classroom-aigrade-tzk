# Sites 應用程式

此目錄是 `classroom-aigrade-tzk` 的 Sites 原始碼。業務規格以 [PROJECT_SPEC.md](../PROJECT_SPEC.md) 為準；進度及限制見 [Phase 2 驗證紀錄](../docs/PHASE_2.md)。

## 本機開發

Node.js 22.13 以上；本次使用 Node.js 24.15.0。依 Sites 官方 Vinext starter 與鎖檔建立，保留既有 UI 元件及建置整合。

在此目錄執行：

```sh
npm run install:ci
npm run dev
npm run lint
npm run format:check
npm test
npm run db:verify
npm run build
npm start
```

Windows PowerShell 可使用 `npm.cmd`。若 npm shim 找不到自身模組，改由已安裝 Node.js 的 `node_modules/npm/bin/npm-cli.js` 執行相同 npm 命令；不用重新安裝 Node.js。

`dev` 預設監聽 127.0.0.1:5173；`start` 使用建置後 Worker，在終端顯示實際 URL。這些命令只做本機預覽，不部署。

## 設定與資料

- `.openai/hosting.json` 保存 Sites project_id 與邏輯 bindings：D1 `DB`、R2 `FILES`。
- 複製 [.env.example](.env.example) 為本機 `.env`；真實值不提交 Git。雲端 Secret 由 Sites Settings 管理，變更不代表已套用至執行中的版本。
- Phase 0 的首頁與測試不需要真實 OAuth／AI／Bootstrap Secret。
- 管理員僅使用 Google OAuth／OIDC；未啟用 starter 的 ChatGPT 登入模擬，未建立任何正式登入流程。
- [db/schema.ts](db/schema.ts) 已定義初版資料表；`drizzle/` 保存四份 migration、journal 與 snapshots。ER 圖、欄位表示及復原計畫見 [DATABASE.md](../docs/DATABASE.md)。
- `npm run db:verify` 僅建立一次性 Miniflare D1，套用 migration、虛構 seed 並檢查重跑；結束即銷毀，不寫入本機預覽 DB 或雲端。伺服器不自動 migration。
- 姓名與生日可重複；分數以百分之一分整數儲存。身分證只儲存密文、key 版本與 HMAC，key 在測試程序中隨機產生；不得將測試 key 當成正式 key。
- `tests` 中的 migration、日期、身分證加密與 D1／R2 測試 使用暫時 Miniflare 實例與虛構資料；不接觸雲端資料庫。
- `.wrangler`、`.sites-runtime`、`.vinext`、`node_modules` 與建置輸出均不進 Git。

## 學籍服務

[AcademicService](lib/server/academic/service.ts) 提供學年度、班級、新生／轉入、學籍、轉班／座號、升班、轉出、撤銷與歷史查詢。所有業務寫入先取得 Preview，再明確 Confirm；來源 revision、actor、Session 與 Scope 會重驗。授權 adapter 預設拒絕，目前只有隔離測試，尚未接管理路由；Phase 3A／3B 完成前不得公開寫入。

詳細輸入、錯誤與限制見 [Phase 2 紀錄](../docs/PHASE_2.md)。Excel／CSV 上傳與完整 Import 流程留待 Phase 6，沒有新增貼上表格介面。

## 部署邊界

目前 Sites 未發布。任何 Sites deployment 都是 Production，必須另有「確認正式部署」授權；不得把 `npm start` 的本機測試結果當成雲端部署驗證。

Starter 原有第三方程式與授權檔保留；MIT 專案授權見 [LICENSE](../LICENSE)。
