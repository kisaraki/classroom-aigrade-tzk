# Sites 應用程式

## Phase 16 安全／隱私（本機完成）

已修補依賴及 Session／Scope／HTTP 邊界，新增學籍交易安全 migration 與跨模組測試；270 項已逐項驗證通過（完整回歸 268 通過，2 項數量斷言修正後重驗通過）。登入限流與報表來源容量已核准並實作。動態頁面／API 使用隱私回應標頭，build 明確關閉 request logs／traces；正式平台仍待 preflight 實測。見 [Phase 16 工作紀錄](../docs/PHASE_16.md)。

## Phase 15 報表／匯出（驗收中）

`POST /api/admin/reports` 接受 `kind`、`examId`、相應的 `classId`／`grade`／`studentId`、可選 `expectedVersion` 與 `format=preview|csv|xlsx|pdf`。每次一個評量，最多 1,000 人及 10 MiB。只讀取已發布快照，AI 只輸出匹配版本的有效成對內容。介面位於 `/admin` 報表頁，提供 Excel／CSV／PDF／列印。

伺服器重新檢查 Session／Scope／來源，不持久保存產出。疑似公式文字會加上「文字：」前綴；不輸出生日、身分證或內部 ID。原校個人成績依目前有效學籍授權並另標示來源，不進本校排名。限制與驗證見 [Phase 15 紀錄](../docs/PHASE_15.md)。

此目錄是 `classroom-aigrade-tzk` 的 Sites 原始碼。業務規格以 [PROJECT_SPEC.md](../PROJECT_SPEC.md) 為準；最新進度及限制見 [Phase 14 工作紀錄](../docs/PHASE_14.md)。

## Phase 14 管理工作區（進行中）

本機 `/admin` 提供 Google 登入與管理功能。`POST /api/admin/workspace` 以 Session、同源 Origin、操作／欄位白名單及伺服器 Permission／Scope 提供選單、名冊、學籍 Preview／Confirm 與排名計算；回應禁止快取。其他管理功能沿用各模組 API。Audit 查看角色未定案，Reports 匯出屬 Phase 15，Production Purge 停用。

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
- [db/schema.ts](db/schema.ts) 已定義資料表；`drizzle/` 保存十四份 migration、journal 與 snapshots。ER 圖、欄位表示及復原計畫見 [DATABASE.md](../docs/DATABASE.md)。
- `npm run db:verify` 僅建立一次性 Miniflare D1，套用 migration、虛構 seed 並檢查重跑；結束即銷毀，不寫入本機預覽 DB 或雲端。伺服器不自動 migration。
- 姓名與生日可重複；分數以百分之一分整數儲存。身分證只儲存密文、key 版本與 HMAC，key 在測試程序中隨機產生；不得將測試 key 當成正式 key。
- `tests` 中的 migration、日期、身分證加密與 D1／R2 測試 使用暫時 Miniflare 實例與虛構資料；不接觸雲端資料庫。
- `.wrangler`、`.sites-runtime`、`.vinext`、`node_modules` 與建置輸出均不進 Git。

## 學籍服務

[AcademicService](lib/server/academic/service.ts) 提供學年度、班級、新生／轉入、學籍、轉班／座號、升班、轉出、撤銷與歷史查詢。所有業務寫入先取得 Preview，再明確 Confirm；來源 revision、actor、Session 與 Scope 會重驗。授權 adapter 預設拒絕；Phase 14 管理路由使用伺服器授權並在 Confirm 交易重驗，不把 request body 當作授權結果。

詳細輸入、錯誤與限制見 [Phase 2 紀錄](../docs/PHASE_2.md)。Excel／CSV 上傳與完整 Import 流程見下方 Phase 6，沒有新增貼上表格介面。

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

[ExamService](lib/server/exams/service.ts) 與 [HTTP 邊界](lib/server/exams/http.ts) 使用真實 Session／Permission／Scope，伺服器從評量、名單快照及學籍解析資源。所有寫入要求同源 Origin、JSON 及欄位允許清單，回應皆 no-store。未登入不回傳成績。Phase 14 管理 UI 已接上既有 API，完整驗收仍進行中。

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

