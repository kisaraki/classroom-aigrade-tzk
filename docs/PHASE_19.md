# Phase 19 — 正式部署前紀錄

日期：2026-10-01（Asia/Taipei）。狀態：**部分完成／受阻，尚未部署**。業務規則仍以 [主規格 §66](../PROJECT_SPEC.md#spec-66) 為準。

## 零、授權與模型

使用者明確回覆「確認正式部署」，正式部署授權已取得並持續有效，不重複要求同一授權。Recommended／Minimum XHIGH；Current XHIGH（沿用先前使用者確認）、KEEP，無額外風險升級。授權涵蓋按既定順序完成正式部署，不等同略過 DB 身分、migration preflight／人工確認、recovery 或其他適用驗收。

開始時本機 HEAD 82479ad，工作目錄乾淨。runtime／tests 仍為 Audit 補做 850aa9d；Phase 18 最新全套 282 項通過，沒有 runtime／schema／dependency 變更，不重跑已適用的測試／建置。

## 一、實際部署前查核

| 查核                            | 結果與意義                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sites get_site                  | 既有專案 active、目前使用者 owner、custom 存取；版本 0，live／preview／expected_url 均 null。未建立新專案或更改 audience。                                                                   |
| Sites read_database_overview    | bindings／tables 空；無省略／截斷。尚無可確認的正式 DB／history，不可假定本機 disposable DB 是 Production。                                                                                  |
| Sites get_environment_variables | revision 2，entries 空。未配置 Google／Bootstrap／Recovery／identity／HMAC／AI 等 runtime 名稱；沒有讀取／輸出 Secret 值。                                                                   |
| Sites 工具能力盤點              | 可用工具只提供 DB overview／table rows，未提供 DB 預先配置、migration preflight／執行、history 或備份／隔離復原操作。工具未提供不代表平台永遠不支援；需先取得平台受控流程與實測證據。        |
| 平台 plugin 文件                | persistence-and-storage.md 說明 migration 在 Worker upload 前逐檔套用／記錄，發布失敗可能仍已套用部分 SQL。這是文件描述，不是本專案正式實測，不能以部署成功／失敗代替 preflight 或資料復原。 |

只查 metadata 與環境設定名稱／空列表，沒有讀取學生列、Worker logs、外部帳號資料或本機 Secret；未執行平台寫入、migration、Purge、付費 API 或 deployment。

## 二、具體阻擋與所缺資訊

1. Google OAuth Client 先前暫緩，使用者尚未回覆現在是否已建立。正式 Sites 環境目前沒有 Google 設定；需透過平台 Secret 設定 Client Secret，核對精確 callback 及 D-09 帳號政策，再驗證 Google-only 登入、Recent Authentication 與 Cookie。不能用 mock 登入上線。
2. 需平台提供能先確認正式 DB／history、完成 preflight、migration 人工確認與備份／隔離復原的受控方式。不能在查核能力缺失時直接觸發會套用 SQL 的部署，或把新 DB 當作已驗證 RPO／RTO。保存目標 RPO≤24 小時／RTO≤8 小時尚未實測達標。
3. 其他適用 gates 沿用 [候選阻擋與驗收步驟](RELEASE_CANDIDATE.md)：其餘 UI／報表、可信 IP／限流清理與副本保存、AI consumer、Purge 副本能力與正式容量。verified 保持關閉，Purge 停用；授權不代表這些結果已通過。

必要環境及流程未備妥，停在正式 DB 確認／preflight 之前。不能靠改寫報告、推送程式或私有發布解除上述阻擋。未請求重新批准部署；Google Client 的提問只為取得尚缺資訊。

## 三、檔案、Migration 與驗證

新增本紀錄；修改主規格 §66、RC 授權狀態、README 與 CHANGELOG。無程式、schema、SQL、套件或 Secret 變更。Production migration／recovery／正式 smoke 未執行，原因見前節；保留 Phase 18 全套 282 與同一 runtime build 的成功證據，不宣稱正式平台驗證通過。

本輪文件最終驗證：npm run format:check 通過；node scripts/check-docs.mjs 驗證 29 份文件／490 個本機連結通過；node scripts/check-safety.mjs 掃描 346 份原始檔未發現指定敏感模式，非完整安全稽核；git diff --check 通過。不以本機測試替代 Production。

## 四、發布狀態

Release／正式版本：無。Sites URL：無。沒有 Sites 成功部署，因此不使用 DEPLOYED_WITH_DOC_SYNC_ERROR；未執行此輪 GitHub／Pages 發布或建立 tag／Release。既有 Repository／Pages 的 Phase 13 線上內容不是本輪部署結果，不提供未驗證的正式系統網址。

前置條件完成後，沿既有授權接續 §66 流程，再回報真正的部署版本與三個驗證網址；本輪不標為 Phase 19 完成。
