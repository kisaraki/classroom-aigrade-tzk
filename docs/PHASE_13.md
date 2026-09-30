# Phase 13 驗證紀錄

日期：2026-09-30。使用者於 2026-09-29 核准 Phase 13，以及 D-02 歧義處理／D-11 查詢限流。本機實作已建立，完整 CI 驗證中；未正式開放查詢或部署 Sites。

## 零、模型／推理強度

Recommended／Minimum：MEDIUM；Actual：沿用已確認 XHIGH；Action：KEEP。公開成績、保存期限及 Purge 交叉邊界以目前強度處理，未自動切換。

## 一、完成項目

- 六項查詢條件透過同源 POST JSON 送出；使用學年度、學期、評量與歷史班級快照定位，不接受 Student ID，不回傳候選名單。
- 無命中、歧義、未發布、期限外與刪除皆使用同一提示。轉出／封存仍依保存與查詢期限讀取既有成績；發送回應前重驗身分匹配、學生版本、全部來源快照及 Purge 狀態。
- 滾動 10 分鐘每 IP 30 次、每完整條件 5 次；成功與失敗消耗額度，D1 條件 INSERT 防止併發超額。專用 HMAC 只保存雜湊與時間，不保存原始 IP、姓名或生日。
- 已發布分類、特殊狀態、0／NULL、檢測／段考／定評／學期平均、總分與個人班級名次。班級與全年段統計分開列示在籍、參與、資格、實際排名與有效成績人數；群體平均依原始有效總分與筆數計算。
- 本學期／學年度／最多 18 次趨勢、三種分析模式；原校成績另列，不混入本校統計與排名。無數值不連線，圖表附可讀數值表。
- 家長／學生版 AI 切換，僅顯示完整且未 stale 的最新建議；AI 缺少或失敗不影響成績。文字以 React 純文字呈現，不執行模型 HTML。
- 手機單欄、標籤、鍵盤操作、可見焦點、表格 caption／scope、狀態通知、結果焦點及清除資料。頁面離開／返回清除敏感狀態，不使用瀏覽器持久儲存。
- Purge 後保留既有個人摘要及名次；原始快照、群體統計與無法完整計算的學期平均明示不可用，不重算殘缺資料。Purge 同一交易清除不可按學生反查的短期 HMAC 限流紀錄。

## 二、新增檔案

- [查詢表單](../site/app/public/lookup.tsx)、[結果頁](../site/app/public/result.tsx)、[選擇元件](../site/app/public/choice.tsx)。
- [公開路由](../site/app/api/public/lookup/route.ts)、[查詢服務](../site/lib/server/public/service.ts)、[資料投影](../site/lib/server/public/result.ts)、[HTTP](../site/lib/server/public/http.ts)、[限流](../site/lib/server/public/limit.ts)、[runtime](../site/lib/server/public/runtime.ts)。
- [公開查詢測試](../site/tests/public-lookup.test.mjs)、[結果呈現測試](../site/tests/public-result.test.mjs)。
- [0013 migration](../site/drizzle/0013_phase_13_public_lookup.sql)、[snapshot](../site/drizzle/meta/0013_snapshot.json) 及本紀錄。

## 三、修改檔案

PROJECT_SPEC／D-02／D-11、CHANGELOG、README、資料庫及 site 說明、首頁／layout／CSS、Env 範本與型別、schema／journal、Purge 清理及 migration 數量相關測試。沿用既有 Radix Select 與套件，不新增 dependency。

## 四、Database Migration

0013 新增 public_lookup_attempts，只有作業 ID、IP HMAC、條件 HMAC、UTC 時間；含雜湊檢查及 IP／條件／清理索引。合計 49 張關聯表、14 份 migration，兩個 FTS 索引不變。測試驗證失敗 batch 回復、重跑、原資料保留；未執行 Production migration。回退程式不會自動回退 schema，復原時先關閉公開入口，保留 migration history。

## 五、測試結果

- `node --import ./scripts/sites-env.mjs --test --test-concurrency=2 --test-timeout=180000 tests/public-*.test.mjs tests/migrations.test.mjs`：29 passed、0 failed。
- 補齊 Purge 與原校呈現後，`node --import ./scripts/sites-env.mjs --test --test-timeout=180000 --test-name-pattern='Phase 13|Purge: permanent' tests/public-result.test.mjs tests/public-lookup.test.mjs tests/lifecycle.test.mjs`：13 passed、0 failed。
- `npm run typecheck`、`npm run lint`、`npm run build`：已通過；最終改動以完整 CI 再驗證。
- 瀏覽器：查詢表單六欄、鍵盤提交安全錯誤、清除條件及 390px 單欄／無水平溢出；獨立虛構資料 harness 驗證成績表、趨勢與家長／學生版本切換。這不是正式平台測試，也不使用真實學生資料。
- 文件、格式、安全掃描與完整回歸驗證中。

## 六、安全性檢查與殘餘風險

姓名與生日不是監護關係證明，知道條件者仍可能查到個人成績；不新增帳號／查詢碼是目前核准範圍，正式公開前仍須 §24／Phase 16 威脅審查。分散式 IP、多人共用網路、已知生日與小班群體統計仍有殘餘風險；本次未宣稱消除。

回應 no-store／private、noindex／nofollow／noarchive、no-referrer；查詢條件不進 URL、分析事件或應用程式 log。表單在 JavaScript 未啟用時仍使用 POST，避免瀏覽器退回 GET 暴露條件。公開 DTO 不含學生／參與／班級內部 ID、全年段個人名次或其他學生名單。瀏覽器已顯示資料無法遠端撤回，清除介面不能保證清除作業系統／瀏覽器自行保存的副本。

## 七、已知限制

- `PUBLIC_LOOKUP_VERIFIED` 預設 false；必須驗證平台確實覆寫可信 `CF-Connecting-IP`、請求／回應紀錄不保存個資，並確認限流清理排程後才可設定 true。不得只信任客戶端 X-Forwarded-For。
- `PUBLIC_LOOKUP_HMAC_SECRET` 為獨立高熵 Secret（至少 32 字元），不得沿用身分證金鑰。來源 IP 不明、Secret 缺少或限流儲存失敗均拒絕查詢。
- 每次請求清除滿 24 小時紀錄；`cleanupLookupLimits` 供平台至少每小時呼叫，提早清除滿 23 小時紀錄，以符合最多 24 小時。排程／備份刪除能力尚未實測，故正式入口維持關閉。Production preflight 必須確認備份也符合保存邊界。
- Purge 清除共用限流紀錄會重設短期額度；僅既有受控 Purge 能觸發，並非公開 API。正式 Purge 仍依既有平台能力限制停用。
- 部分歷史輸入已清理時，不重算相關群體或學期平均；其他學生既有排名保持不變。原校紀錄另表呈現。
- 未做正式 OAuth、真實資料、付費 AI 或 Sites 部署；沒有新增家長登入、查詢碼或自動公開。

## 八、下一 Phase 預計工作

Phase 14：Admin UI 與既有管理 API 整合，須另獲使用者批准。