評量／科目設定影響全校，需全校 score.write；班級名單需整班範圍，任課教師只可寫入自己班級且自己科目的成績。原校成績授權依學生目前有效學籍，無本校班級快照。已轉出、軟刪除或班級封存不接受新草稿寫入。歷史、發布、鎖定及封存評量不可走草稿入口；解鎖、原因、重算與重新鎖定見下方 Phase 7。

Phase 4 測試使用隔離 Miniflare、虛構資料及 stub OIDC；真實 Google／Sites 登入依 D-09 暫緩。草稿 API 證據見 [Phase 4 紀錄](../docs/PHASE_4.md)。

## Phase 5 平均與排名核心

`lib/domain/averages.ts` 使用百分之一分整數與 BigInt 中間運算，單次四捨五入。`lib/domain/ranking.ts` 的 `calculateExam` 接受同一評量版本、科目設定、當次參與／排名資格快照與開始日在籍快照，回傳檢測、段考、定評平均、總分、科目總分及班級／全年段競賽排名；`calculateSemesterAverage` 直接合計同學期同來源的原始有效分數。

未指定 components 的舊內部預覽介面中，`PROVISIONAL` 只計 QUIZ，`FINAL` 計 QUIZ＋MIDTERM。Phase 7 發布明確傳入已發布 components，故支援 MIDTERM 先發布；只有兩分類皆發布才為 FINAL。原校資料分開回傳；本校 cohort 分開列示在籍、參與、合格、實際排名人數及各指標有效學生數／分數筆數／最高平均，未新增公開統計 UI。

`lib/server/exams/ranking-service.ts` 提供內部唯讀 `RankingService.calculate(session, examId, { classId } | { grade }, mode)`，以實際 Session、score.read、全科 Scope 及評量日期授權。D1 batch 讀取一致資料，再重驗授權、exam.version 與 academic_state.revision；班級模式不回傳全年段名次／其他班資料。來源變更回報 `CALCULATION_SOURCE_CHANGED`，呼叫者須重新計算。單科權限不能讀全科排名。

此服務不是 HTTP route，也沒有儲存或發布結果。未來發布交易須再次驗證權限、來源版本與學籍 revision，原子保存計算結果及統計快照；不得把新鮮度檢查當成資料庫寫入鎖。既有草稿與公開路由不會自動呼叫此服務。完整測試與限制見 [Phase 5 紀錄](../docs/PHASE_5.md)。

## Phase 6 匯入與回復 API

成績匯入目標為 `{ kind: "SCORES", examId, classId, examType, subjects }`；七年級新生為 `{ kind: "NEW_STUDENTS", academicTermId, classId }`。一次檔案限同一目標班級與評量分類，XLSX 每科一張 sheet，最多 10 張。跨班檔案必須分開建立 Job；新生檔使用一張 sheet。成績匯入僅操作已有名單確認的參與紀錄，不替評量補建名單。

| 方法與路徑                                    | 用途                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| POST /api/admin/imports/template              | JSON `{ target }`；下載文字儲存格 XLSX 範本                                                                                       |
| POST /api/admin/imports                       | 原始檔案位元組，Content-Type 為 application/octet-stream；X-Import-Format 為 csv 或 xlsx，X-Import-Target 為目標 JSON；回傳 jobId |
| GET /api/admin/imports/[id]                   | Job 狀態、目標、預覽版本及錯誤                                                                                                    |
| POST /api/admin/imports/[id]/preview          | JSON `{ columns? }`；解析、識別、驗證及預覽。columns 可將範本欄名映射到檔案欄名                                                   |
| POST /api/admin/imports/[id]/commit           | JSON `{ previewVersion, confirmed: true }`；重驗權限與來源後整批提交                                                              |
| GET /api/admin/imports/[id]/errors            | 僅含列序與錯誤碼的 CSV，不回顯姓名、身分證、原始列或 SQL                                                                          |
| POST /api/admin/imports/[id]/rollback/preview | JSON `{}`；列示可回復項目或衝突及版本差異                                                                                         |
| POST /api/admin/imports/[id]/rollback/confirm | JSON `{ previewVersion, confirmed: true }`；在期限內整批回復                                                                      |

