# Release Candidate — phase18-rc1

更新日期：2026-10-02。狀態：**業務 Release 仍 BLOCKED；Sites 版本 1／D1 基礎設施已部署，詳見 Phase 19**。

初次基底程式 commit：`cc83fb5`（Phase 17）；目前 runtime／tests 基底為 `850aa9d`（Audit 補做），驗證起點 HEAD `3dbfe19`。初次 Phase 18 檢查未變更 runtime；使用者其後另核准 Phase 14 Audit 補做，已完成本機 API／介面及授權驗證。其後核准 Sites／Passkey 遷移，已變更 dependency／schema；本次驗證見 Phase 19。候選識別不是正式軟體版本；private package 保持 `0.0.0`，主規格仍是 `v1.6-draft`，沒有 frozen、tag 或 GitHub Release；後續 Sites 版本 1 僅完成基礎設施部署，業務 gates 保留。

## Release Notes

已建立的本機功能包括學年度／班級／學生與學籍、Sites／Passkey 管理認證與 Scope、精確成績／平均／共同排名、CSV／XLSX Preview／原子 Commit／Rollback、分分類發布、歷史快照、AI Provider／允許欄位 Context／成對建議與持久 Jobs、RAG、公開查詢、封存／復原與受控 Purge 核心，以及管理工作區與報表核心。

Phase 16 加入交易、Session／Origin／容量與限流安全檢查；Phase 17 串接從新生到九年級畢業／Purge 的完整生命週期，並修正檢測發布後不能匯入未發布段考的問題。只寫未發布分類不改公開快照或匹配的 AI；已發布修改、混合批次、版本及發布競態仍受伺服器保護。

上述為隔離 D1／R2、虛構資料、mock Google／AI 的本機證據，不代表所有 UI 驗收或正式平台能力已完成。

<a id="migration-summary"></a>

## Migration Summary

17 份 migration（0000～0016）、53 張關聯表、兩個 FTS5；不計 FTS shadow tables。文件清單、journal timestamp 與 SQL 全文 SHA-256 見 [Migration Manifest](MIGRATION_MANIFEST.json)，實體模型見 [DATABASE.md](DATABASE.md)。認證遷移新增 0016，已提交 SQL 不改寫。

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
| 0016       | Sites／Passkey 綁定及 challenge；撤銷舊 Sessions／OAuth state／核准，不自動映射舊身分。              |
| 0015       | 登入 HMAC 限流表與索引，不改寫既有業務資料。                                                         |

本機 preflight 比對完整 journal 前綴的 hash／timestamp、必要物件、FK 及 quick_check；不比對完整欄位型別／CHECK／trigger SQL，不能稱為全面 schema drift 稽核。db-local 只建立 disposable Miniflare DB，沒有 Production runner 或 database-id 選項；應用啟動不套用 migration。

正式升級前仍須確認 DB 身分、正式 history／migrator、跨檔原子性、中斷恢復、備份／還原與 Secret 版本。復原先停止寫入，在隔離環境還原並檢查 journal、FK、FTS、筆數與密文；優先向前修正。不提供破壞性 down migration，不假定程式回退能還原資料庫，不捏造 history。

## Secret Names／Site Config

只審查名稱及設定，未讀取或保存真實 Secret 值。

| 類別             | 名稱                                                                             |
| ---------------- | -------------------------------------------------------------------------------- |
| 受控初始化／復原 | ADMIN_BOOTSTRAP_SECRET、ADMIN_RECOVERY_SECRET                                    |
| 身分資料         | IDENTITY_ENCRYPTION_KEY、IDENTITY_HMAC_SECRET（獨立金鑰及版本）                  |
| 限流             | PUBLIC_LOOKUP_HMAC_SECRET、AUTH_RATE_HMAC_SECRET（各自獨立）                     |
| AI               | OPENAI_API_KEY、GEMINI_API_KEY（不影響管理員登入資格）                           |
| 非 Secret 設定   | WEBAUTHN_ORIGIN、SITES_AUTH_VERIFIED、PUBLIC_LOOKUP_VERIFIED、AUTH_RATE_VERIFIED |
| Bindings         | DB、FILES                                                                        |

名稱與 runtime／Env／空白 .env.example 一致，§3.3 已補齊登入 HMAC 名稱；新增 Sites／Passkey 設定名称。公開／登入 verified 在範本預設 false。正式 AI queue／cron 尚未配置，Purge runtime 沒有 copy adapter，均不能以 request 或旗標任意繞過。

hosting.json 的 DB／FILES 是邏輯 binding；本機生成 config 的 placeholder database ID 不是已確認的 Production DB。build config 關閉 observability、request／invocation logs 及 traces，沒有 Secret vars；平台實際遵守行為仍須實測。

## Known Issues／Release Gates

