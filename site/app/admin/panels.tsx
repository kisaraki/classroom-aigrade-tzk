"use client";
import { useState } from "react";
import { ActionForm, DataView, type Field } from "./widgets";
import type { WorkspaceProps, Item } from "./workspace";
import Scores from "./scores";
import Imports from "./imports";
import Users from "./users";
import References from "./references";
import Reports from "./reports";
const f = (
  name: string,
  label: string,
  type = "text",
  required = true,
): Field => ({ name, label, type, required });
const reason = f(
  "historyReason",
  "歷史資料異動原因（如適用）",
  "textarea",
  false,
);
export default function Panels(p: WorkspaceProps & { section: string }) {
  const {
    section,
    workspace,
    request,
    terms,
    classes,
    exams,
    termId,
    classId,
    examId,
    onDate,
    profile,
  } = p;
  const [roster, setRoster] = useState<Item[]>([]);
  const permissions = profile.permissions as string[];
  const access: Record<string, string> = {
    years: "academic.read",
    classes: "academic.read",
    students: "academic.read",
    enrollments: "academic.read",
    exams: "score.read",
    scores: "score.read",
    imports: "score.read",
    rankings: "score.read",
    ai: "ai.read",
    references: "ai.read",
    archive: "archive.read",
    users: "admin.read",
    settings: "ai.manage",
  };
  if (
    access[section] &&
    !permissions.includes(access[section]) &&
    !(section === "imports" && permissions.includes("academic.write"))
  )
    return (
      <section className="admin-panel">
        <h3>此職務沒有這項功能</h3>
        <p>如工作需要，請聯絡授權管理員。</p>
      </section>
    );
  const can = (permission: string) => permissions.includes(permission);
  const term = terms.find((t) => t.id === termId),
    exam = exams.find((e) => e.id === examId);
  const classOptions = classes.length
    ? classes.map((c) => [String(c.id), String(c.code)] as [string, string])
    : ([["_", "請先選擇工作範圍"]] as [string, string][]);
  const students: Field = {
    name: "studentId",
    label: "學生",
    options: roster.length
      ? roster.map((s) => [String(s.id), `${s.seat_number} 號・${s.name}`])
      : [["_", "請先載入名冊"]],
  };
  const academicConfirm = (v: unknown) =>
    workspace("academic-confirm", {
      previewId: (v as { id: string }).id,
      confirmed: true,
    });
  const readRoster = async () => {
    const data = (await workspace("roster", { termId, classId, onDate })) as {
      students: Item[];
    };
    setRoster(data.students);
    return data;
  };
  const selectionPanel = (purpose: string) => (
    <ActionForm
      title="載入可選學生"
      fields={[]}
      read
      run={async () => {
        const r = (await workspace("selection", {
          purpose,
          termId,
          classId,
          onDate,
          ...(purpose === "ai" ? { examId } : {}),
        })) as { students: Item[] };
        setRoster(r.students);
        return r;
      }}
    />
  );
  const rosterPanel = (
    <ActionForm
      title="查閱班級名冊"
      fields={[]}
      read
      run={readRoster}
      note="依選取的學期、班級與學籍日期查閱；轉班不改寫歷史紀錄。"
    />
  );
  const enrollmentFields: Field[] = [
    students,
    { name: "classId", label: "目標班級", options: classOptions },
    f("seatNumber", "座號", "number"),
    { ...f("effectiveFrom", "生效日期", "date"), value: onDate },
  ];
  if (section === "years")
    return (
      <>
        <section className="admin-panel">
          <h3>學年度與學期</h3>
          <DataView value={terms} />
        </section>
        {can("academic.write") && (
          <ActionForm
            title="建立新學年度"
            fields={[
              f("code", "學年度代碼"),
              f("startsOn", "開始日", "date"),
              f("secondTermStartsOn", "下學期開始日", "date"),
              f("endsOn", "結束日（不含當日）", "date"),
            ]}
            preview
            run={(v) => workspace("year-preview", v)}
            confirm={academicConfirm}
          />
        )}
      </>
    );
  if (section === "classes")
    return (
      <>
        <section className="admin-panel">
          <h3>目前範圍的班級</h3>
          <DataView value={classes} />
        </section>
        {can("academic.write") && (
          <ActionForm
            title="建立班級"
            fields={[
              f("codes", "班級代碼（以逗號分隔，例如 701,702）"),
              reason,
            ]}
            preview
            run={(v) =>
              workspace("classes-preview", {
                yearId: term?.academic_year_id,
                codes: v.codes.split(/[,，\s]+/).filter(Boolean),
                historyReason: v.historyReason,
              })
            }
            confirm={academicConfirm}
          />
        )}
      </>
    );
  if (section === "students")
    return (
      <>
        {rosterPanel}
        {can("academic.write") && (
          <ActionForm
            title="新增學生／轉入"
            fields={[
              {
                name: "mode",
                label: "類型",
                options: [
                  ["new", "七年級新生"],
                  ["transfer_in", "轉入學生"],
                ],
              },
              f("name", "學生姓名"),
              f("birthDate", "出生日期", "date"),
              f("studentNumber", "學號"),
              f("identityNumber", "身分證字號", "password"),
              { name: "classId", label: "班級", options: classOptions },
              f("seatNumber", "座號", "number"),
              { ...f("effectiveFrom", "生效日期", "date"), value: onDate },
              reason,
            ]}
            preview
            run={(v) =>
              workspace("students-preview", {
                termId,
                mode: v.mode,
                historyReason: v.historyReason,
                rows: [
                  {
                    name: v.name,
                    birthDate: v.birthDate,
                    studentNumber: v.studentNumber,
                    identityNumber: v.identityNumber,
                    classId: v.classId,
                    seatNumber: Number(v.seatNumber),
                    effectiveFrom: v.effectiveFrom,
                  },
                ],
              })
            }
            confirm={academicConfirm}
            note="身分證僅送往受保護服務進行加密與查重，不會在確認結果回顯。"
          />
        )}
      </>
    );
  if (section === "enrollments")
    return (
      <>
        {rosterPanel}
        {can("academic.write") && (
          <>
            <ActionForm
              title="建立學籍"
              fields={[...enrollmentFields, reason]}
              preview
              run={(v) =>
                workspace("enrollments-preview", {
                  termId,
                  rows: [
                    {
                      studentId: v.studentId,
                      classId: v.classId,
                      seatNumber: Number(v.seatNumber),
                      effectiveFrom: v.effectiveFrom,
                    },
                  ],
                  historyReason: v.historyReason,
                })
              }
              confirm={academicConfirm}
            />
            <ActionForm
              title="轉班／調整座號"
              fields={[...enrollmentFields, reason]}
              preview
              run={(v) =>
                workspace("move-preview", {
                  enrollmentId: roster.find((s) => s.id === v.studentId)
                    ?.enrollment_id,
                  targetClassId: v.classId,
                  seatNumber: Number(v.seatNumber),
                  effectiveFrom: v.effectiveFrom,
                  historyReason: v.historyReason,
                })
              }
              confirm={academicConfirm}
            />
            <ActionForm
              title="轉出"
              fields={[students, f("effectiveOn", "轉出日期", "date"), reason]}
              preview
              run={(v) => workspace("transfer-preview", v)}
              confirm={academicConfirm}
            />
            <ActionForm
              title="升班預覽"
              fields={[
                {
                  name: "sourceTermId",
                  label: "來源學期",
                  options: terms.map((t) => [
                    String(t.id),
                    `${t.year_code} - ${t.term_number}`,
                  ]),
                },
                {
                  name: "targetTermId",
                  label: "目標學期",
                  options: terms.map((t) => [
                    String(t.id),
                    `${t.year_code} - ${t.term_number}`,
                  ]),
                },
                reason,
              ]}
              preview
              run={(v) => workspace("promotion-preview", v)}
              confirm={academicConfirm}
              note="依既有升班規則保留原班號與座號。預覽有衝突時停止，不自動覆寫。"
            />
            <ActionForm
              title="撤銷學籍作業"
              fields={[f("operationId", "原作業編號"), reason]}
              preview
              run={(v) => workspace("undo-preview", v)}
              confirm={academicConfirm}
            />
          </>
        )}
      </>
    );
  if (section === "exams")
    return (
      <>
        <section className="admin-panel">
          <h3>評量清單</h3>
          <DataView value={exams} />
        </section>
        {can("score.write") && (
          <>
            <ActionForm
              title="建立評量"
              fields={[
                {
                  name: "sequence",
                  label: "次序",
                  options: [
                    ["1", "第一次"],
                    ["2", "第二次"],
                    ["3", "第三次"],
                  ],
                },
                f("startsOn", "開始日", "date"),
                f("endsOn", "結束日（不含當日）", "date"),
              ]}
              run={(v) =>
                request("/api/admin/exams", {
                  operationId: crypto.randomUUID(),
                  academicTermId: termId,
                  sequence: Number(v.sequence),
                  startsOn: v.startsOn,
                  endsOn: v.endsOn,
                  confirmed: true,
                })
              }
            />
            <ActionForm
              title="調整選取評量日期"
              fields={[
                {
                  ...f("startsOn", "開始日", "date"),
                  value: String(exam?.starts_on ?? ""),
                },
                {
                  ...f("endsOn", "結束日", "date"),
                  value: String(exam?.ends_on ?? ""),
                },
              ]}
              run={(v) =>
                request(
                  `/api/admin/exams/${encodeURIComponent(examId)}`,
                  {
                    ...v,
                    operationId: crypto.randomUUID(),
                    expectedVersion: exam?.version,
                    confirmed: true,
                  },
                  "PATCH",
                )
              }
            />
            <ActionForm
              title="確認本班評量名單"
              fields={[]}
              preview
              run={() =>
                request(
                  `/api/admin/exams/${encodeURIComponent(examId)}/roster/preview`,
                  { classId },
                )
              }
              confirm={(v) =>
                request(
                  `/api/admin/exams/${encodeURIComponent(examId)}/roster/confirm`,
                  {
                    previewId: (v as Item).previewId,
                    operationId: crypto.randomUUID(),
                    expectedVersion: exam?.version,
                    confirmed: true,
                  },
                )
              }
            />
            <ActionForm
              title="發布評量分類"
              fields={[
                {
                  name: "component",
                  label: "發布分類",
                  options: [
                    ["QUIZ", "檢測"],
                    ["MIDTERM", "段考"],
                  ],
                },
              ]}
              preview
              run={(v) =>
                request(
                  `/api/admin/exams/${encodeURIComponent(examId)}/publication/preview`,
                  {
                    kind: "PUBLISH",
                    component: v.component,
                    expectedVersion: exam?.version,
                  },
                )
              }
              confirm={(v) =>
                request(
                  `/api/admin/exams/${encodeURIComponent(examId)}/publication/confirm`,
                  { previewId: (v as Item).previewId, confirmed: true },
                )
              }
              note="需全校成績權限與近期 Google 驗證。請核對預覽後再提交。"
            />
          </>
        )}
      </>
    );
  if (section === "scores") return <Scores {...p} />;
  if (section === "imports") return <Imports {...p} />;
  if (section === "rankings")
    return (
      <>
        <ActionForm
          title="已發布班級排名"
          fields={[]}
          read
          run={() =>
            request(
              `/api/admin/exams/${encodeURIComponent(examId)}/publication?classId=${encodeURIComponent(classId)}`,
            )
          }
        />
        <ActionForm
          title="計算預覽（不發布）"
          fields={[
            {
              name: "mode",
              label: "計算分類",
              options: [
                ["PROVISIONAL", "檢測"],
                ["FINAL", "檢測＋段考"],
              ],
            },
            {
              name: "scope",
              label: "範圍",
              options: [
                ["class", "選取班級"],
                ["7", "七年級"],
                ["8", "八年級"],
                ["9", "九年級"],
              ],
            },
          ]}
          read
          run={(v) =>
            workspace("rankings", {
              examId,
              mode: v.mode,
              ...(v.scope === "class"
                ? { classId }
                : { grade: Number(v.scope) }),
            })
          }
          note="需整班／全年段全科讀取權限；此預覽不取代已發布版本。"
        />
      </>
    );
  if (section === "ai")
    return (
      <>
        {selectionPanel("ai")}
        <ActionForm
          title="查閱成對建議與工作狀態"
          fields={[students]}
          read
          run={(v) =>
            request(
              `/api/admin/ai/jobs?examId=${encodeURIComponent(examId)}&studentId=${encodeURIComponent(v.studentId)}`,
            )
          }
        />
        {can("ai.manage") && (
          <ActionForm
            title="排入建議生成／重試"
            fields={[
              students,
              {
                name: "retry",
                label: "工作",
                options: [
                  ["false", "建立成對建議"],
                  ["true", "重試已失敗工作"],
                ],
              },
            ]}
            run={(v) =>
              request("/api/admin/ai/jobs", {
                examId,
                studentId: v.studentId,
                retry: v.retry === "true",
                confirmed: true,
              })
            }
            note="正式背景 consumer 尚未啟用。此操作只建立持久工作，不在瀏覽器直接呼叫付費 API。"
          />
        )}
      </>
    );
  if (section === "references") return <References {...p} />;
  if (section === "archive")
    return (
      <>
        {selectionPanel("archive")}
        <ActionForm
          title="回收紀錄"
          fields={[]}
          read
          run={() => request("/api/admin/lifecycle/list")}
        />
        {can("archive.manage") && (
          <>
            <ActionForm
              title="封存／畢業／延長保存"
              fields={[
                {
                  name: "action",
                  label: "操作",
                  options: [
                    ["ARCHIVE", "封存班級"],
                    ["GRADUATE", "九年級畢業"],
                    ["EXTEND", "延長學生保存"],
                    ["READMIT", "恢復在籍"],
                  ],
                },
                students,
                f("date", "生效日期", "date"),
                f("until", "延長至（延長時必填）", "date", false),
                f("seatNumber", "新座號（恢復在籍時必填）", "number", false),
                f("reason", "原因", "textarea"),
              ]}
              preview
              run={(v) =>
                request("/api/admin/archives/preview", {
                  action: v.action,
                  reason: v.reason,
                  ...(v.action === "EXTEND"
                    ? { until: v.until }
                    : v.action === "READMIT"
                      ? { seatNumber: Number(v.seatNumber) }
                      : {}),
                  target: {
                    academicTermId: termId,
                    onDate: v.date,
                    ...(v.action === "GRADUATE"
                      ? { grade: 9 }
                      : v.action === "EXTEND"
                        ? { studentId: v.studentId }
                        : v.action === "READMIT"
                          ? { classId, studentId: v.studentId }
                          : { classId }),
                  },
                  force: false,
                })
              }
              confirm={(v) =>
                request("/api/admin/archives/confirm", {
                  previewId: (v as Item).previewId,
                  confirmed: true,
                })
              }
            />
            <ActionForm
              title="封存撤銷／正式復原"
              fields={[
                f("batchId", "封存批次編號"),
                {
                  name: "action",
                  label: "方式",
                  options: [
                    ["UNDO", "30 天內快速撤銷"],
                    ["RESTORE", "正式復原"],
                  ],
                },
                f("reason", "原因", "textarea"),
              ]}
              preview
              run={(v) => request("/api/admin/archives/preview", v)}
              confirm={(v) =>
                request("/api/admin/archives/confirm", {
                  previewId: (v as Item).previewId,
                  confirmed: true,
                })
              }
            />
            <ActionForm
              title="移入回收區／還原"
              fields={[
                {
                  name: "action",
                  label: "操作",
                  options: [
                    ["DELETE", "Soft Delete"],
                    ["RESTORE", "還原"],
                  ],
                },
                students,
                f("reason", "原因", "textarea"),
              ]}
              preview
              run={(v) =>
                request("/api/admin/lifecycle/preview", {
                  action: v.action,
                  studentIds: [v.studentId],
                  reason: v.reason,
                })
              }
              confirm={(v) =>
                request("/api/admin/lifecycle/confirm", {
                  previewId: (v as Item).previewId,
                  confirmed: true,
                })
              }
            />
          </>
        )}
        <section className="admin-panel">
          <h3>永久清除</h3>
          <p>正式副本與備份刪除能力尚未實測，Production Purge 維持停用。</p>
        </section>
      </>
    );
  if (section === "users") return <Users {...p} />;
  if (section === "settings")
    return (
      <>
        <ActionForm
          title="目前 AI 設定"
          fields={[]}
          read
          run={() => request("/api/admin/ai/settings")}
        />
        <ActionForm
          title="更新 AI 提供者與模型"
          fields={[
            {
              name: "provider",
              label: "提供者",
              options: [
                ["openai", "OpenAI"],
                ["gemini", "Gemini"],
              ],
            },
            f("model", "正式模型名稱"),
            f("expectedVersion", "剛查閱的設定版本", "number"),
          ]}
          run={(v) =>
            request("/api/admin/ai/settings", {
              configuration: { provider: v.provider, model: v.model },
              expectedVersion: Number(v.expectedVersion),
              confirmed: true,
            })
          }
          note="API Key 由部署平台 Secret 管理，此頁不收集或顯示金鑰。模型必須由管理員明確指定。"
        />
      </>
    );
  if (section === "reports") return <Reports {...p} />;
  return (
    <section className="admin-panel">
      <h3>稽核紀錄</h3>
      <p>等待確認指定可查看角色，尚未開放此資料入口。</p>
    </section>
  );
}
