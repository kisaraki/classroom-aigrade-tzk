"use client";
import { ActionForm } from "./widgets";
import type { Requester } from "./workspace";
export default function Login({
  request,
  message,
  refresh,
}: {
  request: Requester;
  message: string;
  refresh: () => void;
}) {
  async function start(path: string, input: unknown) {
    const r = (await request(path, input)) as { authorizationUrl: string };
    window.location.assign(r.authorizationUrl);
    return { message: "正在前往 Google。" };
  }
  return (
    <section className="admin-panel login-panel">
      <p className="eyebrow">僅限已授權人員</p>
      <h2>使用 Google 登入</h2>
      <p>登入後依您的職務與授權班級提供管理功能。</p>
      <a className="primary-button" href="/api/auth/google/start">
        以 Google 帳號繼續 →
      </a>
      <p role="status">{message}</p>
      <button onClick={refresh}>重新檢查登入</button>
      <details>
        <summary>首次初始化或身分重新綁定</summary>
        <ActionForm
          title="首次初始化"
          fields={[
            { name: "secret", label: "Bootstrap 憑證", type: "password" },
          ]}
          run={(v) => start("/api/auth/bootstrap/start", v)}
          note="僅系統尚未初始化時可使用；仍須完成 Google 驗證。"
        />
        <ActionForm
          title="完成已核准的身分綁定"
          fields={[
            { name: "requestToken", label: "一次性核准憑證", type: "password" },
          ]}
          run={(v) => start("/api/auth/identity/start", v)}
          note="核准與驗證須在 5 分鐘內完成；此處不接受 Recovery Secret 直接登入。"
        />
      </details>
    </section>
  );
}
