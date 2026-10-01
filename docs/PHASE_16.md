# Phase 16 — Security / Privacy Hardening

日期：2026-10-01。狀態：**本機安全範圍完成**。使用者已明確批准 Phase 16 並確認 XHIGH；Recommended／Minimum／Actual 均為 XHIGH，Action=KEEP，沒有額外風險升級。不啟動 Phase 17、不正式部署；Phase 14／15 的 Audit 決策及瀏覽器驗收仍維持未完成。

## 本機安全修正

- Auth／Exam／Import／Archive／Publication handlers 在處理業務前檢查 HTTP 方法；管理員更新只接受 PATCH。Bootstrap JSON 採嚴格 UTF-8 解碼。
- Cookie parser 使用沒有 prototype 的字典；重複的 Session／OAuth state Cookie 一律失效。
- Session touch 以資料庫目前的停權、授權版本、撤銷、有效期與閒置時間為條件；失敗不回傳合法 principal。Google 重新驗證的交易也重驗閒置時限，不能復活失效 Session。
- 管理員列表、評量／原校個人成績、AI 設定、Purge 作業與 Recycle Bin 已補讀取後授權重驗；評量成績讀取也檢查來源版本。
- 學籍 Scope 使用此次異動日期，避免沿用區段的未來結束日授予較早異動權限；Undo 沿用原作業持久保存的 Scope 座標，Confirm／Replay 仍重新授權。
- middleware 對動態頁面／API 加入 nosniff、no-referrer、DENY framing 及 CSP 的 base-uri／object-src／frame-ancestors；Admin／API 不快取，HTTPS 才加 HSTS。這不是完整的 script nonce CSP，也不取代伺服器授權。
- PDF 每頁完成即壓縮，依已產生物件容量提早拒絕，避免把全部頁面指令留到最後。原有 10 MiB 檔案上限不變。

## 跨模組審查

| 邊界                    | 已檢查的證據                                                                                                                                        | 限制／剩餘工作                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Auth／Session           | Google OIDC 簽章、issuer／audience／nonce／state／PKCE、一次性 Bootstrap、Session token hash、HttpOnly／Secure／SameSite Cookie、最近驗證與撤銷測試 | 真實 Google／Sites callback／Cookie 仍未實測；登入限流已核准，正式可信 IP／清理／備份未實測 |
| Permission／Scope／IDOR | 伺服器 deny-by-default、dated assignments、歷史 participation、跨班／跨科、批次與下載、Background principal、Purge 權限                             | Audit 閱讀角色仍未定案；沒有開放 Audit 資料 API                                             |
| SQL Injection           | 查詢使用參數綁定；動態 table／column 來自內部白名單；FTS query 經專用轉換                                                                           | 不宣稱替代正式滲透測試                                                                      |
| XSS／公式注入           | React 文字渲染、AI 結構驗證、無任意 HTML 執行；CSV／XLSX 文字前綴、XML escaping；PDF 無執行 action                                                  | 最新版 Admin 下載／列印與手機 UI 未完成瀏覽器驗收                                           |
| CSRF                    | 所有業務 mutation 檢查同源 Origin、JSON／binary Content-Type；OAuth state／nonce 與瀏覽器綁定；禁止任意方法呼叫 handler                             | 正式 edge Origin／Host 傳遞仍待平台測試                                                     |
| Rate limit              | 公開查詢既定 30／5 次 HMAC 原子限流、24 小時期限，無可信 IP／儲存即拒絕；正式入口保持關閉                                                           | 已採登入 60／限制開始 5 次；可信 IP 與清理排程未正式驗證                                    |
| Secret／PII／Log        | 原始碼選定 Secret／身分證 pattern scan；client bundle server-only 識別字檢查；無原始 request／供應者錯誤 log；AI allowlist 與檔名／RAG 個資測試     | scanner 不是完整 PII 偵測；平台 access log／備份保存需正式 preflight 驗證                   |
| Upload                  | CSV／XLSX 容量／展開／公式／外連／加密拒絕，PDF／MD active-content／OCR／個資拒絕；私有 storage、版本與存取重驗                                     | 沒有真實檔案或正式平台壓力測試                                                              |
| Dependency              | Next／React／RSC／Vite 同系列修補，transitive override 及鎖檔；CI 增加 high-level audit 與 client bundle 檢查                                       | advisory 資料會變動；0 findings 不代表沒有未知漏洞                                          |
| 資源容量                | 既有 upload／provider／report 輸出限制；PDF 逐頁壓縮                                                                                                | UTF-8 來源文字總容量 10 MiB 已核准並實作                                                    |

