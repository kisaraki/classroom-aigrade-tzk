# Phase 10 驗證紀錄

日期：2026-09-28。使用者已核准 Phase 10，並同意 D-11 上傳及檢索門檻。核心功能與本機完整回歸驗收完成；未正式部署。

## 零、模型／推理強度

- Recommended／Minimum：MEDIUM。
- Actual：沿用已確認 XHIGH；Action：KEEP，未自動切換、未另外升級。

## 一、完成項目

- PDF／UTF-8 Markdown 上傳、私有 R2 原檔、文字解析、Unicode 片段、版本化 D1 與中文 FTS。
- Metadata、草稿、人工個資覆核後啟用、有效期間與封存。到期／封存不再用於新檢索，保留舊片段與引用 hash。
- 管理操作要求全校 ai.manage；檢索要求 ai.read 與班級／年級／科目 Scope。伺服器決定目前學期；寫入以原子 guard 重驗 Session、學籍 revision、版本及 Purge 鎖。
- 檔名、metadata、PDF 附加資訊、擷取文字、搜尋詞與回傳片段均檢查個資。只回傳允許欄位及 untrusted_reference_data 契約，不提供工具或 Provider 設定操作。
- 上傳失敗保留受保護清理項目，支援重試；D1 批次中途失敗不留下部分材料／片段／索引。已提交原檔不可由 cleanup 刪除。

## 二、新增檔案

- [文字與 FTS helper](../site/lib/domain/rag-text.ts)。
- [解析與限制](../site/lib/server/references/parse.ts)、[服務](../site/lib/server/references/service.ts)、[HTTP](../site/lib/server/references/http.ts)、[runtime](../site/lib/server/references/runtime.ts)。
- [API routes](../site/app/api/admin/references)：清單／上傳、更新、檢索、清理待辦與重試。
- [文字測試](../site/tests/rag-text.test.mjs)、[服務與 Workers 測試](../site/tests/references.test.mjs)。
- [0011 migration](../site/drizzle/0011_phase_10_references.sql)、[snapshot](../site/drizzle/meta/0011_snapshot.json) 與本紀錄。

## 三、修改檔案

- PROJECT_SPEC §31／D-11：已核准 5 MiB、100 頁、200,000 字元、1,000／100 字元分段、250 片段、200 字元搜尋、最多 8 片段／8,000 字元。
- schema、migration journal、package.json／lock；鎖定 unpdf 1.8.1，約 2.1 MB，該套件沒有其他 runtime 相依套件。既有套件保留。
- 受 migration 數量影響的測試期望值；README、DATABASE、CHANGELOG 與 Pages 文件。

## 四、Database Migration

新增 reference_uploads、search_tokens 與 reference_search FTS；共 48 張關聯表、12 份 migration、兩個 FTS 索引。原始片段、hash、引用及既有 migration 不改寫。

舊材料以 needsIndexReview 提示重新覆核；更新啟用後產生有新索引的版本。升級前需清點此類材料。程式回退不刪除 schema 或引用；正式 migration 前仍須 preflight、復原實測與人工確認。詳見 [資料庫說明](DATABASE.md#phase-10-rag-文件與搜尋)。

## 五、測試結果

- `node --import ./scripts/sites-env.mjs --test tests/rag-text.test.mjs`：2 passed、0 failed。
- `node --import ./scripts/sites-env.mjs --test tests/references.test.mjs`：首次 7 項服務／解析測試通過；後續新增 migration、競態及 Workers 測試併入完整回歸。
- Workers 專項：PDF 解析在 Miniflare nodejs_compat 執行且禁止 outbound network，通過。
- `npm run typecheck`：通過。
- `npm run build`：通過，包含 5 個 references route 檔案。
- `npm test`：184 passed、0 failed；包含 11 項 references 測試與 2 項 RAG 文字測試。
- `npm run lint`、`npm run format:check`：通過。
- `node scripts/check-docs.mjs`、`node scripts/check-safety.mjs`：通過；安全掃描不是完整安全稽核。
- 首次完整測試遇到舊版升級測試暫時失敗與 Workers 子程序停滯；該測試單獨重跑通過。測試命令改為並行 2 個檔案、每項逾時 180 秒後，完整 184 項全數通過。

## 六、安全性檢查

驗證 Session／Permission／Scope／IDOR、同源 Origin、欄位 allowlist、UTF-8／檔案與文字上限、PDF 主動內容及加密拒絕、人工覆核與自動個資攔截、版本衝突、撤權競態、Purge 鎖及無敏感內容錯誤代碼。原始檔名不持久化；R2 不建立公開 URL；只用虛構資料與暫時資料庫。

## 七、已知限制

- PDF 只擷取文字，不做 OCR；無法可靠解析、缺少可用字型映射或無文字頁面會拒絕。沒有渲染 PDF、執行 Markdown／HTML 或文件內指令。
- 自動個資檢查是已知學生／管理員識別及模式比對，無法保證辨識任意未知姓名，因此啟用仍須人工覆核。Provider 傳送前的最終 Context allowlist／去識別化及 prompt 隔離由 Phase 11／12 整合。
- 搜尋是正規化字詞／中文連續字的 FTS phrase 比對，不是語意向量搜尋。
- cleanup 紀錄保留以支援失敗／晚到寫入重試；清理 API 的成功表示當次已確認物件不存在，之後仍可重試。正式物件／備份清點 adapter 未啟用，Production Purge 仍停用。
- 管理 UI、AI Provider 與生成工作尚未建立；OAuth／Sites 平台實測仍依先前指示暫緩。Miniflare 結果不是 Production 能力驗證。
- 未執行 Production migration、真實資料 Purge 或 Sites deployment。

## 八、下一 Phase 預計工作

Phase 11：AI Provider Layer。須使用者另外批准，才開始供應者介面、金鑰管理、模型設定與故障隔離；目前未啟動。
