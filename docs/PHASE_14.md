# Phase 14 Admin UI 工作紀錄

更新：2026-10-01。使用者已核准 Phase 14；目前部分完成；後續 Phase 授權依各階段紀錄，並不消除本階段驗收缺口。

## 模型與範圍

Recommended／Minimum：MEDIUM。模型切換後 Current 無法由工具直接讀取；使用者於 2026-10-01 確認目前為 MEDIUM 或更高，Action：KEEP。沒有宣稱自動切換或精確強度。

建立 `/admin` 管理工作區，整合既有服務。Reports 只提供入口，匯出實作屬 Phase 15。Audit 查看政策已於 2026-10-01 定案為僅 active super_admin；介面及授權驗收仍未完成，入口保留說明，不回傳稽核資料。

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

1. Audit 查看角色已由使用者定案為僅 active super_admin；待完成讀取介面、伺服器 Session／Permission／Scope 與未登入／其他角色／撤權測試。本次僅文件同步，未新增 Audit API。
2. 最新操作流程與手機版視覺驗證尚未完成，瀏覽器工具存取受限。
3. 正式 Google callback、可信 IP、限流清理、AI consumer 與副本／備份能力仍沿用既有平台待驗證事項。
4. Production Purge 停用。沒有真實學生資料、付費 API 呼叫、正式 Release 或 Sites 部署。

Phase 14 尚未完成；使用者後續已核准 Phase 15／16，這些授權不消除本節未完成事項。
