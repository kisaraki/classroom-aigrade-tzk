# Phase 7 驗證紀錄

日期：2026-09-25。使用者核准 Phase 7，並明確採用 D-08。範圍見 [主規格 §54](../PROJECT_SPEC.md#spec-54)。本機實作及驗證完成，不代表 Production migration、Sites 部署或 Phase 8 已開始。

## 零、模型／推理強度

- Recommended：HIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，沿用已確認設定；Action：KEEP，未另外升級。

## 一、完成項目與狀態轉換

發布以完整評量分類為單位；整份發布要求 score.write 的全校 Scope。修改允許既有導師／任課教師 Scope，逐列檢查班級及科目。兩者都須有效 Session、Google Recent Authentication、來源版本及 academic revision。

| 起始狀態                               | 操作／條件                                | 成功狀態及公開版本                                                                                | 失敗行為                            |
| -------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------- |
| draft、無公開版本                      | Preview → Confirm，發布 QUIZ 或 MIDTERM   | partially_published、locked；PROVISIONAL 只含該分類                                               | 整筆不生效，無公開結果              |
| partially_published、locked            | 明確發布另一分類                          | published、locked；FINAL 包含兩分類                                                               | 保留上一完整 PROVISIONAL            |
| partially_published／published、locked | 有 Scope 的修改預覽、原因、確認           | 交易內 unlock → Score／History → 重算／保存 → AI stale／Jobs → Audit → relock；維持原發布分類集合 | 保留舊成績、History、結果及鎖定狀態 |
| historical、locked                     | super_admin、原因與 Recent Authentication | 同上，保留原始評量快照                                                                            | 拒絕越權或過期認證，維持舊版本      |
| archived                               | 發布／修改                                | 拒絕；須後續正式 Restore                                                                          | 不改變資料                          |

- 全部 NOT_HELD 仍須明確發布；缺分不阻擋發布，不以 0 代替；兩分類皆發布才為 FINAL。
- 不開放跨請求的持續解鎖；評量發布、鎖定與年度／封存狀態分開判斷。部分發布後未發布分類的後續填分也走有原因、預覽及原子 relock 的修改入口，且不進入公開快照。
- 每次保存完整結果版本、各參與者結果與不可變快照；班級讀取只使用已提交版本，去除全年段個人排名及其他班級。未加入家長公開查詢入口。
- 首次發布固定統計母體，後續重算沿用；原校成績獨立保存，不混入本校排名。
- Confirm 重送回傳原結果，併發不建立重複有效版本／History／AI Jobs。Confirm 及交易內再次檢查撤權、來源與認證期限。
- 修改影響同評量班級／全年段排名，故該評量所有舊 AI 建議標記 stale，為仍 active 且未刪除的參與學生建立 parent／student 重生請求。轉出、畢業或軟刪除者不建立新請求。
- AI 呼叫不在成績交易內；Phase 7 僅保存去重請求及提供 mock 消費契約，Phase 12 接入提供者與最終寫入時的版本檢查。

## 二、新增檔案

- [publication.ts](../site/lib/server/exams/publication.ts)：預覽、確認、交易、完整快照、班級讀取及重生請求契約。
- [HTTP](../site/lib/server/exams/publication-http.ts)、[runtime](../site/lib/server/exams/publication-runtime.ts)及 [publication routes](../site/app/api/admin/exams/[id]/publication)：三個管理 API。
- [0008 migration](../site/drizzle/0008_phase_07_publication.sql)及 Drizzle snapshot。
- [publication.test.mjs](../site/tests/publication.test.mjs)與本紀錄。

## 三、修改檔案

- [主規格](../PROJECT_SPEC.md)、[CHANGELOG](../CHANGELOG.md)、README、Pages 與預覽首頁進度。
- [ranking.ts](../site/lib/domain/ranking.ts)：D-08 明確 components，PROVISIONAL 支援段考先發布；保留未傳 components 的既有計算介面，計算版本更新為 phase7-v1。
- [schema.ts](../site/db/schema.ts)、migration journal；既有 migration 測試的總數更新為 9 份／39 張關聯表。

## 四、Database Migration

新增 publication_previews 與 publication_snapshots；預覽只能一次連結成功結果，其他欄位不可更改，結果快照不可更新。沿用既有 exam_result_versions、exam_results、ScoreChangeHistory、Audit 及 AI Jobs 表。舊 migration 不修改。

升級驗證：先建立 Phase 6 的 8 份 migration、虛構成績，再套用 0008，確認原成績不變、FK／integrity 通過且重跑無待套用項目。生產環境尚未執行。復原策略為先 preflight、備份並檢驗平台資料復原能力；已發布新資料後不能只回退程式或直接刪表。正式 migration 仍須人工確認與 recovery 檢查。

## 五、測試結果

| 指令                                                                      | 結果                                                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `node --import ./scripts/sites-env.mjs --test tests/publication.test.mjs` | 11 項通過（完整回歸涵蓋）                                |
| `npm test`                                                                | 136 項完整回歸通過；新增 2 項分類測試亦通過，總計 138 項 |
| `npm run typecheck`                                                       | 通過                                                     |
| `npm run lint`                                                            | 通過                                                     |
| `npm run format:check`                                                    | 通過                                                     |
| `npm run build`                                                           | 通過                                                     |
| `node scripts/check-docs.mjs`                                             | 通過                                                     |
| `node scripts/check-safety.mjs`                                           | 通過                                                     |
| `git diff --check`                                                        | 通過                                                     |

全部測試使用虛構學生、程序內測試金鑰及隔離 Miniflare D1。實際 Google callback 依既有指示暫緩；沒有呼叫 AI 或 Sites 部署。

## 六、安全性檢查

- HTTP 驗證 Cookie、Origin、JSON、1 MiB 串流上限、欄位允許清單、URL 與 Preview 所屬評量一致；no-store，錯誤碼不含 SQL／Secret。
- 預覽只允許建立者確認，Confirm 重驗權限，交易 guard 檢查真實 Session／Google 時窗；教師不能取得全校發布預覽。
- 快照不含姓名、生日、身分證或學號；必要 Student ID 僅在伺服器／授權管理端，不當作 AI 模型輸入。修改原因為受保護 History 資料，不複製到一般 Audit metadata。
- 成績、History、結果、stale、Jobs、Audit 及鎖定同一 D1 batch，SQL 參數綁定。

## 七、已知限制

- 本階段提供管理 API 與內部服務，管理 UI 為 Phase 14，家長查詢為 Phase 13。
- regenerationRequest 是消費前的版本／資格檢查，不能取代 Phase 12 寫入 AI 結果時的原子 guard；本階段沒有實際 AI 生成、RAG 或字數驗證功能。
- 目前已建立的 AI 相依範圍是該評量的個人成績及班級／全年段排名。Phase 12 新增同學期比較 Context 時，須同步擴充跨評量的 stale／重生相依關係。
- 雲端 D1 最大交易容量、真實 OAuth 與 Sites callback／復原能力尚未實測；本機通過不代表 Production 已可部署。

## 八、下一 Phase 預計工作

Phase 8：封存、畢業、保存期限、Preflight、Undo／Restore 及到期控制；須另行授權及定案相關保存政策，本次不開始。
