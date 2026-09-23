# Phase 3B 驗證紀錄

日期：2026-09-24。範圍：[主規格 §50](../PROJECT_SPEC.md#spec-50) 的 Authorization／Roles／Scopes。接續使用者於 2026-09-23 已核准、因額度中斷的 Phase 3B；D-01／D-10 核准有效，本輪另核准 D-11 的兩個 5 分鐘時窗。

狀態：Phase 3B 已完成本次核准的本機實作與驗證。Google OAuth Client、auth_time 與 Sites callback／Cookie 的真實平台驗證仍依 D-09 暫緩。沒有 Production migration 或 Sites 部署，沒有啟動 Phase 4。

## 零、模型／推理強度

- Recommended：XHIGH；Minimum：HIGH。
- Actual：GPT-6 Astra／XHIGH，由本回合紀錄確認。
- Action：KEEP；無自動切換，未額外升級。

## 一、完成項目

- 主規格同步最小權限矩陣及 D-01／D-10 的已核准規則；Google Recent Authentication 與一次性 Recovery 核准均 5 分鐘，滿時失效。
- AuthorizationService 從資料庫驗證目前帳號、Session、Permission、學期、日期、年級、班級、科目與學生範圍。導師班可全科；任課教師的班級與科目須同時符合；混合批次全部目標均須通過。
- 歷史讀取使用有效日期與既有評量參與快照，不依學生目前班級。歷史寫入另要求 super_admin、Recent Authentication 與原因。
- 管理員新增／啟用／停權、角色與 Scope 變更、強制登出皆由伺服器 super_admin 處理；明確確認及目標 auth_version 防止靜默覆寫。
- 帳號修改、Assignment 置換、Session 撤銷與 Audit 同批提交；交易內再次驗證操作者及目標版本。最後 active super_admin 與保留 admin 的資料庫防護繼續生效。
- Rebind 預先核准 Email、目標版本與操作人，使用一次性 requestToken 啟動 Google OAuth；callback 驗證新身分、操作人仍有效且近期驗證、request 尚未過期／消費。
- Recovery 只透過受控伺服器維護入口核准，需 Recovery Secret、確認、目前版本與非敏感核准／證據參照。完成時仍需新 Google 身分符合核准 Email，撤銷舊 Sessions 並記錄 Audit；不能重開 Bootstrap。
- Google reauthentication 綁定原瀏覽器 Session，檢查同一 subject／Email。使用已驗證 ID token 的 auth_time，缺少、未來或過期時間拒絕高風險操作；不以 token 新發時間取代驗證時間。
- 新增 HTTP 邊界拒絕缺少／跨來源 Origin、非 JSON、未知欄位、偽造身分、過大請求與未授權管理員；回應設 no-store。

Google auth_time 的請求／claim 定義依 [官方 OIDC Reference](https://developers.google.com/identity/openid-connect/reference)；D1 batch 的原子交易依 [Cloudflare D1 文件](https://developers.cloudflare.com/d1/worker-api/d1-database/)。文件能力與本機 mock／Miniflare 實測分開；未宣稱真實 Google 或 Sites 已通過。

## 二、新增檔案

- [authorization.ts](../site/lib/server/auth/authorization.ts)：角色、Permission、Scope 與日期／快照驗證。
- [admin-management.ts](../site/lib/server/auth/admin-management.ts)：管理員異動、一次性 Rebind／Recovery、原子提交。
- [policy.ts](../site/lib/server/auth/policy.ts)：5 分鐘政策與 Google 驗證時間檢查。
- [http.ts](../site/lib/server/auth/http.ts)：可注入並可測試的 HTTP／CSRF／JSON／Session 邊界。
- [admin routes](../site/app/api/admin/users)：清單、建立、修改、Rebind 核准及強制登出。
- [reauth start](../site/app/api/auth/reauth/start/route.ts)、[identity start](../site/app/api/auth/identity/start/route.ts)：Google 重新驗證／身分異動入口。
- [0006 migration](../site/drizzle/0006_phase_03b_authorization.sql) 及 [snapshot](../site/drizzle/meta/0006_snapshot.json)。
- [authorization.test.mjs](../site/tests/authorization.test.mjs)：授權、到期、交易、Recovery／Rebind、HTTP 與升級回歸測試。
- 本驗證紀錄。

## 三、修改檔案

- [PROJECT_SPEC.md](../PROJECT_SPEC.md)、[README.md](../README.md)、[CHANGELOG.md](../CHANGELOG.md)、[DATABASE.md](DATABASE.md)、[site README](../site/README.md)、[Pages](../pages/index.html)。
- [schema.ts](../site/db/schema.ts)、[migration journal](../site/drizzle/meta/_journal.json)、[cloudflare-env.d.ts](../site/cloudflare-env.d.ts)。
- [auth service](../site/lib/server/auth/service.ts)、[OIDC client](../site/lib/server/auth/google-oidc.ts)、[runtime](../site/lib/server/auth/runtime.ts)、[types](../site/lib/server/auth/types.ts)、[callback](../site/app/api/auth/google/callback/route.ts)。
- [auth tests](../site/tests/auth.test.mjs)、[academic tests](../site/tests/academic.test.mjs)、[migration tests](../site/tests/migrations.test.mjs)、[local migration preflight](../site/scripts/db-local.mjs)。

## 四、Database Migration

- 35 張關聯表加 FTS5，共 7 份 migration。新增 auth_identity_requests；OAuth state 新增操作 Session／request 欄位；Session 新增 recent_auth_at，既有值預設 0。
- 0006 是先前中斷時尚未提交／未部署的 migration，已先備份再重新產生；0000～0005 SQL 與 snapshots 保持不變。
- 將 generator 的 OAuth state 重建 SQL 改為 D1 相容的新增欄位與用途 trigger，避免刪表。實際 schema 欄位／索引與生成 snapshot 對照及 drift 檢查納入驗證。
- 從 Phase 3A 的六份 migration 升級，確認原 OAuth state 不變；驗證重跑、外鍵、quick check、失敗回滾與 request 併發只消費一次。
- 回退應用程式不等同回退 schema；保留相容的新增欄位。正式套用前仍須備份／復原計畫與人工確認；本次只操作隔離 Miniflare DB。

## 五、測試結果

指令於 `site/` 執行，文件／安全檢查指令由專案根目錄執行。

| 指令                                                  | 結果                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `npm test`                                            | 73 項通過，0 失敗、0 跳過；含既有 Phase 0～3A 與新增 Phase 3B 回歸 |
| `npm run typecheck`                                   | 通過                                                               |
| `npm run lint`                                        | 通過                                                               |
| `npm run build`                                       | 通過；Vinext Worker／client 產物及管理 API 路由建立成功            |
| `npm run db:generate -- --name phase_03b_drift_check` | 35 張表，沒有 schema 差異，未產生多餘 migration                    |
| `npm run db:verify`                                   | 7 份 migration 套用／重跑成功，外鍵與 integrity 通過，4 位虛構學生 |
| `npm run format:check`                                | 通過                                                               |
| `node scripts/check-docs.mjs`                         | 通過                                                               |
| `node scripts/check-safety.mjs`                       | 169 個來源檔通過既定規則；Pages 保持靜態                           |
| `git diff --check`                                    | 通過                                                               |

升級案例從 Phase 3A 六份 migration 與既有 OAuth state 起始，成功套用第七份且保留原資料。交易案例涵蓋目標版本競爭、操作者撤權、同時停權兩位 super_admin，以及同一 Recovery 核准併發消費只成功一次。

測試全部使用虛構帳號、Google subject、Email、Secret、學生 seed 與程序內產生的金鑰；沒有對 Google 或真實 AI 發送請求。

## 六、安全性檢查

- 各管理 API 從 cookie 驗證 Session；不信任前端 role／Email／Google identity。管理員名單只限 super_admin，不輸出 Google subject 或 token。
- 範圍缺漏、跨班、跨科、跨學期、學生 ID 與班級矛盾、混合批次及失效日期都拒絕。
- 帳號或 Scope 變動撤銷舊 Sessions；guard 防止驗證後才被撤權仍提交。
- 已簽署 Google auth_time 與已核准 request 的效期分別檢查；Recovery Secret 無法單獨登入；公開 route 不可核准 Recovery。
- D1 只保存一次性 request token hash；Recovery Secret、OAuth code／token、cookie 與 Session 原值不寫入 Audit 或 request 表。
- 沒有新增本地密碼、ChatGPT／Gemini 認證；AI provider 不參與管理員認證。

- 前端 14 個產物檔未發現受檢查的伺服器認證模組／Secret 名稱；Worker 產物具有 default fetch 入口。此項僅為靜態產物檢查。

## 七、已知限制

- Google OAuth Client、auth_time claim 的實際可用性及 Sites callback／Cookie、平台存取政策仍待 D-09。缺少有效 auth_time 時一般登入可成立，高風險操作拒絕。
- Recovery 核准的 Production 維護執行環境與證據保存政策須在正式啟用前確認；本 Phase 提供受控服務入口及隔離測試，不建立公開維護端點。
- 管理 UI 尚未建立；學籍／成績 API 尚未對外開放。後續 route 必須由伺服器解析實際資源並使用授權服務，寫入交易仍須重驗；不可把前端傳入 Scope 當作授權證明。
- 匯入、發布、AI、封存／Purge、報表尚屬後續 Phase。本 Phase 的 Permission 名稱不代表這些功能已實作。
- 本機安全掃描是既定規則及相關程式審查，不等同完整滲透測試或 Production 認證。

## 八、下一 Phase 預計工作

[Phase 4](../PROJECT_SPEC.md#spec-51)：評量、科目、特殊狀態、成績來源與快照，以及分數範圍／NOT_HELD 驗證。等待使用者確認 Phase 3B 後才開始。
