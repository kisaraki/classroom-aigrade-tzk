# Phase 14 Admin UI 工作紀錄

更新：2026-10-01。使用者已核准 Phase 14；目前部分完成；後續 Phase 授權依各階段紀錄，並不消除本階段驗收缺口。

## 模型與範圍

Recommended／Minimum：MEDIUM。模型切換後 Current 無法由工具直接讀取；使用者於 2026-10-01 確認目前為 MEDIUM 或更高，Action：KEEP。沒有宣稱自動切換或精確強度。

建立 `/admin` 管理工作區，整合既有服務。Reports 只提供入口，匯出實作屬 Phase 15。Audit 查看政策已於 2026-10-01 定案為僅 active super_admin；使用者另批准本輪 API／介面／授權測試補做，已完成本機驗證，詳見本文末補充。

## 已建立項目

- 17 個管理功能入口，以及 Google 登入、Bootstrap、Rebind 與重新驗證入口。
- 學年度、班級、學生及學籍 Preview／Confirm；評量、草稿成績、發布及已發布修改確認。
- 匯入上傳、欄位映射、預覽、Commit、錯誤下載及 Rollback；排名讀取與計算。
- AI 工作、參考資料、封存／復原、回收桶、使用者、權限指派、AI 設定與個人資料介面。
- 工作區 API 的 Session／Origin、操作／欄位白名單、64 KiB 本文限制、伺服器 Permission／Scope 選單與輸出前 Session 重驗。
- 學籍授權從伺服器解析完整學籍，於既有 Preview 保存授權座標；確認及重送仍重新授權。
- 寫入前核對內容或伺服器 Preview，再明確確認。範圍切換清除表單；登入失效、離頁及返回歷史頁清除管理資料。不使用瀏覽器持久儲存保存敏感資料。

## 檔案與 Migration

新增 `site/app/admin/`、`site/app/api/admin/workspace/route.ts`、`site/lib/server/admin/` 與 `site/tests/admin-workspace.test.mjs`。

修改 Academic Service／types、Auth HTTP、Bootstrap start route 與主規格 §61。跨模組修改只為接上既有授權、Preview／Confirm 及同源 Google 啟動流程。

沒有 schema 變更、新 migration 或新 dependency。Production migration、備份與正式 smoke test 不適用：本次沒有正式部署。

## 驗證

- 管理整合測試 10 項通過：Session／Origin／本文／欄位、任課科目、學生選單／歷史評量、名冊 IDOR、Preview／Confirm／重送、撤權、輸出前撤銷、Bootstrap 與重新驗證。
- `npm run typecheck`、`npm run lint`、`npm run build` 通過。
- 學籍回歸發現 Scope 計算把局部變更當完整學籍的問題；已改從資料庫讀取完整紀錄後套用變更。修正後 `npm test` 完整回歸 245 項通過，0 失敗、0 跳過，含轉班、轉出、升班、Undo 與匯入。
- 先前本機登入與虛構資料 Dashboard 有視覺驗證；本回合瀏覽器安全政策拒絕存取既有分頁，未補做操作流程及手機版視覺驗證，不將先前截圖視為最新版驗證。
- `npm run format:check` 通過。`node scripts/check-docs.mjs` 驗證 22 份文件、446 個本機連結；`node scripts/check-safety.mjs` 掃描 314 份原始檔，未發現指定 Secret／身分證模式（非完整安全稽核）。`git diff --check` 通過。

## 未完成與限制

1. Audit 已完成本機讀取介面、API 及授權測試，角色仍僅 active super_admin；最新瀏覽器互動驗收另依第 2 項，不以 SSR 替代。
2. 最新操作流程與手機版視覺驗證尚未完成，瀏覽器工具存取受限。
3. 正式 Google callback、可信 IP、限流清理、AI consumer 與副本／備份能力仍沿用既有平台待驗證事項。
4. Production Purge 停用。沒有真實學生資料、付費 API 呼叫、正式 Release 或 Sites 部署。

Phase 14 尚未完成；使用者後續已核准 Phase 15／16，這些授權不消除本節未完成事項。

## 2026-10-01 Audit 補做

