# 學生成績查詢與 AI 學習建議系統

Software Requirements Specification（SRS）暨 Codex 分階段開發規格

> 文件用途：本文件為本專案之主要規格來源（Single Source of Truth），供 Codex 進行後續設計、實作、測試、部署與維護。  
> 文件版本：v1.6-draft  
> 最後修訂：2026-09-23  
> 文件狀態：文件修訂已核准；待決策事項尚未定案，不代表任何開發 Phase 已完成。  
> 目標平台：ChatGPT Sites（正式能力於 Phase 0 再驗證）  
> 主要開發工具：Codex  
> 資料庫：D1 / SQLite 類關聯式資料庫  
> 檔案儲存：R2 或 Sites 對應之物件儲存  
> 後端：JavaScript / TypeScript Serverless Routes  
> 前端：HTML / CSS / JavaScript  
> 圖表：Chart.js 或同等輕量圖表庫  
> AI Provider：OpenAI API、Google Gemini API  
> 文件語言：繁體中文（臺灣用語）
> 修訂重點（v1.6）：管理員認證改為僅 Google OAuth／OIDC；移除 ChatGPT／Gemini 認證、AI 身分欄位與人工核驗需求，同步 Bootstrap、Session、Rebind、驗收與 Phase 關卡。AI 建議提供者維持獨立。詳細變更見 [CHANGELOG.md](CHANGELOG.md)。

## 文件導覽

