# Phase 2 驗證紀錄

日期：2026-09-23。範圍：[主規格 §48](../PROJECT_SPEC.md#spec-48) 的 Academic／Class／Enrollment Core。使用者已明確批准 Phase 2；本次只實作內部領域服務，依 §74 在隔離 D1 測試，不對外開放管理寫入。

狀態：Phase 2 內部核心與本機驗證完成。Google OAuth 平台實測依使用者指示暫緩；尚未正式部署，也未開始 Phase 3A。

## 零、模型／推理強度

- Recommended：HIGH。
- Minimum：HIGH。
- Actual：沿用使用者已確認的 HIGH 或以上設定。
- Action：KEEP；沒有宣稱自動切換。
- 沒有額外風險升級；學籍歷程、併發、撤銷與權限邊界依本 Phase 的 HIGH 要求驗證。

## 一、完成項目

| 功能               | 實作與邊界                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 學年度／兩學期     | 操作者明確指定三個日期，確認後同一交易建立年度與兩學期；新年度成為目前年度，舊年度仍可查詢且預設唯讀                |
| 班級               | 驗證 7／8／9 年級三碼代號、年度關聯及重複班級                                                                       |
| 新生單筆／批次基礎 | 單筆視為一列批次；先驗證並產生預覽，再原子保存學生、加密識別值、全部 HMAC 版本及學籍                                |
| Enrollment／座號   | 驗證學期、班級、有效日期與座號衝突；支援下一學期學籍；座號調整也保留歷程                                            |
| 升班與預覽調班     | 7→8、8→9，預設沿用班級後兩碼與座號；可指定同目標年級其他班級及座號；九年級明確略過，不自動畢業封存                  |
| 轉班               | 同年級、同學期；禁止在評量期間操作；舊有效學籍改為 voided，建立必要前段與新段，原評量仍保留原 FK 與快照             |
| 轉入               | 允許各年級的新學生，按轉入生效日建立學籍，不回補舊參與名冊或成績；既有學生識別不靜默合併                            |
| 轉出               | 保存轉出日與 3 個曆年的查詢／保存期限，關閉當下及未來學籍；不封存、不刪除既有成績                                   |
| 撤銷               | 學籍新增、轉班／座號、升班、誤標轉出的撤銷也需 Preview／Confirm，檢查提交後版本及座號衝突；保留快照，不覆蓋後續修改 |
| 歷史年度           | 只接受 super_admin、可信 Google Recent Authentication 授權結果及原因；只限當次交易，沒有持久解鎖旗標可被遺留        |

### 服務入口

[AcademicService](../site/lib/server/academic/service.ts) 提供下列內部方法，完整參數型別見 [types.ts](../site/lib/server/academic/types.ts)：

- `previewAcademicYear`、`previewClasses`。
- `previewNewStudents`：`new`／`transfer_in`；呼叫者傳入已解析的列。
- `previewEnrollments`、`previewMove`、`previewPromotion`、`previewTransferOut`、`previewUndo`。
- `confirm(previewId, { confirmed: true })`。
- `listAcademicYears`、`classRoster`。

沒有新增管理路由、後門測試登入或讓用戶端提交任意 SQL／Plan 的入口。服務的 DB、authorize 與 Secret key provider 都由可信伺服器程式注入；Phase 3A／3B 前只有測試 adapter，未設定 authorize 時預設拒絕。此介面不是 Google OAuth 實作，不能把 mock grant 當作正式登入。

### 確認、版本與撤銷

Preview 保存來源 revision、操作者、資源範圍、原因及伺服器建立的不可改寫計畫；回傳預覽只含所需欄位，身分證顯示遮罩。Confirm 只接受 Preview ID 與明確確認，重新呼叫授權介面，核對 actor、Session、來源 revision 及 key 版本；D1 trigger 在交易內再次檢查 Session 與 revision，避免檢查後才被撤權的競態。

全校學籍相關資料共用 revision，採保守的樂觀併發控制：其他班級的相關修改也可能使舊 Preview 失效，需重新預覽，不會靜默使用舊資料。每次成功操作將業務資料、receipt、學生關聯、Audit 與 Preview 清理放在同一 D1 batch。相同 Preview 同時／重複 Confirm，只產生一筆操作與 Audit，重試可讀取既有 receipt。寫入失敗時不保留部分結果，也不輸出含學生欄位的原始 SQL 錯誤。

已確認 Preview 的 payload 會原子清為 `{}`；一般建立操作的 receipt 不保存姓名、生日或身分證副本。可撤銷操作只保存學籍欄位與狀態／期限／版本變更；Audit 不保存學生姓名、生日或密文。尚未確認的 Preview 仍可能含建檔資料，必須受相同授權保護；正式啟用前需在 Phase 6／9 的保存與 Purge 設計納入這些副本。

撤銷先將該操作新增的學籍片段改為 voided，再恢復原紀錄並遞增版本。已建立的評量、成績、排名／AI 版本都不改寫。若學生或學籍在提交後已有其他修改，或原座號已被占用，就拒絕撤銷；不能用復原承諾覆蓋後續合法資料。

## 二、新增檔案

- [service.ts](../site/lib/server/academic/service.ts)：學年度、學生、學籍、Preview／Confirm 與撤銷領域服務。
- [types.ts](../site/lib/server/academic/types.ts)：可信授權介面、輸入、預覽、receipt 及錯誤型別。
- [academic.test.mjs](../site/tests/academic.test.mjs)：生命週期、併發、權限、歷史不變量及升級測試。
- [0002_phase_02_academic_commands.sql](../site/drizzle/0002_phase_02_academic_commands.sql)：四張命令／revision 資料表。
- [0003_phase_02_academic_guards.sql](../site/drizzle/0003_phase_02_academic_guards.sql)：revision、Session、Preview／receipt 約束。
- [0002_snapshot.json](../site/drizzle/meta/0002_snapshot.json)、[0003_snapshot.json](../site/drizzle/meta/0003_snapshot.json)：新的 migration metadata。
- 本 [PHASE_2.md](PHASE_2.md)：交付與驗證紀錄。

## 三、修改檔案

- [schema.ts](../site/db/schema.ts) 與 [journal](../site/drizzle/meta/_journal.json)：新增四張表，保留原表及既有 migration。
- [migrations.test.mjs](../site/tests/migrations.test.mjs)：驗證完整四份 migration、33 張關聯表；沿用原有 Phase 1 邊界案例。
- [PROJECT_SPEC.md](../PROJECT_SPEC.md)：Phase 2 授權與實作契約。
- [README.md](../README.md)、[CHANGELOG.md](../CHANGELOG.md)、[site/README.md](../site/README.md)、[DATABASE.md](DATABASE.md)：現況、服務與 schema 說明。
- [首頁](../site/app/page.tsx)、[health route](../site/app/api/health/route.ts)、[Pages](../pages/index.html)：更新階段標示。

沒有新增 dependency 或修改 CI 權限。Phase 0／1 驗證報告保留當時的測試數量與 migration 數量。

## 四、Database Migration

新增 0002／0003，原 0000／0001 SQL 與 snapshots 保持不變。現有 schema 為 33 張關聯表加 FTS5，四張新表如下：

| 表                            | 用途                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `academic_state`              | singleton：目前年度與全域 revision                                   |
| `academic_previews`           | actor、來源 revision、scope、待確認計畫與原因                        |
| `academic_operations`         | 唯一 Preview receipt、Session、前後 revision、可撤銷變更與 undo 關聯 |
| `academic_operation_students` | 操作與學生的可追蹤 FK 關聯，供後續保存／Purge 檢查                   |

初次升級時，目前年度以既有年度的建立時間、開始日期與 ID 排序選定；空 DB 為 NULL。這只用於既有 schema 升級初始化，日後依新年度建立操作更新。現有專案沒有真實學生資料；未來正式 migration 前仍應人工核對目前年度與部署前 preflight。

本機測試會先只套用 Phase 1 的兩份 migration、寫入虛構 seed，再升級 Phase 2，逐筆確認學生、學籍、參與及成績未被改寫。所有執行限於隔離 Miniflare D1；沒有執行 Production migration，也沒有新增啟動時自動 migration。

## 五、測試結果

在 `site/` 執行；根目錄命令另註：

| 命令                                                                   | 結果                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm test`                                                             | 56 項通過，0 失敗、0 略過                                                            |
| `node --import ./scripts/sites-env.mjs --test tests/academic.test.mjs` | 最後補上 receipt revision 一致性後，28 項學籍測試再次全部通過                        |
| `npm run lint`                                                         | 通過                                                                                 |
| `npm run typecheck`                                                    | 通過                                                                                 |
| `npm run format:check`                                                 | 通過                                                                                 |
| `npm run db:verify`                                                    | 初次 4 份 migration 全部套用；重跑 0 份待套用，外鍵與 quick check 通過，4 位虛構學生 |
| `npm run db:generate -- --name phase_02_drift_check`                   | 33 張關聯表；No schema changes，沒有額外 migration                                   |
| `npm run build`                                                        | 通過；僅 `/` 與 `/api/health` 兩個路由                                               |
| 根目錄 `node scripts/check-docs.mjs`                                   | 9 份專案 Markdown、189 個本機連結通過                                                |
| 根目錄 `node scripts/check-safety.mjs`                                 | 139 份來源檔案通過既定 Secret／識別碼規則及 Pages 靜態內容檢查                       |
| 根目錄 `git diff --check`                                              | 通過                                                                                 |

另以 Node 比對建置產物：四份 SQL 與 journal 均與來源逐位元組一致；檢查 11 份前端產物，未含學籍服務、Preview 表或身分識別工具的指定伺服器端標記。原 0000／0001 migration 與 snapshots 無差異。上述掃描為指定規則檢查，不等於完整安全稽核。GitHub 的提交後 CI 與 Pages 結果以該 commit 的 [Actions 紀錄](https://github.com/kisaraki/classroom-aigrade-tzk/actions) 為準。

Windows 使用已安裝的 npm CLI 路徑執行命令，沒有重新安裝套件。必要案例涵蓋：兩學期、歷史唯讀、Recent Authentication 介面、同名同生日、正規化查重、遮罩／密文、不完整提交回復、重送、併發、actor 與 Scope、交易內 Session 撤銷、升班手動調班、九年級略過、轉班及座號、晚轉入、不回補成績、轉出期限、撤銷衝突，以及既有 DB 升級。

## 六、安全性檢查

- 僅使用虛構學生／管理員與 `example.test`，Secret key 在測試記憶體產生。
- 學生身分識別正規化後，以 Phase 1 的 AES-GCM／HMAC 工具保存；Preview 不保存原始身分證，確認後清除待建檔 payload。
- 未配置 authorize 預設拒絕，讀取與寫入皆經授權介面；確認時重驗範圍、Session 與資料 revision，歷史寫入另要求 super_admin／Recent Authentication／原因。
- 管理員認證仍僅 Google；沒有新增 ChatGPT／Gemini 認證、本地密碼或真實登入流程。
- 所有服務測試在本機；未接真實 AI，未寫雲端 DB，未正式部署 Sites。

## 七、已知限制

- Google OAuth／OIDC、Recent Authentication 時窗及完整 Role／Permission／Scope 政策仍由 Phase 3A／3B 實作；目前沒有對外管理 API。測試中的可信授權 adapter 只驗證服務介面與交易邊界，不能代替正式身分驗證。
- Excel／CSV 解析、範本與完整 Import Job／30 天 Rollback 屬 Phase 6；Phase 2 只處理已解析列的建檔基礎，不提供貼上 Excel UI。
- 目標班級須預先建立；升班不處理九年級畢業。若來源仍有未關閉的歷史學籍，修正會要求相同歷史年度授權。
- 轉班後續評量若已有凍結名冊，需先於對應評量流程處理；不修改快照來強行通過。未來日期轉出排程尚未提供。
- 已有其他保存事件／延長期限的轉出與真正跨事件恢復學籍，維持 D-05 關卡；誤標轉出只在沒有後續衝突時精確撤銷。
- 待確認 Preview 的到期清理、Production key ring 協調／備份與平台 recovery，須於正式啟用前完成。D1 本機結果不能代表雲端已通過。

## 八、下一 Phase 預計工作

下一個是 [Phase 3A](../PROJECT_SPEC.md#spec-49)：Google OAuth／OIDC、Bootstrap、Session、授權 Email 與 Google 綁定。Google Client 設定與平台 callback／Cookie 實測先前依使用者指示暫緩，Phase 3A 前需補足；本次沒有啟動 Phase 3A。
