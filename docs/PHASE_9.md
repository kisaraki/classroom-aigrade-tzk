# Phase 9 驗證紀錄

日期：2026-09-28。使用者於 2026-09-26 核准啟動 Phase 9 並採用 D-06 三項決策。本機核心實作與完整回歸完成，沒有真實資料 Purge、Production migration 或 Sites 部署。

## 零、模型／推理強度

- Recommended：XHIGH；Minimum：XHIGH。
- Actual：沿用已確認 XHIGH；Action：KEEP，未另外升級。

## 一、完成項目

- Recycle Bin Preview／Confirm、Soft Delete、30 天內 Restore；整批版本 guard、原因、Scope、5 分鐘 Recent Authentication 與 Audit。
- 新生 Import Rollback 同交易建立回收紀錄，Restore 恢復學生及該次被撤銷的學籍，任何後續版本異動均阻擋。
- D-06：僅 super_admin 可預覽、確認、重試 Purge。所有保存日期與 30 天復原承諾都須滿足；沒有可信副本 adapter 時禁止開始。
- Purge Preview 明示各資料表數量、共享檔案及受影響歷史評量，Confirm 另要求輸入綁定預覽編號的確認文字。
- 開始後以資料庫 trigger 暫停業務寫入，相關管理讀取也暫停；外部副本清除失敗保留 PARTIAL，重新授權後可重試。D1 清理採原子 batch，完成後移除 Manifest。
- 保留其他學生既有發布結果與名次，移除被刪學生及原始計算輸入、群體統計；受影響評量凍結重算與成績寫入。
- 完成證據只保留作業編號、操作者、時間、數量、結果及完成日起兩個曆年截止日；一般 Audit 移除受影響學生識別並維持兩個月期限。共享封存批次保留其他學生的正式 Restore 資料。

## 二、新增檔案

- [生命週期服務](../site/lib/server/lifecycle/service.ts)、[HTTP](../site/lib/server/lifecycle/http.ts)、[runtime](../site/lib/server/lifecycle/runtime.ts)、[API routes](../site/app/api/admin/lifecycle)。
- [Purge 資格規則](../site/lib/domain/purge.ts)、[政策測試](../site/tests/purge-policy.test.mjs)、[整合測試](../site/tests/lifecycle.test.mjs)。
- [0010 migration](../site/drizzle/0010_phase_09_lifecycle.sql)、Drizzle snapshot 與本紀錄。

## 三、修改檔案

- PROJECT_SPEC、CHANGELOG、README、資料模型及進度入口。
- [schema](../site/db/schema.ts)、migration journal 與既有升級測試。
- [ImportService](../site/lib/server/imports/service.ts)：Rollback 與回收紀錄的原子整合。
- [AuthorizationService](../site/lib/server/auth/authorization.ts)：清除進行中拒絕一般業務存取，仍允許管理員撤權及清除維護。
- 發布、計算與封存服務：凍結已清除評量的重算，清除進行中拒絕公開資格。

## 四、Database Migration

0010 新增 recycle_entries、lifecycle_previews、purge_jobs、purge_control、purged_exams，共 47 張關聯表、11 份 migration。已存在的 Soft Delete 依原時間及版本回填 30 天期限，不改寫學生或成績。新學生 Import Rollback 保存可驗證的學籍版本供 Restore 使用。

Migration 新增業務寫入鎖、單一未完成 Purge 工作約束、不可變預覽、狀態 guard 與評量凍結 trigger。舊 migration 不變；升級只在隔離虛構資料庫驗證。正式套用前仍須 preflight、備份／復原實測與人工確認，回退程式不會回復已清除資料。

## 五、測試結果

| 指令                            | 結果                             |
| ------------------------------- | -------------------------------- |
| `npm.cmd test`                  | 171 項通過，0 失敗／略過         |
| `npm.cmd run typecheck`         | 通過                             |
| `npm.cmd run lint`              | 通過                             |
| `npm.cmd run format:check`      | 通過                             |
| `npm.cmd run build`             | 通過，含 5 個生命週期 API 路由   |
| `node scripts/check-docs.mjs`   | 17 份文件、377 個內部連結通過    |
| `node scripts/check-safety.mjs` | 249 個來源檔通過既定敏感資料規則 |
| `git diff --check`              | 通過                             |

新增 17 項測試，包括 Purge 期限、共享副本承諾、權限／Scope、CSRF、交易失敗、外部刪除驗證、併發重試、歷史名次、共享封存 Restore、匯入 Rollback 復原及 migration 失敗重試。開發中曾因測試期間變更 migration 而出現雜湊不一致；固定最終 migration 後完整重跑，上表只計最終通過結果。

## 六、安全性檢查

- HTTP Cookie、同源 Origin、嚴格欄位、1 MiB 串流上限與 no-store；客戶端無法注入 adapter、儲存 key 或宣告副本已清除。
- 執行開始與 D1 最終清理均於交易內重驗 Session／角色／Recent Authentication。重試每次重新授權；不因持有 job ID 取得權限。
- 外部清除採冪等刪除及不存在驗證；單一未完成工作阻止新業務資料在清除期間進入。
- D1 清除依 FK 關聯及操作快照引用處理；共享復原資料不得破壞有效承諾，原子失敗不得宣稱 DONE。
- 使用虛構 seed、隔離 Miniflare D1 與 mock 副本 adapter；平台整合尚未驗證。

## 七、已知限制

- 管理 UI 依 Phase 14，公開查詢依 Phase 13；本階段提供後端契約。
- Production runtime 不注入 PurgeCopies，固定拒絕未驗證的 Purge；須先確認雲端所有副本、備份及到期清除能力，再進行另行審查的平台整合。
- 為保持跨儲存清理一致性，未完成 Purge 期間採全系統業務寫入鎖。PARTIAL 必須重試至完成，不能 Undo 已刪外部副本。
- 尚未完成的 Import 或無法確定原檔影響範圍會阻擋 Purge；沒有依猜測跳過未知副本。
- Purge 凍結受影響整份評量，不保留可重算原始資料；其他學生仍可讀取原有個人成績／名次，群體統計不再提供。
- 大資料量、雲端 batch 容量與真實備份回復尚未實測。平台 adapter 需涵蓋每種副本與共享檔案的其他學生承諾；mock 通過不代表可正式清除。

## 八、下一 Phase 預計工作

Phase 10：RAG Reference Materials，文件解析、metadata、FTS 與上傳邊界。需另行授權，本次不啟動。
