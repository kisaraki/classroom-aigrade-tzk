"use client";
import { useState } from "react";
import Link from "next/link";
import {
  demoScore,
  demoStudents,
  demoSubjects,
} from "../../../lib/demo/class809";
import "./demo.css";

export default function DemoClass() {
  const [seat, setSeat] = useState(1);
  const [filter, setFilter] = useState("all");
  const selected = demoStudents.find((s) => s.seat === seat)!;
  const rows = demoStudents.filter(
    (s) => filter === "all" || (filter === "absent" ? s.absent : s.failing),
  );
  return (
    <main className="demo-shell">
      <header className="demo-heading">
        <div>
          <p className="demo-eyebrow">
            模擬資料 · 115 學年度上學期 · 第一次定期評量
          </p>
          <h1>809 班學習紀錄</h1>
          <p>25 位虛構學生，查看檢測、段考與班級名次。</p>
        </div>
        <Link href="/">返回成績查詢</Link>
      </header>
      <aside className="demo-notice">
        <strong>僅供展示與驗收</strong>
        　所有學生及分數均為虛構。此頁不連接正式學籍；AI 建議未生成。
      </aside>
      <section className="demo-metrics" aria-label="模擬班級概況">
        <div>
          <span>班級人數</span>
          <strong>
            25 <small>人</small>
          </strong>
        </div>
        <div>
          <span>有缺考紀錄</span>
          <strong>
            {demoStudents.filter((s) => s.absent).length} <small>人</small>
          </strong>
        </div>
        <div>
          <span>有科目低於 60 分</span>
          <strong>
            {demoStudents.filter((s) => s.failing).length} <small>人</small>
          </strong>
        </div>
        <div>
          <span>全科缺考，不列排名</span>
          <strong>
            1 <small>人</small>
          </strong>
        </div>
      </section>
      <section className="demo-panel" aria-labelledby="student-detail">
        <div className="demo-toolbar">
          <div>
            <p className="demo-eyebrow">個人成績</p>
            <h2 id="student-detail">
              {selected.name} <small>／ {seat} 號</small>
            </h2>
          </div>
          <label>
            切換模擬學生
            <select
              value={seat}
              onChange={(e) => setSeat(Number(e.target.value))}
            >
              {demoStudents.map((s) => (
                <option key={s.seat} value={s.seat}>
                  {s.seat} 號 · {s.name}
                  {s.absent ? " · 有缺考" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="demo-summary" aria-live="polite">
          <span>
            定評平均{" "}
            <strong>{demoScore(selected.result.exam.averageHundredths)}</strong>
          </span>
          <span>
            總分{" "}
            <strong>{demoScore(selected.result.exam.totalHundredths)}</strong>
          </span>
          <span>
            班級名次{" "}
            <strong>
              {selected.result.classRank === null
                ? "不排名"
                : `第 ${selected.result.classRank} 名`}
            </strong>
          </span>
        </div>
        <div className="demo-table-wrap">
          <table>
            <caption className="demo-caption">
              檢測與段考各科成績（100 分制）
            </caption>
            <thead>
              <tr>
                <th scope="col">科目</th>
                <th scope="col">檢測</th>
                <th scope="col">段考</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(demoSubjects).map(([code, label]) => (
                <tr key={code}>
                  <th scope="row">{label}</th>
                  {["QUIZ", "MIDTERM"].map((type) => {
                    const s = selected.scores.find(
                      (x) => x.subject === code && x.examType === type,
                    );
                    return (
                      <td
                        key={type}
                        className={
                          s?.scoreStatus === "ABSENT"
                            ? "demo-absent"
                            : s?.scoreValue != null && s.scoreValue < 6000
                              ? "demo-fail"
                              : ""
                        }
                      >
                        {!s ? (
                          "不適用"
                        ) : s.scoreStatus === "ABSENT" ? (
                          "缺考"
                        ) : (
                          <>
                            {demoScore(s.scoreValue)}
                            {s.scoreValue! < 6000 && (
                              <span className="demo-score-note"> 不及格</span>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="demo-footnote">
          缺考不當作 0 分，也不納入平均；0
          分是有效成績。全無有效分數者顯示「—」並不排名。定評平均依有效檢測與段考分數計算。
        </p>
      </section>
      <section className="demo-panel" aria-labelledby="roster-title">
        <div className="demo-toolbar">
          <div>
            <p className="demo-eyebrow">僅限虛構名單</p>
            <h2 id="roster-title">809 班總覽</h2>
          </div>
          <label>
            篩選紀錄
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">全部 25 人</option>
              <option value="absent">有缺考</option>
              <option value="failing">有不及格科目</option>
            </select>
          </label>
        </div>
        <p aria-live="polite">
          顯示 {rows.length} 位模擬學生；點選姓名查看各科成績。
        </p>
        <div className="demo-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">座號</th>
                <th scope="col">模擬學生</th>
                <th scope="col">檢測平均</th>
                <th scope="col">段考平均</th>
                <th scope="col">定評平均</th>
                <th scope="col">班級名次</th>
                <th scope="col">狀態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className={s.seat === seat ? "demo-selected" : ""}
                >
                  <th scope="row">{s.seat}</th>
                  <td>
                    <button
                      type="button"
                      className="demo-student"
                      aria-pressed={s.seat === seat}
                      onClick={() => {
                        setSeat(s.seat);
                        document
                          .getElementById("student-detail")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                      }}
                    >
                      {s.name}
                    </button>
                  </td>
                  <td>{demoScore(s.result.quiz.averageHundredths)}</td>
                  <td>{demoScore(s.result.midterm.averageHundredths)}</td>
                  <td>{demoScore(s.result.exam.averageHundredths)}</td>
                  <td>{s.result.classRank ?? "—"}</td>
                  <td>
                    {s.absent && <span className="demo-tag">缺考</span>}
                    {s.failing && (
                      <span className="demo-tag demo-tag-fail">有不及格</span>
                    )}
                    {!s.absent && !s.failing && "全科及格"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <footer className="demo-footnote">
        模擬資料版本 809-v1 ·
        兩位同分學生採共同名次。正式家長查詢僅能取得自己的成績，不提供班級名單。
      </footer>
    </main>
  );
}
