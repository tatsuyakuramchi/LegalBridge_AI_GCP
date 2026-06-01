/**
 * workModelHtml — 作品中心(work-centric)新モデルの閲覧ページ。
 *
 * B1: もともと admin-ui(React)内に seed していた WorkModelPage を、
 *   新プラットフォームを所有する Search 側へ移設(D1 / サービス役割分担)。
 *   /api/v3/* は search-api が提供するため、同一オリジンの client fetch で読む。
 *
 * 依存 endpoint(本サービス内):
 *   GET /api/v3/source-ips   → 原作IP一覧(material_count 付き)
 *   GET /api/v3/works        → 自社作品一覧(product_count 付き)
 *   GET /api/v3/contracts    → 契約一覧(新モデル)
 *
 * 認証: ルート側で requireIapUser。/api/v3 read も requireRead で揃える。
 */

const STYLE = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
               "Yu Gothic", sans-serif;
  color: #111827; background: #f8fafc; font-size: 14px;
}
.shell { max-width: 1280px; margin: 0 auto; padding: 20px 24px 48px; }
.header {
  display: flex; align-items: end; justify-content: space-between; gap: 16px;
  border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 18px;
  flex-wrap: wrap;
}
h1 { margin: 0; font-size: 22px; letter-spacing: .02em; }
.muted { color: #6b7280; font-size: 12px; }
.actions { display: flex; gap: 8px; align-items: center; }
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 12px; border: 1px solid #111827; border-radius: 4px;
  background: #111827; color: #fff; text-decoration: none; cursor: pointer;
  font-weight: 600; font-size: 13px; white-space: nowrap;
}
.btn.secondary { background: #fff; color: #111827; }
section.block { margin-top: 22px; }
section.block > h2 {
  font-size: 14px; margin: 0 0 10px; font-weight: 700; color: #0f172a;
  display: flex; align-items: center; gap: 8px;
}
section.block > h2 .count {
  font-family: ui-monospace, monospace; font-size: 12px; color: #64748b; font-weight: 600;
}
.grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
.card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px;
}
.card .row1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.card .name { font-weight: 600; color: #0f172a; }
.card .sub { margin-top: 4px; font-size: 12px; color: #6b7280; }
.badge {
  font-family: ui-monospace, monospace; font-size: 11px; color: #334155;
  background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 2px 7px; white-space: nowrap;
}
.badge.outline { background: #fff; }
.empty { color: #94a3b8; font-size: 13px; padding: 8px 2px; }
#err { color: #b91c1c; font-size: 13px; margin-top: 8px; display: none; }
`;

export function workModelPage(): string {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>作品モデル — LegalBridge Search</title>
<style>${STYLE}</style>
</head><body>
<div class="shell">
  <div class="header">
    <div>
      <h1>作品モデル(work-centric)</h1>
      <div class="muted">原作IP・自社作品・契約を作品軸で閲覧(新プラットフォーム / <code>/api/v3</code>)</div>
    </div>
    <div class="actions">
      <button id="reloadBtn" class="btn">↻ 更新</button>
      <a class="btn secondary" href="/">← Search Portal に戻る</a>
    </div>
  </div>

  <div id="err"></div>

  <section class="block">
    <h2>📚 原作IP <span class="count" id="ipCount">…</span></h2>
    <div class="grid" id="ipGrid"></div>
  </section>

  <section class="block">
    <h2>🎲 自社作品 <span class="count" id="workCount">…</span></h2>
    <div class="grid" id="workGrid"></div>
  </section>

  <section class="block">
    <h2>📜 契約 <span class="count" id="contractCount">…</span></h2>
    <div class="grid" id="contractGrid"></div>
  </section>
</div>

<script>
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function card(name, badge, sub, badgeClass) {
    return '<div class="card"><div class="row1"><div class="name">' + esc(name) +
      '</div>' + (badge ? '<span class="badge ' + (badgeClass || '') + '">' + esc(badge) + '</span>' : '') +
      '</div><div class="sub">' + esc(sub) + '</div></div>';
  }
  function renderEmpty(el, msg) { el.innerHTML = '<div class="empty">' + esc(msg) + '</div>'; }

  async function getJson(url) {
    const r = await fetch(url, { credentials: "same-origin" });
    if (!r.ok) throw new Error(url + " → HTTP " + r.status);
    return r.json();
  }

  async function load() {
    const err = document.getElementById("err");
    err.style.display = "none"; err.textContent = "";
    const ids = ["ipCount", "workCount", "contractCount"];
    ids.forEach(function (id) { document.getElementById(id).textContent = "…"; });
    try {
      const [ips, works, contracts] = await Promise.all([
        getJson("/api/v3/source-ips"),
        getJson("/api/v3/works"),
        getJson("/api/v3/contracts"),
      ]);

      const ipGrid = document.getElementById("ipGrid");
      document.getElementById("ipCount").textContent = "(" + ips.length + ")";
      ipGrid.innerHTML = ips.length
        ? ips.map(function (s) {
            return card(s.title || ("#" + s.id), s.source_code,
              "権利者: " + (s.default_rights_holder || "—") + " / 素材 " + (s.material_count || 0));
          }).join("")
        : "";
      if (!ips.length) renderEmpty(ipGrid, "原作IPがありません");

      const workGrid = document.getElementById("workGrid");
      document.getElementById("workCount").textContent = "(" + works.length + ")";
      workGrid.innerHTML = works.length
        ? works.map(function (w) {
            return card(w.title || ("#" + w.id), w.work_code,
              (w.work_type || "—") + " / " + (w.status || "—") + " / 製品 " + (w.product_count || 0));
          }).join("")
        : "";
      if (!works.length) renderEmpty(workGrid, "自社作品がありません");

      const cGrid = document.getElementById("contractGrid");
      document.getElementById("contractCount").textContent = "(" + contracts.length + ")";
      cGrid.innerHTML = contracts.length
        ? contracts.map(function (c) {
            return card(c.contract_title || c.document_number || ("#" + c.id),
              c.contract_level || "—",
              (c.contract_category || "—") + " / " + (c.primary_vendor || "—") +
                " / " + (c.lifecycle_stage || "—") + " / 条件 " + (c.term_count || 0), "outline");
          }).join("")
        : "";
      if (!contracts.length) renderEmpty(cGrid, "契約がありません");
    } catch (e) {
      err.style.display = "block";
      err.textContent = "読み込みに失敗しました: " + (e && e.message ? e.message : e);
      ids.forEach(function (id) { document.getElementById(id).textContent = ""; });
    }
  }

  document.getElementById("reloadBtn").addEventListener("click", load);
  load();
</script>
</body></html>`;
}
