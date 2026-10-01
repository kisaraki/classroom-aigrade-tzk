"use client";
import { useState, type FormEvent } from "react";
import Choice from "../public/choice";
export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value };
export type Data = Record<string, Value>;
export type Field = {
  name: string;
  label: string;
  type?: string;
  value?: string;
  required?: boolean;
  options?: [string, string][];
  help?: string;
};
export const subjectOptions: [string, string][] = [
  ["CHINESE", "國文"],
  ["ENGLISH", "英文"],
  ["MATH", "數學"],
  ["SCIENCE", "自然"],
  ["GEOGRAPHY", "地理"],
  ["HISTORY", "歷史"],
  ["CIVICS", "公民"],
];
export const labels: Record<string, string> = {
  id: "紀錄編號",
  code: "代碼",
  name: "姓名",
  student_number: "學號",
  birth_date: "出生日期",
  status: "狀態",
  seat_number: "座號",
  class_code_snapshot: "評量班級",
  seat_number_snapshot: "評量座號",
  display_name: "顯示名稱",
  username: "帳號代號",
  authorized_email: "授權 Email",
  role: "角色",
  auth_version: "帳號版本",
  version: "版本",
  starts_on: "開始日期",
  ends_on: "結束日期",
  effective_from: "生效日期",
  effective_to: "截止日期",
  title: "標題",
  description: "說明",
  subject: "科目",
  grade: "年級",
  action: "動作",
  outcome: "結果",
  created_at: "時間",
  actor_id: "操作者",
  count: "筆數",
  operationId: "作業編號",
  previewId: "預覽編號",
  reason: "原因",
  warnings: "提醒",
  conflicts: "衝突",
  students: "學生",
  items: "項目",
  rows: "預覽資料",
  classRank: "班級名次",
  gradeRank: "全年段名次",
  averageHundredths: "平均（百分之一分）",
  totalHundredths: "總分（百分之一分）",
  validCount: "有效分數筆數",
  exam: "評量",
  quiz: "檢測",
  midterm: "段考",
  local: "本校",
  external: "原校",
  classStatistics: "班級統計",
  gradeStatistics: "全年段統計",
  replayed: "已處理過",
  revision: "資料版本",
  participationCount: "參與人數",
  rankingEligible: "具排名資格",
  schoolLabel: "原校名稱",
  parent: "家長版",
  student: "學生版",
  summary: "表現摘要",
  diagnosis: "學習診斷",
  plan: "讀書計畫",
  improvements: "加強方向",
  encouragement: "鼓勵",
  parentSupport: "家長協助",
  error_code: "錯誤",
  attempt_count: "嘗試次數",
  permission: "權限",
  published: "已發布",
  historical_read_only: "歷史唯讀",
  retention_until: "保存至",
  public_query_until: "公開查詢至",
  identityNumber: "身分證（不顯示）",
};
const hidden =
  /token|secret|encrypted|lookup_hash|metadata_json|payload_json|snapshot_json/i;
