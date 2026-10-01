"use client";
import { useState } from "react";
import { ActionForm } from "./widgets";
import type { Requester } from "./workspace";
import { completeSitesIdentity } from "./passkey";
export default function Login({
  request,
  message,
  refresh,
}: {
  request: Requester;
  message: string;
  refresh: () => void;
}) {
  const [status, setStatus] = useState("");
  async function login() {
    try {
      await request("/api/auth/sites", { operation: "login" });
      refresh();
    } catch (error) {
      setStatus((error as Error).message);
    }
  }
  return (
    <section className="admin-panel login-panel">
      <p className="eyebrow">僅限已授權人員</p>
      <h2>使用 ChatGPT 平台登入</h2>
      <p>完成平台登入後，再進入已授權的管理工作區。</p>
      <a
        className="primary-button"
        href="/signin-with-chatgpt?return_to=%2Fadmin"
        target="_top"
      >
        以 ChatGPT 帳號繼續 →
      </a>
      <button onClick={() => void login()}>進入管理工作區</button>
      <button
        onClick={async () => {
          try {
            const identity = (await request("/api/auth/sites")) as {
              subject: string;
            };
            setStatus("我的 Sites 使用者 ID：" + identity.subject);
          } catch (error) {
            setStatus((error as Error).message);
          }
        }}
      >
        取得我的 Sites 使用者 ID
      </button>
      <p role="status">{status || message}</p>
      <details>
        <summary>首次初始化或身分重新綁定</summary>
        <ActionForm
          title="首次初始化"
          fields={[
            { name: "secret", label: "Bootstrap 憑證", type: "password" },
            { name: "displayName", label: "顯示名稱" },
            { name: "contactEmail", label: "聯絡 Email" },
          ]}
          run={async (v) => {
            await request("/api/auth/sites", { operation: "bootstrap", ...v });
            refresh();
            return { message: "初始化完成，請設定 Passkey。" };
          }}
          note="須先登入 ChatGPT；僅尚未初始化的系統可使用。聯絡 Email 不授予權限。"
        />
        <ActionForm
          title="完成已核准的身分綁定"
          fields={[
            { name: "requestToken", label: "一次性核准憑證", type: "password" },
          ]}
          run={async (v) => {
            await completeSitesIdentity(request, v.requestToken);
            await login();
            return { message: "身分與 Passkey 綁定完成，請重新驗證 Passkey。" };
          }}
          note="以核准的 Sites 帳號登入，再註冊新的 Passkey；5 分鐘內完成，舊 Session 與憑證會失效。"
        />
      </details>
    </section>
  );
}