使用者回報「驗收完成，批准執行」，並於範圍澄清中確認本輪補齊 Audit 介面、API 與授權測試。僅執行 Phase 14 Audit，不自動進入其他開發 Phase 或正式部署。此前的驗收回報不冒用為本次新增程式之瀏覽器工具實測。

Recommended／Minimum MEDIUM；Current XHIGH（沿用確認）；KEEP，無額外風險升級。

- 新增 site/lib/server/admin/audit.ts 及 site/app/admin/audit.tsx；透過既有 POST /api/admin/workspace 的 audit 操作查閱。
- 增加 audit.read，只授予 super_admin；從 DB 重驗 Session、active 狀態、Google binding、角色／Permission 及全校 Scope，拒絕前端角色與班級宣告，查詢與回傳前均重驗。
- 固定每頁 50 筆，以 created_at／id 游標穩定排序；拒絕不合法／SQL 注入游標，排除到期及未來紀錄。查詢跨臺北午夜拒絕舊頁面，要求重讀。
- SQL 僅選取稽核編號、時間、操作者帳號代號、動作、類型與結果；不讀 metadata、學生 entity_id、operation_id、Email 或憑證。UI 顯示臺北時間、欄位標題、空狀態與翻頁，錯誤清除資料；沿用工作區的離頁／Scope 切換清除及 no-store。
- 修改 auth/types／authorization、admin/service／http、Panels／Workspace 與 admin-workspace tests；跨模組僅為專用 Permission、路由串接及錯誤提示。無 schema、migration、dependency 或 Secret 變更。

實際指令（site 目錄）：

| 指令                                                                                                                                                | 結果                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| node --import ./scripts/sites-env.mjs --test --test-concurrency=2 --test-timeout=180000 tests/admin-workspace.test.mjs tests/authorization.test.mjs | 26 通過／0 失敗／skip，98,442 ms；涵蓋工作區與既有 Google 授權回歸 |
| node --import ./scripts/sites-env.mjs --test --test-timeout=180000 --test-name-pattern='Audit' tests/admin-workspace.test.mjs                       | 新增午夜邊界後，最終 6 Audit 項全通過，31,084 ms                   |
| npm run typecheck／npm run lint／npm run build                                                                                                      | 最終版本通過；lint 0 warnings，本機 build 不代表正式部署           |

六項涵蓋合法 super_admin、所有其他角色／偽造 role、未登入／Origin／未知 Scope、最小投影與敏感資料隔離、保存期限／未來紀錄、相同 timestamp 分頁、游標驗證、停權／降級／Session 撤銷、查詢後撤權、午夜界線及 SSR 的 XSS escaping／表格標題／無權限入口。開發中測試曾用錯 status=suspended，CHECK 拒絕；修正為既有 disabled 後通過，沒有改動 schema。

Phase 18 的 276 全套結果為補做前基底證據。本輪只執行受影響的 26 項回歸與新增後的 6 項 Audit 重驗，沒有宣稱完整 282 項已執行。SSR 是程式渲染檢查，沒有繞過 browser 政策，不能當作手機／點擊／翻頁的實際瀏覽器驗收。

最終 npm run format:check、git diff --check 通過；check-docs 驗證 28 份文件／482 個本機連結，check-safety 掃描 345 份原始檔未發現指定 Secret／身分證模式（非完整安全稽核）。check-client-bundle 檢查 24 個 client 檔案通過，check-build-config 確認 request logs／traces 關閉；Migration／正式 OAuth／正式 smoke 不適用。RC-01 的本機實作阻擋可解除，新增 Audit 互動與其他 UI／平台 gates 保留，不把 Phase 14 或 18 標成全部完成。

## 使用者驗收回覆

2026-10-01，Audit 補做完成回報（本機 commit `850aa9d`）後，使用者回覆「驗收完成，批准執行」。記錄為使用者確認本次 Audit 補做驗收完成；未提供個別瀏覽器／手機／下載／列印步驟結果，不冒稱工具實測或全部 RC gates 通過。後續執行範圍另待確認；此回覆不視為「確認正式部署」，也不自動啟動下一 Phase 或遠端同步。