## Database Migration

[0014_phase_16_security.sql](../site/drizzle/0014_phase_16_security.sql) 僅增加學籍交易安全 trigger，不增加表／欄位或改寫既有資料。另新增 [0015_phase_16_auth_limits.sql](../site/drizzle/0015_phase_16_auth_limits.sql) 的專用 HMAC 限流表與索引／CHECK。合計 16 份 migration、50 張關聯表。

交易時檢查 Session 的 active Google binding、auth_version、撤銷、有效期，以及閒置未滿 30 分鐘。歷史年度寫入另要求 super_admin 與 Google recent_auth_at 未滿 5 分鐘；等於時限及未來時間均拒絕。原有 historical reason 與 Preview／Revision guard 保留。

僅隔離資料庫套用及驗證；Production 未執行。復原以保留 schema／migration history 及停止受影響寫入為先，程式回退不移除 trigger，也不假定回復資料庫。正式套用前須 preflight、人工確認及已實測的備份／recovery 計畫；必要 trigger 調整另建 migration，不直接改寫既有 migration。

## Request log 設定

審查初次 build 產生的 Wrangler 設定，發現 `observability.enabled=true`。[Cloudflare 官方文件](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) 說明 invocation log 含 request method／URL。推論 OAuth callback 的 query 可能因此進入平台紀錄；本專案尚未正式部署，沒有實際洩漏證據。

Vite／Cloudflare 設定已明確停用 observability logs、invocation logs 與 traces，另以 `check-build-config.mjs` 檢查生成設定，CI 也執行此檢查。這不影響 D1 中受保護的業務 Audit。正式平台是否遵守設定、是否另有 edge access logs／轉送／備份，仍須 preflight 實測；未確認不得啟用正式 OAuth。

## Dependency 修補明細

本次由 `npm audit` 初始 20 項（critical 1／high 9）修補至目前 0 項。Next 16.3.4 → 16.3.6、React／React DOM／react-server-dom-webpack 19.2.6 → 19.2.8、Vite 8.0.13 → 8.0.16，eslint-config-next 同步 16.3.6；`npm audit fix --ignore-scripts` 更新允許範圍內的 transitive 套件。沒有使用 `--force` 或 Miniflare 5 alpha。

保留既有主依賴，override image-size 2.0.4、undici 7.29.1、ws 8.21.0、工具使用的 esbuild 0.28.1；這些 override 須由 build、Workers runtime、migration 與完整回歸確認相容。

公告：[Next 維護者公告](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)、[React 維護者公告](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g)。Next 公告的 exploit 條件為 Node.js `next/og` ImageResponse 使用不可信 SVG 內容，專案未使用該入口；React RSC 仍屬本專案使用路徑，已更新修補版本。工具與 transitive advisory 以 npm registry 的當次稽核結果為證據。

## 測試與完成關卡

- 核准新政策前 `npm test`：264 通過、0 失敗、0 跳過（379,848 ms）。新政策後完整 `npm test`：270 項、268 通過、2 失敗、0 跳過（459,444 ms）；失敗僅為 Phase 3B／4 升級測試仍斷言 15 份 migration。更新為 16 份後，以 `node --import ./scripts/sites-env.mjs --test --test-concurrency=2 --test-name-pattern='migration upgrades Phase 3A|migration: upgrade Phase 3B' tests/authorization.test.mjs tests/exams.test.mjs` 重驗 2 項全部通過。270 項已逐項驗證通過，沒有未解決失敗；沒有宣稱完整重跑輸出為 270／0。
- `node --import ./scripts/sites-env.mjs --test --test-name-pattern='Phase 16 academic scope' tests/admin-workspace.test.mjs`：1 項通過；未來 assignment 不能修改較早日期，實際日期有效的 assignment 可 Confirm／Replay。
- 新增 15 個安全測試（1 個位於 admin-workspace、4 個於 auth-limits、2 個於 reports，其餘於 security test），涵蓋方法混淆、invalid UTF-8、Cookie ambiguity、headers、migration 升級／原子回復、閒置／Google 時窗、Session touch／reauth race、操作日期 Scope。
- `npm run typecheck`、`npm run lint`（0 errors／0 warnings）、`npm run format:check`、`npm run build` 通過。最終報表摘要與 SQL 修正由完整回歸及最後一次 build 覆蓋；數量斷言修正只重驗受影響升級測試。
- `node scripts/check-client-bundle.mjs`：24 個 artifacts 無選定 server-only 識別字。`node scripts/check-build-config.mjs`：最終生成的 request logs／traces 已停用。`node scripts/check-docs.mjs`：25 份專案 Markdown、460 個本機連結通過。`node scripts/check-safety.mjs`：337 個來源檔案無選定 Secret／身分證 pattern。`npm audit --audit-level=high`：0 vulnerabilities；`git diff --check` 通過。
- `node --import ./scripts/sites-env.mjs ./node_modules/drizzle-kit/bin.cjs check`：通過；override 後的 migration tooling 可載入既有 metadata。
- 本機 build 使用隔離 local storage，以 HTTP client 檢查 `/admin`、health、未設定認證的 session API 與不存在的 Admin API；200／503／404 均有 no-store／no-referrer／DENY／CSP，HTTP 沒有 HSTS。未操作瀏覽器，也不算 Phase 14／15 的 UI 驗收。
- `REPORT_QA_OUTPUT` 搭配 PDF test 產生虛構資料 QA PDF，Unicode／多頁／無 active content 測試通過；Poppler 渲染兩頁後視覺檢查中文字、續頁標示與頁碼通過。所有 QA 產物留在 ignored `.wrangler`，不提交個資或報表。

