# Release Candidate — phase18-rc1

日期：2026-10-01。狀態：**BLOCKED／僅本機保存，尚未取得正式發布資格**。

基底程式 commit：`cc83fb5`（Phase 17）。本階段僅整理候選、檢查及文件，runtime／dependency／schema 沒有變更。候選識別不是正式軟體版本；private package 保持 `0.0.0`，主規格仍是 `v1.6-draft`，沒有 frozen、tag、GitHub Release 或 Sites deployment。

## Release Notes

已建立的本機功能包括學年度／班級／學生與學籍、Google-only 管理認證與 Scope、精確成績／平均／共同排名、CSV／XLSX Preview／原子 Commit／Rollback、分分類發布、歷史快照、AI Provider／允許欄位 Context／成對建議與持久 Jobs、RAG、公開查詢、封存／復原與受控 Purge 核心，以及管理工作區與報表核心。

Phase 16 加入交易、Session／Origin／容量與限流安全檢查；Phase 17 串接從新生到九年級畢業／Purge 的完整生命週期，並修正檢測發布後不能匯入未發布段考的問題。只寫未發布分類不改公開快照或匹配的 AI；已發布修改、混合批次、版本及發布競態仍受伺服器保護。

上述為隔離 D1／R2、虛構資料、mock Google／AI 的本機證據，不代表所有 UI 驗收或正式平台能力已完成。

<a id="migration-summary"></a>

## Migration Summary

16 份 migration（0000～0015）、50 張關聯表、兩個 FTS5；不計 FTS shadow tables。文件清單、journal timestamp 與 SQL 全文 SHA-256 見 [Migration Manifest](MIGRATION_MANIFEST.json)，實體模型見 [DATABASE.md](DATABASE.md)。本候選沒有新增 migration，已提交 SQL 不改寫。

| Migration  | 升級內容及注意事項                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| 0000～0001 | 核心表、跨列約束及第一個 FTS；既有片段 rebuild。                                                     |
| 0002～0003 | 學籍命令與守衛；以最新年度初始化 academic_state，既有 DB 須確認所選年度。                            |
| 0004～0006 | OAuth／一次性身分異動；替換用途 trigger；舊 Session recent_auth_at=0，高風險操作須 Google 重新驗證。 |
| 0007～0008 | 評量／名冊與發布命令、不可變快照；更早的已發布結果不自動回填快照，升級前須清點。                     |
| 0009       | 封存及保存事件；既有保存期限回填 LEGACY 承諾，不能縮短。                                             |
| 0010       | Soft Delete／Purge／寫入鎖；回填回收期限與可驗證的 Import Rollback 學籍版本。                        |
| 0011       | RAG upload、搜尋詞及第二個 FTS；舊材料需受控確認／更新索引，不自動納入新檢索。                       |
| 0012       | AI job 授權／版本／設定／用量；舊工作授權欄位 NULL，不自動領取或呼叫付費 API。                       |
| 0013       | 公開 HMAC 限流；正式可信 IP、清理及所有副本 24 小時保存政策未驗證。                                  |
| 0014       | 學籍交易內重驗 Session、idle／recent 時窗；不相容的舊寫入者可能遭拒絕。                              |
| 0015       | 登入 HMAC 限流表與索引，不改寫既有業務資料。                                                         |

本機 preflight 比對完整 journal 前綴的 hash／timestamp、必要物件、FK 及 quick_check；不比對完整欄位型別／CHECK／trigger SQL，不能稱為全面 schema drift 稽核。db-local 只建立 disposable Miniflare DB，沒有 Production runner 或 database-id 選項；應用啟動不套用 migration。

正式升級前仍須確認 DB 身分、正式 history／migrator、跨檔原子性、中斷恢復、備份／還原與 Secret 版本。復原先停止寫入，在隔離環境還原並檢查 journal、FK、FTS、筆數與密文；優先向前修正。不提供破壞性 down migration，不假定程式回退能還原資料庫，不捏造 history。

## Secret Names／Site Config

只審查名稱及設定，未讀取或保存真實 Secret 值。

| 類別             | 名稱                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Google           | GOOGLE_OAUTH_CLIENT_ID、GOOGLE_OAUTH_CLIENT_SECRET                    |
| 受控初始化／復原 | ADMIN_BOOTSTRAP_SECRET、ADMIN_RECOVERY_SECRET                         |
| 身分資料         | IDENTITY_ENCRYPTION_KEY、IDENTITY_HMAC_SECRET（獨立金鑰及版本）       |
| 限流             | PUBLIC_LOOKUP_HMAC_SECRET、AUTH_RATE_HMAC_SECRET（各自獨立）          |
| AI               | OPENAI_API_KEY、GEMINI_API_KEY（不影響管理員登入資格）                |
| 非 Secret 設定   | GOOGLE_OAUTH_REDIRECT_URI、PUBLIC_LOOKUP_VERIFIED、AUTH_RATE_VERIFIED |
| Bindings         | DB、FILES                                                             |

