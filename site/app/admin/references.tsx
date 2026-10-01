"use client";
import { useState } from "react";
import Choice from "../public/choice";
import { ActionForm, subjectOptions, type Field } from "./widgets";
import type { WorkspaceProps, Item } from "./workspace";
export default function References(p: WorkspaceProps) {
  const [items, setItems] = useState<Item[]>([]),
    [selected, setSelected] = useState(""),
    [next, setNext] = useState("");
  const can = (p.profile.permissions as string[]).includes("ai.manage");
  const item = items.find((i) => i.id === selected);
  const fields = (i?: Item): Field[] => [
    { name: "title", label: "標題", value: String(i?.title ?? "") },
    {
      name: "description",
      label: "說明",
      type: "textarea",
      required: false,
      value: String(i?.description ?? ""),
    },
    {
      name: "subject",
      label: "科目",
      value: String(i?.subject ?? "ALL"),
      options: [["ALL", "所有科目"], ...subjectOptions],
    },
    {
      name: "grade",
      label: "年級",
      value: String(i?.grade ?? "ALL"),
      options: [
        ["ALL", "所有年級"],
        ["7", "七年級"],
        ["8", "八年級"],
        ["9", "九年級"],
      ],
    },
    {
      name: "validFrom",
      label: "有效起日",
      type: "date",
      required: false,
      value: String(i?.validFrom ?? ""),
    },
    {
      name: "validTo",
      label: "有效截止日（不含當日）",
      type: "date",
      required: false,
      value: String(i?.validTo ?? ""),
    },
  ];
  const metadata = (v: Record<string, string>) => ({
    title: v.title,
    description: v.description,
    subject: v.subject === "ALL" ? null : v.subject,
    grade: v.grade === "ALL" ? null : Number(v.grade),
    validFrom: v.validFrom || null,
    validTo: v.validTo || null,
  });
  return (
    <>
      <ActionForm
        title="參考資料清單"
        fields={[
          {
            name: "after",
            label: "下一頁游標（留空從頭查閱）",
            required: false,
            value: next,
          },
        ]}
        read
        run={async (v) => {
          const r = (await p.request(
            "/api/admin/references" +
              (v.after ? "?after=" + encodeURIComponent(v.after) : ""),
          )) as { items: Item[]; next: string | null };
          setItems(r.items);
          setNext(r.next ?? "");
          return r;
        }}
      />
      {can && (
        <ActionForm
          title="上傳教學參考文件"
          fields={[
            ...fields(),
            { name: "file", label: "PDF／Markdown 檔案", type: "file" },
            {
              name: "format",
              label: "檔案格式",
              options: [
                ["md", "Markdown"],
                ["pdf", "PDF"],
              ],
            },
          ]}
          run={async (v, file) => {
            if (!file) throw new Error("請先選擇檔案。");
            return p.request("/api/admin/references", file, "POST", {
              "Content-Type": "application/octet-stream",
              "X-Reference-Metadata": encodeURIComponent(
                JSON.stringify(metadata(v)),
              ),
              "X-Reference-Filename": encodeURIComponent(file.name),
              "X-Reference-Format": v.format,
            });
          }}
          note="只上傳不含個資與 Secret 的教學資料；上傳後為草稿，需完成隱私檢查才能啟用。"
        />
      )}
      <section className="admin-panel">
        <h3>編輯資料</h3>
        <Choice
          label="參考文件"
          value={selected || "_"}
          onChange={(v) => setSelected(v === "_" ? "" : v)}
          options={[
            ["_", "請先載入清單"],
            ...items.map(
              (i) =>
                [String(i.id), `${i.title}・版本 ${i.version}`] as [
                  string,
                  string,
                ],
            ),
          ]}
        />
      </section>
      {item && can && (
        <ActionForm
          key={selected + item.version}
          title="更新資料／啟用／封存"
          fields={[
            ...fields(item),
            {
              name: "status",
              label: "狀態",
              value: String(item.status),
              options: [
                ["draft", "草稿"],
                ["active", "啟用"],
                ["archived", "封存"],
              ],
            },
            {
              name: "privacyReviewed",
              label: "隱私檢查",
              options: [
                ["false", "尚未完成檢查"],
                ["true", "已確認不含學生／教師個資或 Secret"],
              ],
            },
          ]}
          run={(v) =>
            p.request("/api/admin/references/" + encodeURIComponent(selected), {
              version: item.version,
              metadata: metadata(v),
              status: v.status,
              privacyReviewed: v.privacyReviewed === "true",
            })
          }
        />
      )}
      <ActionForm
        title="查找有效參考段落"
        fields={[
          { name: "query", label: "教學查詢文字" },
          { name: "subject", label: "科目", options: subjectOptions },
          {
            name: "grade",
            label: "年級",
            options: [
              ["7", "七年級"],
              ["8", "八年級"],
              ["9", "九年級"],
            ],
          },
        ]}
        read
        run={(v) =>
          p.request("/api/admin/references/retrieve", {
            query: v.query,
            subject: v.subject,
            grade: Number(v.grade),
            ...(p.classId ? { classId: p.classId } : {}),
          })
        }
        note="只作資料查閱；文件內文字不能授予指令或執行工具。"
      />
      {can && (
        <>
          <ActionForm
            title="待清理上傳"
            fields={[]}
            read
            run={() => p.request("/api/admin/references/pending")}
          />
          <ActionForm
            title="重試失敗上傳清理"
            fields={[{ name: "id", label: "待清理作業編號" }]}
            run={(v) =>
              p.request(
                "/api/admin/references/" +
                  encodeURIComponent(v.id) +
                  "/cleanup",
                {},
              )
            }
          />
        </>
      )}
    </>
  );
}
