"use client";
import Choice from "./choice";
import { useState } from "react";
import type { LookupResult } from "../../lib/server/public/service";
const scoreText = (value: number | null) =>
  value === null ? "—" : (value / 100).toFixed(2);
const subjects: Record<string, string> = {
  CHINESE: "國文",
  ENGLISH: "英文",
  MATH: "數學",
  SCIENCE: "自然",
  GEOGRAPHY: "地理",
  HISTORY: "歷史",
  CIVICS: "公民",
};
const statuses: Record<string, string> = {
  HISTORICAL_UNAVAILABLE: "原始快照已清理",
  UNPUBLISHED: "尚未發布",
  NOT_APPLICABLE: "不適用",
  NOT_HELD: "未舉行",
  UNENTERED: "未輸入",
  ABSENT: "缺考",
  OFFICIAL_LEAVE: "公假",
  SICK_LEAVE: "病假",
  EXEMPT: "免試",
};
const sections: Record<string, string> = {
  summary: "表現摘要",
  diagnosis: "學習診斷",
  improvements: "需要加強",
  plan: "方法與讀書計畫",
  encouragement: "鼓勵",
  parentSupport: "家長可協助方式",
};
export default function Result({ result }: { result: LookupResult }) {
  const [audience, setAudience] = useState<"parent" | "student">("parent");
  const [range, setRange] = useState("term");
  const [mode, setMode] = useState("both");
  const points = result.trends.filter(
    (p) =>
      range === "all" ||
      (p.year === result.year && (range === "year" || p.term === result.term)),
  );
  const series =
    mode === "quiz"
      ? ["quiz"]
      : mode === "midterm"
        ? ["midterm"]
        : ["quiz", "midterm", "exam"];
  const labels: Record<string, string> = {
    quiz: "檢測",
    midterm: "段考",
    exam: "定評",
  };
  const colors: Record<string, string> = {
    quiz: "#176b5a",
    midterm: "#9a5211",
    exam: "#5953a2",
  };
  const advice = result.advice[audience];
  return (
    <div className="public-results">
      <section className="result-card" aria-labelledby="result-heading">
        <div className="result-heading">
          <h2 id="result-heading" tabIndex={-1}>
            {result.year} 學年度・{result.term === 1 ? "上" : "下"}學期・第{" "}
            {result.sequence} 次
          </h2>
          <span className="status-badge">
            {result.provisional ? "暫時排名" : "正式排名"}
          </span>
        </div>
        <p className="muted">
          {result.provisional
            ? "僅計入已發布的評量分類。"
            : "檢測與段考皆已發布。"}
          「—」表示沒有有效數值，0 分仍計入。
        </p>
        <dl className="metric-grid">
          {[
            ["檢測平均", result.quiz.average],
            ["段考平均", result.midterm.average],
            ["定評平均", result.exam.average],
            ["定評總分", result.exam.total],
            ["學期平均", result.semester.average],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{scoreText(value as number | null)}</dd>
            </div>
          ))}
          <div>
            <dt>班級名次</dt>
            <dd>
              {result.classRank ?? "—"}
              {result.classStatistics.population !== null && (
                <small>／{result.classStatistics.population} 人</small>
              )}
            </dd>
          </div>
        </dl>
        <p className="muted">
          學期平均依本學期已發布的有效原始成績計算，不含原校成績。
        </p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="各科成績表"
        >
          <table>
            <caption>各科成績與狀態</caption>
            <thead>
              <tr>
                <th scope="col">科目</th>
                <th scope="col">檢測</th>
                <th scope="col">段考</th>
              </tr>
            </thead>
            <tbody>
              {result.scores.map((row) => (
                <tr key={row.subject}>
                  <th scope="row">{subjects[row.subject] ?? row.subject}</th>
                  {[row.quiz, row.midterm].map((mark, i) => (
                    <td key={i}>
                      {mark.status === "NORMAL"
                        ? scoreText(mark.value)
                        : (statuses[mark.status] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.historicalInputsRemoved ? (
          <p role="status">
            此歷史評量的原始快照與群體統計已清理。保留的個人摘要與名次不重新計算。
          </p>
        ) : (
          <div className="statistics-grid">
            {[
              ["班級", result.classStatistics],
              ["全年段", result.gradeStatistics],
            ].map(([label, stats]) => {
              const s = stats as LookupResult["classStatistics"];
              return (
                <div key={String(label)}>
                  <h3>{String(label)}統計</h3>
                  <p>
                    平均 <strong>{scoreText(s.average)}</strong>　最高平均{" "}
                    <strong>{scoreText(s.maximum)}</strong>
                  </p>
                  <p className="muted">
                    在籍快照 {s.population} 人・本校參與 {s.participationCount}{" "}
                    人
                    <br />
                    具排名資格 {s.eligibleCount} 人・實際排名 {s.rankedCount} 人
                    <br />
                    有效成績人數：檢測 {s.quizValidStudents}、段考{" "}
                    {s.midtermValidStudents}、定評 {s.validStudents}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        <p className="muted">
          {result.semesterInputsRemoved
            ? "本學期含已清理的計算輸入，因此不重算學期平均。"
            : "群體平均以有效分數總和除以有效筆數；最高平均為該群體的最高定評平均。不含原校成績。"}
        </p>
      </section>
      <section className="result-card" aria-labelledby="trends-title">
        <h2 id="trends-title">學習趨勢</h2>
        <div className="chart-controls">
          <Choice
            label="時間範圍"
            value={range}
            onChange={setRange}
            options={[
              ["term", "本學期（最多 3 次）"],
              ["year", "本學年度（最多 6 次）"],
              ["all", "國中三年（最多 18 次）"],
            ]}
          />
          <Choice
            label="分析模式"
            value={mode}
            onChange={setMode}
            options={[
              ["both", "檢測＋段考合併分析"],
              ["quiz", "檢測趨勢"],
              ["midterm", "段考趨勢"],
            ]}
          />
        </div>
        <div className="chart-legend">
          {series.map((key) => (
            <span key={key} style={{ color: colors[key] }}>
              {labels[key]}
            </span>
          ))}
        </div>
        <svg
          viewBox="0 0 680 240"
          role="img"
          aria-label="已發布平均趨勢圖；完整數值見下方表格"
          className="trend-chart"
        >
          {[0, 25, 50, 75, 100].map((n) => (
            <g key={n}>
              <line
                x1="40"
                x2="660"
                y1={210 - n * 1.8}
                y2={210 - n * 1.8}
                stroke="#dce5df"
              />
              <text x="5" y={215 - n * 1.8} fontSize="12" fill="#536b64">
                {n}
              </text>
            </g>
          ))}
          {series.map((key, index) => {
            const x = (i: number) =>
              points.length < 2 ? 350 : 50 + (i * 600) / (points.length - 1);
            return (
              <g key={key} stroke={colors[key]} fill={colors[key]}>
                {points.map((p, i) => {
                  const value = p[key as "quiz" | "midterm" | "exam"];
                  const prior = i
                    ? points[i - 1][key as "quiz" | "midterm" | "exam"]
                    : null;
                  if (value === null) return null;
                  return (
                    <g key={i}>
                      {i > 0 && prior !== null && (
                        <line
                          x1={x(i - 1)}
                          x2={x(i)}
                          y1={210 - (prior / 100) * 1.8}
                          y2={210 - (value / 100) * 1.8}
                          strokeWidth="2"
                          strokeDasharray={
                            index === 1
                              ? "6 4"
                              : index === 2
                                ? "2 3"
                                : undefined
                          }
                        />
                      )}
                      <circle cx={x(i)} cy={210 - (value / 100) * 1.8} r="4">
                        <title>
                          {`${p.year}-${p.term} 第${p.sequence}次 ${labels[key]} ${scoreText(value)}`}
                        </title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="趨勢數值表"
        >
          <table>
            <caption>趨勢數值（未發布／無數值不連線）</caption>
            <thead>
              <tr>
                <th scope="col">評量</th>
                {series.map((k) => (
                  <th key={k} scope="col">
                    {labels[k]}
                  </th>
                ))}
                <th scope="col">狀態</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={`${p.year}-${p.term}-${p.sequence}`}>
                  <th scope="row">
                    {p.year}-{p.term} 第{p.sequence}次
                  </th>
                  {series.map((k) => (
                    <td key={k}>
                      {scoreText(p[k as "quiz" | "midterm" | "exam"])}
                    </td>
                  ))}
                  <td>{p.provisional ? "暫時" : "正式"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {result.externalTrends.length > 0 && (
        <section className="result-card">
          <h2>原校成績紀錄</h2>
          <p className="muted">
            與本校成績分開呈現，不計入本校平均、群體統計與排名。
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="原校成績紀錄"
          >
            <table>
              <caption>個人原校成績</caption>
              <thead>
                <tr>
                  <th scope="col">評量</th>
                  <th scope="col">檢測平均</th>
                  <th scope="col">段考平均</th>
                  <th scope="col">定評平均</th>
                </tr>
              </thead>
              <tbody>
                {result.externalTrends.map((p) => (
                  <tr key={`${p.year}-${p.term}-${p.sequence}`}>
                    <th scope="row">
                      {p.year}-{p.term} 第{p.sequence}次
                    </th>
                    <td>{scoreText(p.quiz)}</td>
                    <td>{scoreText(p.midterm)}</td>
                    <td>{scoreText(p.exam)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="result-card" aria-labelledby="advice-title">
        <h2 id="advice-title">AI 學習建議</h2>
        <p className="muted">建議供學習參考，請依實際狀況與教師討論。</p>
        <Choice
          label="閱讀版本"
          value={audience}
          onChange={(v) => setAudience(v as "parent" | "student")}
          options={[
            ["parent", "家長版"],
            ["student", "學生版"],
          ]}
        />
        {advice ? (
          Object.entries(advice).map(([key, text]) => (
            <div key={key} className="advice-section">
              <h3>{sections[key]}</h3>
              <p>{text}</p>
            </div>
          ))
        ) : (
          <p role="status">目前尚無可顯示的最新建議。成績查詢不受影響。</p>
        )}
      </section>
    </div>
  );
}
