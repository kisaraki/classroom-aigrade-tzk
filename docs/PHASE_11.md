# Phase 11 驗證紀錄

日期：2026-09-29。使用者於 2026-09-28 核准 Phase 11 與 D-11 Provider 門檻；本機驗證完成，未正式部署。

## 零、模型／推理強度

- Recommended／Minimum：HIGH。
- Actual：沿用已確認 XHIGH；Action：KEEP，未自動切換或另行升級。

## 一、完成項目

- AIProvider、OpenAI Responses 與 Gemini generateContent Adapter；固定官方 HTTPS endpoint，不接受自訂 URL，不跟隨重新導向。
- 由平台 Secret 讀取各自 API Key，沒有預設模型、自動 fallback 或付費 API 測試。
- 每次 30 秒、最多 3 次、總共 100 秒；只有網路／逾時、429、500／502／503／504 可重試。退避 1 秒／2 秒，加 0～250 ms jitter；遵守 Retry-After 並計入總時限。
- 輸入 32,000 Unicode 字元、max output 4,096 tokens、回應 1 MiB；逾時包含本文讀取，取消與錯誤會中止 upstream。拒答、截斷、不完整、工具輸出、無文字或格式錯誤不當成成功。
- Provider／model 使用既有 SystemSettings，要求全校 ai.manage、目前學期、版本與確認。兩項設定與 Audit 原子提交，提交當下重驗權限、Session、學籍 revision、設定版本與 Purge 鎖。
- Provider 設定與金鑰缺失不修改 Google 管理員 Session，也不修改既有成績。

## 二、新增檔案

- [Provider 與 Adapter](../site/lib/server/ai/provider.ts)。
- [設定服務](../site/lib/server/ai/settings.ts)、[HTTP 邊界](../site/lib/server/ai/http.ts)、[runtime](../site/lib/server/ai/runtime.ts)。
- [設定 API](../site/app/api/admin/ai/settings/route.ts)。
- [Provider 測試](../site/tests/ai-provider.test.mjs)、[設定測試](../site/tests/ai-settings.test.mjs) 與本紀錄。

## 三、修改檔案

PROJECT_SPEC §29／D-11／Phase 11、Cloudflare Env 型別、README、site/README、CHANGELOG 與 Pages 進度。沒有新增套件。

## 四、Database Migration

不需要新增 migration；沿用兩筆 system_settings 與既有 audit_logs。仍為 48 張關聯表、12 份 migration、兩個 FTS 索引。未執行 Production migration。

## 五、測試結果

- `node --import ./scripts/sites-env.mjs --test --test-concurrency=2 --test-timeout=180000 tests/ai-provider.test.mjs tests/ai-settings.test.mjs`：16 passed、0 failed。
- `npm run typecheck`、`npm run lint`：通過。
- `node scripts/check-docs.mjs`、`node scripts/check-safety.mjs`：通過；安全掃描不是完整安全稽核。
- 初次整合測試修正 fixture 表名／班級 ID 及 D1 metadata 比較；Workers 實測發現 runtime 拒絕 `redirect: "error"`，改成 `manual` 並拒絕 3xx，後續專項全數通過。

- `npm test`：200 passed、0 failed，約 267 秒；包括既有 migration、授權、成績、匯入、封存、Purge 與 RAG 回歸。
- `npm run build`、`npm run format:check`：通過；建置包含 AI 設定路由。

## 六、安全性檢查

測試使用虛構資料及暫時 Miniflare D1；供應者全部 mock。設定 API 要求 Session、Permission、全校 Scope、同源 Origin、JSON、欄位 allowlist、本文上限及版本；錯誤不回傳 Secret、供應者本文、輸入或原始 exception。Audit 僅記錄版本與供應者，不記錄金鑰／prompt。

## 七、已知限制

- 本階段是內部傳輸與設定服務，沒有公開生成入口；管理 UI、AIContext allowlist、RAG 指令隔離、500 字建議驗證、持久化 Job／重生及舊工作防覆蓋留待 Phase 12／15。呼叫端必須先完成授權及去識別化，不能把學生資料直接交給 Adapter。
- 模型名稱由管理員明確指定，語法檢查不保證模型存在、帳號可用或支援所有參數。供應者拒絕時回傳安全錯誤，不自動猜測替代模型。
- 4,096 tokens 透過供應者 request 上限控制，並拒絕回報超限的 output usage；本機沒有安裝模型 tokenizer。回應另有獨立 1 MiB 上限。
- OpenAI `store:false` 關閉 response storage；Gemini `store:false` 控制該次 logging。這些欄位不代表服務商保證零保存。實際帳號、服務條款、資料處理與正式平台能力尚未實測。
- 取消本機等待不保證供應者已停止計費；網路重試也可能重複用量，故限制最多三次，沒有跨供應者 fallback。
- Google OAuth／Sites 平台實測維持暫緩，Production Purge 仍停用；沒有正式部署、真實資料處理或付費 API 呼叫。

實作契約參照官方 [OpenAI 文字生成](https://developers.openai.com/api/docs/guides/text)、[Responses 遷移與儲存](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[Gemini generateContent](https://ai.google.dev/api/generate-content?hl=en)。官方文件、mock 與本機 Workers 驗證分開記錄，均未宣稱付費平台整合已驗收。

## 八、下一 Phase 預計工作

Phase 12：AI Advice／Jobs、Context allowlist／去識別化、RAG 隔離、版本與重生。須另獲使用者批准才啟動。
