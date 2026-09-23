# classroom-aigrade-tzk

## 專案簡介

供國中使用的學生成績查詢與 AI 學習建議系統。規劃支援學籍、評量、平均與排名、批次匯入、管理權限、AI 建議及資料保存生命週期。

**Phase 2 學年度與學籍領域服務已建立；Google OAuth 依指示暫緩。** 截至 2026-09-23，學年度、班級、新生、升班、轉班、轉入／轉出及撤銷已在隔離 D1 驗證。管理寫入尚未對外開放，沒有真實學生資料或 Sites Production 部署；完整介面及其他業務功能仍待後續 Phase。

## 文件入口

| 文件 | 用途 |
|---|---|
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | 唯一主要業務與技術規格，版本 v1.6-draft |
| [AGENTS.md](AGENTS.md) | Codex 執行紀律、安全邊界與 Phase 回報方式 |
| [CHANGELOG.md](CHANGELOG.md) | 文件及後續軟體變更紀錄 |
| [Phase 0 驗證紀錄](docs/PHASE_0.md) | 工具、平台、本機測試證據與待驗證項目 |
| [Phase 1 驗證紀錄](docs/PHASE_1.md) | 資料庫、邊界、安全與復原測試證據 |
| [Phase 2 驗證紀錄](docs/PHASE_2.md) | 學籍服務、Preview／Confirm、撤銷與權限介面驗證 |
| [資料模型與 ER 圖](docs/DATABASE.md) | 資料表對照、migration、加密輪替與復原方式 |
| [Sites 開發說明](site/README.md) | 安裝、預覽、建置、測試與環境設定 |
| [待決策清單](PROJECT_SPEC.md#spec-72-2) | 尚未定案的業務選擇與確認關卡 |
| [Phase 順序與驗收](PROJECT_SPEC.md#spec-74) | 0 → 1 → 2 → 3A → 3B → 4 → … → 19，共 21 階段 |

需求衝突以使用者目前明確指示優先，其次為 PROJECT_SPEC、AGENTS、README、程式碼註解。README 不另行定義業務規則。

## 主要功能

以下均為規劃功能，詳細條件以主規格為準：

- 家長／學生查詢已發布成績、個人班級排名、趨勢及 AI 建議。
- 學年度、班級、學生與歷史學籍管理，包含升班、轉班、轉入、轉出與畢業。
- 檢測／段考、特殊狀態、平均及班級／全年段排名。
- Excel／CSV 匯入、驗證、預覽、確認提交及 30 天 Rollback。
- 管理員僅使用 Google OAuth／OIDC 認證，仍檢查授權 Email、帳號狀態與 Google 綁定，並以 Permission＋Scope 控制資料範圍。
- AI 提供者、RAG、背景工作、版本及成績修改後重生。
- 報表、稽核、成績歷程、封存、復原與受控 Purge。

## 技術架構

| 項目 | 規劃 | 狀態 |
|---|---|---|
| 正式執行平台 | ChatGPT Sites | 專案已建立，尚未發布 |
| 後端 | Vinext／Cloudflare Workers | 已建立 health route；僅本機預覽 |
| 前端 | React／HTML／CSS | 已建立開發進度預覽頁 |
| 關聯式資料庫 | D1／SQLite，binding `DB` | 33 張關聯表、FTS5 與四份 migration；隔離本機驗證 |
| 檔案儲存 | R2，binding `FILES` | 本機測試；雲端尚未配置 |
| AI | OpenAI API、Google Gemini API adapter | 尚未整合 |
| 參考資料搜尋 | D1 FTS 優先 | FTS5 索引同步及篩選驗證；RAG 尚未實作 |
| 文件與版本入口 | GitHub Repository、GitHub Pages | Repository／Pages 已部署並驗證 |

平台欄位、驗證能力、背景執行及復原方式都須依實際環境確認；[官方文件查核紀錄](PROJECT_SPEC.md#spec-73-8) 不代表本專案實測成功。

## 開發環境

在專案根目錄切換至 `site/`，使用 Node.js 22.13 以上（本次為 24.15.0）：

```sh
cd site
npm run install:ci
npm run dev
```

Windows PowerShell 可使用 `npm.cmd`。預覽僅監聽本機；以終端顯示 URL 為準。建置使用 `npm run build`，建置後本機預覽使用 `npm start`。不會自動部署。

驗證命令：`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm test`。根目錄另有 `node scripts/check-docs.mjs` 與 `node scripts/check-safety.mjs`。資料庫可另以 `npm run db:verify` 建立一次性本機驗證環境；實際結果見 [Phase 2 紀錄](docs/PHASE_2.md)。

環境欄位見 [site/.env.example](site/.env.example)，真實值只填入忽略提交的 `.env` 或 Sites Settings；本次預覽與測試不需要真實 Secret。migration 位於 `site/drizzle/`，不由應用程式啟動時自動套用，未套用至雲端。

需要安裝元件時：Windows 優先 winget；macOS 優先 Homebrew；Python 優先 uv、其次 pip。先檢查既有工具，避免不必要安裝。

Secret 名稱見 [主規格 §3.3](PROJECT_SPEC.md#spec-3-3)。真實值由部署平台管理，不貼入文件、Git、前端或一般 log。

## Phase 狀態

| 項目 | 目前狀態 |
|---|---|
| Markdown 文件修訂 | 規格版本 v1.6-draft；同步 Phase 2 契約；D-03／D-11 日期決策維持 |
| 管理員認證決策 | 已確認僅 Google OAuth／OIDC；取消 ChatGPT／Gemini 認證條件，AI 建議功能維持獨立 |
| 業務待決策 | D-03 已核准；D-11 日期已核准，其餘事項依主規格各 Phase 關卡 |
| Phase 0 | 基礎環境、預覽、測試與 Pages 完成；Google OAuth 實測依使用者指示暫緩 |
| Phase 1 | 初版資料模型、migration、FTS、虛構 seed、加密輪替與復原驗證完成 |
| Phase 2 | 學年度、班級、學生與學籍服務；Preview／Confirm、升班、轉出與撤銷完成隔離測試 |
| Phase 3A～19（含 3B） | 尚未開始 |
| 測試 | D1／R2、migration、資料邊界、日期與身分加密測試；文件與敏感資料檢查 |
| 本地 Git | 已初始化，遠端為 kisaraki/classroom-aigrade-tzk |

文件版本與軟體 Release 分開維護；v1.6-draft 不是正式系統版本。

## 最新部署資訊

| 欄位 | 狀態 |
|---|---|
| Latest Production Release | 尚無已驗證紀錄 |
| Deployment Date | 尚無已驗證紀錄 |
| ChatGPT Sites | 尚無已驗證正式網址 |
| GitHub Pages | [專案文件頁](https://kisaraki.github.io/classroom-aigrade-tzk/)（HTTP 200，2026-09-23） |
| Repository | [kisaraki/classroom-aigrade-tzk](https://github.com/kisaraki/classroom-aigrade-tzk) |

只填入實際取得並驗證的 URL。每次 Sites 正式部署成功後，必須依 [同步流程](PROJECT_SPEC.md#spec-41-9) 更新本區、Pages、CHANGELOG／Release，完成 Commit／Push 與三網址驗證。

## ChatGPT Sites

目標為正式成績系統執行平台。任何 Sites 部署，包括限制訪客範圍的部署，都須先取得使用者「確認正式部署」授權。部署前使用本機預覽或保存版本審查；本次未部署。

## GitHub Pages

只作專案首頁、文件與版本／部署資訊入口。不得承載成績查詢表單、管理員登入、後端 API、Secret 或真實個資。已部署並驗證 [專案文件頁](https://kisaraki.github.io/classroom-aigrade-tzk/)。

## Repository

已建立並以 GitHub API 驗證 [kisaraki/classroom-aigrade-tzk](https://github.com/kisaraki/classroom-aigrade-tzk)，可見性為 Public。使用者已確認 Owner 與 MIT 版權持有人為 `kisaraki`。

## 安全與個資注意事項

- 測試、示例、截圖及版本庫只使用虛構資料。
- 真實 Secret、學生／教師個資、Production DB dump 不進 Git 或公開頁面。
- 管理端須驗證身分、操作權限及資料範圍；不得只靠前端或角色名稱控制。
- 公開查詢須包含學期；多筆命中不提供候選名單，處理流程仍有待決策。
- AI 輸入採允許欄位清單，排除直接識別資料，並檢查 RAG 內容。
- 封存可復原；Purge 不可 Undo，必須完成期限、Preflight、權限、重新驗證、二次確認及稽核。

## 開發方式

1. 閱讀 PROJECT_SPEC 與 AGENTS，指定單一 Phase 或明確的文件工作範圍。
2. 核對 Model/Effort、現有檔案、migration、tests 及待決策關卡。
3. 僅實作核准範圍，執行對應測試並回報證據。
4. Phase 完成後停止，等待使用者確認下一階段；不得自動部署。

完整交付與驗收要求見 [§74](PROJECT_SPEC.md#spec-74)。

## License

採用 [MIT License](LICENSE)，Copyright (c) 2026 kisaraki。Starter 附帶的第三方授權保留於原始碼中。
