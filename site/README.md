# Sites 應用程式

此目錄是 `classroom-aigrade-tzk` 的 Sites 原始碼。業務規格以 [PROJECT_SPEC.md](../PROJECT_SPEC.md) 為準；進度及限制見 [Phase 3B 驗證紀錄](../docs/PHASE_3B.md)。

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
- Phase 3A 的 auth routes 需要部署平台注入 `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`GOOGLE_OAUTH_REDIRECT_URI` 與 `ADMIN_BOOTSTRAP_SECRET`；目前未填入真實值。
- 管理員僅使用 Google OAuth／OIDC；未啟用 starter 的 ChatGPT 登入模擬，也沒有本地密碼登入。
- [db/schema.ts](db/schema.ts) 已定義資料表；`drizzle/` 保存八份 migration、journal 與 snapshots。ER 圖、欄位表示及復原計畫見 [DATABASE.md](../docs/DATABASE.md)。
- `npm run db:verify` 僅建立一次性 Miniflare D1，套用 migration、虛構 seed 並檢查重跑；結束即銷毀，不寫入本機預覽 DB 或雲端。伺服器不自動 migration。
- 姓名與生日可重複；分數以百分之一分整數儲存。身分證只儲存密文、key 版本與 HMAC，key 在測試程序中隨機產生；不得將測試 key 當成正式 key。
- `tests` 中的 migration、日期、身分證加密與 D1／R2 測試 使用暫時 Miniflare 實例與虛構資料；不接觸雲端資料庫。
- `.wrangler`、`.sites-runtime`、`.vinext`、`node_modules` 與建置輸出均不進 Git。

## 學籍服務

[AcademicService](lib/server/academic/service.ts) 提供學年度、班級、新生／轉入、學籍、轉班／座號、升班、轉出、撤銷與歷史查詢。所有業務寫入先取得 Preview，再明確 Confirm；來源 revision、actor、Session 與 Scope 會重驗。授權 adapter 預設拒絕，目前只有隔離測試，尚未接管理路由；後續 API 串接時必須使用伺服器授權並在 Confirm 交易重驗，不得把 request body 直接當作授權結果。

詳細輸入、錯誤與限制見 [Phase 2 紀錄](../docs/PHASE_2.md)。Excel／CSV 上傳與完整 Import 流程留待 Phase 6，沒有新增貼上表格介面。

## 管理員認證

`/api/auth/google/start`、`/api/auth/google/callback`、`/api/auth/bootstrap/start`、`/api/auth/session` 與 `POST /api/auth/logout` 僅在伺服器端讀取 OAuth／Bootstrap Secret。OIDC ID token 驗證 issuer、audience、RS256 簽章、效期、nonce 與 `email_verified`；登入後 D1 只保存 Session token hash。詳見 [Phase 3A 紀錄](../docs/PHASE_3A.md)。

## Phase 3B 授權 API

- GET／POST /api/admin/users：super_admin 讀取清單或新增授權帳號。
- PATCH /api/admin/users/[id]：原子修改 displayName、role、status、assignments。
- POST /api/admin/users/[id]/revoke：強制撤銷目標 Sessions。
- POST /api/admin/users/[id]/rebind：核准新 authorizedEmail 與一次性驗證 request。
- POST /api/auth/identity/start：提交 requestToken，前往 Google；callback 必須符合核准 Email，新身分不由前端提交。
- POST /api/auth/reauth/start：以現有 Session 啟動 Google 重新驗證；callback 檢查同一瀏覽器 Session、subject、Email 與 auth_time。

所有新增 POST／PATCH 要求同源 Origin 與 application/json。建立帳號需 confirmed=true；修改、撤銷與 Rebind 另需清單的 auth_version 作為 expectedVersion，拒絕未知欄位。帳號管理只限近期 Google 驗證的 super_admin；其他角色由 AuthorizationService 檢查 Permission 及資源 Scope。

Recovery 核准只有 [AdminManagementService.approveRecovery](lib/server/auth/admin-management.ts) 的受控伺服器維護入口，沒有公開核准 route。維護者在可信程序注入 D1 與 ADMIN_RECOVERY_SECRET，提供保留帳號 ID、目前版本、核准 Email、confirmed=true、非敏感 approvedBy／evidenceReference。回傳 requestToken 僅交給核准的新身分持有人，不寫入一般 log 或 URL；新身分持有人透過 identity/start 的 JSON body 啟動 Google 驗證。伺服器只保存隨機 token hash，核准與 Google 驗證都必須在 5 分鐘內完成。Production 維護執行環境與證據保存政策須在正式啟用前確認，不能用公開 API 代替受控維護程序。

一般登入及帳號管理不依賴 Recovery Secret 是否配置；只有受控 Recovery 核准會要求該 Secret。Google auth_time 需依 [官方 OIDC 文件](https://developers.google.com/identity/openid-connect/reference) 請求；沒有有效 auth_time 時一般登入仍可成立，但高風險操作會拒絕。真實 Google 設定與 Sites 實測仍暫緩。

## Phase 4 草稿評量 API

[ExamService](lib/server/exams/service.ts) 與 [HTTP 邊界](lib/server/exams/http.ts) 使用真實 Session／Permission／Scope，伺服器從評量、名單快照及學籍解析資源。所有寫入要求同源 Origin、JSON 及欄位允許清單，回應皆 no-store。未登入不回傳成績。管理 UI 尚未建立。

| 方法／路徑                                | 輸入及作用                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| POST /api/admin/exams                     | operationId、academicTermId、sequence（1～3）、startsOn、endsOn、confirmed；建立 3 個 QUIZ、7 個 MIDTERM 科目設定 |
| GET /api/admin/exams/[id]                 | classId、可選 subject 查詢參數；只回傳獲准班級／科目的快照及分數                                                  |
| PATCH /api/admin/exams/[id]               | operationId、expectedVersion、startsOn、endsOn、confirmed；尚無名單才可改日期                                     |
| PATCH /api/admin/exams/[id]/subjects      | operationId、expectedVersion、settingId、settingVersion、held、confirmed；已有本校成績不得切換 held               |
| POST /api/admin/exams/[id]/roster/preview | classId、可選 overrides（studentId、eligible）；回傳 previewId、expectedVersion、來源 revision 與名單             |
| POST /api/admin/exams/[id]/roster/confirm | operationId、expectedVersion、previewId、confirmed；同一操作人確認仍有效的 Preview，凍結班級／資格快照            |
| POST /api/admin/exams/[id]/external       | operationId、expectedVersion、studentId、schoolLabel、confirmed；新增不排名的原校參與                             |
| POST /api/admin/exams/[id]/scores         | operationId、expectedVersion、scores、可選 reason；每筆含 participationId、settingId、expectedVersion、value      |
| GET /api/admin/exam-participations/[id]   | 可選 subject；取得已授權參與紀錄的科目成績                                                                        |

operationId 使用 8～128 個英數／點／底線／連字號，相同 actor 與相同命令的重送取得原結果。修改命令 expectedVersion 是評量版本；每筆 score 的 expectedVersion 是成績版本，新成績為 0。成功寫入使評量版本加 1，成績亦各加 1。收到版本衝突必須重新讀取／預覽；不得沿用舊版本覆寫。

value 接受 0～100、最多兩位小數（建議十進位字串），或 A／B／C／D／N；null／空字串是 UNENTERED。不接受負數、指數字串、逗號、任意狀態或客戶端傳入 ranking／average／snapshot。數字轉百分之一整數保存，回應的 scoreValue 是整數，displayValue 是兩位小數字串。未寫入的本校不舉行科目顯示 NOT_HELD；其他未寫入科目顯示 UNENTERED，兩者版本都是 0。

評量／科目設定影響全校，需全校 score.write；班級名單需整班範圍，任課教師只可寫入自己班級且自己科目的成績。原校成績授權依學生目前有效學籍，無本校班級快照。已轉出、軟刪除或班級封存不接受新草稿寫入。歷史、發布、鎖定及封存評量不可走草稿入口；Phase 7 才處理解鎖、原因、重算與重新鎖定。

測試使用隔離 Miniflare、虛構資料及 stub OIDC；真實 Google／Sites 登入依 D-09 暫緩。沒有計算平均／排名、匯入、發布、AI 重生或正式 migration。完整證據見 [Phase 4 紀錄](../docs/PHASE_4.md)。

## 部署邊界

目前 Sites 未發布。任何 Sites deployment 都是 Production，必須另有「確認正式部署」授權；不得把 `npm start` 的本機測試結果當成雲端部署驗證。

Starter 原有第三方程式與授權檔保留；MIT 專案授權見 [LICENSE](../LICENSE)。
