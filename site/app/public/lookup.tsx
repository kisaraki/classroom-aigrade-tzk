"use client";
import { useState, useRef, useEffect } from "react";
import Choice from "./choice";
import Result from "./result";
import type { LookupResult } from "../../lib/server/public/service";
export default function Lookup() {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<AbortController | null>(null);
  function clear() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setResult(null);
    setMessage("");
    form.current?.reset();
  }
  useEffect(() => {
    const reset = () => {
      pending.current?.abort();
      setResult(null);
      setMessage("");
      setBusy(false);
      form.current?.reset();
    };
    window.addEventListener("pagehide", reset);
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) reset();
    };
    window.addEventListener("pageshow", restore);
    return () => {
      pending.current?.abort();
      window.removeEventListener("pagehide", reset);
      window.removeEventListener("pageshow", restore);
    };
  }, []);
  useEffect(() => {
    if (result) document.getElementById("result-heading")?.focus();
  }, [result]);
  return (
    <main className="lookup-shell">
      <header className="school-heading">
        <span aria-hidden="true">▤</span>
        <div>
          <p>學習紀錄</p>
          <h1>成績與學習建議</h1>
        </div>
      </header>
      <aside className="lookup-card">
        <h2>809 班模擬展示</h2>
        <p>25 位虛構學生，包含缺考、不及格與 0 分案例。</p>
        <a href="/demo/809">開啟模擬成績與班級總覽 →</a>
      </aside>
      <section className="lookup-card" aria-labelledby="lookup-title">
        <h2 id="lookup-title">查詢成績</h2>
        <p className="muted">請填寫評量當時的班級與學生資料。</p>
        <form
          method="post"
          action="/api/public/lookup"
          ref={form}
          autoComplete="off"
          onSubmit={async (e) => {
            e.preventDefault();
            pending.current?.abort();
            const controller = new AbortController();
            pending.current = controller;
            setResult(null);
            setBusy(true);
            setMessage("正在查詢…");
            const data = new FormData(e.currentTarget);
            try {
              const response = await fetch("/api/public/lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
                credentials: "omit",
                signal: controller.signal,
                body: JSON.stringify({
                  year: data.get("year"),
                  term: Number(data.get("term")),
                  classCode: data.get("classCode"),
                  sequence: Number(data.get("sequence")),
                  name: data.get("name"),
                  birthDate: data.get("birthDate"),
                }),
              });
              const body = await response.json();
              if (controller.signal.aborted) return;
              if (!response.ok) {
                setMessage(
                  response.status === 400
                    ? "請核對資料，仍無法查詢請聯絡校方。"
                    : "查詢服務暫時無法使用，請稍後再試。",
                );
                return;
              }
              setResult(body as LookupResult);
              setMessage("查詢完成。");
              form.current?.reset();
            } catch {
              if (!controller.signal.aborted)
                setMessage("查詢服務暫時無法使用，請稍後再試。");
            } finally {
              if (pending.current === controller) setBusy(false);
            }
          }}
        >
          <div className="lookup-grid">
            <label>
              學年度
              <input
                name="year"
                inputMode="numeric"
                pattern="[0-9]{2,3}"
                placeholder="例如 115"
                required
                autoComplete="off"
              />
            </label>
            <Choice
              label="學期"
              name="term"
              defaultValue="1"
              options={[
                ["1", "上學期"],
                ["2", "下學期"],
              ]}
            />
            <label>
              班級
              <input
                name="classCode"
                inputMode="numeric"
                pattern="[7-9][0-9]{2}"
                placeholder="例如 701"
                required
                autoComplete="off"
              />
            </label>
            <Choice
              label="定期評量"
              name="sequence"
              defaultValue="1"
              options={[
                ["1", "第一次"],
                ["2", "第二次"],
                ["3", "第三次"],
              ]}
            />
            <label>
              學生姓名
              <input name="name" maxLength={100} required autoComplete="off" />
            </label>
            <label>
              出生日期
              <input name="birthDate" type="date" required autoComplete="off" />
            </label>
          </div>
          <p className="privacy-note">
            資料僅用於本次查詢。使用共用裝置時，請在查閱後清除結果。
          </p>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "查詢中…" : "查詢成績"} <span aria-hidden="true">→</span>
          </button>
          <button className="clear-button" type="button" onClick={clear}>
            清除資料與結果
          </button>
          <p role="status" aria-live="polite">
            {message}
          </p>
        </form>
      </section>
      {result && <Result result={result} />}
      <footer className="lookup-footer">
        只顯示已發布的成績。資料若有疑問，請聯絡校方。
      </footer>
    </main>
  );
}
