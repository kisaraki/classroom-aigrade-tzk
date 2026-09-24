# Phase 5 驗證紀錄

日期：2026-09-24。使用者核准啟動 Phase 5，並逐項核准 D-04；範圍為 [主規格 §52](../PROJECT_SPEC.md#spec-52)。狀態：Phase 5 本機平均與排名核心實作及驗證完成。沒有開始 Phase 6，沒有 Production migration 或 Sites 部署。

## 零、模型／推理強度

- Recommended：XHIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，沿用本任務已確認設定。
- Action：KEEP；符合 Minimum，未另行升級。

## 一、完成項目

- D-04 三項決策同步正文、待決策表及驗收示例。完全無有效分數時平均與總分為 NULL、不排名；實際 0 分有效。有數值科目總分優先於缺值，雙缺值續比。
- 使用百分之一分整數與 BigInt 中間運算，原始分數加總後單次四捨五入；檢測、段考、定評與學期平均不使用平均的平均。總分超過安全整數時拒絕輸出失真數值。
- 比序依定評平均（兩位小數）、總分、國文、英文、數學；完全相同採 1／2／2／4。班級與全年段共用比較函式，分組使用當次班級及年級快照。
- 排名只包含 LOCAL、快照合格且至少一筆有效成績者；排除排名者仍保留個人成績。原校成績另列，不混入本校排名或群體人數。
- 統計分開列示開始日在籍、LOCAL 參與、快照合格、實際排名人數；各指標列有效學生數、有效分數筆數與最高平均。一般母體含不排名但有分數者，排名母體僅合格且有分數者。
- PROVISIONAL 計算只使用 QUIZ，FINAL 使用 QUIZ＋MIDTERM。回傳明確計算版本、評量來源版本、學年度及學期；這些模式不是發布狀態轉換。
- 內部 RankingService 重驗實際 Session、score.read、班級／年級全科 Scope。D1 batch 一致讀取成績／快照／有效日期學籍，讀後再檢查授權與來源版本。班級模式不輸出全年段名次，單科權限不得取得全科排名。
- 不查目前學生班級或資格來重建歷史排名；轉班、轉出、畢業、目前排名預設變更不影響快照結果。所有返回欄位由允許清單建立。

## 二、新增檔案

- [averages.ts](../site/lib/domain/averages.ts)：精確平均與可空總分。
- [ranking.ts](../site/lib/domain/ranking.ts)：定評／學期計算、比序、分組及統計母體。
- [ranking-service.ts](../site/lib/server/exams/ranking-service.ts)：具授權與來源版本檢查的內部唯讀介面。
- [averages.test.mjs](../site/tests/averages.test.mjs)、[ranking.test.mjs](../site/tests/ranking.test.mjs)、[ranking-service.test.mjs](../site/tests/ranking-service.test.mjs)。
- 本驗證紀錄。

## 三、修改檔案

- [主規格](../PROJECT_SPEC.md)、[CHANGELOG](../CHANGELOG.md)、[README](../README.md)、[開發說明](../site/README.md)。
- [本機預覽首頁](../site/app/page.tsx)、[Pages 文件首頁](../pages/index.html)：同步進度文案。

## 四、Database Migration

本次沒有 schema 或資料寫入變更，不新增 migration。維持 37 張關聯表與 8 份 migration；完整回歸包含既有 migration、外鍵及升級測試。RankingService 不寫入 exam_result_versions／exam_results，測試確認讀取計算不產生發布版本。

Production migration、備份復原與部署 URL 檢查不適用於本次本機計算實作。

## 五、測試結果

測試先於實作：平均、排名引擎、內部服務測試各先因缺少模組失敗；總分擴充則先取得缺少 totalHundredths 的失敗斷言，再加入實作。

| 指令                                                                          | 結果                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| `node --test tests/averages.test.mjs tests/ranking.test.mjs`                  | 18 項通過                                              |
| `node --import ./scripts/sites-env.mjs --test tests/ranking-service.test.mjs` | 3 項通過，使用隔離 Miniflare 與虛構資料                |
| `npm test`                                                                    | 105 項通過、0 失敗、0 跳過；包含既有 84 項及新增 21 項 |
| `npm run typecheck`                                                           | 通過                                                   |
| `npm run lint`                                                                | 通過                                                   |
| `npm run format:check`                                                        | 通過                                                   |
| `npm run build`                                                               | 通過                                                   |
| `node scripts/check-docs.mjs`                                                 | 通過                                                   |
| `node scripts/check-safety.mjs`                                               | 通過                                                   |
| `git diff --check`                                                            | 通過                                                   |

§44 對照：前六項由平均／總分／國英數／共同名次測試涵蓋；第七至十一項由排除、特殊狀態、NOT_HELD 及兩種計算模式涵蓋；第十二至十五項由快照、資料庫生命週期及原校來源測試涵蓋；第十六、十七項由班級／年級分組與兩位小數邊界測試涵蓋。

另測重複學生／參與／科目、跨學期學期平均、無效來源及科目組合、輸入不變性、各統計分母、偽造角色、跨班／跨年級及單科越權、撤銷 Session、計算中來源競爭。

## 六、安全性檢查

- 沒有新增公開或管理 HTTP route；純函式不構成授權入口。內部服務必須取得實際 Session 並通過既有 RBAC／Scope。
- 班級回應無 gradeRank、grades 或其他班級資料；原校個人成績未加入班級／全年段服務回應。前端預覽僅有靜態進度文案。
- 測試均使用虛構身分、成績及程序內測試 Secret，不呼叫 Google 或 AI。
- 計算來源改變回報 CALCULATION_SOURCE_CHANGED；授權失效拒絕回應，無快取或持久副作用。

## 七、已知限制

- Phase 5 交付計算引擎與內部唯讀 adapter，尚未建立排名 HTTP API／UI。班級／全年段公開平均等顯示整合屬後續公開端工作，本次統計輸出涵蓋核准母體、人數及最高平均。
- 未儲存或發布結果；公開可見版本、D-08 狀態轉換、原子結果保存與重算失敗處理屬 Phase 7。發布交易必須重驗 sourceVersion／sourceRevision，不能把讀後檢查當成寫入鎖。
- 內部預覽的在籍人數依目前資料庫中評量開始日有效學籍解析，不使用今日在籍或學生目前狀態；發布時須一併持久保存統計快照，不能日後以學籍重建已發布統計。
- 真實 Google OAuth／Sites callback 與 Production 平台能力依 D-09 仍暫緩。本階段驗證不代表正式系統可用。

## 八、下一 Phase 預計工作

Phase 6 為 Import Engine：Upload → Parse → Validate → Map → Preview → Confirm → Commit，以及完整 30 天 Rollback；啟動前須使用者授權並定案 D-07 及相關上傳門檻。本次不開始 Phase 6。
