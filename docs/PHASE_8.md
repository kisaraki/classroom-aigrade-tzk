# Phase 8 驗證紀錄

日期：2026-09-25。使用者核准 Phase 8 並同意 D-05 兩項建議。本機實作與完整驗證完成；未開始 Phase 9，沒有 Production migration 或 Sites 部署。

## 零、模型／推理強度

- Recommended：XHIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，沿用已確認設定；Action：KEEP，未另外升級。

## 一、完成項目

- 個別、班級、全年段封存；管理員手動指定九年級畢業日期及確認，不排程自動封存。封存與刪除、轉出／畢業身分分開，保留原始成績、參與及排名快照。
- Preflight 列出缺成績、AI 未完成、未發布評量、未完成 Import 與 Failed AI。強制仍顯示警告、須原因及確認，不能略過 Scope、Recent Authentication、來源版本或交易 guard。
- 保存 ArchiveBatch／Items、操作者、原因、時間、Manifest 及封存前後的必要欄位。30 天內快速 Undo；滿 30 天拒絕 Undo，但未 Purge 仍可正式 Restore。
- Undo／Restore 逐項核對封存後值；後續合法修改、延長、再次封存或 Purge 均不能被覆蓋。整批原子提交，失敗不留下部分學生、學籍、期限事件或 Audit。
- D-05：轉出 3 個曆年、畢業 1 個曆年及人工延長分別保存；有效事件的公開期限與保存期限各取最晚值，後續畢業不縮短轉出承諾。延長僅能往後，必要時同交易同步延長保存。
- 正式恢復在籍建立新學籍，保留舊事件並暫停套用其截止日；再次轉出／畢業仍比較既有承諾。READMIT 同時要求 archive.manage 與 academic.write，現行角色矩陣只有 super_admin 同時符合。
- 誤標轉出的 Academic Undo 撤銷對應事件；畢業批次 Undo／Restore 撤銷該次畢業事件並恢復原身分。兩者都以資料版本阻擋後續修改衝突。
- 封存學生停止新學籍、草稿成績、成績修改、匯入／Rollback 及 AI 重生。歷史結果不刪除；公開期限檢查使用 Asia/Taipei 日期、含起不含迄，期限當日已失效。

## 二、新增檔案

- [archive-preflight.ts](../site/lib/domain/archive-preflight.ts)、[retention.ts](../site/lib/domain/retention.ts)：業務警告及期限規則。
- [封存服務](../site/lib/server/archive/service.ts)、[HTTP](../site/lib/server/archive/http.ts)、[runtime](../site/lib/server/archive/runtime.ts)、[管理 routes](../site/app/api/admin/archives)。
- [0009 migration](../site/drizzle/0009_phase_08_retention.sql)及 Drizzle snapshot。
- [整合測試](../site/tests/archive.test.mjs)、[Preflight 測試](../site/tests/archive-preflight.test.mjs)、[期限測試](../site/tests/retention.test.mjs)、本驗證紀錄。

## 三、修改檔案

- [主規格](../PROJECT_SPEC.md)、CHANGELOG、README、資料模型與 Pages 進度。
- [schema](../site/db/schema.ts)及 migration journal。
- [AcademicService](../site/lib/server/academic/service.ts)與型別：轉出事件／撤銷及封存保護。
- [ExamService](../site/lib/server/exams/service.ts)、[PublicationService](../site/lib/server/exams/publication.ts)、[ImportService](../site/lib/server/imports/service.ts)：封存學生的寫入／AI／回復邊界。
- 既有 migration 測試調整為 10 份 migration、42 張關聯表，檢查新增欄位預設 NULL 而不改寫既有資料。

## 四、Database Migration

0009 新增 students.archived_at、retention_events、archive_state 與 archive_previews。既有期限以 LEGACY 事件保存實際已記錄的承諾，不虛構過去多次延長的歷史；原欄位仍保留。新事件不允許改寫原始日期、原因、操作者，只能一次撤銷並增加版本。

