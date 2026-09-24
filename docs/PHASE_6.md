# Phase 6 驗證紀錄

日期：2026-09-25。使用者核准 Phase 6，並採用 D-07 原子提交／Rollback 衝突策略與 D-11 上傳門檻。範圍見 [主規格 §53](../PROJECT_SPEC.md#spec-53)。目前狀態：本機實作與完整驗證完成；尚未開始 Phase 7，沒有 Production migration 或 Sites 部署。

## 零、模型／推理強度

- Recommended：HIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，沿用本任務已確認設定；Action：KEEP，符合 Minimum，未另外升級。

## 一、完成項目

- CSV／XLSX 與文字儲存格範本；UTF-8／BOM、引號／跨行、shared strings、numeric cell 原始文字。保留前導零，不猜測已被 Excel 改變的識別碼。
- 依核准門檻限制檔案、工作表、資料列、欄數、ZIP 項目與實際展開量；驗證 ZIP CRC，拒絕公式、巨集、外部連結、DTD／自訂實體、加密及不支援格式。
- 成績及七年級新生匯入：Upload → Parse → Validate → Map → Preview → Confirm → Commit。檔案不直接寫入成績／學生表；Job 保存狀態、物件 key、雜湊與來源版本，Items 保存必要前後值及錯誤碼。
- 成績用 keyed HMAC 精確匹配身分，並核對學號、姓名、班級／座號、學期／評量分類／次序、科目、來源與 NOT_HELD；不存在的參與者不自動建立。新生沿用 AcademicService 的加密身分與唯一性檢查。
- 同檔重複匯入提供 duplicateOf 提示，仍需新預覽及明確確認；同 Job 確認重送不重複寫入。任一錯誤阻擋整批提交。
- 原子提交及 Rollback：Job、Items、成績／學籍、History 與 Audit 同一 D1 batch；中途失敗不留下部分結果。期限為 committed_at 起 30 天，滿時失效。
- Rollback 顯示衝突及項目版本差異；原匯入項目已被修改／再次匯入、評量已發布，或出現後續相依資料時阻擋整批。不覆蓋後續合法更新，無關學生修改不直接阻擋回復。
- 管理 API、範本與錯誤報表均檢查 Session、Permission、Scope 及 Job 建立者；同源寫入、欄位允許清單、串流 body 大小限制、no-store 與安全錯誤碼。

## 二、新增檔案

- [import-csv.ts](../site/lib/domain/import-csv.ts)、[import-xlsx.ts](../site/lib/domain/import-xlsx.ts)：解析、門檻及範本。
- [匯入服務](../site/lib/server/imports/service.ts)、[HTTP](../site/lib/server/imports/http.ts)、[runtime](../site/lib/server/imports/runtime.ts)、[金鑰設定](../site/lib/server/imports/keys.ts)。
- [匯入 routes](../site/app/api/admin/imports)：8 個入口。
- [CSV 測試](../site/tests/import-csv.test.mjs)、[XLSX 測試](../site/tests/import-xlsx.test.mjs)、[服務測試](../site/tests/import-service.test.mjs)、[金鑰測試](../site/tests/import-keys.test.mjs)。
- 本驗證紀錄。

## 三、修改檔案

- [主規格](../PROJECT_SPEC.md)、[CHANGELOG](../CHANGELOG.md)、[開發說明](../site/README.md)及進度文件。
- [ExamService](../site/lib/server/exams/service.ts)、[AcademicService](../site/lib/server/academic/service.ts)：新增僅由伺服器傳入的交易附加 statements 參數，使匯入紀錄加入既有原子提交；不從 HTTP body 接受 SQL，原呼叫預設空陣列。
- [package.json](../site/package.json)及 lockfile：鎖定 fflate 0.8.3、fast-xml-parser 5.11.1；使用 npm 官方工具安裝，無新增大型試算表套件。
- [環境範本](../site/.env.example)、[Env 型別](../site/cloudflare-env.d.ts)：既有身分 Secret 的版本化 JSON 格式。

## 四、Database Migration

本次沿用既有 import_jobs／import_job_items、Academic／Exam 操作紀錄及 Audit／History 表，沒有 schema 變更，不新增 migration。維持 37 張關聯表及 8 份 migration。核心交易適用既有 Session／Scope 撤銷、來源 revision 與成績版本 guard；匯入另外檢查 Job status、preview_version、期限。

原檔保存在私有 R2，不進 Git。Upload 跨 D1／R2 不能共用交易：失敗 Job 記為 FAILED，不寫入業務資料；可重新上傳。未開啟自動刪除、Purge 或 Production migration。

## 五、測試結果

| 指令                                                                                                    | 結果                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `node --test tests/import-csv.test.mjs tests/import-xlsx.test.mjs`                                      | 基礎解析與限制測試通過；最後新增案例另納完整回歸 |
| `node --import ./scripts/sites-env.mjs --test tests/import-service.test.mjs tests/import-keys.test.mjs` | 第一輪 10 項通過；後續邊界案例另納完整回歸       |
| `npm test`                                                                                              | 125 項通過，0 失敗／略過                         |
| `npm run typecheck`                                                                                     | 通過                                             |
| `npm run lint`                                                                                          | 通過                                           |
| `npm run format:check`                                                                                  | 通過                                       |
| `npm run build`                                                                                         | 通過                                       |
| `node scripts/check-docs.mjs`                                                                           | 通過                                       |
| `node scripts/check-safety.mjs`                                                                         | 通過                                       |
| `git diff --check`                                                                                      | 通過                           |

測試使用隔離 Miniflare D1／R2、虛構學生及程序內金鑰。包含：識別欄位不一致、目標／科目錯誤、重複列與檔案、半途失敗與重試、Commit 併發、Rollback 中途失敗、發布／後續更新阻擋、30 天前後邊界、新生加密與 Soft Delete、原校來源、晚轉入與 NOT_HELD、HTTP Cookie／CSRF／未知欄位、跨班／跨科／他人 Job、提交前撤權、ZIP 偽造長度與展開上限、跨 sheet 列數、UTF-8 錯誤及 key ring 格式。

## 六、安全性檢查

- 身分證原文不保存於 D1 Job／Items；新生預覽沿用加密識別，回應只顯示遮罩。原檔含敏感資料，僅存私有 binding 並以隨機 key 識別，不回傳公開網址。
- 錯誤報表只含列序與錯誤碼；不回顯原始列、Secret、姓名或 SQL。錯誤回應與下載 no-store；所有資料取得均重新授權。
- Commit／Rollback 中途失敗與撤權不留下部分成績、學籍、History、Job 或 Audit。金鑰格式錯誤拒絕且不回顯設定。
- 純解析函式不執行公式、巨集或外部連結；所有外部內容視為資料。

## 七、已知限制

- 僅提供後端 API 與可下載範本，管理 UI 屬 Phase 14。範本是一科一 sheet、同班同分類一個 Job；跨班檔案分開處理。
- 新增成績回復為 UNENTERED／NOT_HELD 並保留 History；新生回復採 Soft Delete＋學籍 voided，保留加密識別及稽核，不視為 Purge。再次使用同一已軟刪除身分須後續 Restore 流程。
- 歷史年度、已發布／鎖定／封存評量或已轉出學生不由匯入繞過保護；已發布成績修正留在 Phase 7 的正式流程。
- XLSX 不接受隱藏 sheet、合併儲存格、非支援儲存格型別、Excel 日期序號或舊版 .xls；日期按 ISO 文字輸入，識別欄位應使用本系統文字範本。
- 上傳門檻與解析限制已核准；雲端 D1／R2 配額、最大批次執行量與真實 Google／Sites callback 尚未實測，不把本機測試當作 Production 容量證明。原檔清理與保存副本 Purge 屬後續階段。

## 八、下一 Phase 預計工作

Phase 7：D-08 發布／鎖定狀態表、Preview／Confirm／Publish、持久化平均與排名結果、已發布成績修改與 History／重算、AI stale 及持久重生請求。須使用者另行核准；本次不開始 Phase 7。
