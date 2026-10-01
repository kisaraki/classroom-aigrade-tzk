"use client";
import { useRef, useState, useEffect } from "react";
import Choice from "../public/choice";
import type { WorkspaceProps, Item } from "./workspace";
import type { Report } from "../../lib/server/reports/formats";
const kinds: [string, string][] = [
  ["class", "班級成績總表"],
  ["grade", "全年段成績總表"],
  ["individual", "個人成績單"],
  ["class-ranking", "班級排名表"],
  ["grade-ranking", "全年段排名表"],
  ["ai", "AI 建議總表"],
];
export default function Reports(p: WorkspaceProps) {
  const [kind, setKind] = useState("class"),
    [grade, setGrade] = useState("7"),
    [students, setStudents] = useState<Item[]>([]),
    [studentId, setStudentId] = useState(""),
    [preview, setPreview] = useState<{
      report: Report;
      version: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null),
    area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const abort = () => controller.current?.abort();
    window.addEventListener("pagehide", abort);
    return () => {
      abort();
      window.removeEventListener("pagehide", abort);
    };
  }, []);
  const scope =
    kind === "grade" || kind === "grade-ranking"
      ? { grade: Number(grade) }
      : kind === "individual"
        ? { studentId }
        : { classId: p.classId };
  const input = { kind, examId: p.examId, ...scope };
  function reset() {
    setPreview(null);
    setMessage("");
  }
  async function read() {
    setBusy(true);
    setMessage("");
    setPreview(null);
    try {
      setPreview(
        (await p.request("/api/admin/reports", {
          ...input,
          format: "preview",
        })) as { report: Report; version: number },
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(format: string) {
    if (!preview) return;
    setBusy(true);
    setMessage("");
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    let url: string | undefined;
    try {
      const response = await fetch("/api/admin/reports", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...input,
          expectedVersion: preview.version,
          format,
        }),
        signal: active.signal,
      });
      if (!response.ok) {
        if (response.status === 401) {
          await p.request("/api/admin/workspace", {
            operation: "profile",
            input: {},
          });
        }
        throw new Error(
          response.status === 413
            ? "報表超過容量上限，請縮小範圍。"
            : response.status === 409
              ? "來源已變動或尚未發布，請重新預覽。"
              : "無法匯出，請確認授權與資料。",
        );
      }
      const blob = await response.blob();
      if (active.signal.aborted) return;
      url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `report-${kind}.${format}`;
      link.click();
      setMessage("下載已啟動；檔案含敏感資料，請妥善保管。");
    } catch (e) {
      if (!active.signal.aborted) {
        setPreview(null);
        setMessage((e as Error).message);
      }
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="admin-panel reports-panel">
      <h3>報表與匯出</h3>
      <p>Excel／CSV 中疑似公式的文字會加上「文字：」前綴，避免被當成公式。</p>
      <p>
        只讀取已發布版本。每次一個評量，最多 1,000 位學生、10
        MiB；檔案不保存於伺服器，下載副本請妥善保管。
      </p>
      <fieldset disabled={busy}>
        <div className="admin-fields">
          <Choice
            label="報表類型"
            value={kind}
            options={kinds}
            onChange={(v) => {
              reset();
              setKind(v);
            }}
          />
          {(kind === "grade" || kind === "grade-ranking") && (
            <Choice
              label="年級"
              value={grade}
              options={[
                ["7", "七年級"],
                ["8", "八年級"],
                ["9", "九年級"],
              ]}
              onChange={(v) => {
                reset();
                setGrade(v);
              }}
            />
          )}
          {kind === "individual" && (
            <>
              <button
                onClick={async () => {
                  reset();
                  setBusy(true);
                  try {
                    const r = (await p.workspace("selection", {
                      purpose: "score",
                      examId: p.examId,
                      classId: p.classId,
                    })) as { students: Item[] };
                    setStudents(r.students);
                    setStudentId("");
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                載入當次評量名冊
              </button>
              <button
                onClick={async () => {
                  reset();
                  setBusy(true);
                  try {
                    const r = (await p.workspace("selection", {
                      purpose: "score",
                      termId: p.termId,
                      classId: p.classId,
                      onDate: p.onDate,
                    })) as { students: Item[] };
                    setStudents(r.students);
                    setStudentId("");
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                載入所選學籍日期名冊（含轉入）
              </button>
              <Choice
                label="學生"
                value={studentId || "_"}
                options={[
                  ["_", "請選擇學生"],
                  ...students.map(
                    (s) =>
                      [String(s.id), `${s.seat_number} 號・${s.name}`] as [
                        string,
                        string,
                      ],
                  ),
                ]}
                onChange={(v) => {
                  reset();
                  setStudentId(v === "_" ? "" : v);
                }}
              />
            </>
          )}
        </div>
        <button
          className="primary-button"
          onClick={() => void read()}
          disabled={!p.examId || (kind === "individual" && !studentId)}
        >
          預覽報表
        </button>
      </fieldset>
      <p role="status">{busy ? "處理中…" : message}</p>
      {preview && (
        <>
          <div className="report-actions">
            <button disabled={busy} onClick={() => void download("xlsx")}>
              下載 Excel
            </button>
            <button disabled={busy} onClick={() => void download("csv")}>
              下載 CSV
            </button>
            <button disabled={busy} onClick={() => void download("pdf")}>
              下載 PDF
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const refreshed = (await p.request("/api/admin/reports", {
                    ...input,
                    expectedVersion: preview.version,
                    format: "preview",
                  })) as { report: Report; version: number };
                  setPreview(refreshed);
                  await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => resolve()),
                  );
                  area.current?.focus();
                  window.print();
                } catch (e) {
                  setPreview(null);
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              列印
            </button>
          </div>
          <div ref={area} tabIndex={-1} className="report-preview">
            <h2>{preview.report.title}</h2>
            <p>{preview.report.subtitle}</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {preview.report.columns.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.report.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((v, j) => (
                        <td key={j}>{v === null ? "—" : v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!preview.report.rows.length && <p>目前沒有資料。</p>}
          </div>
        </>
      )}
    </section>
  );
}
