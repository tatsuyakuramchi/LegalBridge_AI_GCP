/**
 * paymentContractsHtml — 支払対象契約検索 (Phase 28)。
 *
 *   GET /payments/contracts
 *
 * 発注書(個別契約)・単独契約書・利用許諾条件書を検索し、各契約の
 * 検収書 / 利用許諾料計算書の発行状況を確認する読み取り専用ページ。
 *   - viewer: 依頼者(legal_requests → staff)の department_code が自分と
 *     一致する契約のみ表示。
 *   - admin : 全件。
 * 手続き(検収書・計算書の依頼起票)は Slack /法務依頼 側で行う —
 * このページは検索と情報ダウンロード(CSV)に特化する。
 *
 * データ: GET /api/payment-contracts/list / CSV: /api/payment-contracts/export.csv
 */
import { popPage } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

const EXTRA_CSS = `<style>
.pct-filters{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
.pct-filters .f{display:flex;flex-direction:column;gap:4px}
.pct-filters label{font-size:11px;font-weight:800;color:var(--muted)}
.pct-filters input[type=text],.pct-filters select{border:1.5px solid #e2dbfb;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;background:#fff}
.pct-filters input[type=text]{min-width:260px}
.pct-summary{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:0 0 10px;font-size:12.5px;color:var(--muted)}
.pct-summary b{color:var(--ink)}
table.pct{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;font-size:12.5px}
table.pct th{background:#f6f3ff;color:var(--muted);font-size:11px;text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
table.pct td{padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
table.pct tr:hover td{background:var(--hover)}
table.pct td.num{font-variant-numeric:tabular-nums;white-space:nowrap}
.pct-type{display:inline-block;font-size:10px;font-weight:800;padding:1px 8px;border-radius:12px;white-space:nowrap;background:#efeaff;color:#6c5ce7}
.pct-type.master{background:#e8f2ff;color:#1e6bd6}
.pct-type.license{background:#fff0e6;color:#e8810f}
.pct-type.publication{background:#e9f9f0;color:#1a9c6b}
.pct-docno{font-family:ui-monospace,"Cascadia Mono",Menlo,monospace;font-size:12px;white-space:nowrap}
.pct-status{display:inline-block;font-size:11px;font-weight:800;white-space:nowrap}
.pct-status.ok{color:#1a9c6b}
.pct-status.none{color:#9aa0a6}
.pct-status.partial{color:#e8810f}
.pct-empty{color:var(--muted);padding:26px;text-align:center;background:#fff;border:1px solid var(--line);border-radius:14px}
.pct-note{background:#eef6ff;border:1px solid #cfe3ff;color:#1e5aa8;border-radius:12px;padding:8px 12px;font-size:12px;margin:0 0 12px}
</style>`;

const TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  purchase_order: { label: "発注書", cls: "" },
  master_contract: { label: "単独契約書", cls: "master" },
  license_condition: { label: "利用許諾条件書", cls: "license" },
  publication_condition: { label: "出版等条件書", cls: "publication" },
};

