export default function Home() {
  return (
    <main className="preview-shell">
      <p className="eyebrow">CLASSROOM AIGRADE · PHASE 4</p>
      <h1>
        學生成績與
        <br />
        AI 學習建議
      </h1>
      <p className="intro">評量、名單快照與草稿成績服務已建立。</p>
      <section className="preview-card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">目前進度</h2>
        <p>Google 登入實測依指示暫緩。家長查詢與管理介面尚未開放。</p>
        <a href="/api/health">查看服務狀態</a>
      </section>
      <footer>僅供開發預覽 · 未載入學生資料</footer>
    </main>
  );
}
