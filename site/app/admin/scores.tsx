"use client";
import { useState } from "react";
import Choice from "../public/choice";
import { ActionForm, DataView, subjectOptions } from "./widgets";
import type { WorkspaceProps, Item } from "./workspace";
type Score = {
  settingId: string;
  examType: string;
  subject: string;
  scoreStatus: string;
  scoreValue: number | null;
  displayValue: string;
  version: number;
};
type Participant = {
  id: string;
  student_id: string;
  seat_number_snapshot: number;
  scores: Score[];
};
type ExamData = {
  exam: Item;
  publishedComponents: string[];
  settings: Item[];
  participants: Participant[];
};
const marks: Record<string, string> = {
  UNENTERED: "",
  NOT_HELD: "N",
  ABSENT: "A",
  OFFICIAL_LEAVE: "B",
  SICK_LEAVE: "C",
  EXEMPT: "D",
};
export default function Scores(p: WorkspaceProps) {
  const [subject, setSubject] = useState("all"),
    [data, setData] = useState<ExamData | null>(null),
    [edits, setEdits] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [review, setReview] = useState(false),
    [preview, setPreview] = useState<Item | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [approved, setApproved] = useState(false);
  const canWrite = (p.profile.permissions as string[]).includes("score.write");
  const classroom = p.classes.find((c) => c.id === p.classId);
  const options: [string, string][] = [
    ...(((classroom?.capabilities as string[]) ?? []).includes("score.read")
      ? [["all", "全部科目"] as [string, string]]
      : []),
    ...subjectOptions.filter(([k]) =>
      ((classroom?.subjects as string[]) ?? []).includes(k),
    ),
  ];
  const selected = options.some(([k]) => k === subject)
    ? subject
    : (options[0]?.[0] ?? "all");
  async function read() {
    setBusy(true);
    setMessage("");
    setPreview(null);
    setReview(false);
    setApproved(false);
    setEdits({});
    try {
      const r = (await p.request(
        `/api/admin/exams/${encodeURIComponent(p.examId)}?classId=${encodeURIComponent(p.classId)}${selected === "all" ? "" : `&subject=${encodeURIComponent(selected)}`}`,
      )) as ExamData;
      setData(r);
    } catch (e) {
      setData(null);
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changes =
    data?.participants.flatMap((part) =>
      part.scores.flatMap((score) => {
        const key = part.id + ":" + score.settingId;
        return key in edits
          ? [
              {
                participationId: part.id,
                settingId: score.settingId,
                expectedVersion: score.version,
                value: edits[key],
                seat: part.seat_number_snapshot,
                subject: score.subject,
                examType: score.examType,
                before:
                  score.scoreValue === null
                    ? (marks[score.scoreStatus] ?? "")
                    : score.displayValue,
              },
            ]
          : [];
      }),
    ) ?? [];
  const publishedChanges = changes.filter((c) =>
    data?.publishedComponents.includes(c.examType),
  );
  const mixedChanges =
    publishedChanges.length > 0 && publishedChanges.length !== changes.length;
  async function prepare() {
    setBusy(true);
    setMessage("");
    setApproved(false);
    try {
      if (mixedChanges)
        throw new Error("請分開提交已發布與尚未發布分類的變更。");
      if (data && publishedChanges.length) {
        setPreview(
          (await p.request(
            `/api/admin/exams/${encodeURIComponent(p.examId)}/publication/preview`,
            {
              kind: "EDIT",
              expectedVersion: data.exam.version,
              reason,
              scores: changes.map(
                ({ participationId, settingId, expectedVersion, value }) => ({
                  participationId,
                  settingId,
                  expectedVersion,
                  value,
                }),
              ),
            },
          )) as Item,
        );
      }
      setReview(true);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      if (preview)
        await p.request(
          `/api/admin/exams/${encodeURIComponent(p.examId)}/publication/confirm`,
          { previewId: preview.previewId, confirmed: true },
        );
      else
        await p.request(
          `/api/admin/exams/${encodeURIComponent(p.examId)}/scores`,
          {
            operationId: crypto.randomUUID(),
            expectedVersion: data?.exam.version,
            reason,
            scores: changes.map(
              ({ participationId, settingId, expectedVersion, value }) => ({
                participationId,
                settingId,
                expectedVersion,
                value,
              }),
            ),
          },
          "POST",
        );
      await read();
      setMessage("已保存，版本已重新載入。");
    } catch (e) {
      setMessage((e as Error).message);
      setReview(false);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="admin-panel">
        <h3>班級成績</h3>
        <p>
          0 分為有效分數；空白是未輸入。A 缺考、B 公假、C 病假、D 免試、N
          未舉行。
        </p>
        <Choice
          label="科目範圍"
          value={selected}
          options={options.length ? options : [["all", "請先選擇班級"]]}
          onChange={(v) => {
            setSubject(v);
            setData(null);
            setEdits({});
            setReview(false);
          }}
        />
        <button
          disabled={busy || !p.examId || !p.classId}
          onClick={() => void read()}
        >
          載入成績
        </button>
        {message && <p role="status">{message}</p>}
        {data && (
          <>
            <p>
              評量版本 {String(data.exam.version)}・
              {data.publishedComponents.length
                ? "已發布分類修改須原因及近期驗證；尚未發布分類可保存草稿"
                : "草稿"}
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <caption>成績輸入表</caption>
                <thead>
                  <tr>
                    <th scope="col">座號</th>
                    <th scope="col">學生紀錄</th>
                    {data.settings.map((s) => (
                      <th key={String(s.id)} scope="col">
                        {subjectOptions.find((o) => o[0] === s.subject)?.[1]}{" "}
                        {s.exam_type === "QUIZ" ? "檢測" : "段考"}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.participants.map((part) => (
                    <tr key={part.id}>
                      <th scope="row">{part.seat_number_snapshot}</th>
                      <td>{part.student_id}</td>
                      {part.scores.map((s) => {
                        const key = part.id + ":" + s.settingId;
                        return (
                          <td key={s.settingId}>
                            <input
                              aria-label={`${part.seat_number_snapshot} 號 ${subjectOptions.find((o) => o[0] === s.subject)?.[1]} ${s.examType === "QUIZ" ? "檢測" : "段考"}`}
                              disabled={
                                busy ||
                                !canWrite ||
                                s.scoreStatus === "NOT_HELD"
                              }
                              value={
                                edits[key] ??
                                (s.scoreValue === null
                                  ? (marks[s.scoreStatus] ?? "")
                                  : s.displayValue)
                              }
                              onChange={(e) => {
                                setEdits((v) => ({
                                  ...v,
                                  [key]: e.target.value,
                                }));
                                setReview(false);
                                setPreview(null);
                                setApproved(false);
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canWrite && (
              <>
                <label>
                  修改原因
                  <textarea
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setReview(false);
                      setPreview(null);
                    }}
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    !changes.length ||
                    (!reason.trim() && publishedChanges.length > 0)
                  }
                  onClick={() => void prepare()}
                >
                  預覽 {changes.length} 筆變更
                </button>
              </>
            )}
            {review && (
              <div className="confirmation">
                <DataView
                  value={changes.map((c) => ({
                    座號: c.seat,
                    科目: subjectOptions.find((s) => s[0] === c.subject)?.[1],
                    分類: c.examType === "QUIZ" ? "檢測" : "段考",
                    修改前: c.before,
                    修改後: c.value,
                  }))}
                />
                {preview && <DataView value={preview} />}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  我已核對以上變更
                </label>
                <button
                  disabled={busy || !approved}
                  onClick={() => void save()}
                >
                  確認保存
                </button>
                <button
                  onClick={() => {
                    setReview(false);
                    setPreview(null);
                  }}
                >
                  取消
                </button>
              </div>
            )}
          </>
        )}
      </section>
      {data && canWrite && (
        <ActionForm
          key={String(data.exam.version)}
          title="調整科目是否舉行"
          fields={[
            {
              name: "settingId",
              label: "科目",
              options: data.settings.map((s) => [
                String(s.id),
                `${subjectOptions.find((o) => o[0] === s.subject)?.[1]} ${s.exam_type === "QUIZ" ? "檢測" : "段考"}`,
              ]),
            },
            {
              name: "held",
              label: "狀態",
              options: [
                ["true", "舉行"],
                ["false", "未舉行"],
              ],
            },
          ]}
          run={async (v) => {
            const setting = data.settings.find((s) => s.id === v.settingId);
            return p.request(
              `/api/admin/exams/${encodeURIComponent(p.examId)}/subjects`,
              {
                operationId: crypto.randomUUID(),
                expectedVersion: data.exam.version,
                settingId: v.settingId,
                settingVersion: setting?.version,
                held: v.held === "true",
                confirmed: true,
              },
              "PATCH",
            );
          }}
          note="僅草稿且具全校成績寫入權限者可調整。提交後請重新載入成績。"
        />
      )}
    </>
  );
}