本文件仍為草案。先閱讀 [文件治理與待決策清單](#spec-72)，再依指定 Phase 工作；目錄中的功能描述是規格要求，不是已完成聲明。

| 主題 | 章節入口 |
|---|---|
| 原則、架構與名詞 | [§0 最高原則](#spec-0)、[§3 技術架構](#spec-3)、[§4 名詞](#spec-4) |
| 學籍與資料生命週期 | [§5 學年度](#spec-5)、[§6 學生](#spec-6)、[§7 學籍](#spec-7)、[§11 轉出](#spec-11)、[§12 畢業](#spec-12)、[§14 Purge](#spec-14) |
| 成績、匯入與排名 | [§15 評量](#spec-15)、[§18 匯入](#spec-18)、[§20 修改](#spec-20)、[§21 平均](#spec-21)、[§22 排名](#spec-22) |
| 公開查詢與 AI | [§24 查詢](#spec-24)、[§27 AI 建議](#spec-27)、[§30 Jobs](#spec-30)、[§31 RAG](#spec-31) |
| 管理員與權限 | [§32 驗證總則](#spec-32)、[§35 帳號](#spec-35)、[§36 Scope](#spec-36)、[§38 Audit](#spec-38) |
| 資料模型與 GitHub | [§41 資料表](#spec-41)、[§41.1 Repository](#spec-41-1)、[§41.8 README](#spec-41-8) |
| 安全與測試 | [§42 安全性](#spec-42)、[§44 排名測試](#spec-44)、[§67 不變量](#spec-67) |
| Codex 與開發階段 | [§45 作業規則](#spec-45)、[模型檢查](#spec-model-effort)、[§74 Phase 順序與關卡](#spec-74) |
| 範圍與文件維護 | [§69 不包含](#spec-69)、[§72 待決策](#spec-72)、[§73 驗收補充](#spec-73) |

---

<a id="spec-0"></a>

## 0. 專案最高原則

1. 本專案不可一次完成全部功能，必須嚴格依 Phase 分階段進行。
2. Codex 每次只能執行使用者指定的 Phase，不得自行進入下一 Phase。
3. 每個 Phase 完成後必須先測試、回報、等待人工確認。
4. Production deployment 必須由使用者明確確認後才可進行。
5. 資料庫 schema 變更必須透過 migration 管理。
6. Production 資料不得透過破壞性 SQL 直接修改。
7. 真實學生個資不得出現在 Git、README、seed data、測試 fixture、截圖、prompt 檔案。
8. API Key、Secret、Session Token、Bootstrap Secret 不得寫入 Git、D1 明文、前端 bundle 或 log。
9. AI 模組失敗時，成績查詢與管理功能仍必須正常運作。
10. 封存不是刪除；刪除不是封存；Import rollback 亦不是刪除。
11. 歷史排名不得因學生後續升班、轉班、轉出或畢業而改變。
12. 所有成績修改必須可追溯。
13. 所有排名、平均、匯入、封存、權限、安全相關規則都必須有自動測試。
14. Codex 若發現規格互相衝突，必須停止該項實作並回報，不得自行猜測。
15. 本文件若與程式碼註解、舊版文件衝突，以本文件最新版為準。
16. 文件優先順序為：使用者目前明確指示 → `PROJECT_SPEC.md` → `AGENTS.md` → `README.md` → 程式碼註解。
17. 「待決策」與「建議方案」不是已核准的業務規則；受影響的實作必須依 §72 停止於指定關卡，其餘工作可繼續。
18. 本機開發、保存版本、正式部署是不同動作；正式 Sites 部署的判定依 §73.8，不因限制訪客範圍而變成測試部署。

---

<a id="spec-1"></a>

## 1. 專案目標

建立一套供國中使用的「學生成績查詢與 AI 學習建議系統」，包含：

- 家長／學生公開查詢端。
- 管理者後台。
- 學年度、班級、學籍管理。
- 定期評量成績管理。
- Excel／CSV 批次匯入。
- 班級與全年段排名。
- 成績趨勢圖。
- AI 學習建議。
- RAG 教師參考資料。
- 學生轉入、轉出、轉班、升班、畢業、封存。
- 管理員帳號與權限。
- 操作稽核與成績修改歷程。
- 報表、匯出與列印。
- 資料保存期限與永久清除。

---

<a id="spec-2"></a>

## 2. 系統使用者

<a id="spec-2-1"></a>

### 2.1 公開端

主要使用者：

- 家長／監護人。
- 學生本人。

公開端不需管理員帳號，但必須通過查詢條件驗證。

<a id="spec-2-2"></a>

### 2.2 管理端

可能使用者：

- 系統維護者。
- super_admin。
- 教務管理人員。
- 導師。
- 任課教師。
- AI 管理人員。
- 封存管理人員。
- 唯讀查看人員。

管理端採「角色權限 RBAC + 資料範圍 Scope」雙重控制。

---

<a id="spec-3"></a>

## 3. 技術架構

<a id="spec-3-1"></a>

### 3.1 邏輯架構

```text
Browser
  │
  ├── Public UI
  │
  └── Admin UI
        │
        ▼
Server Routes / API
        │
        ├── Authentication / Authorization
        ├── Academic Domain
        ├── Score Domain
        ├── Ranking Engine
        ├── Import Engine
        ├── Archive / Retention
        ├── AI Provider Layer
        └── RAG Retrieval
        │
        ├── D1
        ├── R2 / Object Storage
        └── Secrets
```

<a id="spec-3-2"></a>

### 3.2 目標 Sites bindings

建議預設：

```text
D1 binding: DB
R2 binding: FILES
```

具體設定由 Phase 0 驗證後定稿。

<a id="spec-3-3"></a>

### 3.3 Secret

至少包含：

```text
OPENAI_API_KEY
GEMINI_API_KEY
ADMIN_BOOTSTRAP_SECRET
ADMIN_RECOVERY_SECRET
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
IDENTITY_HMAC_SECRET
IDENTITY_ENCRYPTION_KEY
```

Secrets 不得存入一般設定表。

---

<a id="spec-4"></a>

## 4. 名詞定義

<a id="spec-4-1"></a>

### 4.1 學年度

例如：

```text
115 學年度
```

由管理員手動建立。

建立一個學年度時，系統自動建立：

- 第一學期
- 第二學期

<a id="spec-4-2"></a>

### 4.2 年級

```text
7 = 七年級
8 = 八年級
9 = 九年級
```

<a id="spec-4-3"></a>

### 4.3 班級

班級名稱固定為三碼，例如：

```text
701
702
801
902
```

不處理資源班、體育班、特教班、暫編班等特殊班級。

<a id="spec-4-4"></a>

### 4.4 全年段

定義：

```text
同一 academic_year
+
同一 grade_level
```

例如：

```text
115 學年度八年級全年段
```

<a id="spec-4-5"></a>

### 4.5 定期評量

每學期固定：

- 第 1 次定期評量
- 第 2 次定期評量
- 第 3 次定期評量

每次定期評量原則上包含：

#### 檢測

- 國文
- 英文
- 數學

#### 段考

- 國文
- 英文
- 數學
- 自然
- 地理
- 歷史
- 公民

允許某一次定期評量的某一科「不舉行」。

---

<a id="spec-5"></a>

## 5. 學年度業務規則

1. 新學年度由管理員手動建立。
2. 建立新學年度後，自動建立第一、第二學期。
3. 七年級升八年級、八年級升九年級預設原班升級。
4. 必須提供「批次升班」功能。
5. 批次升班前必須顯示預覽。
6. 預覽階段允許手動調整重新編班與個別學生轉班。
7. 升班必須在人工確認後執行。
8. 新七年級資料採批次輸入為主，也支援單筆新增。
9. 新學年度建立後，舊學年度進入歷史狀態。
10. 系統可查詢任何歷史學年度。
11. 歷史學年度預設唯讀。
12. 只有 super_admin 可透過特殊流程解除歷史年度鎖定。
13. 解除鎖定必須重新驗證身分、填寫原因、留下 Audit Log，完成後重新鎖定。

---

<a id="spec-6"></a>

## 6. 學生基本資料

每位學生至少保存：

- 內部 Student ID。
- 學號。
- 姓名。
- 出生年月日。
- 身分證字號。
- 學籍狀態。
- 建立日期。
- 更新日期。

學號跨國中三年不變。

允許同名同生日學生，內部精確識別以身分證字號為準。公開查詢若無法唯一識別學生，不得任選一筆或回傳候選名單；處理方式見 §24 與待決策 D-02。

身分證字號不得以明文 + 一般 index 保存，必須保存：

```text
identity_number_encrypted
identity_number_lookup_hash
```

查詢使用 keyed HMAC；一般管理介面顯示遮罩，例如 `A12****789`。身分證原文必須加密保存，不得同時另存明文；加密金鑰與查詢 HMAC 金鑰分開管理。金鑰版本、輪替與復原驗證見 §73.7。

---

<a id="spec-7"></a>

## 7. StudentEnrollment 學籍關係

Students 不得直接保存唯一班級作為歷史依據。

StudentEnrollments 至少保存：

- student_id。
- term_id。
- class_id。
- 座號。
- effective_from。
- effective_to。
- enrollment_status。
- ranking_eligible。
- created_at。
- change_source。

同一學生同一時間只能屬於一個行政班，但同一學期可以有多筆 Enrollment，以支援中途轉班。

Phase 1 必須定義生效區間端點及防止區間重疊的約束。評量參與紀錄須保存當次學籍、班級及排名資格快照；建立快照的業務時點依待決策 D-03 定案，不得在讀取歷史資料時用目前學籍重建。

---

<a id="spec-8"></a>

## 8. 新生建立

支援：

- 單筆新增。
- Excel 批次匯入。
- CSV 批次匯入。

必要欄位：

- 姓名。
- 出生年月日。
- 班級。
- 座號。
- 學號。
- 身分證字號。

系統需提供標準 Excel 範本。

不提供直接貼上 Excel 表格功能。

---

<a id="spec-9"></a>

## 9. 轉班

1. 中途轉班必須保存轉班日期。
2. 已完成的定期評量維持原班。
3. 轉班後下一次定期評量才歸新班。
4. 不處理檢測與段考之間轉班。
5. 誤操作可撤銷。
6. 歷史排名不得因轉班改變。
7. 定期評量結果保存 `class_id_snapshot`。

---

<a id="spec-10"></a>

## 10. 轉入學生

1. 轉入前未參加的本校定期評量保持空白。
2. 原校成績可輸入，但不強制。
3. 原校成績不得參與本校歷史排名。
4. 原校成績可用於個人趨勢與 AI 分析。
5. 轉入後第一次實際參加本校定期評量起才納入本校排名。
6. 原校成績標記 `EXTERNAL_TRANSFER`，本校成績標記 `LOCAL`。

---

<a id="spec-11"></a>

## 11. 轉出學生

1. 轉出當下不立即封存。
2. 歷史成績保留。
3. 歷史排名保留。
4. 轉出後停止參與新成績、新排名與新 AI 建議。
5. 家長仍可查詢既有歷史資料。
6. 查詢與資料保存期限為轉出日起 3 年。
7. 管理員可個別延長期限。
8. 誤標轉出可恢復。
9. 保存期滿後經 Purge Preflight 與人工確認後永久刪除。

---

<a id="spec-12"></a>

## 12. 畢業與全年段封存

1. 九年級畢業日由管理員指定。
2. 管理員手動執行全年段畢業封存。
3. 系統不得自動封存。
4. 封存前執行 Preflight。
5. Preflight 檢查缺成績、AI 未完成、未發布評量、未完成 Import、Failed AI。
6. 有問題時警告，但可強制繼續。
7. 強制封存需輸入原因。
8. 畢業後公開查詢與資料保存期限為畢業日起 1 年。
9. 管理員可個別延長公開查詢期限。
10. 保存期滿後僅取得 Purge 候選資格，仍須完成 §14 的 Preflight、重新驗證與人工確認，不得自動永久刪除。

公開查詢期限與資料保存期限必須分別記錄，且公開查詢期限不得晚於資料保存期限。延長公開查詢時如何同步處理保存期限，依待決策 D-05 定案；不得回報已延長查詢卻在原保存期限刪除資料。

---

<a id="spec-13"></a>

## 13. 封存與復原

封存範圍：

```text
student
class
grade
```

必須保留 ArchiveBatch、ArchiveItems、原因、操作者、時間、Manifest。

封存後 30 天內提供快速 Undo；30 天後只要尚未 Purge，仍可依正式 Restore 流程恢復。

---

<a id="spec-14"></a>

## 14. Recycle Bin / Rollback / Purge

一般刪除採 Soft Delete，保留 30 天。

Import Job 保留 30 天 Rollback 能力。

Purge 是唯一不可復原操作，必須：

- Preflight。
- 顯示影響範圍。
- 二次確認。
- 高權限。
- 重新驗證。
- Audit Log。
- 永久刪除學生可識別資料及關聯資料。

Purge Preflight 必須列出 D1、物件儲存、匯入原檔、錯誤報表、匯出檔、AI 版本、快取及備份中的影響範圍。歷史排名、稽核與備份的去識別化／刪除方式，以及尚在復原承諾期間的操作優先序，依待決策 D-06 定案。未定案前不得宣稱 Purge 已涵蓋所有副本。

---

<a id="spec-15"></a>

## 15. 定期評量與科目

每學期固定 3 次。

每次：

### QUIZ

- 國文
- 英文
- 數學

### MIDTERM

- 國文
- 英文
- 數學
- 自然
- 地理
- 歷史
- 公民

某科可設定 `NOT_HELD`。

---

<a id="spec-16"></a>

## 16. 成績資料模型

建議採 Score Item 模型，而非固定十個欄位。

至少保存：

- student_id。
- exam_id。
- assessment_type。
- subject。
- score_value。
- score_status。
- include_in_average。
- include_in_ranking。
- score_origin。
- class_id_snapshot。
- created_at。
- updated_at。

---

<a id="spec-17"></a>

## 17. 分數與特殊狀態

正常分數：

```text
0.00 ~ 100.00
```

最多小數點後 2 位。

特殊文字代碼：

| 代碼 | 內部狀態 | 中文 |
|---|---|---|
| A | ABSENT | 缺考 |
| B | OFFICIAL_LEAVE | 公假 |
| C | SICK_LEAVE | 病假 |
| D | EXEMPT | 免試 |
| N | NOT_HELD | 本次該科不舉行 |

規則：

1. 特殊狀態沒有數值分數。
2. 特殊狀態預設不列入平均。
3. 禁止沒有分數卻列入平均。
4. 學生仍可依其他有效成績參與排名。
5. NOT_HELD 不等於學生缺考。
6. 系統不實作補考流程。

---

<a id="spec-18"></a>

## 18. Excel / CSV 匯入

Excel 原則為一科一張工作表。

欄位固定，至少包括：

- 定期評量分類。
- 學年度與學期（可由 Import Job 的目標評量提供；若檔案也有填寫，必須驗證一致）。
- 第 n 次。
- 班級。
- 姓名。
- 座號。
- 學號。
- 身分證字號。
- 科目。
- 分數／特殊代碼。

流程：

```text
Upload
→ Parse
→ Validate
→ Map
→ Preview
→ Confirm
→ Commit
```

禁止直接寫入正式資料。

每次匯入建立 Import Job，保存錯誤明細並支援 30 天 Rollback。

目標評量須精確識別至學年度、學期、第 n 次及評量分類，不得只依班級名稱或學生姓名寫入。各識別欄位不一致時回報錯誤，不得任意挑選一個欄位覆蓋其他欄位。檔案限制、Preview／Commit 一致性與 Rollback 衝突處理見 §73.4 及待決策 D-07。

---

<a id="spec-19"></a>

## 19. 成績狀態

```text
draft
partially_published
published
locked
historical
archived
```

檢測與段考可以分開發布。

成績不完整時仍可發布。

發布流程必須為：

```text
Preview → Confirm → Publish
```

發布狀態、鎖定狀態與學籍／年度封存狀態應分別定義其作用對象，不得用單一值隱含三者。Phase 7 須提交合法狀態轉換表，包含操作權限、前置條件、失敗行為與公開可見版本。公開端不得讀取草稿或尚未提交完成的計算結果；部分發布的組合與 `FINAL` 語意依待決策 D-08 定案。

---

<a id="spec-20"></a>

## 20. 成績修改

Draft 狀態可由有權限管理員修改。

已發布後仍可修改，但必須：

- 解除鎖定。
- 填寫修改原因。
- 保存修改前後。
- 寫入 ScoreChangeHistory。
- 重算平均與排名。
- 舊 AI 標記 stale。
- 自動建立 AI regeneration job。
- 修改完成後恢復鎖定。

修改採版本檢查，拒絕靜默覆蓋其他操作者的更新。成績、修改歷程、發布版本、平均與排名必須保持一致；AI 失敗不得回滾已成功且完整的成績變更。必要的 AI 重生請求必須可持久保存及重試，詳見 §73.3、§73.5。

---

<a id="spec-21"></a>

## 21. 平均計算

### 檢測平均

有效且列入平均之檢測分數總和 ÷ 有效檢測分數數量。

### 段考平均

有效且列入平均之段考分數總和 ÷ 有效段考分數數量。

### 定期評量平均

所有有效且列入平均的檢測 + 段考分數直接一起平均。

### 學期總平均

整學期所有有效且列入平均的分數一起平均。

平均顯示與排名計算到小數點後 2 位。

計算使用原始有效分數及其筆數，不得先將科目群平均四捨五入後再平均；也不得平均三次定評平均值來代替學期全部有效分數平均。有效分數為 0 分時仍須計入有效筆數；無有效分數時平均沒有數值，不得以 0 代替。精確小數運算及驗收示例見 §73.2；統計母體與無分數的排名比序依待決策 D-04 定案。

---

<a id="spec-22"></a>

## 22. 排名

同時計算：

- 班級排名。
- 全年段排名。

家長端只顯示該生自己的班級排名。

管理端可依權限查看班級與全年段完整排名。

排名優先序：

```text
1. 定期評量平均（四捨五入至小數第 2 位）
2. 定期評量總分
3. 國文總分
4. 英文總分
5. 數學總分
6. 完全相同 → 共同名次
```

共同名次採：

```text
1, 2, 2, 4
```

檢測先發布時產生 `PROVISIONAL` 暫時排名；段考發布後產生 `FINAL` 正式排名。

---

<a id="spec-23"></a>

## 23. 排名資格

排除排名可在三層控制：

- 學生永久預設。
- 學期。
- 單次定期評量。

歷史 ranking eligibility 必須保存 snapshot。

三層設定的繼承／覆寫優先序與快照固定時點，依待決策 D-03 定案。不得假定目前學生預設值可覆寫既有快照。

不列入排名者仍可查成績與 AI 建議，但不影響其他學生名次。

---

<a id="spec-24"></a>

## 24. 公開查詢

條件：

- 學年度。
- 學期。
- 班級。
- 第 n 次定期評量。
- 姓名。
- 出生年月日。

不使用額外查詢碼。

必須做：

- Rate limit。
- 嘗試次數限制。
- Generic error。
- Server-side lookup。
- 不提供名單。
- 不 autocomplete。
- 不把查詢資訊放 URL。
- 禁止搜尋引擎索引結果頁。

伺服器必須依指定評量的歷史班級快照查詢，不得使用學生目前班級替代。若條件命中多位學生，回傳與一般查詢失敗相同的訊息，不得自動選取、不列出候選人，也不得透露命中筆數。後續核驗流程見待決策 D-02。

姓名與生日是查詢條件，不是可證明監護關係的身分驗證。仍維持本版不建立家長帳號、不使用額外查詢碼的範圍；公開前須完成查詢威脅與殘餘風險審查。結果回應、快取與請求紀錄的最小化要求見 §73.7。

---

<a id="spec-25"></a>

## 25. 公開顯示內容

可顯示：

- 各科成績。
- 特殊狀態。
- 檢測平均。
- 段考平均。
- 定期評量平均。
- 學期總平均。
- 總分。
- 班級排名。
- 班級人數。
- 班平均。
- 全年段平均。
- 班級最高分。
- 全年段最高分。
- AI 家長版。
- AI 學生版。
- 趨勢圖。

不得顯示其他學生姓名或排名名單。

---

<a id="spec-26"></a>

## 26. 趨勢圖

範圍：

- 本學期 3 次。
- 整學年度 6 次。
- 國中三年最多 18 次。

模式：

- 檢測趨勢。
- 段考趨勢。
- 檢測 + 段考合併分析。

---

<a id="spec-27"></a>

## 27. AI 建議

首次產生由管理員手動啟動。

成績修改後自動重生。

每個 AI Advice Version 同時保存：

- parent_advice。
- student_advice。

家長版與學生版各至少 500 個中文字。

固定包含：

- 表現摘要。
- 學習診斷。
- 需要加強。
- 具體方法／讀書計畫。
- 鼓勵。

家長版另包含家長可協助方式。

---

<a id="spec-28"></a>

## 28. AI Context

包含：

- 本次各科。
- 檢測平均。
- 段考平均。
- 定評平均。
- 總分。
- 班級排名。
- 班平均。
- 全年段平均。
- 同一學期前一次定評。
- 個人前次各科與平均。
- 差異值。

第一次定評顯示無前次比較。

不得自動跨學期抓上學期最後一次。

送給 AI 的資料原則上不得包含姓名、生日、身分證、學號、Student ID。

---

<a id="spec-29"></a>

## 29. AI Provider

支援：

```text
openai
gemini
```

採 Adapter：

```text
AIProvider
├── OpenAIProvider
└── GeminiProvider
```

SystemSettings 只保存 provider、model、prompt、RAG 設定；API Key 只從 Secret 讀取。

---

<a id="spec-30"></a>

## 30. AI Jobs

不得一次在單一 HTTP request 處理全班／全年段。

狀態：

```text
pending
processing
completed
failed
```

需支援 Retry、版本歷史、usage tracking、duration、error code。

工作必須綁定來源成績版本，避免較舊工作覆蓋較新建議；需定義領取、逾時、重試、去重及取消／略過條件。Phase 0 先確認可用的背景執行與排程方式，Phase 12 完成實作及測試。不得將單一 HTTP request 延長執行視為可靠的工作佇列。

---

<a id="spec-31"></a>

## 31. RAG

參考資料全校共用，但可設定：

- 適用科目。
- 適用年級。
- 有效期間。
- 狀態。
- 標題。
- 說明。

例如數學參考資料只提供給數學 retrieval。

舊文件採封存。

流程：

```text
PDF / MD
→ Object Storage
→ Text Extraction
→ Chunk
→ D1
→ FTS
→ Retrieval
→ AI Context
```

第一版優先採 FTS，不強制向量資料庫。

上傳文件與擷取文字均視為不可信資料。不得執行文件內的指令或讓它更改系統權限、提供者設定及資料範圍；送入 AI 前仍須檢查個資。文件封存或有效期結束後，不得再用於新的 retrieval；舊建議保留版本與引用來源紀錄。詳見 §73.5。

---

<a id="spec-32"></a>

## 32. 管理員身分驗證總則

管理員唯一的外部身分認證方式為 Google OAuth 2.0 / OpenID Connect（OIDC）。OIDC 是 Google OAuth 登入的身分驗證契約，不是新增另一個服務認證。

所有可登入 `/admin` 的管理員帳號，必須同時符合：

1. Google 身分結果已由伺服器驗證。
2. Google 回傳的 Email 為已驗證狀態。
3. Email 符合 `AdminUsers.authorized_email` 授權紀錄。
4. 帳號狀態允許登入；首次綁定帳號須完成 §35.5 的啟用流程。
5. 已綁定帳號的 Google subject 必須一致，不得只憑相同 Email 靜默更換綁定。
6. 每個管理端操作仍須在 Server-side 檢查 Role、Permission 與 Scope。

登入條件：

```text
Google Verified (including email_verified)
AND Authorized Email
AND Allowed Admin Status
AND Google Binding Valid
```

首次 Bootstrap 是建立第一筆授權紀錄的受控例外，依 §35.1 執行。

不得要求 ChatGPT 或 Gemini 的登入、帳號可用資格、人工核驗或 API Key 作為管理員登入條件。管理端不得提供本地密碼登入備援。

---

<a id="spec-33"></a>

## 33. Google 驗證

Google 驗證為所有管理員的必要條件，不可跳過。

採標準 OAuth / OpenID Connect 流程。

至少取得並驗證：

```text
google_subject_id
google_email
google_email_verified
```

必要條件：

```text
google_email_verified = true
```

否則不得登入管理端。

不得只接受使用者手動輸入 Email。

Server 必須驗證 Google 所簽發之身分結果。

Google OAuth Client Secret 等敏感設定必須存放於 Secrets / Environment Values，不得寫入 D1、Git、README 或前端程式。

---

<a id="spec-34"></a>

## 34. Google 身分綁定與認證範圍

使用者於 2026-09-22 明確核准：管理員只需 Google OAuth 認證，取消 ChatGPT 與 Gemini 認證條件。本節取代舊版第二層服務認證，涵蓋登入、Bootstrap、Rebind、Recovery 與高風險重新驗證。

<a id="spec-34-1"></a>

### 34.1 Google 帳號綁定

Google OIDC 的 `sub` 對應本系統 `google_subject_id`。首次合法綁定時保存此識別值，後續登入驗證該值與已授權帳號一致；Email 用於授權名單比對，不取代已綁定的 subject。

```text
normalize(google_email)
=
normalize(AdminUsers.authorized_email)
```

伺服器驗證 `email_verified = true`；已綁定帳號另須符合：

```text
verified_google_sub = AdminUsers.google_subject_id
```

任一必要條件不符時拒絕登入，不得自動建立管理員或合併帳號。Email 正規化與 Google 帳號政策的實作細節依 D-09 確認。

<a id="spec-34-2"></a>

### 34.2 Google Identity Rebind

更換 authorized_email 或 Google subject 須走受控 Rebind：

1. 驗證操作人的權限與 Recent Authentication。
2. 新 Google 帳號完成 OAuth／OIDC，Email 已驗證且符合新授權紀錄。
3. 檢查綁定唯一性，避免同一身分誤綁多個管理員。
4. 更新授權與 Google 綁定，保存必要 Audit。
5. 撤銷舊 Sessions。

`admin` 保留帳號與最後一位 super_admin 的保護依 §35.3；Emergency Recovery 的核准程序仍依 D-01 定案。不得因 Rebind 或 Recovery 而新增其他外部服務認證。

<a id="spec-34-3"></a>

### 34.3 管理員認證與 AI 功能獨立

OpenAI API 與 Google Gemini API 僅作 AI 建議的提供者，依 §29 及 Phase 11／12 管理。管理員不必擁有 ChatGPT 或 Gemini 帳號。

管理員資料模型、登入流程與 Session 不保存或檢查 AI 身分提供者、AI 帳號識別碼、Gemini 人工核驗方法或 AI 身分驗證日期。切換 AI 提供者、缺少 AI API Key 或 AI 服務故障，不得阻止合法管理員登入或使其 Session 失效。

此調整保留 authorized_email 授權名單、Google 綁定、帳號狀態、Permission／Scope、Bootstrap Secret、Recent Authentication 與 Audit 要求。

---

<a id="spec-35"></a>

## 35. 管理員帳號授權清單

Google 驗證成功不等於自動成為管理員。除 §35.1 首次 Bootstrap 外，系統須先有一筆 AdminUsers 授權紀錄。

建議至少保存：

```text
id
username
display_name
authorized_email
google_subject_id
role
status
identity_bound_at
last_login_at
created_by
created_at
updated_at
```

所有管理員的已驗證 Google Email 必須符合 authorized_email；已綁定者的 Google subject 也必須一致。驗證成功不得自行新增帳號。

<a id="spec-35-1"></a>

### 35.1 首次部署與 admin

只有「從未完成 Bootstrap」且 AdminUsers 為 0 時，系統可進入 `BOOTSTRAP_REQUIRED`。首次帳號固定為 `username = admin`、`role = super_admin`；`admin` 只是內部代號，不是登入憑證。

```text
開啟 /admin
→ 驗證 ADMIN_BOOTSTRAP_SECRET
→ Google OAuth / OIDC
→ 伺服器驗證 Google 身分及 email_verified
→ 使用已驗證 Email 建立 authorized_email
→ 建立 username = admin、role = super_admin
→ 綁定 Google subject，啟用帳號
→ Bootstrap 永久關閉
```

此流程是先有授權紀錄要求的唯一初始化例外。不得建立本地密碼、預設密碼、Password Hash 或本地密碼備援。Google 驗證失敗、Secret 錯誤或已初始化時，不建立管理員。

<a id="spec-35-2"></a>

### 35.2 Bootstrap Secret

`ADMIN_BOOTSTRAP_SECRET` 是防止第一位管理員被搶先初始化的控制，並非第二個外部認證服務。首次初始化必須同時符合：

```text
Never Bootstrapped
AND AdminUsers = 0
AND Valid Bootstrap Secret
AND Google Verified
```

帳號建立、綁定與關閉 Bootstrap 須防止併發競爭，並持久保存一次性初始化狀態。之後即使沒有 active super_admin，也不得重新開放 Bootstrap；不能只憑 Secret 再建立初始管理員。

<a id="spec-35-3"></a>

### 35.3 admin 保留帳號

`admin` 不得 rename 或 delete，不使用本地密碼；可修改 display_name，或在受控程序下重新綁定 authorized_email／Google identity。

若另有 active super_admin，可停權 admin；若 admin 是最後一位 active super_admin，不得停權或降級。

更換 admin 身分須由另一位 active super_admin 執行，或走 D-01 核准的 Emergency Recovery。新帳號須通過 Google 驗證，操作人員須重新驗證，並留下 Audit、撤銷舊 Sessions。Recovery Secret 不能單獨作為登入憑證，也不能跳過 Google 認證。

<a id="spec-35-4"></a>

### 35.4 第二位 super_admin

首次 admin 建立後提示建立第二位 super_admin。由第一位 super_admin 建立 authorized_email、role 與必要 Scope，帳號先為 `pending_identity_binding`。

第二位管理員首次登入：

```text
Google OAuth / OIDC
→ Google Email verified
→ 符合已授權 Email
→ 綁定 Google subject
→ 啟用管理員帳號
```

<a id="spec-35-5"></a>

### 35.5 新增一般管理員

super_admin 建立授權紀錄，指定 authorized_email、display_name、role、Scope，狀態為 `pending_identity_binding`。不建立本地密碼。

首次登入時，伺服器驗證 Google 身分、email_verified、授權 Email 與綁定唯一性。成功後保存 google_subject_id、identity_bound_at，並將狀態改為 active。

pending_identity_binding 只允許合法的首次綁定流程，完成前不授予一般管理端 Session 或資料操作權限。disabled、locked、identity_rebind_required 不得藉首次綁定流程自行啟用。

<a id="spec-35-6"></a>

### 35.6 管理員帳號狀態

| 狀態 | 意義 |
|---|---|
| pending_identity_binding | 已授權 Email，尚未完成 Google 綁定 |
| active | 可依授權範圍正常登入及操作 |
| disabled | super_admin 手動停權 |
| locked | 因安全事件暫時鎖定 |
| identity_rebind_required | Google 身分須經受控程序重新綁定 |

離職或不再使用者手動停權；已有操作歷史的 AdminUser 不得真正 DELETE。

<a id="spec-35-7"></a>

### 35.7 管理員 Session

完成 Google 驗證、授權清單、帳號狀態及綁定檢查後，才可建立應用程式自己的 Admin Session。

- 使用安全隨機 token；D1 只保存 token hash。
- Cookie 使用 HttpOnly、Secure 及適當 SameSite。
- Idle timeout 建議 30 分鐘；Absolute timeout 建議 8 小時。

以下事件撤銷相關 Sessions：管理員停權、Role 改變、Scope 改變、Email／Google identity 重新綁定、super_admin 強制登出或重大安全事件。任何權限縮限須立即生效，不得等待舊 Session 自然到期。

<a id="spec-35-8"></a>

### 35.8 高風險操作重新驗證

建立／修改／停權 super_admin、重新綁定 Google 身分、全年段封存、Purge，以及修改安全／OAuth 設定，須 Recent Authentication。

重新驗證只使用 Google re-authentication，並檢查其結果與目前操作人身分一致；有效窗口依 D-11 定案。不得退回本地密碼，亦不新增其他外部服務認證。Rebind 的新帳號驗證與操作人的重新驗證須分開檢查。

<a id="spec-35-9"></a>

### 35.9 管理員身分資料最小化

只保存必要的 authorized_email、google_subject_id、綁定日期及登入／稽核資料。display_name 可在本系統維護，不作為授權依據。

不得要求或保存 Google 密碼、外部 Session Cookie 或不必要的服務內容。外部 token 僅在官方驗證流程必要的短期處理中使用，不長期保存或寫入一般 log。

登入只請求所需的 Google 身分／Email 權限，不藉登入擴張為存取 Drive、信件或 AI 對話的授權。

<a id="spec-35-10"></a>

### 35.10 角色與權限

預設角色：

```text
super_admin
system_admin
academic_admin
score_admin
ai_admin
archive_admin
viewer
```

授權使用 Permission＋Scope，不能只靠 Role 判斷；詳細矩陣依 D-10 確認。

---

<a id="spec-36"></a>

## 36. Scope

至少支援：

- 全校。
- 年級。
- 班級。
- 科目。
- 導師班。
- 任教班級。

導師：

- 只看自己班。
- 可修改自己班全部科目。

任課教師：

- 只看自己任教班級。
- 只能修改自己任教科目。

建議以 AdminAssignments 保存任教範圍。

---

<a id="spec-37"></a>

## 37. 管理員帳號管理

一般管理員由 super_admin 手動建立 authorized_email、display_name、role 及 Scope 授權紀錄，不建立本地密碼。

每位管理員首次登入只需 Google OAuth / OIDC 認證，加上本系統的授權、狀態與 Google 綁定檢查：

```text
Verified Google Email = authorized_email
AND Google Binding Valid
AND Allowed Admin Status
```

首次 Bootstrap 依 §35.1；一般帳號綁定依 §35.5。人員離職後由 super_admin 手動停權，不設定自動失效日。最後一位 active super_admin 不可被停權或降級。

---

<a id="spec-38"></a>

## 38. Audit Log

一般 Audit Log 保存 2 個月。

只有指定高權限管理者可查看。

至少記錄：

- Login。
- 管理員異動。
- Import / Rollback。
- Score Update。
- Publish / Unlock。
- AI Generate / Retry。
- Archive / Restore / Purge。
- Reference Upload / Archive。
- Settings Update。

不得記錄 Secret、密碼、Session Token、身分證明文。

---

<a id="spec-39"></a>

## 39. ScoreChangeHistory

獨立於 Audit Log。

保存期限跟隨學生資料。

至少保存：

- before / after。
- status before / after。
- reason。
- actor。
- timestamp。

---

<a id="spec-40"></a>

## 40. 報表與匯出

必須支援：

- 班級成績總表。
- 全年段成績總表。
- 個人成績單。
- 班級排名表。
- 全年段排名表。
- AI 建議總表。

格式：

- Excel。
- CSV。
- PDF。
- 列印版。

---

<a id="spec-41"></a>

## 41. 建議核心資料表

正式 schema 於 Phase 1 定稿，預期至少：

```text
AcademicYears
AcademicTerms
Classes

Students
StudentEnrollments

Exams
ExamSubjectSettings
ExamParticipations
ScoreItems
ScoreChangeHistory

SystemSettings

AIAdvices
AIJobs

AIReferenceMaterials
AIReferenceChunks
AIReferenceChunksFTS

ImportJobs
ImportJobItems

ArchiveBatches
ArchiveItems

AdminUsers
AdminSessions
AdminAssignments

AuditLogs
```

---

<a id="spec-41-1"></a>

### 41.1 GitHub Repository 管理

本專案必須使用 GitHub 進行原始碼、版本與 Release 管理。

固定 Repository 名稱：

```text
classroom-aigrade-tzk
```

Repository URL 實際形式：

```text
https://github.com/<GITHUB_OWNER>/classroom-aigrade-tzk
```

`<GITHUB_OWNER>` 由 Phase 0 連結實際 GitHub 帳號後取得，不得自行猜測。

GitHub Repository 必須保存：

- 完整原始碼。
- `PROJECT_SPEC.md`。
- `AGENTS.md`。
- `README.md`。
- `LICENSE`。
- Migration。
- Tests。
- GitHub Actions workflow。
- GitHub Pages 所需靜態內容或建置來源。

GitHub Repository 絕對不得保存：

- 真實學生資料。
- 身分證字號。
- 出生年月日資料集。
- Production D1 dump。
- API Key。
- OAuth Client Secret。
- Session Token。
- Bootstrap Secret。
- Encryption Key。
- 任何 `.env` 真實內容。

---

<a id="spec-41-2"></a>

### 41.2 GitHub Repository 可見性

Phase 0 必須確認 GitHub 帳號方案與 Repository 可見性。

若採 GitHub Free 且要直接使用 GitHub Pages，預設建議：

```text
public repository
```

因本專案採 MIT License，可公開原始碼。

若使用者選擇 private repository，Codex 必須先確認該 GitHub 方案是否支援 private repository 的 GitHub Pages，再建立 Pages。

無論 Repository 公開或私人，都不得把學生個資與 Secrets 提交至 Git。

---

<a id="spec-41-3"></a>

### 41.3 MIT License

Repository 必須建立：

```text
LICENSE
```

授權條款：

```text
MIT License
```

LICENSE 應使用標準 MIT License 全文。

Copyright year：

```text
以 Repository 首次建立年份為準
```

Copyright holder：

```text
由使用者於 Phase 0 確認；未確認前不得自行臆測真實姓名或法人名稱。
```

README 必須明確標示：

```text
License: MIT
```

---

<a id="spec-41-4"></a>

### 41.4 GitHub Pages 定位

GitHub Pages 是本專案的：

- 專案首頁。
- 開源說明頁。
- 版本資訊頁。
- 部署狀態入口。
- 使用與開發文件入口。

GitHub Pages **不是正式成績系統執行環境**。

不得使用 GitHub Pages 承載：

- D1 Database API。
- 管理員登入。
- Google OAuth / OIDC 管理員認證。
- 學生成績查詢 API。
- AI API Key。
- Server-side AI 呼叫。
- 個資。
- 任何需要 Server-side Secret 的功能。

正式系統執行網址仍為：

```text
ChatGPT Sites URL
```

GitHub Pages 僅提供安全的靜態內容與連結。

---

<a id="spec-41-5"></a>

### 41.5 GitHub Pages URL

Repository Project Pages 預期網址格式：

```text
https://<GITHUB_OWNER>.github.io/classroom-aigrade-tzk/
```

實際 Pages URL 必須在 GitHub Pages 部署成功後由 GitHub 回傳／確認。

不得在完成部署前將預期格式當成已驗證正式網址。

---

<a id="spec-41-6"></a>

### 41.6 GitHub Pages 部署方式

優先使用 GitHub Actions 自動部署 Pages。

建議 workflow：

```text
.github/workflows/pages.yml
```

流程：

```text
Push / Release
→ Checkout
→ Build static Pages content
→ Configure Pages
→ Upload Pages artifact
→ Deploy Pages
```

GitHub Pages workflow 至少必須具備必要的：

```text
contents: read
pages: write
id-token: write
```

實際 action version 應於 Phase 0 / 實作當時依 GitHub 官方最新支援版本選用，不得把本規格中的示例版本視為永久固定。

---

<a id="spec-41-7"></a>

### 41.7 GitHub Pages 內容

Pages 至少顯示：

1. 專案名稱。
2. 專案簡介。
3. 最新 Release / Deployment 版本。
4. 最新部署日期。
5. ChatGPT Sites 正式網址。
6. GitHub Repository 網址。
7. 主要功能摘要。
8. 技術架構摘要。
9. License。
10. 最新 Changelog 摘要。
11. 文件入口。
12. 安全與隱私提示。

不得在 Pages 顯示：

- 管理員 Email 清單。
- 真實學生資料。
- OAuth Identity ID。
- Secret。
- D1 內容。
- 內部安全設定。

---

<a id="spec-41-8"></a>

### 41.8 README.md 規格

Repository 根目錄必須具有：

```text
README.md
```

README 至少包含：

```text
# classroom-aigrade-tzk

## 專案簡介
## 主要功能
## 技術架構
## 開發環境
## Phase 狀態
## 最新部署資訊
## ChatGPT Sites
## GitHub Pages
## Repository
## 安全與個資注意事項
## 開發方式
## License
```

README 中必須維護部署資訊區塊，例如：

```text
Latest Production Release: vX.Y.Z
Deployment Date: YYYY-MM-DD
ChatGPT Sites: <URL>
GitHub Pages: <URL>
Repository: <URL>
```

不得在 README 寫入 Secrets 或真實學生資料。

---

<a id="spec-41-9"></a>

### 41.9 每次正式部署後的 GitHub 同步

「每次部署後更新 README 與 GitHub Pages」中的「部署」定義為：

```text
ChatGPT Sites 正式 Production Deployment / Release
```

不是 GitHub Pages 自己的部署，避免產生遞迴更新。

每次 ChatGPT Sites Production Deployment 成功後，必須依序：

```text
1. 取得 / 確認 ChatGPT Sites Production URL
2. 記錄 Release version / deployment date
3. 更新 README.md
4. 更新 GitHub Pages 顯示之版本與 Sites URL
5. 更新 CHANGELOG.md（若已建立）
6. Commit
7. Push GitHub
8. 觸發 GitHub Pages workflow
9. 等待 Pages deploy 成功
10. 驗證 Repository / Pages / Sites 三個網址
11. 回報三個網址
```

若 README 或 Pages 更新失敗：

- ChatGPT Sites deployment 本身不得假稱失敗。
- Release 狀態必須標記為 `DEPLOYED_WITH_DOC_SYNC_ERROR` 或等效狀態。
- Codex 必須回報失敗步驟與可重試方式。
- 修復後重新完成 GitHub 同步。

---

<a id="spec-41-10"></a>

### 41.10 部署後必須回報三個網址

每次正式 Production Deployment 完成後，Codex 最終回報必須包含：

```text
GitHub Repository:
https://github.com/<GITHUB_OWNER>/classroom-aigrade-tzk

GitHub Pages:
https://<GITHUB_OWNER>.github.io/classroom-aigrade-tzk/

ChatGPT Sites:
<實際 Production Site URL>
```

只可回報已實際建立、可驗證之網址。

若其中任一尚未成功建立，必須明確標記：

```text
Not available / Deployment failed / Pending
```

不得虛構 URL。

---

<a id="spec-41-11"></a>

### 41.11 Git Branch 與 Release 建議

預設主分支：

```text
main
```

建議：

- Phase 開發可使用 feature branch。
- 通過測試後合併至 `main`。
- 正式 Production Deployment 對應 Git tag / GitHub Release。

Release tag 建議：

```text
v0.1.0
v0.2.0
...
v1.0.0
```

版本策略建議採 Semantic Versioning。

正式規則可於 Phase 0 建立 Repository 時確認。

---

<a id="spec-41-12"></a>

### 41.12 Git Commit 原則

每一個完成並確認的 Phase 至少應產生可辨識的 Git commit。

Commit 不得包含：

- 真實個資。
- Secrets。
- 暫存資料庫。
- Production export。

建議 commit message：

```text
phase-05: implement ranking engine
fix: correct provisional ranking calculation
docs: update deployment URLs
release: v0.5.0
```

---

<a id="spec-41-13"></a>

### 41.13 GitHub Pages 安全規則

GitHub Pages 為公開靜態入口時：

1. 不得收集學生查詢資料。
2. 不得在 Pages 建立家長成績查詢表單。
3. 不得將姓名、生日、身分證等資料送至 GitHub Pages。
4. Pages 僅可連結至正式 ChatGPT Sites。
5. 若要顯示 Demo，只能使用完全虛構資料。
6. 不得把 Production API endpoint 或內部管理 endpoint 暴露為教學範例。
7. 不得把敏感環境資訊編譯進 Pages artifact。

---

<a id="spec-42"></a>

## 42. 安全性

至少處理：

- SQL Injection。
- XSS。
- CSRF。
- Session fixation。
- Brute force。
- Rate limiting。
- Broken access control。
- IDOR。
- Secret exposure。
- PII exposure。
- Log leakage。
- Upload validation。
- CSV / Excel Formula Injection。
- Path traversal。
- Oversized upload。

---

<a id="spec-43"></a>

## 43. 測試層級

至少：

- Unit。
- Integration。
- Database。
- Migration。
- Ranking。
- Import。
- Archive。
- Purge。
- Auth。
- Authorization。
- Scope。
- AI Provider Mock。
- RAG。
- Public Lookup Security。
- UI Smoke。

---

<a id="spec-44"></a>

## 44. 排名必測案例

至少：

1. 平均不同。
2. 平均相同、總分不同。
3. 平均與總分相同、國文不同。
4. 再同分、英文不同。
5. 再同分、數學不同。
6. 全部相同共同名次。
7. exclude ranking。
8. 特殊狀態。
9. NOT_HELD。
10. 暫時排名。
11. 正式排名。
12. 轉班後歷史排名不變。
13. 轉出後歷史排名不變。
14. 畢業後歷史排名不變。
15. 原校成績不參與本校排名。
16. 班級與全年段公式一致。
17. 小數第二位 rounding 邊界。

---

<a id="spec-45"></a>

## 45. Codex 作業規則

每次開始 Phase 前：

1. 讀取本文件，再讀取 AGENTS.md；同一任務中已完整讀取且確認未變更者可沿用，需求更新時必須重讀受影響內容。
2. 確認使用者指定的 Phase；不得把文件維護當作開始 Phase 0。
3. 執行 Model/Effort Check，依實際證據記錄設定。
4. 檢查 repository 現況及使用者未提交變更。
5. 檢查相關 migration、tests 與模組；不存在時明確回報，不虛構結果。
6. 確認本次範圍、依賴與 §72 待決策事項，不修改無關模組。
7. 發現規格內部、規格與平台或現有程式衝突時，先回報受影響項目再實作。

每個 Phase 完成時必須回報：

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

最後停止並詢問：

```text
是否確認 Phase <目前 Phase> 無誤，準備進入 Phase <依 §74 順序的下一 Phase>？
```

---


<a id="spec-model-effort"></a>

## Codex 模型能力與 Token 最佳化原則

本專案採「足夠可靠的最低推理強度」原則，以降低不必要 token 消耗；但不得為節省 token 犧牲安全性、資料正確性、權限邊界、migration 可逆性、排名正確性或 Production 部署檢查。

### 能力層級

使用抽象層級：

```text
LOW
MEDIUM
HIGH
XHIGH
```

若 Codex 當時另提供 `MAX`、`ULTRA` 或更高層級，只有在當前任務確實需要、且高強度仍不足時才使用。

### Phase 開始前的自動調整規則

每個 Phase 開始前必須執行：

```text
1. 讀取該 Phase 的 Recommended Effort 與 Minimum Effort。
2. 檢查目前模型與推理強度。
3. 若有可用切換工具：
      依建議層級調整，確認回傳成功後才記錄 AUTO_SWITCHED。
4. 若無法自行調整：
      已驗證的目前設定符合 Minimum 且適用時可 KEEP；
      否則在實作前提示使用者手動調整或確認，記錄 MANUAL_CHANGE_REQUIRED。
5. 若目前高於建議層級：
      低風險 Phase 可降級以節省 token；
      高風險 Phase 不得低於 Minimum Effort。
6. 完成 Phase 後，不得自行假設下一 Phase 仍使用相同層級。
```

桌面介面的模型／推理選擇器與互動 CLI 的 `/model` 可供使用者調整。只有目前環境提供代理可呼叫且能確認結果的工具時，才可宣稱代理自動切換；詳見 §73.8。

### 固定提示格式

每個 Phase 開始時，Codex 先輸出：

```text
Model/Effort Check:
Recommended=<LEVEL_OR_N/A>;
Minimum=<LEVEL_OR_N/A>;
Current=<CURRENT_OR_UNKNOWN>;
Action=<AUTO_SWITCHED | KEEP | MANUAL_CHANGE_REQUIRED>;
Reason=<簡短原因>
```

若 `Action=MANUAL_CHANGE_REQUIRED`，先說明原因並取得設定確認，再進入受影響的實作。Current 未知時記 UNKNOWN，不得猜測或假稱已切換；尤其不得在無法確認 Minimum 的情況下開始高風險實作。

使用者已確認設定後，後續檢查可依該證據記錄 KEEP，直到設定改變或新 Phase 需要更高強度。純文件維護及唯讀審查未啟動開發 Phase 時，Recommended／Minimum 可記 N/A，保留實際 Current 或 UNKNOWN，Action=KEEP；這不豁免後續正式 Phase 的檢查。

### Token 可節省項目

可節省：

- 與當前 Phase 無關的大型檔案重複讀取。
- 不必要的 repository 全量掃描。
- 已存在且未變動文件的重複生成。
- 與本次變更無關的完整測試套件。
- 冗長重複摘要。
- 不必要的多代理／Ultra 模式。
- 已通過且未受影響模組的重複深度分析。

### Token 不可節省項目

不得省略：

- Authentication / Authorization 邊界檢查。
- Scope / IDOR 檢查。
- Migration preflight / rollback 檢查。
- Ranking 與平均公式測試。
- Import validation。
- 個資與 Secret 洩漏檢查。
- Archive / Restore / Purge 邊界。
- 永久刪除前確認。
- Production 部署前後 Smoke Test。
- GitHub / Pages / Sites 三個網址驗證。
- 規格衝突檢查。
- 任何不可逆資料操作的驗證。

### 自動升級條件

即使 Phase 原建議較低，遇到下列情況至少升一級：

- schema / migration 衝突。
- 權限邏輯不一致。
- ranking 邊界案例失敗。
- 資料保存／Purge 規則矛盾。
- 跨模組回歸。
- 測試結果與規格不一致。
- 未知平台限制。
- 即將執行不可逆操作。

若 HIGH 仍不足，升至 XHIGH。

### 自動降級條件

僅在以下全部成立時可降級：

- 屬文件、樣板、靜態 UI 或局部低風險變更。
- 不涉及 DB schema。
- 不涉及 Authorization。
- 不涉及排名。
- 不涉及個資。
- 不涉及永久刪除。
- 不涉及 Production。
- 相關測試已存在且可快速驗證。

---

<a id="spec-46"></a>

## 46. Phase 0 — 環境與 Sites 能力確認

2026-09-23 使用者已核准執行 Phase 0，並確認 GitHub Owner 為 `kisaraki`、repository 採 Public、MIT 版權標示為 `Copyright (c) 2026 kisaraki`，目前推理強度為 MEDIUM 或以上。使用者隨後澄清目前沒有 Google OAuth Client，指示先跳過；本次免執行 Google OAuth 設定與登入實測，D-09 保留，Phase 3A 前須補足驗證，不得標示已通過。

Phase 0 的 Sites 原始碼位於 `site/`，GitHub Pages 原始碼位於 `pages/`；本機能力測試與雲端正式驗證分開記錄於 [Phase 0 驗證紀錄](docs/PHASE_0.md)。此紀錄只保存證據，不另行定義業務規格。D-09 尚須取得 Google callback／Cookie 的平台實測證據；不得因此啟動 Phase 3A 或部署 Sites Production。

### Codex 能力提示

- Recommended Effort：`MEDIUM`
- Minimum Effort：`MEDIUM`
- 原因：平台能力、Sites、D1、GitHub、OAuth 與外部驗證能力確認需要中等推理。
- 可自動調整時：自動切換至 `MEDIUM`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- 建立／確認 GitHub repository：`classroom-aigrade-tzk`。
- 確認 GitHub Owner。
- 確認 Repository visibility。
- 建立 MIT `LICENSE`。
- 建立初始 `README.md`。
- 啟用 GitHub Pages。
- 建立 GitHub Pages GitHub Actions workflow。
- 驗證 Pages URL。
- 建立 Sites project。
- 驗證目前 Sites runtime。
- 確認 D1。
- 確認 Object Storage。
- 確認 Secret。
- 驗證 Google OAuth / OIDC 能力。
- 驗證 Google-only 管理員登入、callback、Cookie 與 Sites 存取設定相容性；不得以平台門檻額外要求管理員登入其他外部服務。
- 確認 `.openai/hosting.json` 或當時等效設定。
- `.env.example`。
- lint / format / test。
- Hello World preview。
- D1 smoke test。
- Storage smoke test。

不得建立正式 schema 或部署 production。

---

<a id="spec-47"></a>

## 47. Phase 1 — Domain Model 與 Database Migration

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：ER Model、FK、constraints、migration 與個資欄位設計是高風險基礎架構。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- ER Model。
- 初始 migration。
- indexes。
- FKs。
- constraints。
- FTS。
- 虛構 seed data。
- migration tests。

涵蓋全部核心資料表。

不得做完整 UI 或呼叫真實 AI。

---

<a id="spec-48"></a>

## 48. Phase 2 — Academic / Class / Enrollment Core

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：學籍生命週期、升班、轉班、轉入轉出會影響歷史資料。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- 學年度。
- 自動兩學期。
- 班級。
- 新生單筆。
- 新生批次基礎。
- Enrollment。
- 座號。
- 批次升班。
- 升班 Preview。
- 手動調班。
- 轉班。
- 轉入。
- 轉出。
- 撤銷。

---

<a id="spec-49"></a>

## 49. Phase 3A — Admin Bootstrap & Google OAuth Authentication

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：Bootstrap、Google OAuth／OIDC、授權綁定與 Session 仍屬安全核心。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。

工作：

- AdminUsers／AdminSessions／AuthService。
- Bootstrap Secret、一次性 Bootstrap 與 `admin` 保留帳號。
- Google OAuth／OIDC 及伺服器身分驗證。
- Google Email Verified 與 authorized_email allowlist。
- Google subject 綁定、帳號狀態與 identity mismatch 處理。
- Login／Logout、Session timeout／revoke。
- 登入與 AI 提供者／API Key 獨立的驗收案例。

Google OAuth 在 Sites 的實作方式、callback、Cookie、Secret 與平台存取設定原列於 Phase 0 驗證；使用者於 2026-09-23 指示暫緩 OAuth 設定與實測，因此須在 Phase 3A 實作前先補齊，確保管理員僅需 Google 認證即可到達管理端。若平台無法符合，回報限制，不自行恢復已取消的認證條件。

一般首次 Bootstrap 不依賴人工核驗。Emergency Recovery 與受控 Rebind 依 D-01、Phase 3B 的授權模組銜接。

不得建立 PasswordService、本地密碼、Password Reset 或本地登入備援。不得加入 ChatGPT／Gemini 認證分支或人工資格核驗。

---

<a id="spec-50"></a>

## 50. Phase 3B — Authorization / Roles / Scopes

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`HIGH`
- 原因：RBAC + Scope、導師與任課教師資料邊界、IDOR 防護是核心授權邏輯。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Permission。
- Role mapping。
- Scope middleware。
- AdminAssignments。
- 導師 Scope。
- 任課教師 Scope。
- 管理員新增／停權／啟用。
- Identity Rebind。
- D-01 Emergency Recovery 核准流程與 Google 身分重新綁定。
- Role / Scope Change。
- Revoke Sessions。
- Last super_admin protection。

---

<a id="spec-51"></a>

## 51. Phase 4 — Exam / Score / Special Status

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：成績狀態、特殊代碼、NOT_HELD、class snapshot 直接影響資料正確性。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Exam。
- ExamSubjectSettings。
- NOT_HELD。
- ScoreItems。
- A/B/C/D/N。
- 0～100.00。
- Validation。
- Draft。
- Score origin。
- Class snapshot。

---

<a id="spec-52"></a>

## 52. Phase 5 — Average / Ranking Engine

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`HIGH`
- 原因：平均、班級／全年段排名與同分比序是核心演算法。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Quiz average。
- Midterm average。
- Exam average。
- Semester average。
- Total。
- Tie-break。
- Class rank。
- Grade rank。
- Provisional / Final。
- Exclude ranking。
- Competition ranking。

先寫測試，再實作。

---

<a id="spec-53"></a>

## 53. Phase 6 — Import Engine

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：Excel/CSV 匯入、學生識別、Preview/Commit/Rollback 涉及批次資料寫入。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Excel 範本。
- XLSX parser。
- CSV parser。
- 一科一 Sheet。
- Identity matching。
- Validation。
- Preview。
- Error report。
- Commit。
- Import Job。
- 30 天 Rollback。

---

<a id="spec-54"></a>

## 54. Phase 7 — Publish / Lock / Score History

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：發布、鎖定、歷史修改與 AI regeneration 涉及正式資料一致性。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- 檢測分開發布。
- 段考分開發布。
- Preview / Confirm。
- Lock / Unlock。
- 修改原因。
- ScoreChangeHistory。
- Ranking recalc。
- AI stale / regeneration trigger。

---

<a id="spec-55"></a>

## 55. Phase 8 — Archive / Graduation / Retention

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`HIGH`
- 原因：封存、畢業、轉出保存期限與 Restore 涉及完整資料生命週期。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Individual Archive。
- Class Archive。
- Grade Archive。
- Graduation。
- 轉出 3 年。
- 畢業 1 年。
- Preflight。
- Force Archive。
- ArchiveBatch / Items。
- 30-day Undo。
- Restore。
- Public access deadline。
- Per-student extension。

---

<a id="spec-56"></a>

## 56. Phase 9 — Recycle Bin / Rollback / Purge

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`XHIGH`
- 原因：Recycle Bin、Rollback 與 Purge 含永久刪除，屬最高風險。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Soft delete。
- Recycle Bin 30 days。
- Restore。
- Import rollback。
- Purge eligibility。
- Purge preview。
- Permanent delete。
- No-undo guard。
- Audit。

---

<a id="spec-57"></a>

## 57. Phase 10 — RAG Reference Materials

### Codex 能力提示

- Recommended Effort：`MEDIUM`
- Minimum Effort：`MEDIUM`
- 原因：文件解析、chunking 與 FTS 是可測試資料處理流程。
- 可自動調整時：自動切換至 `MEDIUM`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- PDF / MD Upload。
- Object Storage。
- Text extraction。
- Chunking。
- Metadata。
- Validity period。
- Archive old reference。
- FTS。
- Retrieval API。

---

<a id="spec-58"></a>

## 58. Phase 11 — AI Provider Layer

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：OpenAI/Gemini Adapter、Secrets、timeout 與錯誤邊界需要可靠整合。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Provider interface。
- OpenAI adapter。
- Gemini adapter。
- Secret read。
- Timeout。
- Retry。
- Error normalization。
- Mock tests。
- Provider switch。

---

<a id="spec-59"></a>

## 59. Phase 12 — AI Advice / Jobs

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：AI Context、去識別化、RAG、版本與重生涉及跨模組一致性。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Context assembly。
- 同學期前次比較。
- 班平均。
- 全年段平均。
- Ranking context。
- RAG。
- 家長版 ≥ 500 字。
- 學生版 ≥ 500 字。
- AIJobs。
- Retry。
- Version history。
- stale。
- regeneration。
- usage tracking。

---

<a id="spec-60"></a>

## 60. Phase 13 — Public UI

### Codex 能力提示

- Recommended Effort：`MEDIUM`
- Minimum Effort：`MEDIUM`
- 原因：Public UI 主要為呈現，但仍需 rate limit、隱私與查詢安全。
- 可自動調整時：自動切換至 `MEDIUM`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Lookup。
- Rate limit。
- Generic errors。
- Result。
- Scores。
- Special status。
- Average / Total。
- Class rank。
- Statistics。
- Parent / Student AI。
- Charts。
- Mobile。
- Accessibility。

---

<a id="spec-61"></a>

## 61. Phase 14 — Admin UI

### Codex 能力提示

- Recommended Effort：`MEDIUM`
- Minimum Effort：`MEDIUM`
- 原因：Admin UI 主要整合既有 API，但不可省略 Permission/Scope 驗證。
- 可自動調整時：自動切換至 `MEDIUM`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


頁面：

- Dashboard。
- Academic Years。
- Classes。
- Students。
- Enrollments。
- Exams。
- Scores。
- Imports。
- Rankings。
- AI。
- References。
- Archive。
- Reports。
- Audit。
- Users。
- Settings。
- Profile。

---

<a id="spec-62"></a>

## 62. Phase 15 — Reporting / Export

### Codex 能力提示

- Recommended Effort：`MEDIUM`
- Minimum Effort：`MEDIUM`
- 原因：報表與匯出主要為格式組裝，但需 Scope 與公式注入防護。
- 可自動調整時：自動切換至 `MEDIUM`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- 班級總表。
- 全年段總表。
- 個人成績單。
- 排名表。
- AI 總表。
- Excel。
- CSV。
- PDF。
- Print CSS。
- Formula Injection 防護。

---

<a id="spec-63"></a>

## 63. Phase 16 — Security / Privacy Hardening

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`XHIGH`
- 原因：Security / Privacy Hardening 需要完整跨模組威脅與邊界審查。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


工作：

- Auth review。
- Authorization review。
- Scope review。
- IDOR。
- SQL Injection。
- XSS。
- CSRF。
- Rate limit。
- Secret scan。
- PII review。
- Log review。
- Upload review。
- Dependency review。
- Security tests。

---

<a id="spec-64"></a>

## 64. Phase 17 — Full Lifecycle Integration Test

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`HIGH`
- 原因：完整生命週期整合測試涵蓋多模組與歷史不變量。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


測試完整情境：

```text
建立學年度
→ 建班
→ 新生
→ 第一次評量
→ 匯入檢測
→ 暫時排名
→ 匯入段考
→ 正式排名
→ AI
→ 家長查詢
→ 修改成績
→ AI 重生
→ 第二次評量
→ 轉班
→ 升班
→ 九年級
→ 畢業
→ 全年段封存
→ 保存期
→ Purge
```

另測：

- 轉入。
- 轉出。
- Import rollback。
- Archive undo。
- 歷史年度解鎖。

---

<a id="spec-65"></a>

## 65. Phase 18 — Release Candidate

### Codex 能力提示

- Recommended Effort：`HIGH`
- Minimum Effort：`HIGH`
- 原因：Release Candidate 需統整測試、migration、Secrets、GitHub、Pages 與 Sites。
- 可自動調整時：自動切換至 `HIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


Codex：

- 執行全部 tests。
- production build。
- migration review。
- Secret names review。
- Site config review。
- Release Notes。
- Migration Summary。
- Known Issues。
- Test Summary。
- 準備 README.md 最新部署區塊。
- 準備 GitHub Pages Release 內容。
- 檢查 GitHub Repository 與 Pages workflow 狀態。

只建立 Release Candidate / Save Version。

不得正式 Deploy。

---

<a id="spec-66"></a>

## 66. Phase 19 — Production Deployment

### Codex 能力提示

- Recommended Effort：`XHIGH`
- Minimum Effort：`XHIGH`
- 原因：Production migration、部署、GitHub 同步與三網址驗證屬高影響不可逆階段。
- 可自動調整時：自動切換至 `XHIGH`。
- 無法自動調整時：依全域規則核對目前設定；需要調整或無法確認最低強度時，提示使用者手動確認。
- 若發現規格衝突、測試失敗或跨模組風險，依全域規則升級。
- 不得為節省 token 省略本 Phase 必要的安全、邊界、資料完整性與測試。


只有使用者明確表示：

```text
確認正式部署
```

才可執行。

正式部署流程：

```text
確認 production DB
→ Migration Preflight
→ 套用 Migration
→ Secret Check
→ ChatGPT Sites Deploy
→ Sites Smoke Test
→ 取得 Production Sites URL
→ 更新 README.md
→ 更新 GitHub Pages 內容
→ 更新 CHANGELOG / Release 資訊
→ Commit / Push GitHub
→ GitHub Pages Deploy
→ Pages Smoke Test
→ 驗證三個正式網址
```

ChatGPT Sites Smoke Test：

- Public page。
- Admin login。
- D1 read/write。
- Storage。
- Lookup。
- Ranking。
- Import。
- AI。
- Archive。
- Report export。

GitHub / Pages Smoke Test：

- Repository 可存取。
- README 最新版本與部署日期正確。
- README Sites URL 正確。
- Pages 可開啟。
- Pages 最新版本資訊正確。
- Pages Sites URL 正確。
- LICENSE 為 MIT。
- 不含 Secret / PII。

每次 Phase 19 完成後必須回報：

```text
Release / Version:
<version>

GitHub Repository:
<verified repository URL>

GitHub Pages:
<verified Pages URL>

ChatGPT Sites:
<verified production URL>
```

若 GitHub 文件同步或 Pages 部署失敗，必須回報：

```text
DEPLOYED_WITH_DOC_SYNC_ERROR
```

並說明已成功與失敗的項目，不得虛構網址。

---

<a id="spec-67"></a>

## 67. Acceptance Invariants

1. 不得因升班改變歷史班級。
2. 不得因轉班改變已完成定評所屬班級。
3. 不得因轉出改變歷史排名。
4. 不得因畢業改變歷史排名。
5. 封存不得等於刪除。
6. Purge 才是永久刪除。
7. 特殊狀態不得用負數。
8. NOT_HELD 不得視為缺考。
9. 特殊狀態無數值時不得列入平均。
10. 學生可依其他有效分數參與排名。
11. 排名以平均優先於總分。
12. 同分比序為平均、總分、國文、英文、數學。
13. 完全相同採共同名次。
14. 家長只看自己的班級名次。
15. 管理端可看全年段排名。
16. 原校成績不參與本校歷史排名。
17. 檢測先發布可有暫時排名。
18. 歷史年度預設唯讀。
19. Admin 必須同時檢查 Permission 與 Scope。
20. 導師只能操作自己班，但可改全科。
21. 任課教師只能操作自己任教班級與科目。
22. Secret 不得出現在 D1 明文、前端或 Git。
23. 身分證不得以普通明文 index 查詢。
24. AI Context 應去識別化。
25. AI 故障不得影響成績查詢。
26. 家長版與學生版 AI 各至少 500 中文字。
27. Audit Log 保存 2 個月。
28. ScoreChangeHistory 跟隨學生資料期限。
29. 一般刪除、Archive Undo、Import Rollback 快速復原 30 天。
30. 畢業資料保存 1 年。
31. 轉出資料保存 3 年。
32. 保存期滿後需人工確認 Purge。
33. Purge 不可復原。
34. Production migration 需人工確認。
35. Production deployment 需人工確認。
36. 所有 AdminUser 必須通過 Google OAuth / OIDC 驗證。
37. Google OAuth / OIDC 是管理員唯一外部認證，不再要求 ChatGPT 或 Gemini 認證。
38. 已驗證 Google Email 必須符合 AdminUsers.authorized_email。
39. 已綁定帳號的 Google subject 必須一致；變更須受控 Rebind。
40. AI 帳號、提供者設定、API Key 與 AI 服務可用性不影響合法管理員登入或 Session。
41. 管理端不得提供本地密碼登入備援。
42. `admin` 僅為內部保留帳號代號，不是登入憑證。
43. GitHub Repository 名稱固定為 `classroom-aigrade-tzk`。
44. Repository 必須包含 MIT License。
45. GitHub Pages 只能承載靜態專案資訊，不得承載成績或管理功能。
46. 每次 ChatGPT Sites 正式部署後必須同步更新 README.md。
47. 每次 ChatGPT Sites 正式部署後必須同步更新 GitHub Pages。
48. 每次正式部署完成後必須回報 Repository、GitHub Pages、ChatGPT Sites 三個已驗證網址。
49. GitHub 不得保存任何真實學生資料或 Secrets。

50. 每個 Phase 開始前必須執行 Model/Effort Check。
51. 能自動調整時應依 Phase 自動調整，以避免不必要 token 消耗。
52. 無法自動調整且目前設定不足或無法確認最低強度時，必須先提示使用者手動調整／確認；已有有效證據且符合需求時可 KEEP。
53. 不得為節省 token 省略安全、權限、資料邊界、migration、排名、封存、Purge、Release 或 Production 必要檢查。
54. 高風險 Phase 實際推理強度不得低於該 Phase 的 Minimum Effort。

---

<a id="spec-67-1"></a>

### 67.1 管理員 Google 認證必測案例

至少包含：

1. Google 驗證成功、Email 已驗證且符合授權、active、subject 一致 → 可登入，不需其他服務認證。
2. 未完成 Google 驗證 → 拒絕登入。
3. Google `email_verified = false` 或缺少必要 Email／subject → 拒絕登入。
4. Google 驗證成功但 Email 不在授權名單 → 拒絕，不能自動建立 AdminUser。
5. 偽造簽章、錯誤 issuer／audience、過期 ID token → 分別拒絕。
6. state／nonce 不一致、callback 重放 → 拒絕。
7. 前端 Email、角色或偽造身分標頭不能取代 Google 身分結果。
8. pending_identity_binding 經合法 Google 首次綁定後才轉 active 並建立 Session。
9. 已綁定帳號以不同 Google subject 登入 → 拒絕，須受控 Rebind。
10. 相同 Google subject 的 Email 不再符合授權紀錄 → 拒絕，不能靜默改寫授權。
11. disabled、locked、identity_rebind_required 帳號不能直接取得管理端 Session。
12. 首次 Bootstrap：有效 Secret＋Google 已驗證＋從未初始化＋零帳號 → 建立第一位 admin。
13. Bootstrap Secret 錯誤或 Google 驗證失敗 → 不建立帳號。
14. Bootstrap 完成後不能重啟；併發初始化不產生多位初始管理員。
15. `admin` 不可 rename／delete，且不存在本地密碼欄位或本地登入 route。
16. 管理員停權後既有 Session 立即失效；Role／Scope 變更立即依 Server 最新資料生效。
17. Google Rebind 後撤銷舊 Sessions；新帳號須通過 Google 驗證與授權。
18. 最後一位 active super_admin 不可被停權或降級。
19. 高風險重新驗證使用 Google，檢查操作人與驗證新鮮度；Recovery Secret 不可單獨登入。
20. OAuth code、token、Cookie 不進一般 Audit Log；前端 bundle 不含 OAuth Client Secret；登入不取得不必要服務內容。
21. 管理員沒有 ChatGPT／Gemini 帳號，或 AI API Key 缺少／錯誤、AI 服務故障 → 合法 Google 登入仍成功。
22. 切換 AI 提供者不撤銷管理員 Session，也不觸發任何 AI 帳號綁定或資格驗證。

以上是後續 Phase 3A／3B 的驗收要求，本次文件修訂未執行應用程式認證測試。

---

<a id="spec-68"></a>

## 68. Codex 禁止事項

Codex 不得：

- 自行進入下一 Phase。
- 自行 Deploy Production。
- 建立任何本地管理員密碼。
- 將 Secret 寫進程式。
- 將真實學生資料寫入測試。
- 移除 Scope 權限。
- 把特殊狀態當數值。
- 把 NULL 當 0。
- 把 NOT_HELD 當缺考。
- 用目前班級推算歷史班級。
- 用目前 exclude 狀態重算歷史排名。
- 刪除 Audit 所需管理員帳號。
- 未確認就 Purge。
- 用 client-side 判斷取代 server-side authorization。
- 將 GitHub Pages 當作正式後端執行環境。
- 在 GitHub Pages 收集或處理學生個資。
- 將 Production D1、Secrets 或真實學生資料提交至 GitHub。
- 正式 Sites 部署後略過 README.md / GitHub Pages 同步。
- 在未驗證成功前虛構 Repository、Pages 或 Sites URL。
- 為節省 token 而降低高風險 Phase 至 Minimum Effort 以下。
- 為節省 token 而跳過安全、邊界、migration、排名或 Production 驗證。

---

<a id="spec-69"></a>

## 69. v1 不包含

除非另行要求：

- 額外企業級 SSO／SAML 整合（本規格要求的 Google OAuth / OIDC 登入不在排除範圍）。
- Google Workspace 企業目錄整合與組織級 SSO；不排除符合 §32–37 的 Google OAuth / OIDC 登入。實際帳號政策仍須於 Phase 0 確認。
- Microsoft Entra。
- 自訂 Role Builder。
- SCIM。
- Vector DB。
- Push Notification。
- Email 自動寄送。
- 家長帳號系統。
- 手機 App。
- 補考流程。
- 特殊班級。
- 多校 Tenant。

---

<a id="spec-70"></a>

## 70. Codex 每次開始工作的建議指令

```text
請先完整閱讀 PROJECT_SPEC.md。

本次只執行 Phase X。

開始前先執行 Model/Effort Check：
- 讀取本 Phase 的 Recommended / Minimum Effort。
- 有可用工具就依建議調整，確認成功後才回報 AUTO_SWITCHED。
- 無法調整時核對實際設定；符合需求可 KEEP，不足或無法確認 Minimum 時先提示我調整／確認。
- 以節省 token 為原則，但不得省略安全、資料邊界或必要測試。
不得開始其他 Phase。
不得部署 Production。
不得使用真實學生資料。

實作前先檢查現有 repository、migration、tests 與相關模組。
如規格與現有程式衝突，以 PROJECT_SPEC.md 為準，但請在修改前回報衝突。

完成後請：
1. 執行相關測試。
2. 列出新增與修改檔案。
3. 列出 migration。
4. 列出測試結果。
5. 列出安全性檢查。
6. 列出已知限制。
7. 停止並等待我確認，不要自行進入下一 Phase。
```

---

<a id="spec-71"></a>

## 71. 文件狀態

本文件已整合目前已確認之：

- 學年度。
- 升班。
- 班級。
- 新生。
- 轉班。
- 轉入。
- 轉出。
- 畢業。
- 封存。
- 保存期限。
- 成績。
- 特殊狀態。
- 平均。
- 排名。
- 匯入。
- AI。
- RAG。
- 家長查詢。
- 管理員。
- 權限。
- Audit。
- 報表。
- Recycle Bin。
- Rollback。
- Purge。
- Codex Phase。

後續若需求修改，應直接更新本文件版本，不應只在對話中新增例外規則而未回寫規格。

文件完善不等於業務決策全部完成，也不等於功能已實作。本版已確認規則與尚待決策事項的區分，以 §72 為準。

---

<a id="spec-72"></a>

## 72. 文件治理與待決策清單

<a id="spec-72-1"></a>

### 72.1 本次核准範圍與文件責任

2026-09-22 使用者核准文件審查提出的修訂範圍：統一主規格、完善主規格與 AGENTS，新增 README、CHANGELOG；尚未定案的業務選擇先列為待決策，不由 Codex 代為核准。

同日使用者進一步確認管理員僅需 Google OAuth 認證。此決策已納入 v1.6-draft，取消全部 ChatGPT／Gemini 認證前置條件；D-01、D-09 已移除相關未決部分，僅保留 Recovery 與 Google 登入實作政策。

| 文件 | 責任 | 不得宣稱 |
|---|---|---|
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | 唯一主要業務與技術規格、Phase 定義、待決策事項 | 未確認的建議已成為規則 |
| [AGENTS.md](AGENTS.md) | 開發紀律、工具使用、安全邊界與回報流程 | 可覆蓋主規格的業務要求 |
| [README.md](README.md) | 專案入口、實際狀態、環境與網址資訊 | 尚未驗證的功能、指令或部署已可用 |
| [CHANGELOG.md](CHANGELOG.md) | 文件及軟體變更紀錄 | 文件版本等於正式軟體 Release |

規格固定使用 `PROJECT_SPEC.md`；文件版本保存於本文與 CHANGELOG，不以另建平行規格副本追蹤版本。未完成決策前維持 `draft`，不得標為 frozen。新增決策須記錄日期、使用者核准依據、受影響章節、Phase 及測試要求。

純文件工作可跨章節修正一致性，不算執行多個開發 Phase。若開始程式、schema、外部資源建立或部署，仍必須先取得對應 Phase／動作授權。

<a id="spec-72-2"></a>

### 72.2 待決策事項

下列項目目前全部為 **待使用者決策**。表中的建議不是已核准規則；實作到所列關卡前，必須先確認並回寫本節與相關正文。平台能力不足時保留實際證據，不可用模擬結果宣稱 Production 可用。

| ID | 待決定事項及影響 | 建議方案／可選方案 | 最遲確認關卡 |
|---|---|---|---|
| D-01 | 失去全部可用管理身分時的 Emergency Recovery 核准者、流程與必要證據 | 首次 Bootstrap 已依 Google＋Bootstrap Secret 定義；Recovery 建議由受控維護程序核准，新 Google 帳號仍須驗證，不能只憑 Recovery Secret 登入或重新開啟 Bootstrap | Recovery／緊急 Rebind 實作前；最晚 Phase 3B 完成前 |
| D-02 | 同班同名同生日的公開查詢無法唯一識別 | 目前一律一般查詢失敗；建議交由校方受控協助。若改採額外識別條件，須明確核准新增欄位，不能自行增加身分證、查詢碼或帳號 | Phase 13 |
| D-03 | 學生／學期／單次評量排名資格的覆寫或排除優先序，以及參與快照建立時點 | 可選「單次優先、空值繼承」或「任一層排除即排除」；快照建議在當次參與名單確認時固定。需同時決定開始後轉入、撤銷轉班的邊界 | Phase 1 資料模型；Phase 5 計算 |
| D-04 | 無有效分數時的總分／排名、同分比序科目缺值，以及班級人數與各項統計母體 | 建議無有效分數不排名、無數值顯示「—」；統計明確區分在籍、實際參與、排名合格及有效分數人數。另定排除排名者、原校成績是否進入各統計，不得以 NULL＝0 解決 | Phase 5 |
| D-05 | 延長查詢是否同時延長保存；轉出後畢業、恢復學籍等多事件的期限優先序 | 可選同步延長兩期限，或先獨立核准保存延長再延長查詢；兩者都必須符合查詢期限不晚於保存期限 | Phase 8 |
| D-06 | Purge 與未滿 30 天復原承諾、歷史排名、稽核紀錄、物件副本及備份的關係 | 建議有未到期復原承諾時阻擋 Purge；評估保留不可回推個人的統計快照或凍結既有他人成績排名。所有可識別副本的刪除／到期機制須逐一確認 | Phase 9；Production Purge 前 |
| D-07 | 匯入後已有手動修改、再次匯入或發布時的 Rollback；批次錯誤時整批或部分提交 | 建議整批原子提交；回復遇版本衝突時阻擋並預覽差異。可另選逐項核准，但不得靜默覆蓋後續修改 | Phase 6；Phase 9 整合 |
| D-08 | 段考先發布、全部 NOT_HELD、未完整發布時 PROVISIONAL／FINAL 的轉換；修改重算失敗時的公開版本 | 建議以明確發布完成條件區分暫時／正式，與缺分數分開；失敗時繼續提供上一完整發布版本，不能混用新舊成績與排名 | Phase 7 |
| D-09 | Google OAuth／OIDC 的平台 callback／Cookie 相容性、Email 正規化與允許的 Google 帳號政策 | Google sub 作綁定識別鍵已定義；Email 用於授權比對，不自行去除點號或加號別名。確認 Google-only 登入不被平台額外認證門檻阻擋；不能以訪客可偽造的 Email 標頭授權。2026-09-23 使用者指示暫緩 OAuth 設定與登入實測，尚未通過 | Phase 0 保存文件／存取選項證據；Phase 3A 前補實測與驗證契約 |
| D-10 | 預設角色對各項操作的權限矩陣、多任教範圍組合，以及教師異動後歷史資料 Scope | 依最小權限建立 Role × Permission × Scope × 時間範圍矩陣；未授權預設拒絕。導師／任課教師既有班級與科目限制不可放寬 | Phase 3B |
| D-11 | 日期時區、有效區間端點、兩個月稽核保存的曆月／天數定義；查詢、上傳、重試、容量門檻與復原目標 | 建議業務日期使用 Asia/Taipei、技術時間戳使用 UTC，但須確認保存期限與端點語意。門檻依平台驗證及學校需求定稿，不任填數值 | 日期於 Phase 1；其餘於對應功能 Phase，最晚 Phase 18 |

<a id="spec-72-3"></a>

### 72.3 衝突處理與證據

- 實作前若發現本文內部衝突，暫停受影響項目，列出章節、影響、選項及建議；不受影響的工作可繼續。
- 決策定案時同步更新正文、測試案例、Phase 關卡與 CHANGELOG，不僅在待決策表改狀態。
- URL、平台能力與執行結果分為「官方文件已說明」「本專案已實測」「待驗證」，不得互相代替。
- 文件中的姓名、班級、數值及代碼示例均為虛構；不得加入真實學生、教師或管理員個資作為決策證據。

---

<a id="spec-73"></a>

## 73. 跨章節邊界與驗收補充

<a id="spec-73-1"></a>

### 73.1 公開查詢與歷史快照

查詢目標以學年度、學期、評量次序及當次班級快照定位。內部以不可混淆的 ID 連結資料，UI 班級代碼不能充當跨年度唯一鍵。

必測：上下學期同次評量不混淆；轉班後舊評量仍屬舊班；同名同生日多筆命中不洩漏資料；保存／查詢期限外拒絕；部分發布不洩漏未發布科目；不以更改 URL 或請求中的 Student ID 存取其他學生。

家長端僅可見該生自己的班級名次，不回傳其他學生名單或全年段個人排名。班級與全年段彙總統計須待 D-04 定稿後測試；公開查詢方式的殘餘風險須於 Phase 13／16 記錄。

<a id="spec-73-2"></a>

### 73.2 平均與排名驗收示例

所有分數為虛構。計算應使用能維持精確小數語意的方法，例如百分之一分整數及明確的四捨五入規則；不得依賴未驗證的浮點輸出。

| 有效輸入／情境 | 必須成立的結果 |
|---|---|
| 0、100 | 平均 50.00；0 是有效分數，分母為 2 |
| 80、ABSENT、NOT_HELD、未輸入 | 平均 80.00；分母為 1；各特殊狀態與未輸入分開呈現 |
| 全部為特殊狀態或未輸入 | 平均無數值，不能顯示為 0.00；總分與排名政策依 D-04 |
| 檢測 100；段考 50、50 | 定評平均 66.67，不能先平均兩類平均得到 75.00 |
| 學期四筆有效分數為 100、0、0、0，分布在不同定評 | 學期平均 25.00，不能改用各定評平均的平均 |
| 80.00、80.25 | 原始平均 80.125，四捨五入顯示及排名用平均為 80.13 |
| 所有已定義的比序鍵相同 | 共同名次；後續名次依 1、2、2、4 的競賽排名規則 |

科目是否舉行由評量科目設定控制，單筆匯入的 N 不得擅自改成全班或全年段不舉行。每位學生的特殊狀態必須與科目設定一致，不一致時回報 Validation 錯誤。

歷史不變量限制的是升班、轉班、轉出、畢業及目前資格的變動。合法解鎖並修正歷史成績仍依 §20 重算，但只能使用原評量的班級與資格快照，且保留修改歷程。

<a id="spec-73-3"></a>

### 73.3 發布、成績修改與併發

- API 必須重新檢查操作者的 Authentication、Permission、Scope 與評量鎖定狀態，不能沿用 UI 預覽時的判斷。
- Preview 必須能識別來源版本；Confirm 時來源或權限已變更，就重新預覽或拒絕提交。
- 成績更新及對應 ScoreChangeHistory 不得出現只成功一半的狀態。跨步驟操作需提供可重試、可辨識完成狀態的設計。
- 平均、排名與公開結果必須對應同一成績版本；D-08 定案前不得自行選擇公開端降級策略。
- 重算可能影響同班／全年段其他人的排名及 AI Context。依相依資料標記舊建議 stale，並僅為仍符合生成資格的學生建立重生工作。
- 已轉出者不得因他人的成績修改而產生新的 AI 建議；畢業封存等狀態須依既有生命週期規則處理。
- 成功修改後恢復鎖定；失敗後不得留下未說明、未稽核的可寫狀態。

必測：兩人同時修改、Confirm 重送、寫入中斷、排名重算失敗、AI 不可用、歷史年度解鎖再鎖定，以及未授權班級／科目的修改。

<a id="spec-73-4"></a>

### 73.4 匯入、Rollback 與物件資料

- Upload 時限制格式、大小、壓縮展開量與工作表／列數；具體門檻於 D-11 定案。格式不符、超量或含不支援的公式／巨集不得靜默執行。
- Parse／Map 明確定義 CSV 編碼、日期格式、空白、前導零與科目映射；不得因試算表自動轉型改變學號或識別欄位。
- Validate 同時檢查學生識別、目標學期／評量、Scope、重複列、特殊狀態、原校成績及 NOT_HELD。
- Preview 顯示新增、修改、錯誤及目標範圍；Commit 再驗證權限與來源版本，並防止重複確認產生重複成績或工作。
- Import Job 保存必要的提交前後值、版本及操作者；原檔、錯誤報表和 Rollback 資料屬敏感資料，不得進 Git、公開儲存或一般 log。
- Rollback 同樣須經預覽、授權、確認與稽核；若影響已發布成績，必須走解鎖、原因、History、重算及 AI stale 流程。
- D-07 未確認前，不得把「覆寫目前值」當作 Rollback 實作；D-06 未確認前，不得讓 Purge 靜默破壞 30 天復原承諾。

必測：識別不一致、重複匯入、跨班科目越權、檔案解析失敗、提交中斷、後續手動修改衝突、Rollback 重送，以及期限內外邊界。

<a id="spec-73-5"></a>

### 73.5 AI、RAG 與工作版本

- AI Context 採允許欄位清單；姓名、生日、身分證、學號與 Student ID 均不列入允許清單。若有例外需求，先取得明確核准及回寫規格，不能由程式自行放行。
- 去識別化需涵蓋資料列、檔名、RAG 片段及錯誤內容；不能只刪除頂層姓名欄位。
- AI 工作記錄成績版本、提供者／模型、prompt 版本與引用資料版本；所有必要識別只留在伺服器，不作為模型輸入。
- 同一來源版本的重試不得產生重複有效建議；較舊工作的完成結果不得覆蓋較新的版本。發布前重新檢查學生狀態與來源版本。
- AI 失敗、逾時或重試耗盡時記錄安全的錯誤代碼，基本成績、查詢、學籍與排名仍可使用。
- 家長版、學生版各自計算中文字數；只計可辨識的漢字，不以標點、空白或英文字數充足替代。測試至少含 499／500 字邊界及任一版本不足。
- 過期或封存的參考資料不得進入新 retrieval；保存舊建議及必要引用紀錄，仍受學生保存期限與 Purge 規則約束。
- 提供者及引用文字不能取得執行權限；RAG 內的指令只視為資料，不能改寫系統規則或觸發額外工具操作。

必測：提供者失敗不影響成績、重試去重、舊工作晚完成、轉出後工作取消／略過、個資攔截、同學期比較、RAG 封存與指令注入、中文字數邊界。

<a id="spec-73-6"></a>

### 73.6 管理端驗證與授權契約

- Google OAuth / OIDC 須驗證簽章、issuer、audience、效期、state、nonce 與 `email_verified`；採用官方支援的安全流程與 PKCE，具體契約於 Phase 0／3A 驗證。
- 管理員名稱、Email 或角色的前端值不能當作登入證明；必須驗證 Google 身分結果，不接受可由訪客偽造的身分標頭。Sites 代理、直連與存取設定須實測，避免在 Google 登入之前額外要求另一個外部服務認證。
- 已授權、首次綁定、active、disabled、locked 及 rebind 狀態有獨立轉換條件；帳號停權及權限縮限立即生效。
- 每個管理端 API、檔案下載、報表、背景工作與批次操作都必須檢查 Permission＋Scope；拒絕時不能先洩漏目標資料。
- Phase 3B 交付 D-10 核准後的權限矩陣。導師限自己的班且可操作全科；任課教師限任教班及任教科目。
- 高風險操作驗證 Recent Authentication、操作者資格、目標版本與確認內容；Recent Authentication 的有效窗口依 D-11 定案。
- Session 使用 HttpOnly、Secure 及適當 SameSite Cookie，D1 僅存 token hash；SameSite 不能取代完整 CSRF 防護。
- Bootstrap 必須一次性且防止併發初始化；Recovery 不得重新開啟 Bootstrap 或創造本地密碼備援。

必測：§67.1 全部案例、跨班／跨科 IDOR、權限變動後既有 Session、最後一位 super_admin 保護、CSRF、OAuth callback 重放及身分標頭偽造。

<a id="spec-73-7"></a>

### 73.7 保存、Secret、匯出與維運

- 查詢期限、保存期限、學籍生效日期與技術時間戳分別定義；到期與復原邊界需依 D-11 測試，不能把一年寫死為 365 天或把兩個月默認為 60 天。
- Purge 前保留可審查的影響 Manifest；完成後驗證各儲存位置結果。若部分失敗，記錄未完成項目與重試狀態，不能宣稱已完全刪除。
- 一般 Audit Log 保留兩個月；ScoreChangeHistory 跟隨學生保存期限。Recovery 證據、Purge 證據與去識別紀錄另依 D-01／D-06 定義，不能靠延長一般 Audit Log 迴避決策。
- 身分證加密與 keyed HMAC 各自記錄金鑰版本；輪替、重算查詢雜湊、解密失敗及金鑰遺失復原策略於 Phase 1 設計並測試。金鑰不得與密文一起寫入 Git 或一般資料表。
- 公開查詢資料不進 URL；敏感回應禁止共用快取，並檢查瀏覽器快取、搜尋索引、分析事件及伺服器 log 不含查詢條件或結果。
- 報表與匯出必須重新驗證 Scope，避免 CSV／Excel Formula Injection，並限制敏感輸出檔的取得與保存範圍。
- Production migration 需 preflight、人工確認及已驗證的 recovery 計畫；備份與復原能力先依平台實測，不能假定部署回退會一併還原資料庫。
- 所有開發、預覽與測試僅用虛構資料；Production smoke test 必須使用受控的虛構測試資料，執行前定義範圍及清理方式，不得以未核准 Purge 清理資料。

<a id="spec-73-8"></a>

### 73.8 外部能力與查核來源

以下為 **2026-09-22 官方文件查核**，不是本專案的實測完成紀錄：

| 項目 | 文件可支持的內容 | 本專案仍須驗證 |
|---|---|---|
| Google 登入 | Google OAuth 2.0 支援 OIDC；以 sub 識別帳號，Email 用於授權比對 | Sites 上的 callback、Cookie、Google-only 登入與帳號政策；不能用平台其他服務的登入結果代替 Google 認證 |
| Sites 發布 | 保存版本與部署分開；所有 Sites 部署 URL 都是 Production deployment | 實際帳號能力、建置相容性、D1／R2、Secrets、工作排程及復原方式 |
| Codex 模型 | 桌面介面提供模型／推理控制；互動 CLI 可用 `/model` | 目前執行設定與代理是否擁有可驗證的切換工具 |

來源：[Google OIDC 官方文件](https://developers.google.com/identity/openid-connect/openid-connect)、[Sites 官方文件](https://learn.chatgpt.com/docs/sites)、[Models 官方文件](https://learn.chatgpt.com/docs/models)。後續若文件、工具或帳號能力改變，記錄新查核日期與影響，不沿用過期假設。

限制訪客為本人、工作區或受邀者，不會改變 Sites 部署屬 Production 的性質。Phase 0 預覽使用本機或經驗證且不執行部署的預覽能力；Phase 18 僅保存版本。任何 Sites deployment，包括受限存取部署，都須先取得「確認正式部署」授權。

模型設定須以工具回應、可驗證的執行資訊或使用者確認為依據；讀到預設設定檔不代表正在執行的回合已切換。沒有切換工具或成功證據時，不得回報 `AUTO_SWITCHED`，也不得為調整推理強度擅自建立另一個 task。

---

<a id="spec-74"></a>

## 74. Phase 順序、交付與驗收關卡

本次僅維護文件，不宣稱任何 Phase 已完成。以下為後續工作的順序與最低交付證據；各 Phase 原章節的要求仍全部適用。

| Phase | Recommended / Minimum | 主要交付與驗收關卡 |
|---|---|---|
| [0](#spec-46) | MEDIUM / MEDIUM | 平台能力證據、GitHub Owner／可見性／授權人確認、環境與預覽檢查；D-09 Google-only 登入實測依 2026-09-23 指示暫緩；不得部署 Sites Production |
| [1](#spec-47) | HIGH / HIGH | 核心 schema、約束、migration 與 recovery 設計；虛構資料 migration tests；確認影響模型的 D-03／D-11 |
| [2](#spec-48) | HIGH / HIGH | 學年度與學籍領域服務、生命週期測試；Phase 3A／3B 完成前，管理寫入功能只在隔離測試環境驗證，不對外開放 |
| [3A](#spec-49) | HIGH / HIGH | Google OAuth／OIDC、授權與綁定、Session、一次性 Bootstrap；D-09；通過 §67.1 適用案例，Recovery 跨 Phase 邊界依 D-01 |
| [3B](#spec-50) | XHIGH / HIGH | D-10 權限矩陣、Permission／Scope、停權、Google Rebind、D-01 Recovery 與最後一位管理員保護；通過越權測試 |
| [4](#spec-51) | HIGH / HIGH | 評量、科目、特殊狀態、來源與快照；分數範圍及 NOT_HELD 驗證 |
| [5](#spec-52) | XHIGH / HIGH | D-03／D-04 定稿；先寫測試，再實作平均與排名；通過 §44、§73.2 |
| [6](#spec-53) | HIGH / HIGH | Upload 至 Commit 與完整 30 天 Rollback 核心能力；D-07；不得把 Rollback 延後到 Phase 9 才實作 |
| [7](#spec-54) | HIGH / HIGH | D-08 狀態表、發布／鎖定／History／重算；持久化 AI 重生請求與 mock 消費契約，實際 AI 消費於 Phase 12 整合 |
| [8](#spec-55) | XHIGH / HIGH | D-05 期限、封存 Preflight／Undo／Restore；強制封存有原因及權限，不能繞過其他安全檢查 |
| [9](#spec-56) | XHIGH / XHIGH | D-06 定稿；整合既有 Rollback 與 Recycle Bin；Purge 全流程、部分失敗與完成驗證測試；不得執行真實資料 Purge |
| [10](#spec-57) | MEDIUM / MEDIUM | PDF／MD 解析、FTS、metadata、期限與封存；上傳安全、個資及不可信內容測試 |
| [11](#spec-58) | HIGH / HIGH | Provider adapter、Secret、逾時、重試、錯誤契約；優先使用 mock；必要的真實 API 驗證須在本次授權、Secret 管理與用量範圍內進行 |
| [12](#spec-59) | HIGH / HIGH | AI Context／Jobs／版本／RAG／去識別化；整合 Phase 7 請求，測試舊工作、字數、失敗與重試 |
| [13](#spec-60) | MEDIUM / MEDIUM | D-02 查詢歧義流程、學期選擇、已發布結果、行動與無障礙；公開查詢安全測試 |
| [14](#spec-61) | MEDIUM / MEDIUM | 管理 UI 串接已授權 API；按角色／Scope 驗證主要操作與錯誤處理 |
| [15](#spec-62) | MEDIUM / MEDIUM | 報表、匯出、列印；Scope、公式注入與敏感輸出檢查 |
| [16](#spec-63) | XHIGH / XHIGH | 跨模組安全／隱私審查及必要修正；不能把前面 Phase 的基本安全要求延後至此 |
| [17](#spec-64) | XHIGH / HIGH | 完整生命週期、歷史不變量、Rollback、Restore 與解鎖整合測試；全部使用虛構資料 |
| [18](#spec-65) | HIGH / HIGH | 全套測試、production build、migration review、Release Candidate、文件與部署計畫；相關待決策不得未解即宣稱可正式發布 |
| [19](#spec-66) | XHIGH / XHIGH | 取得「確認正式部署」及 migration 人工確認；preflight、部署、smoke test、GitHub／Pages 同步與三網址驗證 |

共 21 個執行階段：0 → 1 → 2 → 3A → 3B → 4 → … → 19。每次只執行一個，下一階段依此順序，不能用字面數字加一代替。Phase 19 完成後停止並回報部署結果，不詢問不存在的 Phase 20。

每個 Phase 完成報告必須列出實際測試指令與結果、檔案、migration、安全檢查及限制；無法執行的檢查須明確記為未執行並說明影響。UI 未開發時可用領域服務／API 測試驗證，不可藉此提前完成下一 Phase UI。

安全與資料一致性測試在功能所屬 Phase 即須具備，Phase 16／17 是跨模組驗證。未通過相關關卡、尚有阻擋實作的待決策或缺少必要驗證時，回報「部分完成／受阻」，不得標成完成、正式 Release 或 frozen。