export function DataView({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value === null || value === undefined) return <span>—</span>;
  if (typeof value === "boolean") return <span>{value ? "是" : "否"}</span>;
  if (typeof value !== "object") return <span>{String(value)}</span>;
  if (depth > 5) return <span>請縮小查閱範圍。</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ol className="record-list">
        {value.map((v, i) => (
          <li key={i}>
            <DataView value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    ) : (
      <p className="muted">目前沒有資料。</p>
    );
  return (
    <dl className="data-grid">
      {Object.entries(value)
        .filter(([k]) => !hidden.test(k))
        .map(([k, v]) => (
          <div key={k}>
            <dt>{labels[k] ?? k}</dt>
            <dd>
              <DataView value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
    </dl>
  );
}
export function Fields({ fields }: { fields: Field[] }) {
  return (
    <div className="admin-fields">
      {fields.map((f) =>
        f.options ? (
          <Choice
            key={f.name}
            label={f.label}
            name={f.name}
            defaultValue={f.value ?? f.options[0]?.[0]}
            options={f.options.length ? f.options : [["_", "目前沒有可選項目"]]}
          />
        ) : (
          <label key={f.name}>
            {f.label}
            {f.type === "textarea" ? (
              <textarea
                name={f.name}
                defaultValue={f.value}
                required={f.required !== false}
                rows={3}
              />
            ) : (
              <input
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={f.value}
                required={f.required !== false}
                autoComplete="off"
              />
            )}
            {f.help && <small>{f.help}</small>}
          </label>
        ),
      )}
    </div>
  );
}
export function ActionForm({
  title,
  fields,
  run,
  preview,
  confirm,
  read = false,
  note,
}: {
  title: string;
  fields: Field[];
  run: (v: Record<string, string>, file?: File) => Promise<unknown>;
  preview?: boolean;
  confirm?: (v: unknown) => Promise<unknown>;
  read?: boolean;
  note?: string;
}) {
  const [review, setReview] = useState<Record<string, string> | null>(null),
    [file, setFile] = useState<File>(),
    [result, setResult] = useState<unknown>(),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [approved, setApproved] = useState(false),
    [completed, setCompleted] = useState(false);
  async function perform(v: Record<string, string>, f?: File) {
    setPending(true);
    setError("");
    try {
      setResult(await run(v, f));
      setReview(null);
      setApproved(false);
      setCompleted(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失敗，請重試。");
      setResult(undefined);
      setReview(null);
    } finally {
      setPending(false);
    }
  }
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      v: Record<string, string> = {};
    let f: File | undefined;
    for (const [k, x] of d) {
      if (typeof x === "string") v[k] = x;
      else if (x.size) f = x;
    }
    setResult(undefined);
    setError("");
    setApproved(false);
    if (read || preview) void perform(v, f);
    else {
      setReview(v);
      setFile(f);
    }
  }
  return (
    <section className="admin-panel">
      <h3>{title}</h3>
      {note && <p className="muted">{note}</p>}
      <form
        onSubmit={submit}
        autoComplete="off"
        onChange={() => {
          setReview(null);
          setResult(undefined);
          setApproved(false);
        }}
      >
        <fieldset disabled={pending}>
          <Fields fields={fields} />
          <button className="primary-button" type="submit">
            {pending
              ? "處理中…"
              : read
                ? "查閱"
                : preview
                  ? "產生預覽"
                  : "檢查變更"}
          </button>
        </fieldset>
      </form>
      {review && (
        <div className="confirmation" role="region" aria-label="確認變更">
          <h4>請確認這次操作</h4>
          <DataView
            value={Object.fromEntries(
              Object.entries(review).filter(
                ([k]) =>
                  !fields.some((f) => f.name === k && f.type === "password"),
              ),
            )}
          />
          {file && <p>已選擇檔案，共 {file.size} bytes。</p>}
          <label className="check">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => setApproved(e.target.checked)}
            />
            我已確認影響範圍與內容
          </label>
          <button
            disabled={!approved || pending}
            onClick={() => void perform(review, file)}
          >
            確認執行
          </button>
          <button onClick={() => setReview(null)}>取消</button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {result !== undefined && (
        <div className="operation-result" role="region" aria-label="操作結果">
          <p role="status">
            {preview && !completed
              ? "預覽已產生，尚未提交。"
              : read
                ? "查閱完成。"
                : "操作已完成。"}
          </p>
          <DataView value={result} />
          {preview && confirm && !completed && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={approved}
                  onChange={(e) => setApproved(e.target.checked)}
                />
                我已核對預覽，確認提交
              </label>
              <button
                disabled={!approved || pending}
                onClick={async () => {
                  setPending(true);
                  setError("");
                  try {
                    const receipt = await confirm(result);
                    setResult(receipt);
                    setApproved(false);
                    setCompleted(true);
                  } catch (e) {
                    setError(
                      e instanceof Error ? e.message : "提交失敗，請重新預覽。",
                    );
                    setResult(undefined);
                  } finally {
                    setPending(false);
                  }
                }}
              >
                確認提交
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