| ID    | 阻擋項目                                                                                     | 解除所需證據                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| RC-01 | 本機已通過：Audit API／介面及授權測試                                                        | 26 項相關回歸及最終 6 項 Audit 重驗通過；使用者已回報 Audit 補做驗收完成，其他 UI／平台 gates 保留。             |
| RC-02 | 最新 Admin／手機 UI、下載／列印瀏覽器驗收未完成                                              | 可用且獲准的工具完成最新流程／Print CSS 驗收；不繞過既有 browser 安全阻擋。                                      |
| RC-03 | Sites／ChatGPT＋Passkey 已核准，本機認證切換驗證中；正式 gateway／Passkey 尚未實測           | 完成本機回歸、平台標頭防偽、直連隔離、Cookie、正式 Origin 裝置互動及 Recovery 維護驗收；不再建立 Google Client。 |
| RC-04 | 正式 DB／migration／backup restore／Secret 復原未驗證；D-11 復原目標已定案，演練尚未驗證達標 | 達成 RPO≤24 小時／RTO≤8 小時，平台 preflight 與隔離演練，確認資料／密文／history／FTS 一致性。                   |
| RC-05 | 正式可信 IP、平台 logs、限流清理與備份保存未驗證                                             | 驗證傳遞及保存／清理承諾後才可開啟 verified；目前維持關閉。                                                      |
| RC-06 | 正式 durable AI consumer／排程與用量限制未驗證                                               | 持久 claim／重試／去重／撤權與工作版本實測；mock 不作正式證據。                                                  |
| RC-07 | Production Purge 副本／備份清點及刪除能力未驗證                                              | 完整 copy adapter、共享副本承諾與逐項刪除／缺失驗證；全部驗證前保持停用。                                        |
| RC-08 | 1,000 人 PDF／Excel 的正式 CPU／記憶體／時間容量未驗證                                       | 在正式平台能力下的合成資料容量驗收，不能以受控 1,001 人查詢模擬代替。                                            |
| RC-09 | 本機候選未同步 GitHub／Pages；本次 RC 沒有遠端 CI 結果                                       | 同步已納入 Phase 19 部署授權；依 §66 順序完成，等待同一候選 commit 的 CI／Pages，驗證版本與 URL。                |
| RC-10 | 2026-10-01 已取得正式部署授權；尚無已驗證 Sites URL                                          | 授權持續有效、不重複要求；先解除適用阻擋並完成正式 DB／preflight／recovery，再依 §66 執行。                      |
| RC-11 | D-11 其餘查詢／容量門檻與正式服務能力尚未定案或驗證                                          | 依實際平台量測與使用者決策完成；不能以本機測試或程式暫時上限宣稱正式容量。                                       |

使用者已採用 RPO≤24 小時／RTO≤8 小時的復原目標；最多可能失去 24 小時內資料。這是驗收目標，尚未完成平台演練，不宣稱已達標。使用者後續同意 Audit 僅 super_admin 查看，政策及本機介面／API／授權驗證已完成，使用者已回報 Audit 補做驗收完成；其他 Admin／手機／報表流程仍缺完整步驟結果。即使決策定案，必要實作／平台驗收仍須完成，不能只更新文字就解除 gate。

## 剩餘驗收的執行準備（未執行平台操作）

2026-10-01 18:56（Asia/Taipei）唯讀查核既有 Sites project：active、目前使用者 owner、access_mode=custom；latest_version_number=0、版本列表空、live／preview URL 皆 null、D1 bindings／tables 皆空（無省略或截斷），automations 空。這是專案目前狀態，不能推論已支援備份、排程、刪除或任何正式服務容量。未讀取環境 Secret 值、學生列或 Worker logs，未改變 Site、存取設定或版本。

同時唯讀 GitHub：Public／main、HEAD 19017e8db6fd25e844c6ef9acfd59d4e57373f61；最近 Verify project 及 Publish project documentation 均 completed／success，仍只對應 Phase 13，沒有目前 Audit 候選的遠端 CI。

下表整理既有規格要求的驗收執行順序與證據，並非新增政策或已完成聲明。平台相關操作須先取得適用環境與授權；在本專案任何 Sites 部署皆屬 Production，不能先私有部署來繞過正式部署關卡。Sites／Passkey 正式整合仍依 D-09 待驗證；consumer／copy adapter 等缺少的實作也不能只靠填表解除。

