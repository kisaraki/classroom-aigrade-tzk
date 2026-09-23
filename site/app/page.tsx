export default function Home() {
  return (
    <main className="preview-shell">
      <p className="eyebrow">CLASSROOM AIGRADE · PHASE 1</p>
      <h1>
        學生成績與
        <br />
        AI 學習建議
      </h1>
      <p className="intro">資料模型與本機驗證環境已建立。</p>
      <section className="preview-card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">目前進度</h2>
        <p>Google 登入驗證依指示暫緩。成績查詢與管理功能尚未開放。</p>
        <a href="/api/health">查看服務狀態</a>
      </section>
      <footer>僅供開發預覽 · 未載入學生資料</footer>
    </main>
  );
}
