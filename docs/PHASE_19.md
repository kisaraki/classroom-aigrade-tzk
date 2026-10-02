# Phase 19 — 正式部署前紀錄

更新日期：2026-10-02（Asia/Taipei）。狀態：**部分完成，Sites 版本 1／D1 建置成功，業務上線 gates 尚未通過**。以下保留各次查核的時間與適用範圍；最新結果見文末。業務規則仍以 [主規格 §66](../PROJECT_SPEC.md#spec-66) 為準。

## 零、授權與模型

使用者明確回覆「確認正式部署」，正式部署授權已取得並持續有效，不重複要求同一授權。Recommended／Minimum XHIGH；Current XHIGH（沿用先前使用者確認）、KEEP，無額外風險升級。授權涵蓋按既定順序完成正式部署，不等同略過 DB 身分、migration preflight／人工確認、recovery 或其他適用驗收。

首次部署前查核時本機 HEAD 82479ad，工作目錄乾淨。runtime／tests 仍為 Audit 補做 850aa9d；Phase 18 最新全套 282 項通過，沒有 runtime／schema／dependency 變更，不重跑已適用的測試／建置。

## 一、實際部署前查核

| 查核                            | 結果與意義                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sites get_site                  | 既有專案 active、目前使用者 owner、custom 存取；版本 0，live／preview／expected_url 均 null。未建立新專案或更改 audience。                                                                   |
| Sites read_database_overview    | bindings／tables 空；無省略／截斷。尚無可確認的正式 DB／history，不可假定本機 disposable DB 是 Production。                                                                                  |
| Sites get_environment_variables | revision 2，entries 空。未配置 Google／Bootstrap／Recovery／identity／HMAC／AI 等 runtime 名稱；沒有讀取／輸出 Secret 值。                                                                   |
| Sites 工具能力盤點              | 可用工具只提供 DB overview／table rows，未提供 DB 預先配置、migration preflight／執行、history 或備份／隔離復原操作。工具未提供不代表平台永遠不支援；需先取得平台受控流程與實測證據。        |
| 平台 plugin 文件                | persistence-and-storage.md 說明 migration 在 Worker upload 前逐檔套用／記錄，發布失敗可能仍已套用部分 SQL。這是文件描述，不是本專案正式實測，不能以部署成功／失敗代替 preflight 或資料復原。 |

只查 metadata 與環境設定名稱／空列表，沒有讀取學生列、Worker logs、外部帳號資料或本機 Secret；未執行平台寫入、migration、Purge、付費 API 或 deployment。

## 二、具體阻擋與所缺資訊

1. 此項 Google Client 阻擋已由後續使用者取消；目前改為 Sites／Passkey 的可信 gateway、直連隔離、Cookie、正式 HTTPS Origin 與裝置互動實測，參見下節。
2. 需平台提供能先確認正式 DB／history、完成 preflight、migration 人工確認與備份／隔離復原的受控方式。不能在查核能力缺失時直接觸發會套用 SQL 的部署，或把新 DB 當作已驗證 RPO／RTO。保存目標 RPO≤24 小時／RTO≤8 小時尚未實測達標。
3. 其他適用 gates 沿用 [候選阻擋與驗收步驟](RELEASE_CANDIDATE.md)：其餘 UI／報表、可信 IP／限流清理與副本保存、AI consumer、Purge 副本能力與正式容量。verified 保持關閉，Purge 停用；授權不代表這些結果已通過。

必要環境及流程未備妥，停在正式 DB 確認／preflight 之前。不能靠改寫報告、推送程式或私有發布解除上述阻擋。正式部署授權仍有效；已不再要求 Google Client。

## 三、檔案、Migration 與驗證

新增本紀錄；修改主規格 §66、RC 授權狀態、README 與 CHANGELOG。無程式、schema、SQL、套件或 Secret 變更。Production migration／recovery／正式 smoke 未執行，原因見前節；保留 Phase 18 全套 282 與同一 runtime build 的成功證據，不宣稱正式平台驗證通過。

本輪文件最終驗證：npm run format:check 通過；node scripts/check-docs.mjs 驗證 29 份文件／490 個本機連結通過；node scripts/check-safety.mjs 掃描 346 份原始檔未發現指定敏感模式，非完整安全稽核；git diff --check 通過。不以本機測試替代 Production。

## 四、發布狀態

Release／正式版本：無。Sites URL：無。沒有 Sites 成功部署，因此不使用 DEPLOYED_WITH_DOC_SYNC_ERROR；未執行此輪 GitHub／Pages 發布或建立 tag／Release。既有 Repository／Pages 的 Phase 13 線上內容不是本輪部署結果，不提供未驗證的正式系統網址。

前置條件完成後，沿既有授權接續 §66 流程，再回報真正的部署版本與三個驗證網址；本輪不標為 Phase 19 完成。

## 2026-10-01 Sites／Passkey 認證遷移

使用者已核准 Sites／ChatGPT 平台登入及 Passkey 高風險重驗，也已確認 XHIGH。Recommended／Minimum XHIGH；Current XHIGH（使用者確認）；Action KEEP。Google Client 待辦取消；不重複索取部署或推理強度確認。

### 實作範圍

- Sites ID 由已驗證 gateway 提供；預設關閉可信開關。明確帳號綁定，不以 Email 自動授權；每次管理 Session 均核對當前 Sites ID。
- 一般登入不給近期驗證；Passkey 要求 user verification、Origin／RP ID、challenge、簽章、counter 及最新帳號／Session／憑證版本。五分鐘時窗、一次性 challenge、失敗消耗、交易內再檢查與 Audit。
- Bootstrap 仍一次性；Rebind／Recovery 指定新 Sites ID 與新 Passkey。完成時撤銷舊 Sessions／憑證；Rebind 另核對核准者的即時權限與近期驗證。
- UI 改用 ChatGPT 頂層登入連結、自己的 Sites ID、Passkey 註冊／重驗及核准身分綁定。Google 舊 HTTP 入口回 410；正式 runtime 不使用 Google Client。
- 新增 0016、三張表與 identity request 欄位。升級提升所有舊 auth_version、撤銷 Session／OAuth state／核准，保留 Bootstrap 已使用狀態，舊背景工作必須重新核准；沒有自動依 Email 遷移。
- 既有 Google domain helper／測試與歷史 SQL 保留相容；這不是宣稱所有 Google 字樣或舊欄位已刪除。新增 SimpleWebAuthn server 14.0.3／browser 14.0.0，未變更既有鎖定套件版本。

### 驗證與限制

17 項初始 Sites 身分／真實 ES256 簽章／重播／撤權／Recovery／migration 測試通過；另補舊路由關閉、錯誤請求限流與舊背景授權撤銷測試，Sites 測試最終為 18 項。原 282 項結果只代表舊 Google 基底，不作新方案完成證據。所有測試均使用隔離 D1、虛構資料與合成裝置金鑰，不呼叫付費 AI；最終回歸結果見下節。

本輪再次唯讀確認平台：active、owner、custom access、版本 0，live／expected URL 均空；D1 bindings／tables 空且無省略。工具仍沒有正式 DB preflight／备份／隔離復原能力；未以部署嘗試觸發 migration。平台可信標頭與實際 Passkey 裝置未驗證，SITES_AUTH_VERIFIED／AUTH_RATE_VERIFIED 維持關閉。正式環境前置條件未完成，沒有 Production migration、Push、Release 或 Sites deployment。

資料庫復原遵循既有向前修正及平台還原計畫。0016 已撤銷的 Session 不因程式回退自動復活；既有 admin 透過受控 Recovery 遷移，再由 admin 逐一 Rebind 其餘管理員；空庫才允許 Bootstrap。

規範及套件驗證依 [WebAuthn](https://www.w3.org/TR/webauthn-2/) 與 [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server)；文件契約、本機簽章測試和正式裝置實測分別記錄。

## 2026-10-02 D1 建置授權

使用者明確授權實施 D1 相關建置流程。範圍依主規格 §66 補充：先確認空平台、保存 migration manifest 與本機通過證據，再以 Sites 正式機制配置 D1；業務 verified 門檻不因基礎設施建立自動解除。正式部署授權仍有效，不另索取相同授權。平台備份／隔離復原尚無工具證據，不將初始化空库標成復原達標。

### 本機最終驗證

- `npm test`：300 項，首次 282 通過／18 失敗。失敗包含既有測試對 migration 撤銷 Session 的舊預期、欄位順序比較造成的連鎖 fixture 失敗，以及本機 Miniflare 分配到 fetch 禁用連接埠；未更改作業系統連接埠設定。
- `node --import ./scripts/sites-env.mjs --test --test-concurrency=1 tests/migrations.test.mjs tests/auth-limits.test.mjs tests/security.test.mjs tests/sites-auth.test.mjs`：42 項，41 通過／1 失敗；最後一項是測試 Session 時間不符合 schema 約束，已修正 fixture。
- `node --import ./scripts/sites-env.mjs --test --test-concurrency=1 --test-name-pattern="migration preserves|migration:|Migration:|origins and held|suspension, role" tests/security.test.mjs tests/references.test.mjs tests/exams.test.mjs tests/import-service.test.mjs tests/admin-workspace.test.mjs`：5 項通過，涵蓋最後修正與前述 Audit／Import 平台模擬重試。
- 300 項案例均已有個別通過證據；不是一次全套零失敗的執行。未修改的通過案例沿用同輪結果，失敗案例均已修正或隔離重驗。
- `npm run typecheck`、`npm run lint`、`npm run format:check` 通過；`npm audit --omit=dev` 為 0 vulnerabilities。
- `node scripts/check-docs.mjs`：29 份文件／492 個本機連結通過；`node scripts/check-safety.mjs`：355 份原始檔的指定敏感模式檢查通過，非完整安全稽核；17 份 SQL 與 manifest hash 一致；`git diff --check` 通過。文件後續更新另執行文件驗證。

### 發布準備

沿用既有 Site，發布前再次確認 active／owner／custom、版本 0、沒有 D1 binding 或資料表且無截斷。以忽略目錄中的獨立 Site checkout 保存對應來源；未建立第二個 Site 或改變 audience。Windows 上 Sites build helper 的 npm 包裝器失敗，改由相同 package script 的 `node scripts/run-framework.mjs build` 執行，仍由正式 workflow 負責 source push、打包及驗證。尚未因此宣稱 D1 或復原成功。

### 版本 1 實際部署結果

2026-10-02 07:05:55（Asia/Taipei）Sites 回傳 `succeeded`；[正式入口](https://classroom-aigrade-tzk.kisaraki.chatgpt.site)。Site source commit `7001efb7de42cf749559da11c857e4853b3a4abf`，版本及 deployment ID／archive hash 詳見 [D1 維運紀錄](D1_OPERATIONS.md)。Windows tar 另以 `TAR_OPTIONS=--force-local` 解決磁碟路徑被誤認為遠端位址，未修改 plugin 或專案 build 行為；正式 workflow 成功驗證及打包。候選 build 通過，24 個 client 檔的指定 Secret／server-only 模式檢查通過，Worker logs／traces 設定停用。

- 部署後 `DB` binding 及新認證表可見，`admin_users` 為空；沒有建立管理員、匯入學生或執行 Purge。
- overview 僅回傳 50 個名稱且未展示 history；雖標示無省略，仍不足以核對本機全部 53 張關聯表／兩個 FTS 及 17 筆 migration hash。完整正式 schema／history 驗證保留，後續不得盲目變更已套用 SQL。
- 正式 runtime 環境 revision 2，entries 空；沒有配置 Secret，可信身分／登入限流／公開查詢 verified 都按程式預設關閉。
- 對 `/`、`/api/health`、`/api/auth/google/start`、`/api/auth/sites` 的無憑證 smoke 均 HTTP 401／`Cache-Control: no-store`，由平台存取層拒絕；未讀取回應本文或記錄 Cookie。這只能證明存取防護，不能取代登入後 application smoke、裝置 Passkey、可信標頭或直連隔離實測。
- R2 已在部署 manifest 宣告，正式物件寫入／備份／刪除能力未驗證；RPO≤24 小時／RTO≤8 小時尚未實測。AI consumer、Purge、副本及容量 gates 不因本次部署解除。

此為基礎設施正式部署，並非業務正式上線或 Phase 19 完成；不建立正式 Release／tag。README／Pages／CHANGELOG 已更新，GitHub／Pages 同步結果見下節。

### 文件同步驗證

發布後本機 `npm run format:check`、`npm audit --audit-level=high`（0 vulnerabilities）、`git diff --check` 通過；文件檢查為 30 份／499 個本機連結，安全指定模式檢查 356 份來源檔通過。逐位元組核對 315 份 Site 來源與實際發布 checkout 全部相同，17 份 migration hash 與 manifest 一致。Source commit 不含 runtime Secret、備份或真實資料。

GitHub 主庫 commit `b8feb2dfcbeddc2383ebe8b01d660ba8553c6a8f` 已推送。2026-10-02 07:16（Asia/Taipei）[Verify project](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36939360314) 全部成功：`npm test` 一次全套 300 通過，0 失敗／跳過／取消，281,859.142 ms；install、audit、lint、format、typecheck、文件／安全檢查、build、client bundle 與 logs config 檢查均成功。這是新認證方案的完整遠端回歸證據，補足前述本機分次重驗的限制。

[Pages workflow](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36939360295) 對同一 commit 完成 success。[Repository](https://github.com/kisaraki/classroom-aigrade-tzk) 與 [Pages](https://kisaraki.github.io/classroom-aigrade-tzk/) 均 HTTP 200，Pages 本文已核對 Phase 19 及正式 Sites URL；Sites 原生 deployment status 為 succeeded，無憑證 HTTP 401 符合目前 custom 存取限制。三網址均有實際驗證，沒有文件同步錯誤；應用程式登入後 smoke 及業務 gates 仍未通過。
