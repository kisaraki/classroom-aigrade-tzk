"use client";
import { useState } from "react";
import Choice from "../public/choice";
import { ActionForm, DataView, subjectOptions, type Field } from "./widgets";
import type { WorkspaceProps, Item } from "./workspace";
const roles: [string, string][] = [
  ["super_admin", "最高管理員"],
  ["system_admin", "系統管理員"],
  ["academic_admin", "學籍管理員"],
  ["score_admin", "成績管理員"],
  ["ai_admin", "AI 管理員"],
  ["archive_admin", "封存管理員"],
  ["viewer", "唯讀人員"],
];
export default function Users(p: WorkspaceProps) {
  const [users, setUsers] = useState<Item[]>([]),
    [selected, setSelected] = useState(""),
    [details, setDetails] = useState<{
      user: Item;
      assignments: Item[];
    } | null>(null),
    [token, setToken] = useState("");
  const path = "/api/admin/users/" + encodeURIComponent(selected);
  const assignments = () =>
    details?.assignments.map((a) => ({
      academicTermId: a.academic_term_id,
      scopeType: a.scope_type,
      ...(a.grade !== null ? { grade: a.grade } : {}),
      ...(a.class_id ? { classId: a.class_id } : {}),
      ...(a.subject ? { subject: a.subject } : {}),
      startsOn: a.starts_on,
      endsOn: a.ends_on,
    })) ?? [];
  const confirm = {
    expectedVersion: details?.user.auth_version,
    confirmed: true,
  };
  async function update(body: Item) {
    const result = await p.request(path, { ...body, ...confirm }, "PATCH");
    setDetails(null);
    setToken("");
    return result;
  }
  const assignmentFields: Field[] = [
    {
      name: "scopeType",
      label: "授權範圍",
      options: [
        ["class", "班級"],
        ["homeroom", "導師班"],
        ["teaching_subject", "任教科目"],
        ["grade", "年級"],
        ["school", "全校"],
      ],
    },
    {
      name: "grade",
      label: "年級",
      options: [
        ["7", "七年級"],
        ["8", "八年級"],
        ["9", "九年級"],
      ],
    },
    { name: "subject", label: "任教科目", options: subjectOptions },
    { name: "startsOn", label: "授權開始日", type: "date", value: p.onDate },
    {
      name: "endsOn",
      label: "授權結束日（不含當日；可留空）",
      type: "date",
      required: false,
    },
  ];
  return (
    <>
      <ActionForm
        title="載入管理員名單"
        fields={[]}
        read
        run={async () => {
          const r = (await p.request("/api/admin/users")) as { admins: Item[] };
          setUsers(r.admins);
          return r;
        }}
      />
      <ActionForm
        title="新增授權帳號"
        fields={[
          { name: "username", label: "內部帳號代號" },
          { name: "displayName", label: "顯示名稱" },
          {
            name: "authorizedEmail",
            label: "授權 Google Email",
            type: "email",
          },
          { name: "role", label: "角色", options: roles },
        ]}
        run={(v) => p.request("/api/admin/users", { ...v, confirmed: true })}
        note="不建立本地密碼。一般管理員建立後需另設定有效 Scope，首次登入綁定 Google 身分。"
      />
      <section className="admin-panel">
        <h3>選擇管理員</h3>
        <Choice
          label="管理員"
          value={selected || "_"}
          options={[
            ["_", "請選擇"],
            ...users.map(
              (u) =>
                [String(u.id), `${u.display_name}（${u.username}）`] as [
                  string,
                  string,
                ],
            ),
          ]}
          onChange={(v) => {
            setSelected(v === "_" ? "" : v);
            setDetails(null);
            setToken("");
          }}
        />
      </section>
      {selected && (
        <ActionForm
          key={selected}
          title="查閱授權與版本"
          fields={[]}
          read
          run={async () => {
            const d = (await p.workspace("user-details", { id: selected })) as {
              user: Item;
              assignments: Item[];
            };
            setDetails(d);
            return d;
          }}
        />
      )}
      {details && (
        <>
          <ActionForm
            key={"edit" + selected + details.user.auth_version}
            title="修改角色／狀態"
            fields={[
              {
                name: "displayName",
                label: "顯示名稱",
                value: String(details.user.display_name),
              },
              {
                name: "role",
                label: "角色",
                value: String(details.user.role),
                options: roles,
              },
              {
                name: "status",
                label: "狀態",
                value: String(details.user.status),
                options: [
                  ["active", "啟用"],
                  ["disabled", "停權"],
                  ["locked", "鎖定"],
                  ["identity_rebind_required", "需重新綁定"],
                ],
              },
            ]}
            run={(v) => update(v)}
            note="修改權限會撤銷既有 Sessions；最後一位 active super_admin 受伺服器保護。"
          />
          <ActionForm
            title="新增一筆 Scope 授權"
            fields={assignmentFields}
            run={(v) =>
              update({
                assignments: [
                  ...assignments(),
                  {
                    academicTermId: p.termId,
                    scopeType: v.scopeType,
                    ...(v.scopeType === "grade"
                      ? { grade: Number(v.grade) }
                      : ["class", "homeroom", "teaching_subject"].includes(
                            v.scopeType,
                          )
                        ? { classId: p.classId }
                        : {}),
                    ...(v.scopeType === "teaching_subject"
                      ? { subject: v.subject }
                      : {}),
                    startsOn: v.startsOn,
                    endsOn: v.endsOn || null,
                  },
                ],
              })
            }
            note="使用工作範圍所選學期與班級，保留已有授權。確認後請重新載入。"
          />
          {details.assignments.length > 0 && (
            <ActionForm
              title="移除一筆 Scope 授權"
              fields={[
                {
                  name: "assignmentId",
                  label: "授權紀錄",
                  options: details.assignments.map((a) => [
                    String(a.id),
                    `${a.scope_type}・${a.class_id ?? a.grade ?? "全校"}・${a.subject ?? ""}・${a.starts_on}`,
                  ]),
                },
              ]}
              run={(v) =>
                update({
                  assignments: assignments().filter(
                    (_, i) => details.assignments[i].id !== v.assignmentId,
                  ),
                })
              }
            />
          )}
          <ActionForm
            title="強制登出所有裝置"
            fields={[]}
            run={async () => {
              const r = await p.request(path + "/revoke", confirm);
              setDetails(null);
              return r;
            }}
          />
          <ActionForm
            title="核准 Google 身分重新綁定"
            fields={[
              {
                name: "authorizedEmail",
                label: "新的授權 Email",
                type: "email",
              },
              { name: "reason", label: "原因", type: "textarea" },
            ]}
            run={async (v) => {
              const r = (await p.request(path + "/rebind", {
                ...confirm,
                ...v,
              })) as Item;
              setToken(String(r.requestToken));
              return {
                expiresAt: r.expiresAt,
                message: "一次性核准已建立；請由新身分持有人於 5 分鐘內驗證。",
              };
            }}
          />
        </>
      )}
      {token && (
        <section className="admin-panel">
          <h3>一次性核准憑證</h3>
          <p>
            只在本畫面暫存，不放入網址或瀏覽器持久儲存。請經受控管道交付新身分持有人。
          </p>
          <label>
            核准憑證
            <input type="password" readOnly value={token} autoComplete="off" />
          </label>
          <button onClick={() => void navigator.clipboard.writeText(token)}>
            複製憑證
          </button>
          <button onClick={() => setToken("")}>清除憑證</button>
        </section>
      )}
      <DataView value={null} />
    </>
  );
}