名稱與 runtime／Env／空白 .env.example 一致，§3.3 已補齊登入 HMAC 名稱；沒有新增環境名稱。公開／登入 verified 在範本預設 false。正式 AI queue／cron 尚未配置，Purge runtime 沒有 copy adapter，均不能以 request 或旗標任意繞過。

hosting.json 的 DB／FILES 是邏輯 binding；本機生成 config 的 placeholder database ID 不是已確認的 Production DB。build config 關閉 observability、request／invocation logs 及 traces，沒有 Secret vars；平台實際遵守行為仍須實測。

## Known Issues／Release Gates

| ID    | 阻擋項目                                                                                     | 解除所需證據                                                                                    |
| ----- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| RC-01 | Audit 查看角色未定案，管理 UI 部分完成                                                       | 使用者明確決策，後續於該功能範圍實作並通過 Permission／Scope 及輸出驗收。                       |
| RC-02 | 最新 Admin／手機 UI、下載／列印瀏覽器驗收未完成                                              | 可用且獲准的工具完成最新流程／Print CSS 驗收；不繞過既有 browser 安全阻擋。                     |
| RC-03 | D-09 Google OAuth／Sites callback／Cookie／帳號政策未驗證，依既有指示暫緩                    | 真實 Google-only 流程、精確 callback、Secure／HttpOnly／SameSite Cookie 與授權 Email 政策驗收。 |
| RC-04 | 正式 DB／migration／backup restore／Secret 復原未驗證；D-11 復原目標已定案，演練尚未驗證達標 | 達成 RPO≤24 小時／RTO≤8 小時，平台 preflight 與隔離演練，確認資料／密文／history／FTS 一致性。  |
| RC-05 | 正式可信 IP、平台 logs、限流清理與備份保存未驗證                                             | 驗證傳遞及保存／清理承諾後才可開啟 verified；目前維持關閉。                                     |
| RC-06 | 正式 durable AI consumer／排程與用量限制未驗證                                               | 持久 claim／重試／去重／撤權與工作版本實測；mock 不作正式證據。                                 |
| RC-07 | Production Purge 副本／備份清點及刪除能力未驗證                                              | 完整 copy adapter、共享副本承諾與逐項刪除／缺失驗證；全部驗證前保持停用。                       |
| RC-08 | 1,000 人 PDF／Excel 的正式 CPU／記憶體／時間容量未驗證                                       | 在正式平台能力下的合成資料容量驗收，不能以受控 1,001 人查詢模擬代替。                           |
| RC-09 | 本機候選未同步 GitHub／Pages；本次 RC 沒有遠端 CI 結果                                       | 取得對應範圍授權後同步，等待同一候選 commit 的 CI／Pages，驗證版本與 URL。                      |
| RC-10 | 沒有正式部署授權或已驗證 Sites URL                                                           | 使用者明確「確認正式部署」，且先解除上述適用阻擋，再依 §66 執行。                               |
| RC-11 | D-11 其餘查詢／容量門檻與正式服務能力尚未定案或驗證                                          | 依實際平台量測與使用者決策完成；不能以本機測試或程式暫時上限宣稱正式容量。                      |

使用者已採用 RPO≤24 小時／RTO≤8 小時的復原目標；最多可能失去 24 小時內資料。這是驗收目標，尚未完成平台演練，不宣稱已達標。Audit 問題仍待答覆，未把建議當作核准政策。即使決策定案，必要實作／平台驗收仍須完成，不能只更新文字就解除 gate。

## Test Summary

Phase 18 全套 276 項 tests 通過（0 失敗／skip／取消）；本機 production build、typecheck、lint、audit（0 vulnerabilities）及 disposable db:verify 通過。格式、文件／安全／bundle／config 的最終結果見 [Phase 18 紀錄](PHASE_18.md)。全部屬本輪實際結果，不使用遠端舊版本或 Phase 17 的成功數冒稱。

## GitHub／Pages 與發布準備

2026-10-01 08:59 UTC 唯讀查核：[Repository](https://github.com/kisaraki/classroom-aigrade-tzk) 與 [Pages](https://kisaraki.github.io/classroom-aigrade-tzk/) 均 HTTP 200，repository Public／main；遠端 HEAD 為 `19017e8`（Phase 13）。[Verify project](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36678595820) 與 [Pages workflow](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36678595707) 成功，兩者只屬 Phase 13。

本機 README 最新部署區塊及 pages/index.html 已準備候選內容。Pages workflow 只上傳 pages/ 靜態文件，不承載登入、查詢、D1 或 AI。僅 README 變更不會觸發 Pages；正式同步需包含 Pages 內容。未 Push／觸發 workflow 前，遠端仍是 Phase 13，不宣稱 RC 或 Sites 已發布。

下一階段仍是 Phase 19；本候選受阻，不請求或執行正式部署。正式 URL、日期及三網址驗證只能在實際成功後填入。