**已定案（2026-10-01）**：報表來源 UTF-8 10 MiB 與登入／callback 60、Bootstrap／Identity 開始另 5 次的每 IP 10 分鐘限流，逐批容量與原子限流已實作並通過適用驗證。無付費 API、真實學生資料、Production Purge、Production migration 或 Sites 部署。

## 已核准政策的補充驗證

新增 `auth-limits.test.mjs` 與報表來源測試，驗證 70 個併發嘗試只成功 60 次、兩個限制開始共用 5 次、失敗不部分消耗、IPv4／IPv6 正規化、10 分鐘精確失效、23／24 小時清理、缺少可信來源／Secret／儲存 fail closed。五個 OAuth HTTP 入口在 code／body／service 前先限流。正式旗標預設 false。

報表 SQL 先讀來源位元組數，超限快照不傳回本文；AI 先讀不可變版本 metadata，逐位取得合格成對內容並累計。CSV／XLSX／PDF／預覽都先驗證來源容量，壓縮不能繞過。多位元字元及跨分段 surrogate pairs 依 UTF-8 計量。來源快照與 AI 本文由既有 migration 保證不可修改，下載重驗使用版本／快照 SHA-256 摘要／來源大小／狀態，避免 fingerprint 留存整班 AI 本文。

首輪新測試發現 D1 的單值大小先拒絕 5.3 MB fixture，改用六位虛構學生、每份 900 KB 的合法資料值累計超限；在第六組內容讀取前整次拒絕，沒有部分輸出。這是隔離本機測試，不是正式 D1 容量聲明。

最終本機 build HTTP smoke：Google start、Google callback、Bootstrap start、Identity start、Reauth start 五個入口均在 `AUTH_RATE_VERIFIED` 未啟用時回傳 503／`AUTH_RATE_UNAVAILABLE`，並有 no-store／no-referrer／DENY 標頭。首輪 Worker 暫時重啟，於所有測試／建置結束後重驗五個入口通過；隔離 smoke server 已停止。這是本機 HTTP 技術檢查，不替代 Phase 14／15 瀏覽器驗收或正式平台驗證。

## 交付檔案與下一關卡

Phase 16 新增：兩份 migration 及 0015 schema snapshot、`auth/limit.ts`、`http-security.ts`、middleware、兩個 build／client CI 檢查腳本、security／auth-limits 測試與本紀錄；報表與 admin-workspace 測試補充安全案例。修改主規格、CHANGELOG、README、DATABASE、環境範例與型別、CI、依賴鎖檔，以及既有 Auth／Academic／Exam／Import／Archive／Lifecycle／AI／Report 模組。跨模組範圍僅限安全檢查與邊界修正。

既有 Phase 14／15 程式與文件仍保留部分完成狀態，未將其標為完成。工作樹包含這三階段尚未提交的成果；沒有建立正式 Release、Push 或執行遠端 CI。Phase 16 完成報告後依 AGENTS.md 停止，等待使用者確認，再決定進入 Phase 17 Full Lifecycle Integration Test；目前未啟動。
