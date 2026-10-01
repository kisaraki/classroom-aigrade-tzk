# Phase 17 — Full Lifecycle Integration Test

日期：2026-10-01。狀態：**本機生命週期整合完成**。

Recommended=XHIGH；Minimum=HIGH；Current=XHIGH（沿用使用者確認）；Action=KEEP，無額外風險升級。使用者明確批准本 Phase，沒有批准 Phase 18 或正式部署。

## 主流程重現

新增 `site/tests/full-lifecycle.test.mjs`，使用空白隔離 D1／R2、完整 16 份 migration、實際 AdminWorkspace 授權 adapter 建立學年度、班級、新生、評量與名冊；CSV 經 Upload／Preview／Confirm／Commit，再由 Publication 與 PublicLookup 服務讀取已發布版本。

初次驗證重現 §64 的阻擋：檢測發布後，段考 Preview 被整評量唯讀規則拒絕。使用者採用 D-08 分類鎖定補充後，已同步主規格、Preview 及 Commit 交易邊界；主流程順序現在可完成。

只有成績草稿入口可寫入尚未發布的分類；已發布分類或混合批次整批拒絕，發布快照缺失／分類不合法時拒絕。D1 batch 同時重驗分類、評量版本、Session、Permission 及 Scope；名冊、時程、科目設定與原校參與仍沿用整評量草稿限制。Rollback 仍受既有發布與後續異動衝突限制。

## 完整串接驗證

以檢測匯入／發布、再段考匯入／發布的核准順序，串接測試 AI 重生、公開投影、歷史快照、轉班、兩次跨年度升班、九年級畢業及全年段封存、Archive Undo、保存期限與私有副本 Purge 重試。主流程與完整生命週期均使用核准的順序，另保留反向發布及競態情境。

所有資料皆虛構；Google／AI 為 mock。Purge 僅操作 disposable Miniflare D1／R2，沒有正式刪除、真實資料、付費 API 或 Production migration。正式 OAuth、可信 IP、排程與備份能力仍未實測；Phase 14／15 的 Audit 角色及瀏覽器驗收繼續保留。

## 版本與驗證

使用者批准進入 Phase 17 已確認前一階段；先以 `2a5a116` 保存 Phase 16 安全成果及其依賴的 Phase 14／15 部分成果，commit 明示後兩階段未完成，沒有 Push／Release。第三方字型 OFL 原文有一處既有行尾空白，保留原授權檔，不宣稱新增第三方檔案的 whitespace 檢查完全通過。

Phase 17 測試及文件驗證已完成。沒有新增 schema／migration／dependency；沒有跳過失敗情境；分類修正後重新執行適用驗證。

## 已通過的生命週期檢查

- 獨立完整串接：新生與名冊、0 與 NULL、只公開已發布分類、AI 允許欄位與成對建議、已發布成績修正的 History／重算／重新鎖定／stale／重生、第二次評量、轉班、學期續籍、兩次升班至九年級、歷史修改的原因及 5 分鐘 Google 時窗、畢業與全年段封存、Archive Undo、1 年保存邊界、Purge 二次確認、真實隔離 R2 副本失敗／重試、最小證據、其他學生歷史排名保持與重算凍結。
- 分支串接：匯入整批 Rollback 將新成績回復為 UNENTERED／NULL 並保留 History，而不是當作 0 或直接移除歷程；發布後回復受阻。晚轉入不重建舊名冊，下一次評量接納新生，原校分數不混入本校平均／名次；轉出後不建立 AI 工作、下一次名冊排除轉出者；Soft Delete 的 30 天承諾阻擋 Purge，可 Restore；轉出 3 年邊界及 Purge 可驗證清理。
- 跨班公開查詢使用歷史 class snapshot；不接受目前班級代替。公開結果不含其他學生名稱／學號／Student ID 或個人全年段排名。
- 每個隔離資料庫都套用完整 migration；最後檢查 FK 與無待套用 migration。所有日期前進以 mock Google 重新登入取得新的合法 Session，不手動延長 Session／竄改 domain 期限。

畢業採既有 `GRADUATE` 對九年級 grade target 的原子行為，包含學生狀態及全年段封存 Manifest，並不對已封存班級再做第二次 Archive。副本失敗時學生與匯入 metadata 仍存在且受 Purge lock 保護，全部副本確認清除後才刪除資料與清空 Manifest；不把 PARTIAL 當 DONE。

## 分類邊界與競態

