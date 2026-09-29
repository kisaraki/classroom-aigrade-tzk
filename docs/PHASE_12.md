# Phase 12 驗證紀錄

日期：2026-09-29。使用者核准 Phase 12、D-11 Job 門檻，以及先完成本機佇列／consumer 核心的範圍。核准的本機核心範圍已完成；正式排程與付費 API 尚未啟用。

## 零、模型／推理強度

Recommended／Minimum：HIGH；Actual：沿用已確認 XHIGH；Action：KEEP，未自動切換或另行升級。

## 一、完成項目

- Context 明確選取本次各科、平均、總分、班級名次及群體統計，不傳送識別碼、姓名、其他學生名單或全年段個人名次。群體平均使用有效原始分數總和與筆數，不混入原校成績。
- 同學期緊鄰前次比較，第一次不跨學期；NULL 不代入 0。RAG 只傳參考文字與暫時標籤，指令與資料分離，傳送前及保存前檢查個資。
- 家長版／學生版各自檢查五項必要段落，家長版另須協助方式，至少 500 漢字；拒絕個資、非預期欄位、HTML 與控制字元。只有兩版都成功才原子保存成對版本、引用與工作完成狀態。
- 首次手動啟動；來源／前次／模型設定／prompt 相同者去重。後續成績發布或修改，同一交易保存重生請求，連同同學期下一次評量的前次比較一起 stale。
- 可恢復 D1 工作、獨立單組 consumer、5 分鐘 lease、最多 3 次執行、1／5 分鐘重試。只重試暫時性 Provider／網路錯誤；租約與版本守衛防止舊 worker 覆蓋新結果。
- 背景執行與保存重驗啟動者、auth_version、Google 綁定、Permission、Scope、學生狀態、Purge 鎖、來源、設定與引用版本。不借用其他管理員權限。
- 保存已知 token usage、Provider 嘗試數與耗時，未回報為 NULL；AI 故障不修改成績或 Google Session。

## 二、新增檔案

- [Advice 驗證](../site/lib/server/ai/advice.ts)、[Context](../site/lib/server/ai/context.ts)、[Job 核心](../site/lib/server/ai/jobs.ts)、[重生交易](../site/lib/server/ai/regeneration.ts)、[HTTP](../site/lib/server/ai/jobs-http.ts)。
- [管理 API](../site/app/api/admin/ai/jobs/route.ts)。
- [Advice 測試](../site/tests/ai-advice.test.mjs)、[Context 測試](../site/tests/ai-context.test.mjs)、[Job 測試](../site/tests/ai-jobs.test.mjs)、[migration 測試](../site/tests/ai-jobs-migration.test.mjs)。
- [0012 migration](../site/drizzle/0012_phase_12_ai_jobs.sql)、[snapshot](../site/drizzle/meta/0012_snapshot.json) 及本紀錄。

## 三、修改檔案

PROJECT_SPEC／D-11、CHANGELOG、README、資料庫說明、schema／journal、Provider usage、runtime、背景授權、publication 原子重生，以及受 migration 數量影響的測試。跨模組修改限於來源／前次相依失效、權限與資料庫整合，沒有新增套件。

## 四、Database Migration

既有 ai_jobs 增加成對去重、授權版本、前次來源、Provider 設定及用量欄位；48 張關聯表、13 份 migration、兩個 FTS 索引。既有工作保持未授權，不自動領取或產生 API 費用。Purge 沿用既有工作／建議／引用刪除路徑。詳見 [資料庫說明](DATABASE.md#phase-12-ai-工作執行)。未執行 Production migration。

## 五、測試結果

- 第一輪 Context／Advice：5 passed、0 failed。
- 第一輪 Jobs：9 passed、0 failed；含成對保存、重試、併發、lease、轉出、重生、權限與 HTTP。
- `npm run typecheck`：通過。
- `node --import ./scripts/sites-env.mjs --test --test-timeout=180000 tests/ai-jobs-migration.test.mjs`：1 passed；驗證原子回復、重跑與舊工作不自動授權。
- Context／Advice／Jobs／Provider 專項 33 項：首次 30 passed；修正 RAG fixture 的搜尋 token 格式後，相關 4 項重跑全數通過。
- `npm run lint`、`npm run format:check`、`npm run build`：通過。
- `node scripts/check-docs.mjs`、`node scripts/check-safety.mjs`、`git diff --check`：通過；前端 bundle 未找到所檢查的 AI Secret／伺服器標記。
- `node --import ./scripts/sites-env.mjs --test --test-timeout=180000 tests/migrations.test.mjs`：17 passed；修正 schema 宣告順序與 ALTER TABLE 附加順序不一致，既有資料邊界回歸恢復通過。
- [完整 CI](https://github.com/kisaraki/classroom-aigrade-tzk/actions/runs/36520335655) 已通過修正後的 `9ab3309`：`npm test` 共 223 passed、0 failed；lint、格式、型別、文件／安全檢查及建置全數通過。首次 CI 的 schema 順序檢查中止 seed，造成連帶失敗，未視為通過。

## 六、安全性檢查

測試僅使用虛構學生、暫時 D1 與 mock Provider。HTTP 只接受管理員同源請求、JSON、4 KiB 本文及允許欄位；不提供 HTTP consumer 或直接付費生成入口。原始 Provider 錯誤、失敗生成文字、Secret 與未去識別化 Context 不保存於一般 log／Audit。Audit 只記錄操作與內部工作關聯。RAG 不取得工具或權限。

## 七、已知限制

- 依使用者核准，本階段驗收本機 durable queue／consumer 介面。正式 consumer／排程待平台方案與正式部署核准；未使用 waitUntil 代替可靠佇列。查核時 Sites plugin 0.1.71 文件與工具未提供可確認的 queue／scheduler 配置契約，這不是平台不支援的證明。
- 首次請求綁定持久化啟動者；撤權後自動工作拒絕，須由具資格管理員明確重新核准。背景生成限目前學年度，歷史建議仍保留並依 dated Scope 讀取。
- 每組順序生成兩版；任一失敗不發布半套。Job 重試可能重新呼叫兩版。用量僅表示供應者該次成功回應的已知 tokens；失敗或中斷請求的帳單用量可能未知，NULL 不代表 0。
- 自動個資檢查沿用已知識別與模式比對，可能誤判，也不能保證辨識所有未知姓名。模型品質與真實平台能力尚未實測；本機測試不代表生成內容一定正確。
- 管理／公開 UI 留待 Phase 13～15；Google OAuth／Sites 實測維持先前暫緩，Production Purge 仍停用。沒有正式部署、真實學生資料或付費 API 呼叫。

## 八、下一 Phase 預計工作

Phase 13：Public UI、查詢、限流、一般化錯誤、成績／AI／趨勢呈現與行動版可用性；須另獲使用者批准。
