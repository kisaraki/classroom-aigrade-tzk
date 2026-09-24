# Changelog

記錄文件與軟體的變更。文件版本與軟體 Release 分開；以下文件版本不是應用程式正式版本，也不是任何 Phase 或部署完成聲明。歷史條目保留當時變更，現行規則以 PROJECT_SPEC.md 為準。

## Phase 5 平均與排名核心 — 2026-09-24

使用者核准啟動 Phase 5，並核准 D-04 全部三項：完全無有效分數時，平均／總分為 NULL 且不排名；實際 0 分有效。科目比序有數值優先於缺值，雙缺值續比。一般統計納入不排名但有分數者，排名統計只含合格且有分數者；原校成績另列。驗證及限制見 [Phase 5 紀錄](docs/PHASE_5.md)。本次不是正式 Release 或 Sites 部署。

- 先測試再實作精確平均、可空總分、五層比序、班級／全年段共同名次、暫時／正式計算範圍與學期原始分數平均。
- 新增具真實 Session、Scope 及來源版本檢查的內部唯讀計算服務；歷史計算使用既有參與快照，不因目前學籍或資格改變。
- 完整回歸 105 項通過，含新增 21 項；typecheck、lint、format、build、文件及既定敏感資料檢查通過。
- 尚未串接結果儲存、排名 HTTP API 或發布流程，沒有資料庫 migration；相關發布交易留在 Phase 7。

## Phase 4 評量與草稿成績核心 — 2026-09-24

依使用者核准接續 Phase 4，驗證與限制見 [Phase 4 紀錄](docs/PHASE_4.md)。本次不是正式 Release 或 Sites 部署。

- 新增草稿評量、固定科目設定、NOT_HELD、A/B/C/D/N 與 0～100.00 的精確分數驗證；空白、特殊狀態與 0 分分開保存。
- 名單採 Preview／Confirm，依開始日解析有效學籍並固定 D-03 資格及班級快照；原校成績保留獨立來源與空本校班級，不參與本校排名。
- 管理 API 重驗 Cookie Session、Permission、班級／科目 Scope、來源版本及草稿狀態；交易內防止撤權或版本競爭，成績、History、版本、Audit 與操作結果原子提交。
- 新增 0007 migration，保留 0000～0006；建立不可變名單預覽及可重送操作紀錄。補入隔離 D1 的權限、狀態、併發、回滾及升級測試。
- 真實 Google／Sites 驗證仍暫緩；平均、排名、匯入、發布及 UI 屬後續 Phase。

## Phase 3B 管理員授權核心 — 2026-09-24

接續使用者已核准的 Phase 3B、D-01／D-10，新增 D-11 決策：Google Recent Authentication 及一次性 Recovery 核准均為 5 分鐘。驗證結果見 [Phase 3B 紀錄](docs/PHASE_3B.md)；不是正式軟體 Release 或 Sites 部署。

- 新增最小權限矩陣、學期／日期／班級／科目 Scope、批次全目標檢查、學生學籍解析與歷史評量快照授權；缺少範圍預設拒絕。
- 管理員新增／異動、Role／Scope 變更、強制登出要求伺服器 super_admin、Google Recent Authentication、明確確認與目標版本；交易內重驗操作人及版本，連同 Audit 原子提交。
- 新增 Google reauthentication、一次性 Rebind／Recovery 核准與 callback；核准 Email、新 Google 身分、原操作人、到期、版本與重放皆驗證。Recovery 核准不提供公開 HTTP API。
- Recent Authentication 使用已驗證 Google ID token 的 auth_time；缺失、未來或超過窗口即拒絕高風險操作，不把新發 token 或選擇帳號當作重新驗證證據。
- 新增 0006 migration 與認證／授權／HTTP／併發／升級測試。保留已提交 0000～0005，Phase 3A OAuth state 以新增欄位及替換 trigger 升級。
- Google OAuth Client、auth_time 啟用與 Sites callback／Cookie 實測依 D-09 暫緩；管理 UI 及後續學籍／成績 API 不在此階段提前開放。

