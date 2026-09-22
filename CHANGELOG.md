# Changelog

記錄文件與軟體的變更。文件版本與軟體 Release 分開；以下文件版本不是應用程式正式版本，也不是任何 Phase 或部署完成聲明。歷史條目保留當時變更，現行規則以 PROJECT_SPEC.md 為準。

## Phase 0 基礎環境 — 2026-09-23

本次為開發基礎建置，不是正式軟體 Release 或 Sites 部署。

- 使用者確認 GitHub Owner `kisaraki`、Public repository、MIT 版權持有人與 2026 年份。
- 建立 Sites 專案、Vinext／Cloudflare Workers 本機預覽、DB／FILES 邏輯 bindings、環境欄位範本與隔離儲存測試。
- 建立 GitHub Pages 靜態文件入口與 Actions、CI、格式及文件／敏感資料檢查。
- 停用 starter 的 ChatGPT 登入模擬；管理員唯一外部認證仍為 Google OAuth／OIDC。
- 使用者澄清目前沒有 OAuth Client，要求先跳過設定與登入實測；D-09 保留，Phase 3A 前補驗證。
- 正式 schema、migration 與 Production 部署未執行。結果與限制見 [Phase 0 驗證紀錄](docs/PHASE_0.md)。

## 文件 v1.6-draft — 2026-09-22

依使用者明確指示，管理員只需 Google OAuth 認證，取消 ChatGPT 與 Gemini 認證條件。

### 變更

- 管理員唯一外部認證改為 Google OAuth／OIDC；保留 email_verified、authorized_email、Google subject 綁定、帳號狀態及 Permission／Scope。
- 移除 ChatGPT／Gemini 認證分支、AI 身分欄位、人工核驗，以及 AI 服務資格對登入和 Session 的限制。
- 同步首次 Bootstrap、第二位與一般管理員、Rebind、Recovery 邊界及高風險 Google 重新驗證；保留 Bootstrap Secret 與稽核控制。
- 重寫管理員驗收案例與 Phase 0／3A 要求；驗證只有 Google 認證仍可登入，AI 帳號、API Key 或服務故障不影響登入。
- D-01 移除首次 Gemini 人工核驗問題，保留 Emergency Recovery；D-09 移除 AI 身分能力與人工核驗政策，保留 Google 平台整合與 Email 政策。
- OpenAI／Gemini 的 AI 建議提供者及 ChatGPT Sites 目標部署平台維持原規劃。
- 同步 AGENTS、README 與官方 Google OIDC 查核來源。

### 驗證範圍

僅修訂四份 Markdown，檢查現行認證條件、過期欄位／分支殘留、文件連結、Phase／Effort 及敏感資料格式。專案仍無程式、migration 或測試套件，未執行登入功能測試或正式部署。

## 文件 v1.5-draft — 2026-09-22

本次依使用者核准的文件審查範圍修訂。業務選項尚未全部定案，狀態維持 draft。

### 新增

- [README.md](README.md)：文件入口、規劃架構、開發現況、Phase 狀態、部署資訊及 License 狀態。
- 本 CHANGELOG，供後續追蹤文件與軟體變更。
- [主規格 §72](PROJECT_SPEC.md#spec-72)：文件責任、D-01～D-11 待決策清單與確認關卡。
- [主規格 §73](PROJECT_SPEC.md#spec-73)：公開查詢、計算案例、併發／版本、Rollback、AI／RAG、身分驗證及保存／部署邊界。
- [主規格 §74](PROJECT_SPEC.md#spec-74)：21 個 Phase 的順序、Recommended／Minimum 及最低交付證據。

### 修正

- 將原 `PROJECT_SPEC_Student_Grades_AI_System_v1.4.md` 重新命名為 [PROJECT_SPEC.md](PROJECT_SPEC.md)，統一主規格引用，保留單一權威來源。
- 管理員首次登入統一為 Google 加上 ChatGPT／Gemini 擇一驗證，修正舊 §37 只允許 ChatGPT 的矛盾。
- 釐清不納入 v1 的企業級 SSO／目錄整合與必要 Google OAuth / OIDC 登入的差異。
- 公開查詢加入學期條件及多筆命中的一般失敗處理；核驗方式仍待決策。
- 補齊 AGENTS 的匯入 Map、修改後恢復鎖定及狀態回報值。
- Phase 完成提示使用實際順序，處理 3A → 3B 及 Phase 19 後停止。

### 調整

- 整理標題層級、導航及章節錨點；文件優先順序與維護方式一致化。
- Model/Effort 改依實際證據回報，區分 KEEP、確認成功的 AUTO_SWITCHED 與 MANUAL_CHANGE_REQUIRED；純文件工作可記 N/A。
- Sites 保存版本／預覽與 Production 部署明確分開；官方文件說明與本專案實測狀態分開記錄。
- AI 身分欄位不再假定全部由平台保證提供；綁定、首次人工核驗與 Recovery 保留待決策。
- Phase 6 負責完整 Rollback 核心，Phase 9 整合；Phase 7 保留可持久化 AI 重生請求，Phase 12 整合消費。
- AGENTS 納入 Windows winget、macOS Homebrew、Python uv／pip 的安裝優先順序。

### 驗證範圍與限制

本次只修訂 Markdown，檢查文件結構、內部連結、錨點、檔名引用、Phase／Effort 一致性及常見敏感資料格式。沒有應用程式、migration 或測試套件，未執行功能測試；未初始化 Git、建立遠端資源或部署。

本版承接既有 v1.4-draft-freeze 文件；不回填未提供的舊版發布日期、部署紀錄或測試結果。