archive_state 專門追蹤成績、AI、Import、封存與期限變動，避免以舊 Preflight 強制提交；不改變既有 academic_state 的用途。確認同時核對兩個 revision、Session、5 分鐘 Google 認證與未確認的 Preview。預覽不可改寫，僅可一次保存成功 receipt。

升級測試從 Phase 7 建立有資料的資料庫，驗證既有期限回填、成績不變、失敗 batch 不留下半套 schema，重試及重複 migration 可完成。正式執行前仍須 DB 確認、備份／復原實測及人工批准；回退程式不代表資料庫回退，不提供破壞性 down migration。

## 五、測試結果

| 指令                                                                  | 結果                                                  |
| --------------------------------------------------------------------- | ----------------------------------------------------- |
| `node --test tests/archive-preflight.test.mjs`                        | 3 項通過                                              |
| `node --import ./scripts/sites-env.mjs --test tests/archive.test.mjs` | 11 項整合案例均通過，最後警告／HTTP 調整另經 2 項重測 |
| `npm test`                                                            | 154 項通過，0 失敗／略過                              |
| `npm run typecheck`                                                   | 通過                                                  |
| `npm run lint`                                                        | 通過                                                  |
| `npm run format:check`                                                | 通過                                                  |
| `npm run build`                                                       | 通過                                                  |
| `node scripts/check-docs.mjs`                                         | 16 份文件、360 個內部連結通過                         |
| `node scripts/check-safety.mjs`                                       | 235 個來源檔通過既定敏感資料規則                      |
| `git diff --check`                                                    | 通過                                                  |

全部測試使用虛構資料、程序內測試金鑰與隔離 Miniflare D1。覆蓋原子失敗、重送／併發、撤權、Scope、CSRF、期限與閏年、畢業／轉出多事件、恢復在籍、歷史不變量及 migration 復原。

## 六、安全性檢查

- archive.manage、Scope、Recent Authentication 在 Preview／Confirm 重驗；交易內檢查真實 Session 與認證時間，強制不能繞過。
- 批次讀取須涵蓋 Manifest 全部 Scope；使用舊名單仍須涵蓋學生目前班級。歷史年度寫入依既有規則限定 super_admin 及原因。
- HTTP 同源 Origin、Cookie、嚴格 JSON／欄位清單、1 MiB body 上限、no-store，僅回傳安全錯誤碼。
- 封存快照只保留必要身分狀態、期限與學籍欄位，不複製姓名、生日、身分證或學號；原因只存受保護的操作／事件紀錄，一般 Audit 僅保存數量與強制旗標。
- 公開期限 helper 僅是內部資格判定，不提供無認證查詢路由，也不代替 Phase 13 的完整身分比對與授權。

## 七、已知限制

- 提供後端 API，管理 UI 留在 Phase 14，公開查詢整合留在 Phase 13。
- 不接受未來封存／畢業／重新入學日期，避免預覽確認即提前生效；由管理員於生效日或之後手動執行。
- 沒有 Purge、永久刪除或背景到期刪除；保存期滿只代表未來 Purge 候選條件之一，D-06 仍待 Phase 9 決策。
- 封存不刪既有 AI／匯入原檔，已排程 AI 消費時需檢查封存／狀態；實際提供者與工作完成時的原子 guard 留在 Phase 12。
- Preview 遇任何相關來源變更即須重新預覽，採保守全批次一致性。Restore 遇衝突整批阻擋，不提供覆蓋後續合法更新的強制選項。
- 雲端 D1 容量、備份／復原與真實 OAuth／Sites callback 仍未實測；沒有正式部署。

## 八、下一 Phase 預計工作

Phase 9：Recycle Bin、Rollback 整合與 Purge 資格／預覽／永久刪除，須另行授權並定案 D-06；本次不開始。