export function paymentContractsPage(
  role: Role = "viewer",
  deptCode: string | null = null
): string {
  const isAdmin = role === "admin";
  const scopeNote = isAdmin
    ? "admin ロールのため全部署の契約を表示しています。"
    : deptCode
      ? `あなたの部署コード <b>${deptCode}</b> の依頼に紐づく契約のみ表示しています。`
      : "スタッフマスタに部署コードが未設定のため、表示できる契約がありません。管理者に登録を依頼してください。";

  const body = `
  <div class="pct-note">
    🔎 検収書・利用許諾料計算書の<b>発行状況の確認と情報ダウンロード専用</b>のページです。
    発行の依頼は Slack の <b>/法務依頼</b> から行ってください (このページの契約番号をコピーして使えます)。
    ${scopeNote}
  </div>

  <div class="pct-filters">
    <div class="f"><label>キーワード (契約番号 / 件名 / 取引先)</label>
      <input type="text" id="pct-q" placeholder="例: ARC-PO-2026 / 株式会社〇〇">
    </div>
    <div class="f"><label>種別</label>
      <select id="pct-type">
        <option value="">すべて</option>
        <option value="purchase_order">発注書 (個別契約)</option>
        <option value="master_contract">単独契約書</option>
        <option value="license_condition">利用許諾条件書</option>
        <option value="publication_condition">出版等利用許諾条件書</option>
      </select>
    </div>
    <div class="f"><label>絞り込み</label>
      <select id="pct-pending">
        <option value="">すべて</option>
        <option value="1">未検収の明細がある契約のみ</option>
      </select>
    </div>
    <button class="pop-btn sm" id="pct-reload">🔄 検索</button>
    <span class="sp" style="flex:1"></span>
    <button class="pop-btn" id="pct-csv">📥 CSV ダウンロード</button>
  </div>

  <div class="pct-summary">
    <span>表示 <b id="pct-count">0</b> 件</span>
    <span class="muted">最大 300 件まで表示します。絞り込みで対象を減らしてください。</span>
  </div>

  <div id="pct-wrap"><div class="pct-empty">条件を指定して「検索」を押してください。</div></div>

<script>
  var TYPE_LABELS = ${JSON.stringify(TYPE_LABELS)};

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function qs() {
    var p = new URLSearchParams();
    p.set("q", document.getElementById("pct-q").value.trim());
    p.set("type", document.getElementById("pct-type").value);
    p.set("pending", document.getElementById("pct-pending").value);
    return p.toString();
  }
  function docsBadge(count, lineDone, lineTotal) {
    // 検収書/計算書の発行状況。文書があれば ✓、明細があるのに未発行なら「未」。
    if (count > 0) return '<span class="pct-status ok">✓ ' + count + ' 件</span>';
    if (lineTotal > 0 && lineDone < lineTotal) return '<span class="pct-status partial">未発行</span>';
    return '<span class="pct-status none">—</span>';
  }
  function render(rows) {
    document.getElementById("pct-count").textContent = String(rows.length);
    var wrap = document.getElementById("pct-wrap");
    if (!rows.length) {
      wrap.innerHTML = '<div class="pct-empty">該当する契約がありません。</div>';
      return;
    }
    var h = ['<table class="pct"><thead><tr>',
      '<th>種別</th><th>契約番号</th><th>件名</th><th>取引先</th>',
      '<th>明細 (検収済/総数)</th><th>検収書</th><th>計算書</th><th>依頼者 / 部署</th><th>課題</th>',
      '</tr></thead><tbody>'];
    rows.forEach(function (r) {
      var t = TYPE_LABELS[r.record_type] || { label: r.record_type, cls: "" };
      var lineCell = r.line_count > 0
        ? '<span class="num">' + r.inspected_count + " / " + r.line_count + "</span>"
        : '<span class="pct-status none">—</span>';
      h.push('<tr>',
        '<td><span class="pct-type ' + t.cls + '">' + esc(t.label) + "</span></td>",
        '<td class="pct-docno">' + esc(r.document_number || "-") + "</td>",
        "<td>" + esc(r.contract_title || "-") + "</td>",
        "<td>" + esc(r.vendor_name || "-") + (r.vendor_code ? ' <span class="pct-docno">(' + esc(r.vendor_code) + ")</span>" : "") + "</td>",
        '<td class="num">' + lineCell + "</td>",
        "<td>" + docsBadge(r.inspection_doc_count, r.inspected_count, r.line_count) + "</td>",
        "<td>" + docsBadge(r.calc_doc_count, 0, 0) + "</td>",
        "<td>" + esc(r.requester_name || "-") + (r.requester_dept ? ' <span class="pct-docno">(' + esc(r.requester_dept) + ")</span>" : "") + "</td>",
        '<td class="pct-docno">' + esc(r.issue_key || "-") + "</td>",
        "</tr>");
    });
    h.push("</tbody></table>");
    wrap.innerHTML = h.join("");
  }
  function load() {
    var wrap = document.getElementById("pct-wrap");
    wrap.innerHTML = '<div class="pct-empty">読み込み中…</div>';
    fetch("/api/payment-contracts/list?" + qs(), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "load failed");
        render(d.rows || []);
      })
      .catch(function (e) {
        wrap.innerHTML = '<div class="pct-empty">読み込みに失敗しました: ' + esc(e.message || e) + "</div>";
      });
  }
  document.getElementById("pct-reload").addEventListener("click", load);
  document.getElementById("pct-q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") load();
  });
  document.getElementById("pct-csv").addEventListener("click", function () {
    window.location.href = "/api/payment-contracts/export.csv?" + qs();
  });
  load();
</script>`;

  return popPage({
    active: "payment-contracts",
    mode: "view",
    title: "支払対象契約検索",
    subtitle: "検収書・計算書の発行状況を確認 (読み取り専用)",
    body,
    headExtra: EXTRA_CSS,
    role,
    deptCode,
  });
}
