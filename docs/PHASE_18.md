# Phase 18 — Release Candidate 審查紀錄

日期：2026-10-01。狀態：**部分完成／RC 受阻**。使用者明確批准本階段，未批准正式部署。

## 零、模型與範圍

Recommended HIGH／Minimum HIGH／Current XHIGH（沿用使用者已確認設定）；Action KEEP，無額外風險升級。保留目前設定完成跨模組審查，沒有宣稱自動切換。

僅執行 §65 的全套測試、本機 production build、migration／Secret names／Sites config 與 GitHub／Pages 唯讀審查，準備候選文件及本機 Save Version。沒有補做其他 Phase 的未授權功能或啟動 Phase 19。

## 一、候選與檔案

候選為 [phase18-rc1](RELEASE_CANDIDATE.md)，runtime 基底 `cc83fb5`；主規格 v1.6-draft 與 package 0.0.0 保持原值，不標示正式 Release。

新增本紀錄、Release Candidate 與 [Migration Manifest](MIGRATION_MANIFEST.json)。修改主規格、CHANGELOG、根與 site README、資料模型文件及 Pages 本機準備稿，修正 50 表／16 migration 與 Phase 狀態。補齊 §3.3 既有 AUTH_RATE_HMAC_SECRET 名稱及非 Secret 設定說明，沒有改變政策或 runtime。

## 二、Migration／設定審查

16 份 migration、50 張關聯表、兩個 FTS5；本階段沒有 schema／dependency／lockfile 變更。升級與回填風險、preflight 侷限及復原順序見 RC Migration Summary，正式 runner／history／backup restore 未驗證。

Secret 名稱與 runtime／Env／example 核對一致；example 真實值皆空，verified 預設 false。正式 AI consumer／排程與 Purge copy adapter 未配置。雲端 Secret 及 runtime 注入未實測，GitHub secrets／variables 空不能作為 Sites 配置證據。

## 三、實際驗證

以下 npm 指令的工作目錄為 site；根目錄檢查另行標示。

| 指令                                           | 本輪實際結果                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| npm test                                       | 276 通過、0 失敗、0 skip／取消；511,924 ms                                                                            |
| npm run build                                  | 本機 production build 通過；不是正式部署                                                                              |
| npm run typecheck                              | 通過                                                                                                                  |
| npm run lint                                   | 通過，0 warnings                                                                                                      |
| npm audit --audit-level=high                   | 0 vulnerabilities                                                                                                     |
| npm run db:verify                              | disposable-local-only；空白 0 applied／16 pending；套用及重跑均 16 applied／0 pending，FK／integrity ok，4 名虛構學生 |
| npm run format:check                           | 通過                                                                                                                  |
| node scripts/check-docs.mjs（根目錄）          | 通過：28 份專案 Markdown／477 個本機連結                                                                              |
| node scripts/check-safety.mjs（根目錄）        | 通過：343 個來源檔案，無選定敏感模式；非完整安全稽核                                                                  |
| node scripts/check-client-bundle.mjs（根目錄） | 通過：24 個 client 檔案，無選定 server-only 識別模式                                                                  |
| node scripts/check-build-config.mjs（根目錄）  | 通過：生成 config 關閉 request logs／traces；平台未實測                                                               |
| git diff --check（根目錄）                     | 通過                                                                                                                  |

先前中斷留下的測試 log 只有啟動文字，沒有完整結果，不計入成功證據；本輪重新執行並取得完整結果。runtime／tests 未變更，因此完成檢查後不再重跑未受影響的全套測試。

build 輸出既有 Vinext 靜態路由分類警告，exit code 為 0；動態資料使用 no-store／隱私標頭並有本機測試。本輪沒有瀏覽器 smoke 或正式容量驗收，仍列阻擋。

Migration Manifest 另以 journal 檔名／timestamp 與 SQL 全文 SHA-256 核對，50 張 schema 表與目前 migration 相符；這是本機候選稽核，不是 Production preflight。

## 四、GitHub／Pages 狀態

唯讀查核時間 2026-10-01 08:59 UTC：遠端 Public／main、HEAD 19017e8（Phase 13）；本輪開始時本機 HEAD cc83fb5，領先已知 origin/main 兩個 commit。Repository 與 Pages HTTP 200。

最新 Verify project／Pages workflows active 且 success，均屬 Phase 13，沒有本輪 RC 的遠端 CI。詳見 RC 的實際 run links。本輪不 Push、不 dispatch workflow、不建立 tag／Release；本機 README／Pages 修改不表示線上已同步。

## 五、安全、限制與後續

所有測試資料皆虛構，Google／AI 為 mock；沒有真實 Secret、學生資料、付費 API、Production migration／Purge、Sites deployment 或正式 smoke test。

Audit 介面及授權驗收（角色已定案為僅 active super_admin）、D-11 復原演練（已核准 RPO≤24 小時／RTO≤8 小時）、D-09 真實 Google 平台政策／流程、最新版 UI／Print 驗收、正式 DB／備份、可信 IP／清理、consumer／用量、Purge 副本及 1,000 人報表容量保留阻擋。使用者已採用 RPO≤24 小時／RTO≤8 小時，已回寫正文／D-11／RC，但平台演練未通過，gate 不解除；使用者後續同意 Audit 僅 super_admin 查看，已同步 §38／D-10／驗收要求與 RC；介面及授權驗收仍未完成，gate 不解除。本次為純文件政策同步，不重跑未受影響的 runtime／migration tests。

Phase 18 不能標為完成或請求進入正式部署；繼續可完成的本機準備，本輪保存可審查的本機 commit，沒有遠端同步或正式 Release。下一 Phase 19 仍須解除適用 gates，並另取得明確「確認正式部署」。
