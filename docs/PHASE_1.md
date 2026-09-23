# Phase 1 驗證紀錄

日期：2026-09-23。範圍：Domain Model、Database Migration 與必要安全／資料邊界驗證。主要規格：[PROJECT_SPEC.md §47](../PROJECT_SPEC.md#spec-47)。此交付不是正式軟體 Release，不代表後續業務 API 或 Sites Production 已可用。

## 零、模型／推理強度

| 項目        | 紀錄                                                                |
| ----------- | ------------------------------------------------------------------- |
| Recommended | HIGH                                                                |
| Minimum     | HIGH                                                                |
| Actual      | HIGH 或以上，使用者明確確認；未宣稱工具自動切換                     |
| Action      | KEEP                                                                |
| 風險升級    | 無額外升級；資料庫、密碼學與回復驗證依本 Phase 的 HIGH 最低要求執行 |

使用者已批准啟動 Phase 1，並於本次確認 D-03 建議、D-11 日期政策與推理設定，無需重複要求同一授權。Google OAuth Client 仍缺少，沿用使用者「先跳過」決策，沒有進行真實登入或要求 Secret。

Phase 1 本機交付與必要驗證已完成。版本庫與文件頁透過既有 GitHub 工作流程同步，CI／Pages 的每次結果可於 [GitHub Actions](https://github.com/kisaraki/classroom-aigrade-tzk/actions) 查核；這不包含 Sites Production。

## 一、完成項目

- 將 D-03 的排名資格優先序、凍結來源、晚轉入及撤銷轉班規則，以及 D-11 的台北日期／UTC 時間／區間／曆法規則回寫主規格。
- 建立 29 張關聯表與 FTS5，涵蓋主規格全部核心實體；補充多版本 lookup hashes、學期資格、結果版本、AI 引用、Bootstrap 狀態。
- 建立索引、複合外鍵、CHECK 和跨列 trigger，保護學籍、座號、歷史快照、分數、成績歷程、引用與管理員資料。
- 提供身分證 AES-256-GCM、獨立 HMAC、key 版本、輪替準備與遮罩；在 Node 及 Workers runtime 驗證。
- 提供隔離本機 migration preflight、重播、虛構 seed 與中斷／失敗回復驗證。ER 圖、實體對照、金鑰輪替與 Production recovery 前置要求見 [DATABASE.md](DATABASE.md)。

## 二、新增檔案

| 路徑                                                                                                                                                             | 用途                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [DATABASE.md](DATABASE.md)                                                                                                                                       | ER 圖、資料表示、FTS、輪替及 migration／recovery 說明 |
| [PHASE_1.md](PHASE_1.md)                                                                                                                                         | 本驗證紀錄                                            |
| [seed-fictional.ts](../site/db/seed-fictional.ts)                                                                                                                | 隔離測試專用虛構資料                                  |
| [0000_phase_01_core.sql](../site/drizzle/0000_phase_01_core.sql)                                                                                                 | 核心 schema 與索引                                    |
| [0001_phase_01_invariants.sql](../site/drizzle/0001_phase_01_invariants.sql)                                                                                     | 跨列約束、不可改寫版本、FTS5 同步                     |
| [0000_snapshot.json](../site/drizzle/meta/0000_snapshot.json)／[0001_snapshot.json](../site/drizzle/meta/0001_snapshot.json)                                     | Drizzle 追蹤 metadata                                 |
| [dates.ts](../site/lib/domain/dates.ts)                                                                                                                          | 台北日期、半開區間及曆月／年運算                      |
| [ranking-eligibility.ts](../site/lib/domain/ranking-eligibility.ts)                                                                                              | D-03 資格解析                                         |
| [identity.ts](../site/lib/server/identity.ts)                                                                                                                    | 伺服器加密、查重、輪替與遮罩 primitive                |
| [db-local.mjs](../site/scripts/db-local.mjs)                                                                                                                     | 一次性本機 DB 與 preflight                            |
| [domain.test.mjs](../site/tests/domain.test.mjs)／[identity.test.mjs](../site/tests/identity.test.mjs)／[migrations.test.mjs](../site/tests/migrations.test.mjs) | 日期、加密與資料庫邊界／復原測試                      |

## 三、修改檔案

- [PROJECT_SPEC.md](../PROJECT_SPEC.md)：使用者決策、Phase 1 資料契約與證據入口。
- [README.md](../README.md)、[CHANGELOG.md](../CHANGELOG.md)、[site/README.md](../site/README.md)：更新現況與驗證命令。
- [schema.ts](../site/db/schema.ts)、[index.ts](../site/db/index.ts)、[migration journal](../site/drizzle/meta/_journal.json)：schema、格式與 migration metadata；DB 入口沒有新增自動 migration。
- [package.json](../site/package.json)、[tsconfig.json](../site/tsconfig.json)、[CI](../.github/workflows/ci.yml)：本機資料庫驗證命令、格式涵蓋、TypeScript 測試 import 與 CI 名稱；沒有新增 dependency。
- [預覽首頁](../site/app/page.tsx)、[health route](../site/app/api/health/route.ts)、[Pages 文件頁](../pages/index.html)：標示 Phase 1 現況；未增加登入或查詢流程。

## 四、Database Migration

兩份 migration 依 journal 順序執行。初版 schema 由既有 drizzle-kit 0.31.10 產生；FTS／trigger 使用 Drizzle custom migration。所有寫入限於新建且可銷毀的本機 Miniflare D1，沒有接觸 Sites Cloud DB，也沒有在應用程式啟動時套用 migration。

`npm run db:verify` 應得到 applied 0／pending 2 → applied 2／pending 0；重跑仍為 2／0，四名虛構學生、外鍵與 quick_check 均正常。Seed 與 migration 分開，不建立管理員、不初始化 Bootstrap；真實 Secret 與學生資料不進版本庫。

本機 D1 不授權 `PRAGMA integrity_check`；已依官方支援改用 `PRAGMA quick_check` 加上 `foreign_key_check`。正式平台 migration history、分批執行與 restore 行為尚未實測，不能用本機原子 batch 結果代替 Production recovery 證據。

## 五、測試結果

驗證命令在 `site/` 執行，除另註者外：

| 命令                                                         | 結果                                                    |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `npm run db:generate -- --name phase_01_core`                | 成功產生核心 migration                                  |
| `npm run db:generate -- --custom --name phase_01_invariants` | 成功建立 custom migration journal entry                 |
| `npm run db:verify`                                          | 已通過隔離套用、seed、重跑及 preflight                  |
| `npm test`                                                   | 通過：28 項，0 失敗，0 略過                             |
| `npm run lint`                                               | 通過                                                    |
| `npm run typecheck`                                          | 通過                                                    |
| `npm run format:check`                                       | 通過                                                    |
| `npm run build`                                              | 通過；Sites build 保留兩份 SQL 與 journal，與原始碼一致 |
| 根目錄 `node scripts/check-docs.mjs`                         | 通過：8 份專案 Markdown，157 個本機連結                 |
| 根目錄 `node scripts/check-safety.mjs`                       | 通過：131 份原始檔，未命中指定 Secret／身分證模式       |
| 根目錄 `git diff --check`                                    | 通過                                                    |

`npm run db:generate -- --name phase_01_drift_check` 回報 No schema changes，沒有產生額外 migration。建置後檢查 11 份前端輸出，未發現身分加密模組特徵或虛構學生識別資料。

Windows 本機執行 npm 時使用已安裝的 `C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js`，不重新安裝套件。測試包含：

- schema 欄位／索引、外鍵、學期與班級年份、無效日期及時間表示。
- 重疊學籍／座號、相鄰期間、撤銷、晚轉入、資格優先序與快照不變。
- 0 分、NULL、負數、超界、小數儲存、特殊狀態、NOT_HELD 與原校成績禁止排名。
- 失敗 DDL／資料 batch 回復、已完成第一份 migration 後續跑、FTS rebuild、journal 及 trigger 異常拒絕。
- 加密隨機 IV、綁定 AAD、HMAC 版本、key 輪替、查重衝突回復、錯誤／遺失 key 與竄改封閉失敗。
- Google 綁定資料形狀、保留管理員、最後一位 super_admin、併發 Bootstrap、token hash 與 Session 撤銷。
- FTS 增刪改同步、封存／到期排除，結果／AI 來源關聯、去重、轉出後拒絕新 AI 工作，History／Import／Archive 關聯與資料保留。

Google OAuth、完整權限／IDOR、平均排名演算法、真實 AI、Production smoke test 及 Sites 正式 URL 驗證未執行，原因是依使用者決策暫緩或屬後續 Phase；不能標成已通過。

## 六、安全性檢查

測試資料均明確標示虛構，Email 使用 `example.test`。加密 key 由測試程序隨機產生；沒有持久化 key、真實個資、OAuth credentials 或 AI API keys。Seed 不包含管理帳號、Session 或 Role grants。資料庫不存身分證明文，Session 只存 hash；管理員 schema 沒有 ChatGPT／Gemini 認證或本地密碼欄位。

Secret／身分證樣式掃描只能偵測指定模式，不能視為完整安全審查。JSON、R2 檔名、Audit 及後續 AI Context 仍需 server-side 允許欄位清單與輸入檢查。此次沒有新增管理端 API，資料庫約束不等於已完成 OAuth、Permission 或 Scope。

## 七、已知限制

- Google OAuth 設定與 live login 實測仍依使用者先前要求暫緩，Phase 3A 前需補足。
- D-03 已核准；D-11 僅日期語意已核准。其餘待決策保持未定，後續以新 migration 擴充。
- 本機測試不代表雲端 DB、正式 migration、備份復原或 Sites deployment 已驗證；目前沒有 Sites Production URL。
- 身分證正規化、完整輪替工作與 Secret key ring／備份管理，需於真實資料寫入前完成；本 Phase 交付 primitive、欄位、協定及測試。
- 未提供完整 UI、管理員登入、排名計算、匯入／封存流程、AI 呼叫或到期刪除。外鍵不使用 cascade，不提前決定 Purge 邊界。

## 八、下一 Phase 預計工作

[Phase 2](../PROJECT_SPEC.md#spec-48) 為 Academic Foundation，建立學年度、學期及班級等基礎功能與相關測試。尚未開始；須由使用者確認 Phase 1 後再授權。正式部署仍須另外取得「確認正式部署」授權。
