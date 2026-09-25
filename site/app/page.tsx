export default function Home() {
  return (
    <main className="preview-shell">
      <p className="eyebrow">CLASSROOM AIGRADE · PHASE 8</p>
      <h1>
        學生成績與
        <br />
        AI 學習建議
      </h1>
      <p className="intro">封存、畢業、保存期限與安全復原核心已建立。</p>
      <section className="preview-card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">目前進度</h2>
        <p>Google 登入實測依指示暫緩。家長查詢與管理介面尚未開放。</p>
        <a href="/api/health">查看服務狀態</a>
      </section>
      <footer>僅供開發預覽 · 未載入學生資料</footer>
    </main>
  );
}
