# D1 建置與復原作業紀錄

更新日期：2026-10-02。業務及驗收規則以 [PROJECT_SPEC §66](../PROJECT_SPEC.md#spec-66) 為準；本文件是執行流程與證據，不另訂政策。

## 已執行的初次建置

使用者已授權正式部署及 D1 流程建置。部署前以 Sites 工具確認既有專案 active／owner／custom、版本 0、DB binding／tables 空，無省略或截斷。未建立第二個 Site，未更改受眾，未寫入學生或測試 seed。

- Site：`appgprj_6ab31085ee6481918d7a5dd51124b085`。
- Site source commit：`7001efb7de42cf749559da11c857e4853b3a4abf`（獨立發布來源庫；不是 GitHub 主庫的 commit）。
- 版本：`appgprj_6ab31085ee6481918d7a5dd51124b085~appgver_8ff155ea169481919675a820e7b44de7`，版本號 1。
- Deployment：`appgdep_6abee70a9f8c8191b584f667a51933d2`，`succeeded`，2026-10-02 07:05:55 Asia/Taipei。
- Archive SHA-256：`034a068e38091ae729ff0114b647aa49383b81406176245f27be7f21acba3c73`，16,250,880 bytes、195 files。
- [正式入口](https://classroom-aigrade-tzk.kisaraki.chatgpt.site)；custom 存取保持原樣，業務開關未開啟。

部署後 overview 確認 `DB`，並返回 50 個名稱，含 `admin_sites_bindings`、`admin_passkeys`、`auth_sites_challenges` 及兩個 FTS 名稱。工具回報無截斷／省略，但未呈現本機預期的全部 55 個關聯表／FTS 名稱，也沒有 migration history；不能以此判定正式 schema 清單完整、全部 17 筆 history hash 相符或已做完整性檢查。不得猜表名繞過工具的 overview 要求，應由平台受控 database viewer／正式能力補足。

唯讀 `admin_users` 回傳 0 列且無下一頁；`purge_control` 為 migration 建立的單一控制列，`executing_job=null`。未讀取學生列。環境 revision 2、entries 空；缺少 verified 設定時程式預設拒絕登入與公開查詢。未執行 Purge、Bootstrap、付費 AI 或真實資料匯入。

## 後續 migration 流程

1. 核對既有 Site／DB binding、目前版本與實際 history。以 [manifest](MIGRATION_MANIFEST.json) 對照 SQL SHA-256／journal timestamp；缺少 history 或已套用邊界不明時停止 schema 更新。
2. 只增加必要的新 migration；已套用 SQL、snapshot、journal 不改寫。於隔離 D1 測試空庫、已有資料升級、外鍵／不變量及授權撤銷，更新 manifest。
3. 取得並驗證備份／一致性復原點，完成 preflight、影響範圍與必要人工確認。既有部署授權不豁免新的破壞性變更審查。
4. 對核准來源完成 typecheck、相關 tests、build、Secret／client bundle 檢查，正式 workflow 推送確切 source、打包、保存版本及部署。
5. 檢查部署與 migration history。平台文件明示 SQL 在 Worker upload 前逐檔套用，Worker 發布失敗不代表 DB 未改變；不可盲目重試或用程式版本回退當作資料回復。
6. 成功後驗證授權、版本、業務不變量，更新部署紀錄與文件／Pages；部分失敗保留實際已完成邊界，使用平台受控修復流程。

本次空平台初始化依使用者新增授權執行；不得把這個例外套用至有資料的後續 migration。

## 備份與隔離復原驗收

目前連接器提供 DB overview／限定表列讀取，沒有建立備份、取得一致性復原點、隔離還原、完整 history、任意 SQL 或 backup 刪除工具。因此尚未實作或演練正式平台復原，不宣稱 RPO／RTO 達標。

平台能力可用後，演練須涵蓋 D1、R2 物件、加密／HMAC 金鑰版本與相依資料的一致性。以虛構資料驗證快照、FK、成績／排名、FTS、檔案及密文可解讀；在隔離目標復原，避免覆蓋正式 DB。记录最新一致性復原點、中斷開始及服務驗證完成時間，計算 RPO≤24 小時／RTO≤8 小時。只保存非敏感統計及結果，不將 dump、金鑰或真實資料寫入 Git。

正式服務上線前還需可信 Sites ID／來源 IP、Passkey 裝置、限流清理與備份保存承諾等 [候選 gates](RELEASE_CANDIDATE.md)。Production Purge 另須副本清點及備份刪除能力實測；目前保持停用。
