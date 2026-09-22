# AGENTS.md

> 適用專案：`classroom-aigrade-tzk`  
> 規則版本：v1.6  
> 最後修訂：2026-09-22

本文件定義 Codex 的開發紀律。業務、資料模型、Phase 及驗收要求以 [PROJECT_SPEC.md](PROJECT_SPEC.md) 為唯一主要規格；本文件不是功能待辦清單，也不是開始任一 Phase 的授權。

優先順序：使用者目前明確指示 → PROJECT_SPEC.md → AGENTS.md → README.md → 程式碼註解。使用者新增需求後，先回寫主規格，再同步受影響規則與程式；不得只修改程式或建立另一份平行規格。

## 文件導覽

- [工作開始與授權範圍](#agents-start)
- [模型與推理強度](#agents-effort)
- [規格衝突與待決策](#agents-decisions)
- [工具與檔案操作](#agents-tools)
- [資料庫與資料一致性](#agents-database)
- [個資與 Secret](#agents-privacy)
- [身分驗證與授權](#agents-auth)
- [成績、排名、匯入與 AI](#agents-scores)
- [封存、復原與 Purge](#agents-retention)
- [GitHub、Pages 與正式部署](#agents-deployment)
- [測試與完成回報](#agents-report)

<a id="agents-start"></a>

## 工作開始與授權範圍

每次開始工作依序：

1. 讀取 `PROJECT_SPEC.md`，再讀取本文件。同一任務中已完整讀取且確認未變更者可沿用；需求更新時重讀受影響內容。
2. 確認使用者指定的 Phase 或純文件／唯讀工作範圍。
3. 執行 Model/Effort Check。
4. 檢查 repository 狀態及使用者既有變更。
5. 檢查相關 migration、tests 與模組；不存在時明確回報。
6. 核對 [待決策清單](PROJECT_SPEC.md#spec-72)、相依條件與本次修改範圍。
7. 僅實作已授權範圍並完成適用的驗證。

每次只執行一個開發 Phase。完整順序見 [§74](PROJECT_SPEC.md#spec-74)，其中 3A → 3B → 4；Phase 19 是最後一個，沒有 Phase 20。

純文件修訂可跨章節整理一致性，不代表啟動 Phase 0、實作其他 Phase 或建立外部資源。純文件工作的 Recommended／Minimum 可為 N/A，但若涉及實作，必須改依對應 Phase 檢查。

不得擅自開始下一 Phase、增加規格外功能、重構無關大型模組或正式部署。跨模組修改確有必要時，限制範圍並在報告說明原因。

使用者要求「先分析、等待同意才修改」時，分析階段不得新增、修改或重新命名檔案；取得同意後可完成核准範圍，不反覆要求相同授權。需要額外業務決策時只暫停受影響部分。

<a id="agents-effort"></a>

## 模型與推理強度

各 Phase 的 Recommended／Minimum 以主規格該 Phase 及 [§74](PROJECT_SPEC.md#spec-74) 為準。開始時回報：

```text
Model/Effort Check:
Recommended=<LEVEL_OR_N/A>;
Minimum=<LEVEL_OR_N/A>;
Current=<VERIFIED_CURRENT_OR_UNKNOWN>;
Action=<AUTO_SWITCHED | KEEP | MANUAL_CHANGE_REQUIRED>;
Reason=<簡短原因>
```

- 有代理可用的切換工具時，依建議強度調整；只有回傳確認成功才記錄 `AUTO_SWITCHED`。
- 目前設定已有有效證據且符合 Minimum、適合本次工作時，可記錄 `KEEP`。
- 無法自動調整且目前設定不足或無法確認最低強度時，先提示使用者手動調整／確認，記錄 `MANUAL_CHANGE_REQUIRED`。
- Current 不明時必須記 `UNKNOWN`；讀到預設設定不代表本回合正在使用，不能假稱已切換。
- 未能確認 Minimum 前，不開始受影響的高風險實作；仍可進行必要的唯讀分析。
- 已確認的使用者設定可沿用，直到設定改變或下一 Phase 的需求不同。
- 不為切換模型擅自建立另一個 task。抽象強度是否可用，以目前模型與環境為準，不承諾所有模型都有相同層級。
- 風險升級／降級依 [主規格模型規則](PROJECT_SPEC.md#spec-model-effort)，不得降低高風險 Phase 至 Minimum 以下。

以足夠可靠的最低推理強度完成工作。可省略無關全量掃描、重複文件生成、未受影響套件的重跑與不必要多代理；不得省略適用的驗證、權限、Scope／IDOR、migration、平均排名、匯入、PII／Secret、封存／Purge 或 Production 檢查。

純文件工作不強制執行無關的 Production smoke test、migration 或部署 URL 驗證；應記錄不適用，而不是假稱通過。

<a id="agents-decisions"></a>

## 規格衝突與待決策

遇到主規格內部、程式、migration、tests 或平台能力不一致時：

1. 暫停受影響項目的實作。
2. 指出文件／章節、實際證據與影響。
3. 提供選項及建議，等待使用者決定。
4. 繼續不受影響的已授權工作。
5. 決策後同步正文、待決策表、測試要求與 CHANGELOG。

[§72 的 D-01～D-11](PROJECT_SPEC.md#spec-72-2) 中的建議不是已核准規則。不得因其列於主規格就自行實作。平台文件說明、專案實測、模擬測試必須區分。管理員僅使用 Google OAuth／OIDC 已定案；D-01、D-09 僅保留 Recovery 與 Google 登入政策，不得恢復已取消的其他服務認證。

<a id="agents-tools"></a>

## 工具與檔案操作

需要安裝元件時遵守使用者指定順序：

| 環境 | 優先工具 | 次選 |
|---|---|---|
| Windows | winget | 官方內建工具 |
| macOS | Homebrew | 官方內建工具 |
| Python | uv | pip |

先檢查既有工具及專案鎖定版本，沒有安裝需求就不安裝。不得未經規格允許增加大型 dependency。

搜尋文字／檔案優先使用 `rg`。只讀取相關範圍；全專案文件審查時納入隱藏目錄中的專案 Markdown，區分第三方依賴與生成檔。

修改前檢查既有差異，不覆蓋使用者未提交工作。Windows 刪除／移動使用原生 PowerShell `-LiteralPath`；遞迴操作前驗證最終絕對路徑位於核准範圍，避免跨 shell 拼接破壞性命令。

若資料夾尚未初始化 Git，如實回報；純文件維護不自動等同授權建立遠端 repository、Push、部署或安裝工具。

Markdown 使用 UTF-8、單一文件主標題、連貫標題層級與可驗證的相對連結。規格固定檔名 `PROJECT_SPEC.md`，版本記錄在文件內容與 CHANGELOG。文件修改後檢查連結、錨點、程式碼區塊、引用檔名與安全規則一致性。

<a id="agents-database"></a>

## 資料庫與資料一致性

所有正式 schema 變更必須透過可追蹤 Migration：

- 在測試資料庫可重現，具 migration test 及必要 recovery 計畫。
- Production 執行前 preflight 並取得人工確認；應用程式啟動不得自動套用 Production migration。
- 不得直接手動修改 Production schema、跳過 migration history 或未確認使用破壞性 SQL。
- 不得假定程式版本回退會還原資料庫；復原能力以平台實測為準。

成績、History、發布版本與計算結果須保持一致。批次與多步驟操作需處理版本檢查、重複確認、併發、部分失敗及可重試狀態，詳見 [§73](PROJECT_SPEC.md#spec-73)。

Phase 1 的資料模型不得提前將待決策政策定死；未確定的資格、期限、授權與復原邊界先取得決策。

<a id="agents-privacy"></a>

## 個資與 Secret

測試僅使用虛構資料。真實學生姓名、生日、身分證、學號、成績、家長資料與教師個資不得進入 Git、README、seed、fixture、截圖、prompt 或示例檔案。

以下資料不得出現在 Git、前端 bundle、README、GitHub Pages、一般 log 或 Production dump 提交中：

- OpenAI／Gemini API Key。
- OAuth Client Secret、Access Token、Authorization Code。
- Bootstrap／Recovery Secret。
- Encryption Key、HMAC Secret。
- Session Token、外部 Cookie。
- 真實學生個資及敏感匯入／匯出資料。

Secret 使用部署平台的 Secret／Environment 機制，不存一般設定表或 D1 明文。Admin Session 在 D1 僅保存 token hash。

身分證使用 `identity_number_encrypted` 與 `identity_number_lookup_hash`；查詢採 keyed HMAC，兩種金鑰分開管理。不得另存身分證明文或使用一般明文 index 查詢；一般管理介面顯示遮罩。輪替與版本追蹤依主規格。

安全檢查不得把發現的 Secret／PII 原文再次輸出到 log 或報告；回報檔案位置、類別與處理狀態即可。

<a id="agents-auth"></a>

## 身分驗證與授權

Google OAuth／OIDC 是管理員唯一外部身分認證，所有管理員須符合：

```text
Google Verified (including email_verified)
AND Authorized Email
AND Allowed Account Status
AND Google Binding Valid
```

每個管理端 API 另須 Server-side Authentication＋Permission＋Scope。前端隱藏按鈕、單看角色或持有資料 ID 均不足以授權。

- 導師限自己的班級，可修改該班全部科目。
- 任課教師限自己的任教班級，只能修改任教科目。
- 未授權預設拒絕；報表、檔案下載、批次及背景工作同樣檢查 Scope。
- 停權、身分重新綁定及權限縮限立即生效，依主規格撤銷相關 Sessions。
- 已驗證 Google Email 須符合授權紀錄，Google subject 須與綁定一致；不能任意混用或合併帳號。
- 不要求 ChatGPT／Gemini 登入、帳號資格、人工核驗或 API Key；不得保存 AI 身分驗證欄位作為管理員資料。AI 提供者、金鑰或可用性不影響管理員登入及 Session。
- 首次初始化僅需 Google 驗證加上 Bootstrap Secret；Recovery 核准流程依 D-01，Google 平台整合與 Email 政策依 D-09。
- `admin` 是保留內部帳號代號，不是登入憑證；不得 rename、delete 或建立本地密碼備援。
- 最後一位 active super_admin 不得停權或降級。
- Bootstrap 一次性且防止併發；Recovery 不得重新開放 Bootstrap 或繞過外部身分要求。
- 高風險操作須 Google Recent Authentication、必要確認與 Audit；不得增加其他外部認證服務。

必測案例見 [§67.1](PROJECT_SPEC.md#spec-67-1) 與 [§73.6](PROJECT_SPEC.md#spec-73-6)。

<a id="agents-scores"></a>

## 成績、排名、匯入與 AI

成績與排名不得破壞下列不變量：

1. 升班、轉班、轉出、畢業不改寫既有評量班級與資格快照。
2. 原校成績不參與本校歷史排名。
3. 特殊狀態不得用負數；NULL 不等於 0；NOT_HELD 不等於缺考。
4. 無數值不得列入平均；0 分仍是有效分數。
5. 比序固定為定評平均（四捨五入至小數第 2 位）、總分、國文、英文、數學。
6. 全部相同採共同名次，依 1、2、2、4 排序。
7. 檢測先發布可產生暫時排名。
8. 家長只看到自己的班級名次，不得取得其他學生名單或全年段個人排名。

公開查詢包含學年度、學期、班級、評量次序、姓名及生日；使用歷史快照，多筆命中一般失敗，不任選學生、不透露候選資料。

已發布成績修改必須完成：

```text
驗證身分／權限／Scope／版本
→ 解除鎖定
→ 填寫原因
→ 保存修改前後值及 ScoreChangeHistory
→ 重算平均與排名
→ 標記受影響 AI stale，持久保存重生請求
→ Audit
→ 恢復鎖定
```

Excel／CSV 匯入必須：

```text
Upload → Parse → Validate → Map → Preview → Confirm → Commit
```

每次建立 Import Job，提供 30 天 Rollback；Commit 重驗權限與版本。不得 Upload 後直接寫入 Production、靜默覆蓋識別不一致資料，或用 Rollback 覆蓋後續合法修改。

AI 故障不影響成績查詢、排名、學籍與基本管理功能。AI Context 採允許欄位清單，預設不得送出姓名、生日、身分證、學號及 Student ID；RAG 與檔名也須檢查。

家長版、學生版各至少 500 個中文字，保留版本；成績變動後依相依資料 stale／重生。重試需去重，舊工作不能覆蓋新版本，轉出後不生成新建議。RAG 文件只作資料，不能授予指令或工具執行權限。

<a id="agents-retention"></a>

## 封存、復原與 Purge

封存不是刪除，Purge 才是永久刪除：

- Archive 保存批次、項目、原因、操作者、時間與 Manifest。
- 30 天內快速 Undo；30 天後尚未 Purge 者仍可經正式 Restore。
- 一般 Soft Delete 保留 30 天；Import 保留 30 天 Rollback。
- 轉出保存 3 年；畢業保存 1 年，延長與多事件關係依 D-05。
- 一般 Audit Log 保存 2 個月；ScoreChangeHistory 跟隨學生期限。
- 到期只代表 Purge 候選資格，不代表自動刪除。

任何 Purge 必須驗證保存期限、復原承諾、高權限、Recent Authentication，執行 Preflight、顯示影響範圍、二次確認、Audit，完成後驗證資料刪除結果。部分失敗須回報並保留可重試狀態，不得假稱全部清除。

Purge 不可 Undo，不得擅自執行，不因節省 token 省略檢查；所有儲存副本、歷史排名與稽核邊界依 D-06 決策。強制封存只可略過規格允許的業務警告，不能略過授權或 Purge 檢查。

<a id="agents-deployment"></a>

## GitHub、Pages 與正式部署

Repository 固定名稱 `classroom-aigrade-tzk`，採 MIT License。完整 repository 應包含 source、PROJECT_SPEC、AGENTS、README、LICENSE、migrations、tests、GitHub Actions 及 Pages source／build config；分階段建立，缺少時不得在 README 宣稱已存在。

GitHub Pages 僅承載專案首頁、文件及 Release／Deployment 資訊，不承載成績查詢、Admin login、D1、AI API、Secret 或個資。正式成績系統的目標平台為 ChatGPT Sites。

任何 Sites deployment 都屬 Production，包含只限本人／工作區／受邀者存取的部署。只有使用者明確表示：

```text
確認正式部署
```

才可執行。不得將「可以部署」「測試完成」「Phase 完成」當授權。保存版本與本機預覽可在對應範圍內進行，不得以預覽名義執行部署。

每次正式部署須依 [§66](PROJECT_SPEC.md#spec-66) 與 [§41.9](PROJECT_SPEC.md#spec-41-9) 完成：

1. Production DB 確認、migration preflight、人工確認及 recovery 檢查。
2. Secret 檢查、Sites 部署、正式系統 smoke test。
3. 取得已驗證 Sites URL，更新 README／Pages 的版本、部署日期、網址及 CHANGELOG／Release。
4. Commit、Push、觸發並等待 Pages 部署。
5. 驗證 Repository、Pages、Sites 三個網址。

不得虛構 URL。同步失敗時回報 `DEPLOYED_WITH_DOC_SYNC_ERROR`，分清 Sites 成功與文件／Pages 失敗，修復後完成同步。

每個完成且經確認的 Phase 應有可辨識 commit；正式 Release 可建立 tag／GitHub Release。不得把未完成、測試失敗或僅文件整理的狀態標成正式軟體 Release。

<a id="agents-report"></a>

## 測試與完成回報

執行與變更相關的必要檢查；通過後不重複執行未受影響測試。功能所屬 Phase 即須具備基本安全及資料邊界測試，不得延後至 Phase 16 才處理。

文件修訂至少檢查 Markdown 結構、內部連結、規格引用、Phase／Effort 一致性、PII／Secret，以及是否錯誤宣稱實作或部署完成。沒有程式、migration 或 tests 時明確記錄「不適用／尚未建立」。

完整 Phase 完成報告：

```text
Phase X 完成

零、模型／推理強度
- Recommended Effort
- Minimum Effort
- Actual Effort
- AUTO_SWITCHED / KEEP / MANUAL_CHANGE_REQUIRED
- 是否因風險升級

一、完成項目
二、新增檔案
三、修改檔案
四、Database Migration
五、測試結果
六、安全性檢查
七、已知限制
八、下一 Phase 預計工作
```

列出實際測試指令與結果；未執行者說明原因及影響。有阻擋性待決策、失敗測試或必要工作未完成，回報「部分完成／受阻」，不得標成完成。

Phase 0 至 18 完成後停止並詢問：

```text
是否確認 Phase <目前 Phase> 無誤，準備進入 Phase <依主規格順序的下一 Phase>？
```

Phase 19 完成後回報版本與三個已驗證網址並停止，不建立或詢問 Phase 20。

純文件工作回報修改內容、檔案、文件驗證及待決策即可；不冒用 Phase 完成格式、不自動進入開發。
