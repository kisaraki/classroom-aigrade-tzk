# Phase 0 驗證紀錄

日期：2026-09-23（Asia/Taipei）。此檔記錄執行證據，規格仍以 [PROJECT_SPEC.md](../PROJECT_SPEC.md#spec-46) 為準。

本次基礎環境交付已完成；Google OAuth 設定與登入實測依使用者指示暫緩。這不是正式系統或 Production 驗收完成聲明。

## 範圍與使用者決策

- 使用者核准 Phase 0，GitHub Owner 為 `kisaraki`、Public repository、MIT 版權標示 `2026 kisaraki`。
- Recommended／Minimum 均為 MEDIUM；使用者確認實際設定為 MEDIUM 或以上，KEEP，未自動切換。
- 使用者澄清目前沒有 Google OAuth Client，要求先跳過。Google OAuth 設定與登入實測暫緩；D-09 保留至 Phase 3A 前補驗證。
- 沒有正式 schema、正式 migration、管理員帳號、學生資料或 Sites Production 部署。未進入 Phase 1。

## 平台與工具證據

| 項目           | 證據                                                                 | 範圍／限制                                                      |
| -------------- | -------------------------------------------------------------------- | --------------------------------------------------------------- |
| 本機工具       | Git 2.55.0.windows.3、Node.js 24.15.0、npm 11.5.2                    | Windows PowerShell                                              |
| GitHub         | `gh api repos/kisaraki/classroom-aigrade-tzk` 回傳 Public repository | [Repository](https://github.com/kisaraki/classroom-aigrade-tzk) |
| Sites project  | `appgprj_6ab31085ee6481918d7a5dd51124b085`                           | 已建立，版本數 0，current_live_url 為 null                      |
| Sites audience | get_site 回傳 custom，available_access_modes 為 custom、public       | 保留既有受限存取，未切換 Public                                 |
| Sites Secret   | 合成測試值以 is_secret=true 寫入；讀回 value=null，測試後移除        | 僅證明設定 API 可用；未驗證雲端 Worker 注入                     |
| 雲端 D1        | read_database_overview 回傳 bindings=[]                              | 尚未發布，未配置雲端 DB；不假稱雲端讀寫成功                     |
| Worker runtime | Sites portable starter 使用 Cloudflare Workers 相容建置              | 本機模擬與建置結果見下方，不等於 Production 實測                |
| 邏輯 bindings  | `site/.openai/hosting.json`：DB／FILES                               | 真實 Cloudflare 資源由 Sites 管理，未虛構資源 ID                |

Sites 註冊回傳的預期 origin 不是已發布網址，因此 README／Pages 不將它列為可用的正式系統入口。

## 驗證命令

在專案根目錄執行文件及安全檢查；其餘命令在 `site/` 執行。

| 命令／檢查                      | 狀態                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `npm run install:ci`            | 通過，依鎖檔安裝                                                                  |
| `npm run lint`                  | 通過                                                                              |
| `npm run format:check`          | 通過                                                                              |
| `npm run typecheck`             | 通過                                                                              |
| `npm test`                      | 4 passed，0 failed                                                                |
| `node scripts/check-docs.mjs`   | 通過，6 份專案 Markdown、109 個本機連結                                           |
| `node scripts/check-safety.mjs` | 通過，另確認 .env、.dev.vars、runtime state 與 build output 被 Git 忽略           |
| `npm run build`                 | 通過，產生 Worker ESM、client assets、wrangler 設定及 hosting manifest            |
| 本機開發預覽                    | 首頁／health／favicon 為 200；未知路徑、範例 notes 與 ChatGPT 登入路徑為 404      |
| 建置後 Worker 預覽              | 首頁／health／favicon 為 200，未知路徑為 404，health 回傳 Cache-Control: no-store |
| GitHub Actions CI／Pages        | 首次 CI 與 Pages 均 success；Repository、Pages 及 CSS／favicon HTTP 200           |

Windows 的 Sites plugin 安裝／建置 wrapper 遇到 npm shim 路徑錯誤；改由已安裝 npm 的 JS 入口執行相同腳本後通過，未修改全機工具或 plugin。實際使用命令：

```powershell
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run install:ci
node 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run build
```

D1／R2 測試在獨立 Miniflare／workerd 實例內執行，關閉持久化。涵蓋 D1 參數化查詢、batch、NULL／0 與 FTS5；R2 寫入、讀取、metadata、刪除與不存在物件；Worker Web Crypto、Secret binding 與 Set-Cookie header。Cookie header 測試不代表瀏覽器實際接受，也不代表 Google OAuth 成功。

正式 schema 與 migration test：本 Phase 不適用。權限、Scope／IDOR 與管理員 Session 尚未實作，不得視為測試通過。

已驗證的遠端結果：

- [Repository](https://github.com/kisaraki/classroom-aigrade-tzk)
- [GitHub Pages](https://kisaraki.github.io/classroom-aigrade-tzk/)
- [初次 CI 成功紀錄](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/35799472497)
- [初次 Pages 成功紀錄](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/35799472467)
- ChatGPT Sites：未發布，無已驗證正式 URL。

## Google-only 登入關卡

此 Phase 未建立登入端點或授權資料表；starter 的 ChatGPT 登入模擬已停用，首頁不依賴其他服務認證。

官方 Sites 說明將 public audience 與應用程式登入分開；工具確認此帳號提供 public 選項。但外部 Google OAuth 在 Sites 的 callback、Cookie、HTTP redirect、錯誤處理及 Google-only 到達管理端仍未實測。已安裝 Sites plugin 0.1.70 的 Authentication 說明將 `/callback` 列為平台保留路徑，應用程式未占用該路徑。

Phase 3A 前須：

1. 取得 Google Web OAuth Client 並透過安全設定提供 Secret。
2. 確認 Sites 現行外部 OAuth 支援方式及非保留 callback 路徑，將精確 URI 登錄於 Google。
3. 以預定存取設定驗證 Google-only 流程、Secure／HttpOnly／SameSite Cookie。
4. 確認 Email 正規化、允許帳號政策，再完成 §67.1 的適用驗收案例。

## 其他能力限制

- 雲端 D1、R2、Secret 注入與正式 Cookie 行為未測試；需在核准的後續部署與 smoke test 補驗證。
- Phase 0 沒有可靠背景佇列／排程的實測證據；不將 `waitUntil` 或延長 HTTP request 當成可靠工作佇列。Phase 12 實作前需確認平台方案。
- Starter 依賴含上游元件與建置整合；本次只額外加入格式工具 Prettier，並將原本由 Wrangler 帶入的相同版本 Miniflare 列為直接測試依賴。
- 不將此基礎建置標示為正式軟體 Release。

## 參考來源

- [Sites 官方說明](https://learn.chatgpt.com/docs/sites)：專案／版本／部署、存取控制、D1／R2 與 Secret。
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)：OIDC 與 redirect_uri 契約。
- [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)：Pages Actions 與必要權限。

官方文件查核日期為 2026-09-23。文件可用能力、工具回傳與本機測試分別記錄；任何一項均不能代替未執行的正式驗證。

## Phase 0 交付報告

### 零、模型／推理強度

Recommended MEDIUM；Minimum MEDIUM；Actual 為使用者確認的 MEDIUM 或以上（無法讀取更精確層級）；KEEP。未自動切換，未另行升級。

### 一、完成項目

完成 GitHub repository、MIT、Sites 專案註冊、邏輯 bindings、環境範本、Hello World／health 預覽、隔離 D1／R2 smoke test、格式／lint／TypeScript／文件／敏感資料檢查、Worker 建置、GitHub CI 與 Pages 發布驗證。Sites Secret 設定 API 已以合成值驗證並清理。

### 二、新增檔案

- 根目錄：LICENSE、.gitignore、.gitattributes。
- site/：官方 starter、套件與鎖檔、預覽頁、health route、DB／FILES 設定、.env.example、測試與格式設定。保留上游元件及授權，移除未使用的範例路由／資產與 ChatGPT auth helper。
- pages/：靜態文件首頁、樣式與圖示。
- .github/workflows/：CI 與 Pages workflow。
- scripts/：文件連結／結構與常見 Secret／身分證格式檢查。
- docs/PHASE_0.md：本驗證及交付紀錄。

### 三、修改檔案

PROJECT_SPEC.md 記錄 Phase 0 決策與 OAuth 暫緩；README.md 更新實際命令、進度及已驗證網址；CHANGELOG.md 記錄本次建置。AGENTS.md 的既有內容未變更，納入初始 Git commit。

### 四、Database Migration

未建立正式 SQL migration；schema 保持空白，Drizzle journal entries 為空。測試 FTS5 表只存在於可丟棄的本機模擬資料庫。

### 五、測試結果

上方命令表列出實際結果；本機測試 4 passed／0 failed，GitHub CI 成功。Google OAuth 測試依使用者指示不執行，未計入通過數。

### 六、安全性檢查

僅使用虛構測試值；Secret probe 已移除；Git 忽略本機環境、資料庫與 runtime state；Pages 不含表單或執行腳本。常見 Secret／身分證格式掃描通過，不能代替後續功能安全測試。未部署 Sites、未寫入雲端學生資料或執行 Purge。

### 七、已知限制

Google OAuth／D-09、雲端 D1／R2／Secret 注入、正式瀏覽器 Cookie、背景佇列／排程尚未實測，詳見前述限制。初始提交只代表基礎建置，不是正式 Release。

### 八、下一 Phase 預計工作

Phase 1：依核准資料模型建立正式 schema、migration 及 migration tests。開始前讀取該 Phase 的 HIGH／HIGH 要求並確認 D-03、D-11 等相依決策；本次未開始。Google 登入必須在 Phase 3A 前補齊 D-09 驗證。
