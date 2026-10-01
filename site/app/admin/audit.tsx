"use client";
import { useState } from "react";
import type { AuditPage, AuditRow } from "../../lib/server/admin/audit";
import type { WorkspaceProps } from "./workspace";

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption>稽核紀錄</caption>
        <thead>
          <tr>
            {["時間（臺北）", "操作者帳號", "動作", "類型", "結果"].map(
              (label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {new Intl.DateTimeFormat("zh-TW", {
                  timeZone: "Asia/Taipei",
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: false,
                }).format(r.createdAt)}
              </td>
              <td>{r.actor ?? "無操作者資料"}</td>
              <td>{r.action}</td>
              <td>{r.entityType}</td>
              <td>
                {(
                  {
                    success: "成功",
                    failure: "失敗",
                    denied: "拒絕",
                    error: "錯誤",
                  } as Record<string, string>
                )[r.outcome] ?? "未知"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>這一頁沒有稽核紀錄。</p>}
    </div>
  );
}

export default function Audit(p: WorkspaceProps) {
  const [page, setPage] = useState<AuditPage | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  if (!(p.profile.permissions as string[]).includes("audit.read"))
    return <p>此職務沒有稽核查看權限。</p>;
  async function load(next = false) {
    const cursor = next ? page?.nextCursor : null;
    setPage(null);
    setMessage("");
    setBusy(true);
    try {
      setPage(
        (await p.workspace("audit", cursor ? { cursor } : {})) as AuditPage,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="admin-panel">
      <h3>稽核紀錄</h3>
      <p>
        僅 super_admin 可查看全校保存期限內的紀錄。每頁最多 50
        筆，按時間由新到舊排列。
      </p>
      <button disabled={busy} onClick={() => void load()}>
        讀取最新紀錄
      </button>
      <button
        disabled={busy || !page?.nextCursor}
        onClick={() => void load(true)}
      >
        下一頁
      </button>
      {busy && <p role="status">讀取中…</p>}
      {message && <p role="alert">{message}</p>}
      {page && <AuditTable rows={page.rows} />}
    </section>
  );
}
