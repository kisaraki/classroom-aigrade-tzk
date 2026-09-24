# Phase 4 驗證紀錄

日期：2026-09-24。使用者明確批准進入 Phase 04；範圍為 [主規格 §51](../PROJECT_SPEC.md#spec-51)。狀態：Phase 4 已完成本次核准的本機實作與驗證。沒有開始 Phase 5，沒有 Production migration 或 Sites 部署。

## 零、模型／推理強度

- Recommended：HIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，本回合紀錄已確認。
- Action：KEEP；沿用有效設定，符合 Minimum，未因風險另行升級。

## 一、完成項目

- 每學期評量次序限制 1～3，拒絕跨學期／無效日期及重複次序；建立 3 個 QUIZ、7 個 MIDTERM 科目設定。已有名單快照後不能改換日期。
- 科目 held 屬全評量設定，已有本校成績不能單獨變更；學生的 N 與設定不符即拒絕，不會修改全評量設定。原校成績維持獨立舉行語意。
- 分數接受 0～100、最多兩位小數，直接解析為百分之一分整數。A/B/C/D/N、未輸入、0 分分開保存；特殊狀態及未輸入不納入平均。
- 班級名單由開始日有效學籍產生 Preview，Confirm 重驗操作人、Scope、評量版本及學籍 revision。D-03 的學生／學期／單次資格來源與最終結果、班級／年級／座號一併固定。
- 轉入時間晚於評量開始日者不納入該次本校名單。原校參與需有效學生學籍授權，保存原校標籤與獨立 origin，本校班級快照為空、排名資格固定為否。
- 草稿成績 API 使用既有 Google Session、Permission、班級及科目 Scope。禁止以客戶端身分、角色、snapshot 或排名欄位授權；任課教師不能把不同任教班級及科目交叉組合。
- 成績、ScoreChangeHistory、評量版本、Audit 與操作 receipt 同一 batch 提交；操作人撤權、來源變更、同時寫入或批次中途失敗均拒絕或完整回滾。相同 operationId、actor 與命令重送回傳原結果。
- 成績讀取限定已授權班級／科目，回應 no-store。未存入的科目由設定呈現 NOT_HELD／UNENTERED，不假裝成績為 0。

## 二、新增檔案

- [scores.ts](../site/lib/domain/scores.ts)：科目常數、特殊代碼及精確分數解析。
- [ExamService](../site/lib/server/exams/service.ts)：評量、名單、原校參與、草稿成績、歷程與交易控制。
- [HTTP 邊界](../site/lib/server/exams/http.ts)、[runtime](../site/lib/server/exams/runtime.ts)。
- [評量管理 routes](../site/app/api/admin/exams)、[參與紀錄 route](../site/app/api/admin/exam-participations)：共 8 個 route 檔，9 個方法／操作入口。
- [0007 migration](../site/drizzle/0007_phase_04_exam_commands.sql)、[snapshot](../site/drizzle/meta/0007_snapshot.json)。
- [exams.test.mjs](../site/tests/exams.test.mjs)：11 組 Phase 4 測試。
- 本驗證紀錄。

## 三、修改檔案

- [PROJECT_SPEC.md](../PROJECT_SPEC.md)、[README.md](../README.md)、[CHANGELOG.md](../CHANGELOG.md)、[DATABASE.md](DATABASE.md)、[開發說明](../site/README.md)、[Pages](../pages/index.html)。
- [本機預覽首頁](../site/app/page.tsx)：同步 Phase 4 進度文案。
- [schema.ts](../site/db/schema.ts)、[migration journal](../site/drizzle/meta/_journal.json)。
- [academic.test.mjs](../site/tests/academic.test.mjs)、[authorization.test.mjs](../site/tests/authorization.test.mjs)、[migrations.test.mjs](../site/tests/migrations.test.mjs)：同步 migration／schema 數量，既有斷言仍保留。

## 四、Database Migration

- 新增 exam_roster_previews、exam_operations，合計 37 張關聯表及 FTS5、8 份 migration。operationId 主鍵防止重複命令；preview 唯一關聯防止重複確認；兩表有禁止更新的 trigger。
- 已提交 0000～0006 SQL／snapshot 不改動。0007 只新增表、索引與 trigger，不重建表、不改寫成績／名單／Sessions。
- 升級案例從 Phase 3B 七份 migration 與既有虛構資料起始，檢查原成績、名單及 Sessions 保留、外鍵完整與 migration 可重跑。
- 不使用應用回退刪除新表。Production migration 仍須備份／復原計畫、preflight 與人工確認；本次只使用隔離 Miniflare 資料庫。

## 五、測試結果

以下 npm 指令於 site 目錄執行；文件與安全檢查於 repository 根目錄執行。

| 指令                                                                | 結果                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `node --import ./scripts/sites-env.mjs --test tests/exams.test.mjs` | 初次可執行版本 10／10 通過；最後調整另納入完整回歸              |
| `npm test`                                                          | 84 項通過，0 失敗、0 跳過，含完整既有回歸及 11 組 Phase 4 測試  |
| `npm run lint`                                                      | 通過                                                            |
| `npm run typecheck`                                                 | 通過                                                            |
| `npm run format:check`                                              | 通過                                                            |
| `npm run build`                                                     | 通過                                                            |
| `npm run db:generate -- --name phase_04_drift_check`                | 37 張表，無 schema 差異，未產生額外 migration                   |
| `npm run db:verify`                                                 | 8 份 migration 套用及重跑成功，FK／integrity 正常，4 位虛構學生 |
| `node scripts/check-docs.mjs`                                       | 12 份專案 Markdown 與全部本機連結通過                           |
| `node scripts/check-safety.mjs`                                     | 185 個來源檔通過既定規則，Pages 保持靜態                        |
| `git diff --check`                                                  | 通過                                                            |

測試案例包含精確小數邊界、A/B/C/D/N、缺值／0、跨學期目標、任課組合、偽造角色、混合批次、名單來源過期、D-03 快照、原校來源、發布／鎖定／封存／歷史限制、轉出禁止寫入、併發只成功一次、相同命令重送、第二筆失敗完整回滾、交易前撤權、CSRF／JSON／Cookie 與 migration 升級。資料與金鑰皆為虛構或程序內產生。

## 六、安全性檢查

- API 使用伺服器 Session 與資料庫授權；寫入須同源 Origin、JSON、欄位允許清單；錯誤只回傳代碼，不輸出 SQL／Secret／學生內容。
- 來源版本與 Session 在寫入 batch 內重驗；Assignment／Role 變更透過既有 Session 撤銷 trigger 阻止已撤權操作完成。
- 成績及 History 不會部分成功；同一操作重送仍重驗目前 Scope，不能取得他人的 receipt。History 初次輸入記錄 null → 新值，後續保存前後值與遞增版本。
- 此階段只接受目前年度草稿；已發布分項即使尚未設定評量 published_at，也不能經草稿入口寫入。
- 沒有新 dependency、真實個資、雲端 Secret、公開成績查詢或 AI 呼叫。
- 前端 14 個產物檔未發現受檢查的伺服器認證／成績模組、Secret 名稱或虛構 seed 識別；Worker 具 default fetch 入口。此項為靜態產物檢查，不代表真實平台已驗證。

## 七、已知限制

- 真實 Google OAuth／auth_time／Sites callback 依 D-09 暫緩；HTTP 安全驗證使用真實本機 Session 及隔離 D1，Google 身分來源為測試 stub，未宣稱 Production 通過。
- 管理 UI 尚未建立。平均／排名、統計母體 D-04、匯入 D-07、發布／解鎖 D-08 留待各自 Phase；沒有提前決定 NULL 總分或 FINAL 語意。
- 已有本校成績的 held 切換保留 Phase 1 阻擋規則；本 Phase 不提供刪除成績來繞過約束的入口。
- 操作去重及班級名單來源依資料庫版本作保守衝突檢查；不同學生同時修改同一評量時仍可能需要重新讀取評量版本。
- 原校參與的授權依學生目前有效學籍；無有效學籍時拒絕此入口。後續保存／復原／報表流程需另處理正式的歷史存取權限。
- 名單 Preview、操作紀錄與歷程是敏感業務資料；Phase 9 Purge 必須納入相關引用及保存承諾。本 Phase 不自行刪除它們或決定保存政策。
- 本機規則掃描與功能安全測試不等同全面滲透測試；正式環境仍須依 Phase 18 關卡驗證。

## 八、下一 Phase 預計工作

[Phase 5](../PROJECT_SPEC.md#spec-52)：平均與排名引擎、精確小數、班級／全年段及學期計算。先確認 D-04 的無有效分數、比序缺值與統計母體；等待使用者確認 Phase 4 後才開始。