- 檢測先發布後，段考可經匯入及直接草稿寫入；反向段考先發布後，也可匯入檢測。
- 已發布分類與混合批次拒絕，成績保持原值；名冊 Preview 仍拒絕。
- 未發布分類寫入不改既有公開快照，不使匹配的 AI 建議 stale，公開端仍只顯示已發布分類及暫時排名。
- Preview 後發布，舊 Commit 拒絕且 Import Job 留在 PREVIEW；沒有成績變動。
- 在成績檢查後、D1 batch 前插入真實 Publication 確認，交易拒絕整批；無新的 score、History 或操作 receipt。

## 驗證結果與未執行項目

以下 npm 與測試指令的工作目錄為 site；根目錄指令另外標示。

| 指令                                                                                                                                                                                                 | 實際結果                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| npm test                                                                                                                                                                                             | 276 通過、0 失敗、0 skip／取消；503,881 ms                            |
| node --import ./scripts/sites-env.mjs --test --test-concurrency=2 --test-timeout=180000 tests/full-lifecycle.test.mjs tests/exams.test.mjs tests/publication.test.mjs tests/admin-workspace.test.mjs | 同步管理入口後，39 通過、0 失敗、0 skip／取消；173,615 ms             |
| npm run typecheck                                                                                                                                                                                    | 通過                                                                  |
| npm run lint                                                                                                                                                                                         | 通過，0 warnings                                                      |
| npm run format:check                                                                                                                                                                                 | 通過                                                                  |
| npm run build                                                                                                                                                                                        | 本機 build 通過；不代表 Production 部署                               |
| node scripts/check-client-bundle.mjs（根目錄）                                                                                                                                                       | 24 個 client 檔案，未發現選定 server-only 識別模式                    |
| node scripts/check-build-config.mjs（根目錄）                                                                                                                                                        | 生成 Worker config 關閉 request logs／traces；平台實際執行未驗證      |
| node scripts/check-docs.mjs（根目錄）                                                                                                                                                                | 26 份專案 Markdown，本機連結通過                                      |
| node scripts/check-safety.mjs（根目錄）                                                                                                                                                              | 340 個來源檔案，未發現選定 Secret／身分證模式；不是完整個資或安全稽核 |
| git diff --check（根目錄）                                                                                                                                                                           | 本階段差異通過                                                        |

完整回歸期間同步了管理入口，因此另對最後的受影響模組重跑 39 項。原本按整評量 published_at 選擇修改流程，現在使用伺服器授權讀取的 publishedComponents：未發布分類走草稿；已發布分類走原因／近期驗證／重算流程；兩種分類不可混合提交。後端 Publication EDIT 也拒絕尚未發布分類，防止從該入口誤觸公開版本與 AI 重生。

Typecheck 曾指出新增型別缺少發布欄位及前端 data 可能為 null，已修正並重驗通過；不把中間失敗當成最終結果。沒有新增 dependency 或 lockfile 變更，dependency audit 沿用 Phase 16 的 0 vulnerability 結果，未重跑無關套件檢查。

Database Migration：無新增；仍為 16 份 migration／50 個 relational tables。完整情境的隔離資料庫從空白套用全部 migration，通過 FK 及無待套用 migration 檢查。未執行 Production migration。

最初的主流程失敗是修正前的真實證據。開發中也修正測試自身的欄位及預期（History 的 score_item_id、participation 的 origin、Rollback 回復為 UNENTERED／NULL、Purge 副本失敗保留資料），沒有為了通過而弱化產品規則。

沒有真實 OAuth／AI、正式備份實測、Push／Release 或 Sites 部署。正式可信 IP、排程、備份、Google callback 及 Production Purge 仍待平台實測，正式入口與 consumer 未開啟。

管理入口僅完成分類流程同步及本機 build／服務回歸，沒有繞過既有 browser 工具阻擋進行視覺驗收；Phase 14／15 的 Audit 角色與瀏覽器驗收仍未完成。Phase 17 完成不表示先前未完成項目已消失，也不表示適合正式上線。

## 檔案與後續

新增：site/lib/server/exams/component-lock.ts、site/tests/full-lifecycle.test.mjs、本紀錄。

修改：PROJECT_SPEC.md、CHANGELOG.md、README.md、site/README.md、site/lib/server/exams/service.ts、site/lib/server/exams/publication.ts、site/lib/server/imports/service.ts、site/app/admin/scores.tsx、site/tests/exams.test.mjs。

下一 Phase 18 為 Release Candidate，檢查 release 候選、必要驗收缺口、migration／Secret names／Sites config 及部署準備；尚未授權。正式部署仍另需使用者明確「確認正式部署」。
