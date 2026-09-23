# Phase 3A 驗證紀錄

日期：2026-09-23。範圍：[主規格 §49](../PROJECT_SPEC.md#spec-49) 的 Admin Bootstrap、Google OAuth／OIDC、授權 Email、Google subject 綁定、登入／登出與 Session。使用者已明確批准 Phase 3A；本次只完成認證核心與本機驗證，不進行 Sites Production 部署。

狀態：Phase 3A 程式核心完成。OAuth Client、Google callback／Cookie 的 Sites 實際設定與登入實測，因使用者先前表示目前沒有 Client 設定而暫緩；本機虛構測試不代表 Google 或 Sites Production 已通過。

## 零、模型／推理強度

- Recommended：HIGH。
- Minimum：HIGH。
- Actual：沿用使用者已確認的 HIGH 或以上設定。
- Action：KEEP；沒有宣稱自動切換。
- 沒有額外風險升級；OAuth callback、Session 與 Bootstrap 競態依本 Phase 的 HIGH 要求驗證。

## 一、完成項目

- Google OIDC discovery：只接受 Google issuer 與 HTTPS discovery endpoints。
- ID token 驗證：RS256、`kid`／JWKS、issuer、audience／`azp`、`iat`／`exp`、nonce、subject、Email 與 `email_verified`。
- Authorization Code flow：`state`、`nonce`、PKCE S256、固定 redirect URI、一次性 callback state。
- 一次性 Bootstrap：提交 `ADMIN_BOOTSTRAP_SECRET` 後才能建立 bootstrap OAuth state；callback 必須再次完成 Google 驗證，建立固定 `username = admin`、`super_admin` 與第一個 Session。
- 授權清單：authorized email 正規化後比對；pending identity binding 首次合法 Google 登入才轉 active；已綁定帳號要求 subject 一致。
- Session：D1 只保存 SHA-256 token hash；HttpOnly、Secure、`__Host-`、SameSite=Lax cookie；idle／absolute timeout、auth version、帳號狀態與 revoke 檢查。
- Routes：Google start／callback、Bootstrap start、Session 查詢、POST logout；未建立本地密碼或 ChatGPT／Gemini 認證路由。

OIDC 驗證契約依 [Google OIDC API Reference](https://developers.google.com/identity/openid-connect/reference) 與 [Google Web Server OAuth 指南](https://developers.google.com/identity/protocols/oauth2/web-server) 實作；Google 官方要求伺服器驗證 ID token 簽章、issuer、audience、效期，並使用 state 防止 callback CSRF。本機未呼叫 Google。

## 二、新增檔案

- [auth/types.ts](../site/lib/server/auth/types.ts)：OIDC、Session、OAuth state 與錯誤型別。
- [auth/cookies.ts](../site/lib/server/auth/cookies.ts)：`__Host-` cookie 建立、清除與解析。
- [auth/google-oidc.ts](../site/lib/server/auth/google-oidc.ts)：discovery、PKCE URL、token exchange、JWKS／RS256 驗證。
- [auth/service.ts](../site/lib/server/auth/service.ts)：Bootstrap、登入、綁定、Session、logout 與 Audit。
- [auth/runtime.ts](../site/lib/server/auth/runtime.ts)：Cloudflare env／D1／Secret 注入邊界。
- [auth routes](../site/app/api/auth)：Google、Bootstrap、Session、logout routes。
- [auth.test.mjs](../site/tests/auth.test.mjs)：OIDC、Bootstrap、Session、callback replay 與 Google-only 測試。
- [0004_phase_03a_auth_states.sql](../site/drizzle/0004_phase_03a_auth_states.sql)：短期 OAuth state hash 表。
- [0005_phase_03a_bootstrap_state_purpose.sql](../site/drizzle/0005_phase_03a_bootstrap_state_purpose.sql)：login／bootstrap 用途欄位與 trigger。

## 三、修改檔案

- [schema.ts](../site/db/schema.ts)、migration journal／snapshot：新增 `auth_oauth_states`，現有帳號與 Session 表保持相容。
- [migrations.test.mjs](../site/tests/migrations.test.mjs)：更新六份 migration 與 34 張關聯表驗證。
- [cloudflare-env.d.ts](../site/cloudflare-env.d.ts)：宣告 OAuth／Bootstrap Secret bindings。
- [health route](../site/app/api/health/route.ts)、README、DATABASE、Pages、CHANGELOG 與主規格：同步 Phase 3A 狀態與限制。

## 四、Database Migration

現有 schema 為 34 張關聯表加 FTS5，共六份 migration。`auth_oauth_states` 保存 state／nonce／PKCE verifier 的 hash、用途、期限與一次性消費時間；不保存 OAuth code、ID token、Session token 或 Bootstrap Secret。0005 採 additive `ALTER TABLE` 加用途 trigger，保留既有短期 state，沒有重建或刪除既有業務表。

沒有執行 Production migration；本機 migration 可從空資料庫重播，也可在既有 Phase 2 資料庫上升級。正式執行前仍須人工 preflight、Secret 檢查及 recovery 計畫。

## 五、測試結果

在 `site/` 執行；完整結果以提交後 CI 為準。

| 命令                                                                     | 結果                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `node --import ./scripts/sites-env.mjs --test tests/auth.test.mjs`       | 7 項通過，0 失敗                                       |
| `node --import ./scripts/sites-env.mjs --test tests/migrations.test.mjs` | 17 項通過，0 失敗                                      |
| `npm test`                                                               | 63 項通過，0 失敗、0 略過                              |
| `npm run lint`                                                           | 通過；無 error                                         |
| `npm run typecheck`                                                      | 通過                                                   |
| `npm run format:check`                                                   | 通過                                                   |
| `npm run db:verify`                                                      | 六份 migration、重跑、外鍵與 quick check 已通過        |
| `npm run db:generate -- --name phase_03a_drift_check`                    | 34 張表；No schema changes，沒有額外 migration         |
| `npm run build`                                                          | 通過；首頁、5 個 auth routes 與 health route           |
| 根目錄 `node scripts/check-docs.mjs`                                     | 10 份專案 Markdown、208 個本機連結通過                 |
| 根目錄 `node scripts/check-safety.mjs`                                   | 155 份來源檔案通過既定 Secret／識別碼規則及 Pages 檢查 |
| 根目錄 `git diff --check`                                                | 通過                                                   |

測試使用產生的 RSA key、虛構 Google subject／Email／Secret；沒有向 Google 發送 request，也沒有把 token、cookie 或 secret 寫入 log／Audit。

## 六、安全性檢查

- 未信任前端 Email、角色、header 或 ID 作為登入身分；唯一登入來源是伺服器驗證的 Google OIDC 結果。
- 未驗證簽章、issuer、audience、效期、nonce 或 `email_verified` 時拒絕登入。
- state、nonce、PKCE verifier 的 D1 比對與一次性消費防止 callback replay；Session cookie 與 D1 token hash 不可互換。
- Bootstrap 要求有效 Secret、零 AdminUsers、未初始化狀態與已驗證 Google，並以唯一 singleton／batch 防止併發建立多個 admin。
- pending、disabled、locked、identity_rebind_required 與不同 Google subject 均拒絕直接建立 Session。
- 沒有本地密碼、Password Reset、ChatGPT／Gemini 認證或 AI 帳號欄位。
- OAuth Client Secret、Bootstrap Secret、ID token、code、Session token 未進 Git、D1、前端 bundle 或一般 Audit。

## 七、已知限制

- 沒有真實 Google OAuth Client；`GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`GOOGLE_OAUTH_REDIRECT_URI` 尚未填入或驗證。
- Sites callback／Cookie、代理與 Google-only 存取相容性尚未實測；D-09 仍保留平台證據關卡。
- Recent Authentication 的正式有效窗口尚待 D-11 相關決策；本 Phase 只提供可注入的 Session timeout 設定，未宣稱政策定案。
- 完整 Role × Permission × Scope、Google Rebind、Emergency Recovery 與最後管理員操作 UI 屬 Phase 3B；本 Phase 不提前完成。
- 沒有正式管理 UI、Production DB、Sites 部署或真實帳號登入。

## 八、下一 Phase 預計工作

下一個是 [Phase 3B](../PROJECT_SPEC.md#spec-50)：D-10 權限矩陣、Permission／Scope、停權、Google Rebind、D-01 Recovery、最後一位 active super_admin 保護與越權測試。本次沒有啟動 Phase 3B。