| 順序／gate      | 前置條件及驗收步驟                                                                                                                       | 僅保存的非敏感證據／完成條件                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1／RC-02        | 可用且獲准的 UI 工具或使用者逐項驗收；以虛構資料測 Admin 權限、選取範圍切換、Audit 分頁／失效、手機操作、報表下載／列印。                | 記候選 commit、驗收人角色、裝置／viewport、步驟與結果。Audit 整體使用者驗收回覆已記錄，但不得代替未回報的所有 Admin／報表步驟或工具實測。                                                                              |
| 2／RC-03        | 核對 Sites stable ID、可信 gateway、直連隔離、Cookie、Passkey 正式 Origin 與五分鐘 freshness。                                           | 保存非敏感測試結果；不記錄身分 ID、token、Cookie、Secret 或私鑰。以實測證明偽造標頭不能登入。                                                                                                                          |
| 3／RC-04        | 確認實際 DB／FILES 身分、正式 migrator／history、備份及隔離復原能力；先備份與 preflight，再以平台允許的隔離演練驗證 D1／檔案／金鑰版本。 | 記備份時間、最新一致性復原點、模擬中斷開始及服務驗證完成時間；計算 RPO≤24 小時、RTO≤8 小時。核對 journal hash／timestamp、FK／完整性、FTS、筆數／快照／檔案及密文可解讀。只存統計與結果，不提交 dump／金鑰／真實資料。 |
| 4／RC-05        | 可信來源 IP 傳遞、同源及平台 logs 實測；配置並驗證登入／公開 HMAC 限流清理，以及所有備份副本的 24 小時保存承諾。                         | 保留來源 header 契約、成功／拒絕測試、排程清理時間、非敏感筆數及平台設定結果；不留 IP／查詢條件。全部相依驗收通過才可依授權啟用 verified，範本仍 false。                                                               |
| 5／RC-06        | 有已授權且可持久執行的 AI consumer／排程實作與用量限制；在受控合成資料下測重啟、租約、重試、去重、過期／撤權／版本競爭。                 | 記工作狀態轉移、版本、嘗試次數及結果。正式 Provider／用量證據不能以 mock 替代；付費 API 另依授權，沒有此證據不宣稱正式背景能力。                                                                                       |
| 6／RC-07        | 副本清點與可用 copy adapter；共享物件／備份／所有復原承諾可驗證，平台備份刪除能力已實測。                                                | 對合成資料逐項驗證 Preflight、阻擋條件、部分失敗／重試、全部清除；只存隨機作業號、時間、數量及結果。不保存原始 Manifest 或學生識別；本輪不執行 Purge。                                                                 |
| 7／RC-08、RC-11 | 取得正式平台 CPU／記憶體／時間／查詢限制與未決容量門檻的使用者決策；以一評量 1,000 位虛構學生生成 PDF／Excel。                           | 記輸入人數／文字位元組、輸出大小、時間／資源、完整性、版本／撤權拒絕及超限全拒絕。不得用本機成功宣稱正式容量。                                                                                                         |
| 8／RC-09、RC-10 | 前項適用 gates 完成，再另取得遠端同步與正式部署授權，遵循 §66 的 migration preflight／人工確認／recovery。                               | 記同一候選 commit 的 CI／Pages、Sites 成功狀態及實際網址，完成三網址與 smoke 驗證；沒有真實成功結果不填正式版本／日期／URL。                                                                                           |

## Test Summary

2026-10-01 接續 Phase 18，對目前含 Audit 的 runtime／tests 基底 `850aa9d` 執行 `npm test`：282 項通過、0 失敗／skip／取消／todo，441,023.4626 ms。先前 276 基底全套與 Audit 的 26 項相關回歸／6 項最終重驗仍為歷史證據；本次不再以舊全套數代表目前候選。typecheck／lint／build 沿用同一份未變更 runtime／dependency／config 的 Audit 最終成功結果；本輪重新核對 bundle／config 及 16 項 migration manifest，格式／文件／安全／diff 檢查通過。原本 audit（0 vulnerabilities）及 disposable db:verify 的證據仍適用未變更的 lockfile／SQL，未宣稱正式平台能力，詳細命令見 [Phase 18 紀錄](PHASE_18.md)。

## GitHub／Pages 與發布準備

2026-10-01 08:59 UTC 唯讀查核：[Repository](https://github.com/kisaraki/classroom-aigrade-tzk) 與 [Pages](https://kisaraki.github.io/classroom-aigrade-tzk/) 均 HTTP 200，repository Public／main；遠端 HEAD 為 `19017e8`（Phase 13）。[Verify project](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36678595820) 與 [Pages workflow](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36678595707) 成功，兩者只屬 Phase 13。

本機 README 最新部署區塊及 pages/index.html 已準備候選內容。Pages workflow 只上傳 pages/ 靜態文件，不承載登入、查詢、D1 或 AI。僅 README 變更不會觸發 Pages；正式同步需包含 Pages 內容。未 Push／觸發 workflow 前，遠端仍是 Phase 13，不宣稱 RC 或 Sites 已發布。

使用者已明確授權 Phase 19 正式部署；[部署前查核](PHASE_19.md) 仍受阻，尚未執行部署。正式 URL、日期及三網址驗證只能在實際成功後填入。

## 認證需求變更

2026-10-01 使用者取消 Google OAuth Client 認證。上述 Google 流程／Client／callback 驗收步驟是變更前紀錄，停止作為後續待辦；已依主規格 §32／D-09 實作 Sites ID／Passkey，RC-03 尚待正式 gateway 與裝置實測。舊 282 項結果僅代表 Google 基底；新候選 300 項案例在初次全套與失敗項修正／隔離重驗中均已有通過證據，並非一次全套零失敗。完整指令與結果見 [Phase 19 紀錄](PHASE_19.md)。

2026-10-02 使用者已授權 D1 建置，允許依主規格 §66 初始化空平台資源；正式部署授權不需重取。版本 1 已成功部署，正式 DB binding／新認證表可見；這不解除完整 history、備份／隔離復原、可信標頭、AI consumer、Purge 或正式容量等業務上線 gates。最新平台結果以 Phase 19 紀錄為準。
