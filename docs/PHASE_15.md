# Phase 15 Reporting／Export 工作紀錄

2026-10-01 使用者核准啟動，並核准主規格 §40／D-11 的資料、容量與保存政策。Phase 14 仍為部分完成，不因本階段獲准而改記完成。

## 零、模型／推理強度

Recommended／Minimum：MEDIUM。Actual：使用者已確認 MEDIUM 或更高，工具無法讀取精確設定；KEEP，沒有宣稱 AUTO_SWITCHED。沒有風險降級。

## 一、完成項目

- 班級總表、全年段總表、個人成績單、班級排名表、全年段排名表與 AI 總表。
- 只讀取已發布的完整快照，明示暫時／正式排名及發布版本，不另重算歷史名次。原校個人成績另列來源、按目前有效學籍授權，原校成績不進本校排名。
- CSV、Excel XLSX、嵌入繁體中文字型的 PDF、預覽及列印 CSS。
- Excel 儲存文字而非公式；CSV 引號／分隔符防護。疑似 ASCII／全形公式或以控制字元開頭者，加上可見「文字：」前綴，不依賴單引號在重存後仍有效。參考 [OWASP CSV Injection](https://community.owasp.org/attacks/CSV_Injection)。
- 每次一評量、1,000 位學生、10 MiB 產出限制。AI 只輸出匹配發布版本的有效完整成對建議；stale、缺少或內容不合格時不輸出部分建議。
- 下載前重驗 Session、Permission／Scope、發布快照、學生資料與 AI 來源。禁止快取，固定附件檔名，不將學生姓名、生日或 ID 放入 URL。
- 不匯出生日、身分證、內部 ID；不持久保存檔案。前端只用即時 Blob URL 並撤銷，範圍切換／離頁取消下載。

## 二、新增檔案

`site/lib/server/reports/{service,http,formats,pdf}.ts`、`site/app/api/admin/reports/route.ts`、`site/app/admin/reports.tsx`、`site/tests/reports.test.mjs`、字型宣告與 `site/assets/reports/`。字型來源、SHA-256、重建方式與 OFL 見 [字型紀錄](../site/assets/reports/README.md)。

## 三、修改檔案

主規格 §40／62／72／73.7、Admin Panels／Print CSS、README、site README 與 CHANGELOG。只修改必要的報表入口，未補做 Phase 14 Audit 或其他 Phase。

## 四、Database Migration

不適用：沒有 schema 變更、新 migration 或 Production DB 操作。沿用已發布快照、學籍、Session 與 AI 版本。

## 五、測試結果

- `node --import ./scripts/sites-env.mjs --test --test-timeout=180000 tests/reports.test.mjs`：10 項通過，0 失敗／跳過。包含公式／容量、六種報表、原校 Scope、AI 完整／stale／內容不合格、IDOR、版本變動、撤權及附件 HTTP。1,001 人採受控查詢結果模擬；10 MiB 測試涵蓋等於上限及超出上限。
- `npm run typecheck`、`npm run build`：通過。`npm run lint`：0 errors、2 warnings，均為忽略的既有 `.wrangler` QA 腳本未使用變數，產品原始碼無警告。
- PDF 虛構資料完成 Unicode 擷取、字型嵌入、兩頁換頁及 Poppler 渲染檢查；最新版分隔線與跨頁姓名提示已重渲染並檢視。產出約 4.2 MB，沒有 JavaScript／OpenAction。測試 PDF／PNG 不提交 Git、不當成正式學生報表交付。
- 本階段未再跑未受影響的完整回歸；前一工作回合的 245 項完整回歸已通過。本階段不宣稱完整 255 項回歸已執行。
- `npm run format:check` 與 `git diff --check` 通過。`node scripts/check-docs.mjs`：24 份文件、451 個本機連結通過；`node scripts/check-safety.mjs`：326 份原始檔，未發現指定 Secret／身分證模式（非完整安全稽核）。Production smoke test 不適用，沒有部署。

## 六、安全性檢查

覆蓋未登入、同源 Origin、未知欄位、混合 Scope、class／grade／student IDOR、任課科目限制、來源變動與撤權。容量 1,001 人案例為受控查詢結果模擬，並非正式平台負載測試。測試檔只用虛構資料，存於忽略的 `.wrangler`；沒有付費 API 或真實學生資料。

## 七、已知限制與未完成

瀏覽器工具先前被安全政策阻擋，下載／列印的瀏覽器互動與 Print CSS 實際排版尚未驗收，因此本階段暫列部分完成。PDF 無法呈現的字元會安全拒絕而不漏字。字型增加 Worker bundle 與每份 PDF 大小；Production 1,000 人容量、CPU／記憶體限制仍須平台實測。不將本機測試宣稱正式能力。

沒有正式 Release、Sites 部署或 Production migration；使用者後續已核准 Phase 16，本節瀏覽器驗收仍未完成。

## 八、下一 Phase 預計工作

Phase 16 為 Security／Privacy Hardening，Recommended／Minimum XHIGH。後續已獲使用者明確授權，並保留 Phase 14 未完成事項；本紀錄本身不等同啟動授權。