## Phase 3A 管理員 Google 認證核心 — 2026-09-23

依使用者批准實作 Phase 3A，僅在隔離本機驗證；OAuth Client 與 Sites callback 實測仍依先前指示暫緩，不是正式軟體 Release 或 Sites 部署。

- 新增 Google OIDC discovery、RS256 ID token 驗證、issuer／audience／效期／nonce／`email_verified` 檢查，以及 PKCE、state、一次性 callback state。
- 新增 Google-only 一次性 Bootstrap start／callback、授權 Email、Google subject 綁定、pending identity binding、登入／登出與 HttpOnly Secure Session cookie。
- Session 使用 idle／absolute timeout、D1 token hash、帳號狀態／auth version 驗證；停權、綁定及權限資料變動沿用既有 Session 撤銷 trigger。
- 新增 `0004_phase_03a_auth_states.sql`、`0005_phase_03a_bootstrap_state_purpose.sql` 與 7 組認證測試；未建立本地密碼、ChatGPT／Gemini 認證或 AI 身分欄位。
- 正式部署前仍須補充 OAuth Client、Google callback／Cookie 的平台實測與 D-09 證據。

## Phase 2 學年度與學籍核心 — 2026-09-23

依使用者批准實作 Phase 2，僅在隔離本機驗證；完整結果見 [Phase 2 紀錄](docs/PHASE_2.md)，不是正式軟體 Release 或 Sites 部署。

- 建立內部學年度／兩學期、班級、新生單筆／批次基礎、學籍與座號、升班預覽／調班、轉班、轉入／轉出及撤銷服務。
- 所有業務寫入先 Preview／Confirm，保存 revision 與 receipt，重驗 actor／Session／Scope，重送不重複；資料與 Audit 同批提交，失敗可重試。
- 新增四張 academic 命令／revision 表與 0002／0003 migration，保留 Phase 1 migration；測試既有資料升級不改歷史紀錄。
- 轉班保存原快照，禁止評量期間及後續凍結名冊衝突；轉出依曆年設定 3 年期限，撤銷不覆蓋後續修改；D-05 跨事件期限仍待決策。
- 歷史年度預設唯讀；單次歷史寫入要求 super_admin、可信 Google Recent Authentication 與原因，沒有永久解鎖旗標。
- 授權預設拒絕，尚未對外開放管理路由；Google OAuth 實測仍暫緩。Excel／CSV 完整匯入流程留待 Phase 6。

## Phase 1 資料模型與 Migration — 2026-09-23

本次是本機開發交付，不是正式軟體 Release 或 Sites 部署。詳細證據見 [Phase 1 紀錄](docs/PHASE_1.md)；資料表示及復原方式見 [DATABASE.md](docs/DATABASE.md)。

- 使用者確認 HIGH 以上推理強度，接受 D-03 的單次／學期／學生預設優先序、名冊快照及晚轉入規則；接受 D-11 的台北業務日期、UTC 技術時間、半開區間與曆月／曆年運算。
- 新增 29 張關聯表、FTS5、索引、外鍵、CHECK 與跨列 trigger；兩份 Drizzle migration 保留 journal／snapshots，應用啟動不自動套用。
- 保存學籍與評量快照，拒絕重疊學籍／座號、跨年關聯、特殊成績數值與原校排名；提供不可改寫的歷程、結果與 AI 內容版本。
- 新增 AES-256-GCM、獨立 HMAC-SHA-256、key 版本、輪替準備及遮罩；測試含竄改、錯綁定、遺失 key、跨版本查重及原子回復。
- 新增一次性本機 DB 驗證、虛構 seed、migration／domain／identity 測試，以及 ER 圖和 recovery 設計；測試不建立外部資源，不呼叫真實 AI。
- 管理員資料只含 Google 綁定；Session 保存 hash，資料約束保護保留帳號、最後一位 super_admin、一次性 Bootstrap 與 Session 撤銷。登入與完整 Permission／Scope 仍待 Phase 3A／3B。
- D-03 已定案，D-11 只完成日期決策；其他待決策保持未定。Google OAuth 實測仍依先前指示暫緩。

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
