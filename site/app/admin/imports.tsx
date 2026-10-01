"use client";
import { useState } from "react";
import { ActionForm, subjectOptions, DataView } from "./widgets";
import type { WorkspaceProps, Item } from "./workspace";
export default function Imports(p: WorkspaceProps) {
  const [job, setJob] = useState(""),
    [target, setTarget] = useState<Item | null>(null),
    [last, setLast] = useState<unknown>();
  const makeTarget = (v: Record<string, string>) =>
    v.kind === "NEW_STUDENTS"
      ? { kind: v.kind, academicTermId: p.termId, classId: p.classId }
      : {
          kind: "SCORES",
          examId: p.examId,
          classId: p.classId,
          examType: v.examType,
          subjects:
            v.subject === "ALL"
              ? subjectOptions
                  .filter(
                    ([s]) =>
                      v.examType === "MIDTERM" ||
                      ["CHINESE", "ENGLISH", "MATH"].includes(s),
                  )
                  .map(([s]) => s)
              : [v.subject],
        };
  async function download(path: string, filename: string, body?: unknown) {
    const r = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error("下載未完成，請確認權限與範圍。");
    const url = URL.createObjectURL(await r.blob());
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return { message: "下載已建立。" };
  }
  const targetFields = [
    {
      name: "kind",
      label: "匯入類型",
      options: [
        ["SCORES", "成績"],
        ["NEW_STUDENTS", "七年級新生"],
      ] as [string, string][],
    },
    {
      name: "examType",
      label: "評量分類",
      options: [
        ["QUIZ", "檢測"],
        ["MIDTERM", "段考"],
      ] as [string, string][],
    },
    {
      name: "subject",
      label: "科目",
      options: [["ALL", "全部適用科目"], ...subjectOptions] as [
        string,
        string,
      ][],
    },
  ];
  return (
    <>
      <ActionForm
        title="下載匯入範本"
        fields={targetFields}
        read
        run={(v) =>
          download("/api/admin/imports/template", "import-template.xlsx", {
            target: makeTarget(v),
          })
        }
      />
      <ActionForm
        title="上傳檔案"
        fields={[
          ...targetFields,
          { name: "file", label: "CSV／XLSX 檔案（最多 5 MiB）", type: "file" },
          {
            name: "format",
            label: "檔案格式",
            options: [
              ["csv", "UTF-8 CSV"],
              ["xlsx", "XLSX"],
            ],
          },
        ]}
        run={async (v, file) => {
          if (!file || file.size > 5 * 1024 * 1024)
            throw new Error("請選擇不超過 5 MiB 的檔案。");
          const t = makeTarget(v);
          const r = (await p.request("/api/admin/imports", file, "POST", {
            "Content-Type": "application/octet-stream",
            "X-Import-Format": v.format,
            "X-Import-Target": JSON.stringify(t),
          })) as Item;
          setJob(String(r.jobId));
          setTarget(t);
          setLast(r);
          return r;
        }}
        note="上傳只建立 Job；解析、預覽與確認提交是分開步驟。檔名不作識別依據。"
      />
      <section className="admin-panel">
        <h3>目前匯入工作</h3>
        <label>
          工作編號
          <input
            value={job}
            onChange={(e) => {
              setJob(e.target.value);
              setLast(undefined);
            }}
          />
        </label>
        {target && <DataView value={target} />}
        <DataView value={last} />
      </section>
      {job && (
        <>
          <ActionForm
            key={"read" + job}
            title="查閱工作狀態"
            fields={[]}
            read
            run={() =>
              p.request(`/api/admin/imports/${encodeURIComponent(job)}`)
            }
          />
          <ActionForm
            key={"preview" + job}
            title="欄位映射、驗證與預覽"
            fields={[
              {
                name: "mapping",
                label: "自訂欄位映射（每行：範本欄名=檔案欄名；留空使用範本）",
                type: "textarea",
                required: false,
              },
            ]}
            preview
            run={(v) => {
              const columns = Object.fromEntries(
                v.mapping
                  .split(/\r?\n/)
                  .filter((x) => x.trim())
                  .map((line) => {
                    const i = line.indexOf("=");
                    if (i < 1)
                      throw new Error("映射格式需為範本欄名=檔案欄名。");
                    return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
                  }),
              );
              return p.request(
                `/api/admin/imports/${encodeURIComponent(job)}/preview`,
                Object.keys(columns).length ? { columns } : {},
              );
            }}
            confirm={(v) =>
              p.request(
                `/api/admin/imports/${encodeURIComponent(job)}/commit`,
                { previewVersion: (v as Item).previewVersion, confirmed: true },
              )
            }
            note="任一列有錯就整批不寫入；版本衝突須重新預覽。"
          />
          <ActionForm
            title="下載錯誤清單"
            fields={[]}
            read
            run={() =>
              download(
                `/api/admin/imports/${encodeURIComponent(job)}/errors`,
                "import-errors.csv",
              )
            }
          />
          <ActionForm
            key={"rollback" + job}
            title="30 天內整批回復"
            fields={[]}
            preview
            run={() =>
              p.request(
                `/api/admin/imports/${encodeURIComponent(job)}/rollback/preview`,
                {},
              )
            }
            confirm={(v) =>
              p.request(
                `/api/admin/imports/${encodeURIComponent(job)}/rollback/confirm`,
                { previewVersion: (v as Item).previewVersion, confirmed: true },
              )
            }
            note="如已有後續修改、再次匯入或發布，衝突會阻擋整批回復。"
          />
        </>
      )}
    </>
  );
}
