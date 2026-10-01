"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import Login from "./login";
import Choice from "../public/choice";
import { DataView } from "./widgets";
import Panels from "./panels";
import "./workspace.css";
export type Item = Record<string, unknown>;
export const navigation = [
  ["dashboard", "總覽"],
  ["years", "學年度"],
  ["classes", "班級"],
  ["students", "學生"],
  ["enrollments", "學籍"],
  ["exams", "評量"],
  ["scores", "成績"],
  ["imports", "匯入"],
  ["rankings", "排名"],
  ["ai", "AI 建議"],
  ["references", "參考資料"],
  ["archive", "封存與回收"],
  ["reports", "報表"],
  ["audit", "稽核紀錄"],
  ["users", "使用者"],
  ["settings", "設定"],
  ["profile", "個人資料"],
] as const;
export type Requester = (
  path: string,
  body?: unknown,
  method?: string,
  headers?: Record<string, string>,
) => Promise<unknown>;
export type WorkspaceProps = {
  request: Requester;
  workspace: (operation: string, input?: Item) => Promise<unknown>;
  profile: Item;
  terms: Item[];
  classes: Item[];
  exams: Item[];
  termId: string;
  classId: string;
  examId: string;
  onDate: string;
  refresh: () => void;
};
const messages: Record<string, string> = {
  AUDIT_SOURCE_CHANGED: "稽核保存日期已切換，請重新讀取。",
  AUTHENTICATION_REQUIRED: "登入已失效，請重新登入。",
  AUTH_NOT_CONFIGURED: "Google 登入尚未完成平台設定。",
  AUTH_DATABASE_UNAVAILABLE: "管理資料庫尚未就緒。",
  RECENT_AUTHENTICATION_REQUIRED: "請先重新驗證 Google 身分，再重新預覽。",
  SCOPE_DENIED: "您的授權範圍不包含這項資料。",
  PERMISSION_DENIED: "您沒有這項操作權限。",
  STALE_PREVIEW: "資料已變動，請重新讀取及預覽。",
  VERSION_CONFLICT: "版本已變動，請重新讀取。",
  PURGE_IN_PROGRESS: "資料清理中，請稍後再試。",
};
export default function Workspace() {
  const [profile, setProfile] = useState<Item | null>(null),
    [section, setSection] = useState("dashboard"),
    [message, setMessage] = useState("正在確認登入狀態…"),
    [terms, setTerms] = useState<Item[]>([]),
    [classes, setClasses] = useState<Item[]>([]),
    [exams, setExams] = useState<Item[]>([]),
    [termId, setTermId] = useState(""),
    [classId, setClassId] = useState(""),
    [examId, setExamId] = useState(""),
    [onDate, setOnDate] = useState(""),
    [revision, setRevision] = useState(0);
  const controllers = useRef(new Set<AbortController>()),
    generation = useRef(0);
  const request: Requester = useCallback(
    async (path, body, method, headers) => {
      const controller = new AbortController(),
        g = generation.current;
      controllers.current.add(controller);
      try {
        const response = await fetch(path, {
          method: method ?? (body === undefined ? "GET" : "POST"),
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            ...(body instanceof File
              ? {}
              : body === undefined
                ? {}
                : { "Content-Type": "application/json" }),
            ...headers,
          },
          body:
            body === undefined
              ? undefined
              : body instanceof File
                ? body
                : JSON.stringify(body),
          signal: controller.signal,
        });
        const data = (response.status === 204 ? {} : await response.json()) as {
          error?: string;
        };
        if (controller.signal.aborted || g !== generation.current)
          throw new Error("操作已取消。");
        if (!response.ok) {
          if (response.status === 401 || data.error === "ACCESS_DENIED") {
            setProfile(null);
            setTerms([]);
            setClasses([]);
            setExams([]);
          }
          throw new Error(
            messages[data.error ?? ""] ??
              "操作未完成，請檢查條件與版本，必要時聯絡管理員。",
          );
        }
        return data;
      } finally {
        controllers.current.delete(controller);
      }
    },
    [],
  );
  const workspace = useCallback(
    async (operation: string, input: Item = {}) =>
      request("/api/admin/workspace", { operation, input }),
    [request],
  );
  const clear = useCallback(() => {
    generation.current++;
    for (const c of controllers.current) c.abort();
    controllers.current.clear();
    setProfile(null);
    setTerms([]);
    setClasses([]);
    setExams([]);
    setMessage("請登入以開啟管理工作區。");
  }, []);
  useEffect(() => {
    const activeControllers = controllers.current;
    const hide = () => clear();
    window.addEventListener("pagehide", hide);
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) {
        clear();
        setRevision((v) => v + 1);
      }
    };
    window.addEventListener("pageshow", restore);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", restore);
      for (const c of activeControllers) c.abort();
    };
  }, [clear]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const p = (await workspace("profile")) as Item;
        if (!active) return;
        setProfile(p);
        const data = (await workspace("terms")) as { terms: Item[] };
        if (!active) return;
        setTerms(data.terms);
        setMessage("");
      } catch (e) {
        if (active) setMessage(e instanceof Error ? e.message : "無法載入。");
      }
    })();
    return () => {
      active = false;
    };
  }, [revision, workspace]);
  useEffect(() => {
    if (!profile || !termId || !onDate) return;
    let active = true;
    void workspace("context", { termId, onDate })
      .then((v) => {
        if (active) {
          const c = v as { classes: Item[]; exams: Item[] };
          setClasses(c.classes);
          setExams(c.exams);
          setMessage("");
        }
      })
      .catch((e) => {
        if (active) setMessage(e.message);
      });
    return () => {
      active = false;
    };
  }, [termId, onDate, revision, profile, workspace]);
  const user = profile?.user as Item | undefined;
  const props = {
    request,
    workspace,
    profile: profile ?? {},
    terms,
    classes,
    exams,
    termId,
    classId,
    examId,
    onDate,
    refresh: () => setRevision((v) => v + 1),
  };
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <p className="eyebrow">CLASSROOM / 管理工作區</p>
          <h1>讓教務工作清楚有序</h1>
        </div>
        <Link href="/" onClick={clear}>
          公開查詢
        </Link>
      </header>
      {!profile ? (
        <Login
          request={request}
          message={message}
          refresh={() => setRevision((v) => v + 1)}
        />
      ) : (
        <div className="admin-layout">
          <aside>
            <p className="admin-person">
              {String(user?.display_name ?? "管理員")}
            </p>
            <nav aria-label="管理功能">
              {navigation.map(([key, label]) => (
                <button
                  key={key}
                  aria-current={section === key ? "page" : undefined}
                  onClick={() => {
                    generation.current++;
                    for (const c of controllers.current) c.abort();
                    setSection(key);
                    setMessage("");
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            <button
              onClick={async () => {
                try {
                  await request("/api/auth/logout", {});
                } finally {
                  clear();
                }
              }}
            >
              登出並清除畫面
            </button>
          </aside>
          <div className="admin-content">
            <header className="section-header">
              <div>
                <p className="eyebrow">管理功能</p>
                <h2 tabIndex={-1}>
                  {navigation.find((n) => n[0] === section)?.[1]}
                </h2>
              </div>
              <button
                onClick={() => {
                  setClasses([]);
                  setExams([]);
                  setClassId("");
                  setExamId("");
                  setRevision((v) => v + 1);
                }}
              >
                重新讀取
              </button>
              <button
                onClick={async () => {
                  try {
                    const r = (await request("/api/auth/reauth/start", {})) as {
                      authorizationUrl: string;
                    };
                    window.location.assign(r.authorizationUrl);
                  } catch (e) {
                    setMessage((e as Error).message);
                  }
                }}
              >
                重新驗證 Google
              </button>
            </header>
            <section className="context-bar" aria-label="工作範圍">
              <Choice
                label="學期"
                value={termId || "_"}
                onChange={(v) => {
                  if (v === "_") v = "";
                  setClasses([]);
                  setExams([]);
                  setClassId("");
                  setExamId("");
                  setTermId(v);
                  const t = terms.find((t) => t.id === v);
                  setOnDate(String(t?.starts_on ?? ""));
                }}
                options={[
                  ["_", "請選擇學期"],
                  ...terms.map(
                    (t) =>
                      [
                        String(t.id),
                        `${t.year_code} 學年度・第 ${t.term_number} 學期`,
                      ] as [string, string],
                  ),
                ]}
              />
              <label>
                學籍日期
                <input
                  type="date"
                  value={onDate}
                  onChange={(e) => {
                    setClasses([]);
                    setExams([]);
                    setClassId("");
                    setExamId("");
                    setOnDate(e.target.value);
                  }}
                />
              </label>
              <Choice
                label="班級"
                value={classId || "_"}
                onChange={(v) => setClassId(v === "_" ? "" : v)}
                options={[
                  ["_", "請選擇班級"],
                  ...classes.map(
                    (c) => [String(c.id), String(c.code)] as [string, string],
                  ),
                ]}
              />
              <Choice
                label="評量"
                value={examId || "_"}
                onChange={(v) => setExamId(v === "_" ? "" : v)}
                options={[
                  ["_", "請選擇評量"],
                  ...exams.map(
                    (e) =>
                      [
                        String(e.id),
                        `第 ${e.sequence} 次（${e.starts_on}）`,
                      ] as [string, string],
                  ),
                ]}
              />
            </section>
            {message && <p role="status">{message}</p>}
            {section === "dashboard" ? (
              <section className="admin-panel">
                <h3>今天要處理什麼？</h3>
                <p>
                  先選擇學期與班級，再開啟左側工作項目。歷史學籍與評量使用各自的日期快照。
                </p>
                <div className="admin-metrics">
                  <div>
                    <strong>{classes.length}</strong>
                    <span>可見班級</span>
                  </div>
                  <div>
                    <strong>{exams.length}</strong>
                    <span>可見評量</span>
                  </div>
                </div>
                <p className="muted">
                  高風險操作需要 5 分鐘內 Google
                  重新驗證；資料變動時必須重新預覽。
                </p>
              </section>
            ) : section === "profile" ? (
              <section className="admin-panel">
                <h3>我的帳號與授權</h3>
                <DataView value={profile} />
                <p>帳號與授權範圍由 super_admin 維護。</p>
              </section>
            ) : (
              <Panels
                key={`${section}:${termId}:${classId}:${examId}:${onDate}:${revision}`}
                section={section}
                {...props}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