所有入口驗證應用 Session；Job 限建立者且必須仍具有目前 Permission／Scope，下載亦相同。寫入須同源 Origin；回應 no-store。Phase 14 匯入表單只供已授權管理員使用，公開頁面不能上傳。

上傳遵守 [§73.4](../PROJECT_SPEC.md#spec-73-4)：5 MiB、5,000 筆資料列、每列 30 欄；XLSX 展開總量 25 MiB／1,000 ZIP 項目，實際串流展開量與宣告大小都檢查。拒絕公式、巨集、外部連結、加密檔及 .xls；目前也拒絕隱藏 sheet、合併儲存格及非支援儲存格型別。CSV 使用 UTF-8（可含 BOM），保留前導零與原始文字；日期填 YYYY-MM-DD，不推測 Excel 日期序號或已遺失的識別碼前導零。

成績欄位為學年度、學期、評量次序、評量分類、班級、姓名、座號、學號、身分證字號、科目、分數、成績來源及原校名稱。前四欄可省略，由 Job 目標提供；若有值則必須一致。成績來源空白視為 LOCAL，原校資料填 EXTERNAL_TRANSFER 並核對既有原校名稱；不混入本校排名。新生欄位為姓名、生日、班級、座號、學號、身分證字號、生效日期。範本全部使用文字儲存格。

同一建立者曾成功提交相同內容至同一目標時，Preview 回傳 duplicateOf；仍需查看新預覽並明確 Confirm 才會再次寫入。相同 Job 的確認重送只回傳既有結果。錯誤不部分提交；來源異動必須重新預覽。

30 天從 committed_at 起算，滿 30 天失效。Rollback 不覆蓋後續版本；發布、鎖定、封存、轉出等受保護狀態會阻擋。還原首次新增成績時保存為 UNENTERED／NOT_HELD，保留 History 的外鍵及版本。新生回復採學籍 voided 與學生 Soft Delete，保留加密識別及稽核；同一識別資料的再次使用須循後續 Restore 流程，不自動 Purge。

原檔僅保存在私有 FILES binding 的隨機物件 key；不提供公開網址、不以使用者檔名作 key。Job／Items、成績／學籍、History／Audit 於同一 D1 batch 提交。D1／R2 跨儲存上傳失敗保留 FAILED Job，可重新上傳建立新 Job；不會寫入成績。原檔清理與 Purge 尚未開放。

新增兩個鎖定的小型解析依賴：[fflate 0.8.3](https://github.com/101arrowz/fflate) 與 [fast-xml-parser 5.11.1](https://github.com/NaturalIntelligence/fast-xml-parser)。ZIP 分批解壓並核對 CRC；XML 拒絕 DTD／自訂實體。沒有執行試算表公式或呼叫外部連結。

身分金鑰仍使用既有 Secret 名稱：IDENTITY_ENCRYPTION_KEY 為含 version（正整數）、base64（32-byte 金鑰）的 JSON object；IDENTITY_HMAC_SECRET 為相同格式 object 的 JSON array，列出所有有效查重版本。兩類金鑰必須獨立，重複版本或格式錯誤時拒絕。不要把真實 Secret 放入範本、Job、文件或 Git。正式環境輪替沿用 [資料模型說明](../docs/DATABASE.md)。

實際驗證及限制見 [Phase 6 紀錄](../docs/PHASE_6.md)。

## Phase 7 發布與修改 API

全部為管理端 API，Cookie Session、Permission／Scope、no-store；寫入要求同源 Origin 與 application/json，body 上限 1 MiB。

| 方法／路徑                                          | 輸入及用途                                                                                                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/admin/exams/[id]/publication/preview`    | 發布：`{kind:"PUBLISH",component:"QUIZ"或"MIDTERM",expectedVersion}`；修改：`{kind:"EDIT",reason,expectedVersion,scores:[{participationId,settingId,expectedVersion,value}]}` |
| POST `/api/admin/exams/[id]/publication/confirm`    | `{previewId,confirmed:true}`；來源版本改變須重新預覽，重送不重複提交                                                                                                          |
| GET `/api/admin/exams/[id]/publication?classId=...` | 只讀取已提交的班級結果，不回傳其他班級或全年段個人名次；尚無版本則 published=false                                                                                            |

發布須全校 score.write；修改逐列驗證班級／科目權限。兩者皆要求 5 分鐘內 Google Recent Authentication。部分發布後未發布分類的後續填分也走 EDIT；其分數不進入公開快照。編輯一律保存原因及 History，在同一交易內解鎖、重算、保存完整版本與 AI 請求、重新鎖定。歷史年度僅 super_admin 可依正式修改流程處理，封存評量拒絕。

`regenerationRequest(jobId)` 僅供 Phase 12 內部消費契約，回傳版本／audience，不呼叫 AI，亦不能取代消費者完成時的原子版本及學生狀態檢查。詳見 [Phase 7 紀錄](../docs/PHASE_7.md)。

## Phase 8 封存、畢業與保存期限 API

| 方法／路徑                         | 用途                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| POST `/api/admin/archives/preview` | 建立以下動作的預覽與 Preflight；回傳 previewId、警告及必要前後值                            |
| POST `/api/admin/archives/confirm` | `{previewId,confirmed:true}`；重驗授權、Recent Authentication、來源與期限，原子提交且可重送 |
| GET `/api/admin/archives/[id]`     | 重新驗證整份 Manifest 的 archive.read Scope 後取得批次紀錄                                  |

所有寫入使用同源 Origin、Cookie Session、application/json、1 MiB body 上限及 no-store。action 支援 ARCHIVE、GRADUATE、EXTEND、READMIT、UNDO、RESTORE：

- ARCHIVE：`{action,target:{academicTermId,onDate,studentId或classId或grade},reason,force}`。
- GRADUATE：同上，但 target 僅指定 grade:9。日期不可在未來，逐列保留歷史學籍快照。
- EXTEND：target 指定 studentId，加上 ISO 日期 until；只延長非 active 學生的既有期限，必要時同步延長保存。
- READMIT：target 同時指定 studentId、目標 classId，加上 seatNumber。建立新學籍、保留舊期限事件並暫停套用截止日；需 archive.manage 與 academic.write。
- UNDO／RESTORE：`{action,batchId,reason}`；前者限提交起未滿 30 天，後者不受快速 Undo 時窗限制，但皆不得覆蓋後續修改或已 Purge 項目。

一般封存／畢業／延長／復原須 archive.manage 與 Scope，皆要求 5 分鐘內 Google Recent Authentication；歷史年度遵守既有 super_admin 限制。已封存項目不能重複封存，Restore 衝突需先釐清，不提供強制覆蓋。publicEligibility 是 Phase 13 對接用的內部期限 helper，不是公開查詢 API。詳見 [Phase 8 紀錄](../docs/PHASE_8.md)。

## Phase 9 Recycle Bin 與 Purge API

- `POST /api/admin/lifecycle/preview`：`{ action: "DELETE" | "RESTORE" | "PURGE", studentIds: string[], reason: string }`。
- `POST /api/admin/lifecycle/confirm`：`{ previewId, confirmed: true, confirmation? }`；Purge 另要求 Preview 回傳的確認文字。
- `GET /api/admin/lifecycle/list`：依 archive.read 與所有受影響歷史 Scope 篩選回收紀錄。
- `GET /api/admin/lifecycle/jobs/[id]`：super_admin 查看 Purge 狀態及最小證據。
- `POST /api/admin/lifecycle/jobs/[id]/retry`：`{ confirmed: true }`；重試仍要求 Google Recent Authentication。

Purge 目前僅透過 server-owned mock adapter 在隔離測試執行。runtime 未配置已驗證副本／備份 adapter，會拒絕 Production Purge；客戶端不能用欄位或環境開關略過。開始後至完成期間鎖住業務寫入，PARTIAL 可重試、不可 Undo。其他學生的已發布名次保留，受影響評量停止重算，原始群體統計移除。詳見 [Phase 9 紀錄](../docs/PHASE_9.md)。

## Phase 10 參考資料 API

- `POST /api/admin/references`：原始 binary body；`Content-Type: application/octet-stream`，`X-Reference-Format: md|pdf`，`X-Reference-Filename` 是 URI 編碼檔名，`X-Reference-Metadata` 是 URI 編碼 JSON。metadata 包含 `title`、可選 `description`、`subject`、`grade`、`validFrom`、`validTo`。成功回傳草稿 ID、version 與 chunks 數。
- `GET /api/admin/references?after=...`：每頁 50 份 metadata；回傳 `next` 游標，不回傳物件 key 或原始檔名。
- `POST /api/admin/references/[id]`：`{ version, metadata, status: "draft"|"active"|"archived", privacyReviewed }`。啟用須 `privacyReviewed: true` 且仍通過伺服器個資檢查；封存保留原 metadata 與引用片段，不受新個資檢查阻擋。封存後不可直接重啟，改上傳新文件。
- `POST /api/admin/references/retrieve`：`{ query, subject, grade, classId? }`。回傳 `trust: "untrusted_reference_data"` 與最多 8 個版本化片段。未來 Provider 必須將其當作資料，不能拼接為系統指令或授予工具權限。
- `GET /api/admin/references/pending`：全校 ai.manage 查看未完成上傳／清理項目。
- `POST /api/admin/references/[id]/cleanup`：body `{}`；重試刪除未提交的私有物件，驗證不存在。保留清理紀錄以涵蓋晚到的物件寫入，可重複執行；不能刪除已提交文件。

寫入要求同源 Origin；除 binary upload 外 POST 使用 JSON。管理全校共用資料須全校 ai.manage；檢索須 ai.read 與年級／班級／科目 Scope，使用伺服器解析的目前學期。Purge 未完成時拒絕相關操作。檔名只用於驗證，不保存在物件 key、Audit 或 AI Context。D-11 門檻與驗證見 [Phase 10 紀錄](../docs/PHASE_10.md)。

## 部署邊界

目前 Sites 未發布。任何 Sites deployment 都是 Production，必須另有「確認正式部署」授權；不得把 `npm start` 的本機測試結果當成雲端部署驗證。

Starter 原有第三方程式與授權檔保留；MIT 專案授權見 [LICENSE](../LICENSE)。

## Phase 11 Provider 與設定 API

- `GET /api/admin/ai/settings`：回傳 `{ version, configuration }`；尚未設定時 `version: 0`、`configuration: null`。
- `POST /api/admin/ai/settings`：接受 `{ configuration: { provider, model }, expectedVersion, confirmed: true }`。provider 僅 `openai` 或 `gemini`；model 必須由管理員明確指定，不接受 URL、路徑或其他欄位。
- 讀寫皆須目前學期的全校 `ai.manage`；POST 另驗證同源 Origin、JSON、4 KiB 本文與版本。切換為整批原子提交，衝突不覆蓋，Audit 只記錄版本與供應者。API 不讀寫 Secret。
- `OPENAI_API_KEY`／`GEMINI_API_KEY` 由平台 Env／Secret 注入，僅相應 Adapter 讀取；未設定不影響 Google 登入或成績核心。不提供金鑰查詢、上傳或測試付費 API 的 HTTP 入口。
- 內部 `configuredAIProvider()` 回傳設定版本與 Provider；後續 Job 必須先授權、清除個資、保存來源版本，完成時重驗版本。Adapter 本身不處理學生成績、RAG、工作排程或建議持久化。
- 已核准限制與錯誤／取消行為見 [Phase 11 紀錄](../docs/PHASE_11.md) 及 [主規格 §29](../PROJECT_SPEC.md#spec-29)。

## Phase 12 Advice／Jobs API

- `POST /api/admin/ai/jobs`：`{ examId, studentId, confirmed: true, retry?: boolean }`。只建立或明確重試 durable Job，不在 HTTP 內生成；需要該歷史班級的 `ai.manage`、有效 Session 與同源 Origin。同來源／前次／模型設定／prompt 組合去重。
- `GET /api/admin/ai/jobs?examId=...&studentId=...`：要求 `ai.read` 與 Scope，回傳成對建議版本及工作狀態／安全錯誤／已知用量。內容是已驗證的段落 JSON；不得當作 HTML。公開家長 UI 由 Phase 13 整合，不可直接公開此管理 API。
- `AIJobService.consumeOne()` 是獨立 consumer 介面，每次領取一組家長／學生工作；5 分鐘租約、同組原子領取、最多 3 次自動執行、1／5 分鐘退避。過期租約可重新領取，舊 lease 無法完成或覆蓋新 worker。
- 每組先後生成兩版，兩者均滿 500 漢字且通过個資與來源檢查後，同一 D1 batch 保存內容、引用、版本與完成狀態。任一版失敗不發布半套。重試可能重新呼叫兩版並增加 API 用量。
- 首次須管理員手動啟動。後續發布／改分在同一交易為已啟動的學生評量保存重生請求；也使同學期下一次評量的前次比較失效。背景工作使用持久化的啟動者及 auth_version，重驗 active Google 綁定、ai.manage、Scope 與學生狀態；撤權後須重新核准 Job，不能借用其他管理員權限。
- 用量為供應者成功回應所回報的 tokens，未回報為 NULL。包含失敗／中斷呼叫的完整帳單用量不一定可知，不能將 NULL 當 0；duration 為該次成功呼叫耗時，api_attempts 為 Provider 當次嘗試數。
- 正式排程／consumer 未啟用；沒有用 `waitUntil` 或延長 HTTP 假裝可靠排程。授權範圍與驗證見 [Phase 12 紀錄](../docs/PHASE_12.md)。

## Phase 13 公開查詢

首頁提供六項查詢條件；`POST /api/public/lookup` 只接受同源 JSON：year、term、classCode、sequence、name、birthDate。禁止 URL 查詢參數及 GET。伺服器只回傳匹配者的已發布成績、班級名次、群體彙總、趨勢與可用 AI 建議；歧義及一般查詢失敗不揭露候選資訊。回應禁止快取，前端不使用持久儲存。

`PUBLIC_LOOKUP_VERIFIED=false` 為預設；正式平台可信 IP、請求紀錄、清理排程與備份保存尚未實測，入口維持關閉。必須提供獨立 `PUBLIC_LOOKUP_HMAC_SECRET`（至少 32 字元）；無可信 IP 或限流儲存不可用時拒絕查詢。10 分鐘內每 IP 30 次、每完整條件 5 次，成功與失敗均計入。

`cleanupLookupLimits(db, now)` 必須由正式平台至少每小時呼叫，刪除滿 23 小時紀錄；請求時另清除滿 24 小時紀錄。只有核心函式，尚未配置正式排程。Purge 同一交易清除共用 HMAC 紀錄；歷史快照清理後不重算殘缺群體資料。完整驗證與殘餘風險見 [Phase 13](../docs/PHASE_13.md)。

`AUTH_RATE_VERIFIED=false` 為預設；只有正式可信 `CF-Connecting-IP` 傳遞、紀錄／備份保存與清理排程實測通過後才可開啟。`AUTH_RATE_HMAC_SECRET` 須為至少 32 字元的獨立高熵 Secret，不與公開查詢或身分證金鑰共用。登入／reauth／callback 共用 60 次／IP／10 分鐘，Bootstrap／Identity 開始另共用 5 次；拒絕不消耗部分額度。`cleanupAuthLimits(db, now)` 須至少每小時清除滿 23 小時紀錄，請求另清除滿 24 小時紀錄；目前只有核心函式，沒有正式排程。紀錄不含學生參照，不屬個別學生 Purge，但所有副本仍須符合 24 小時上限。
