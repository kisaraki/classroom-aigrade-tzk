export default function Home() {
  return (
    <main className="preview-shell">
      <p className="eyebrow">CLASSROOM AIGRADE · PHASE 0</p>
      <h1>
        學生成績與
        <br />
        AI 學習建議
      </h1>
      <p className="intro">Hello World！基礎環境預覽已啟動。</p>
      <section className="preview-card" aria-labelledby="preview-heading">
        <h2 id="preview-heading">目前進度</h2>
        <p>
          正在確認平台、資料儲存與 Google
          登入相容性。成績查詢與管理功能尚未開放。
        </p>
        <a href="/api/health">查看服務狀態</a>
      </section>
      <footer>僅供開發預覽 · 未載入學生資料</footer>
    </main>
  );
}
