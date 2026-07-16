/**
 * attachmentUploadHtml — 法務依頼 資料アップロード。
 *
 *   GET /attachments/upload            (?issue=LEGAL-123 でプリフィル)
 *
 * Slack /法務依頼 で起票した課題に、レビュー対象文書・参考資料などの
 * ファイルを格納するページ。依頼者は Drive に直接触れず、search-api が
 * worker (portal-secret S2S) へ中継して法務共有 Drive に保管する。
 * Drive 上のファイル名は「課題番号_Googleアカウント_元ファイル名」。
 *
 * データ: GET /api/attachment-upload/issues?q=   (課題検索・最小フィールドのみ)
 *         POST /api/attachment-upload             (multipart 中継)
 */
import { popPage } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

const EXTRA_CSS = `<style>
.aup-note{background:#eef6ff;border:1px solid #cfe3ff;color:#1e5aa8;border-radius:12px;padding:8px 12px;font-size:12px;margin:0 0 14px}
.aup-card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px}
.aup-card h3{margin:0 0 10px;font-size:13.5px}
.aup-row{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.aup-row .f{display:flex;flex-direction:column;gap:4px}
.aup-row label{font-size:11px;font-weight:800;color:var(--muted)}
.aup-row input[type=text],.aup-row select{border:1.5px solid #e2dbfb;border-radius:10px;padding:7px 10px;font:inherit;font-size:13px;background:#fff}
.aup-row input[type=text]{min-width:280px}
.aup-results{margin-top:10px}
.aup-issue{display:flex;gap:10px;align-items:center;padding:8px 10px;border:1.5px solid var(--line);border-radius:10px;margin-bottom:6px;cursor:pointer;font-size:12.5px}
.aup-issue:hover{background:var(--hover)}
.aup-issue.sel{border-color:#6c5ce7;background:#f4f1ff}
.aup-key{font-family:ui-monospace,"Cascadia Mono",Menlo,monospace;font-size:12px;font-weight:800;white-space:nowrap}
.aup-muted{color:var(--muted);font-size:11.5px}
.aup-selected{background:#e9f9f0;border:1px solid #bfe8d2;color:#15794f;border-radius:10px;padding:8px 12px;font-size:12.5px;margin-top:10px}
.aup-drop{border:2px dashed #cfc6f2;border-radius:14px;padding:22px;text-align:center;color:var(--muted);font-size:13px;background:#fbfaff}
.aup-drop.drag{border-color:#6c5ce7;background:#f4f1ff}
.aup-files{margin-top:10px;font-size:12.5px}
.aup-file{display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--line)}
.aup-file .st{margin-left:auto;font-size:11px;font-weight:800;white-space:nowrap}
.aup-file .st.ok{color:#1a9c6b}.aup-file .st.ng{color:#d63031}.aup-file .st.run{color:#e8810f}
.aup-empty{color:var(--muted);padding:14px;text-align:center;font-size:12.5px}
</style>`;

export function attachmentUploadPage(
  role: Role = "viewer",
  deptCode: string | null = null,
  initialIssue: string = ""
): string {
  const body = `
  <div class="aup-note">
    📎 Slack の <b>/法務依頼</b> で起票した課題に資料 (レビューしてほしい契約書ドラフト、
    参考資料など) を格納するページです。ファイルは法務の共有 Drive に
    「<b>課題番号_あなたのアカウント_元ファイル名</b>」の名前で保管され、
    Backlog 課題にも記録が残ります。課題番号は依頼送信後に Slack の DM で届きます。
  </div>

  <div class="aup-card">
    <h3>1. 対象の課題を指定</h3>
    <div class="aup-row">
      <div class="f"><label>課題番号 / 件名 / 取引先名で検索</label>
        <input type="text" id="aup-q" placeholder="例: LEGAL-123 / NDA / 株式会社〇〇">
      </div>
      <button class="pop-btn sm" id="aup-search">🔎 検索</button>
    </div>
    <div class="aup-results" id="aup-results"><div class="aup-empty">課題番号がわかっている場合はそのまま入力して検索してください。</div></div>
    <div class="aup-selected" id="aup-selected" style="display:none"></div>
  </div>

  <div class="aup-card">
    <h3>2. ファイルをアップロード</h3>
    <div class="aup-row" style="margin-bottom:10px">
      <div class="f"><label>資料の種別</label>
        <select id="aup-kind">
          <option value="counterparty_draft">相手方ドラフト (レビュー対象)</option>
          <option value="own_draft">自社ドラフト</option>
          <option value="reference" selected>参考資料</option>
        </select>
      </div>
    </div>
    <div class="aup-drop" id="aup-drop">
      ここにファイルをドラッグ＆ドロップ、またはクリックして選択<br>
      <span class="aup-muted">複数可 / 1ファイル 30MB まで</span>
      <input type="file" id="aup-file" multiple style="display:none">
    </div>
    <div class="aup-files" id="aup-files"></div>
  </div>`;

  const script = `
<script>
  var selectedIssue = ${JSON.stringify(
    // クエリ由来なので課題キーとして妥当な文字だけ通す (script 片の混入防止)。
    String(initialIssue || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "")
  )};

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function showSelected() {
    var box = document.getElementById("aup-selected");
    if (!selectedIssue) { box.style.display = "none"; return; }
    box.style.display = "";
    box.innerHTML = "✅ 格納先の課題: <b class=\\"aup-key\\">" + esc(selectedIssue) + "</b>";
  }
  function renderResults(rows) {
    var wrap = document.getElementById("aup-results");
    if (!rows.length) {
      wrap.innerHTML = '<div class="aup-empty">該当する依頼が見つかりません。課題番号 (例: LEGAL-123) をご確認ください。</div>';
      return;
    }
    wrap.innerHTML = rows.map(function (r) {
      var sel = r.issue_key === selectedIssue ? " sel" : "";
      return '<div class="aup-issue' + sel + '" data-key="' + esc(r.issue_key) + '">' +
        '<span class="aup-key">' + esc(r.issue_key) + "</span>" +
        "<span>" + esc(r.summary || "(件名なし)") + "</span>" +
        '<span class="aup-muted">' + esc(r.counterparty || "") + "</span>" +
        '<span class="aup-muted" style="margin-left:auto">' + esc((r.created_at || "").slice(0, 10)) + "</span>" +
        "</div>";
    }).join("");
    Array.prototype.forEach.call(wrap.querySelectorAll(".aup-issue"), function (el) {
      el.addEventListener("click", function () {
        selectedIssue = el.getAttribute("data-key");
        Array.prototype.forEach.call(wrap.querySelectorAll(".aup-issue"), function (x) { x.classList.remove("sel"); });
        el.classList.add("sel");
        showSelected();
      });
    });
  }
  function search() {
    var q = document.getElementById("aup-q").value.trim();
    if (!q) return;
    var wrap = document.getElementById("aup-results");
    wrap.innerHTML = '<div class="aup-empty">検索中…</div>';
    fetch("/api/attachment-upload/issues?q=" + encodeURIComponent(q), { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "search failed");
        renderResults(d.rows || []);
        // 完全一致が 1 件ならそのまま選択状態にする (DM リンクからの流入)。
        if (d.rows && d.rows.length === 1 && d.rows[0].issue_key === q.toUpperCase()) {
          selectedIssue = d.rows[0].issue_key;
          renderResults(d.rows);
          showSelected();
        }
      })
      .catch(function (e) {
        wrap.innerHTML = '<div class="aup-empty">検索に失敗しました: ' + esc(e.message || e) + "</div>";
      });
  }

  function fileRow(name) {
    var files = document.getElementById("aup-files");
    var row = document.createElement("div");
    row.className = "aup-file";
    row.innerHTML = "<span>📄 " + esc(name) + '</span><span class="st run">アップロード中…</span>';
    files.appendChild(row);
    return row.querySelector(".st");
  }
  function uploadOne(file) {
    var st = fileRow(file.name);
    if (file.size > 30 * 1024 * 1024) {
      st.className = "st ng"; st.textContent = "30MB を超えています";
      return;
    }
    var fd = new FormData();
    fd.append("issueKey", selectedIssue);
    fd.append("docKind", document.getElementById("aup-kind").value);
    fd.append("originalName", file.name);
    fd.append("file", file);
    fetch("/api/attachment-upload", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (x) {
        if (!x.d.ok) throw new Error(x.d.error || ("HTTP " + x.s));
        st.className = "st ok";
        st.textContent = "✓ 格納済 (" + (x.d.document && x.d.document.document_number || "") + ")";
      })
      .catch(function (e) {
        st.className = "st ng"; st.textContent = "失敗: " + (e.message || e);
      });
  }
  function handleFiles(list) {
    if (!selectedIssue) {
      alert("先に「1. 対象の課題」を検索して選択してください。");
      return;
    }
    Array.prototype.forEach.call(list, uploadOne);
  }

  var drop = document.getElementById("aup-drop");
  var fileInput = document.getElementById("aup-file");
  drop.addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { handleFiles(fileInput.files); fileInput.value = ""; });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", function () { drop.classList.remove("drag"); });
  drop.addEventListener("drop", function (e) {
    e.preventDefault(); drop.classList.remove("drag");
    if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  });

  document.getElementById("aup-search").addEventListener("click", search);
  document.getElementById("aup-q").addEventListener("keydown", function (e) { if (e.key === "Enter") search(); });

  // ?issue=LEGAL-123 プリフィル: 検索欄に入れて自動検索 (実在確認を兼ねる)。
  if (selectedIssue) {
    document.getElementById("aup-q").value = selectedIssue;
    search();
  }
</script>`;

  return popPage({
    active: "attachment-upload",
    mode: "view",
    title: "法務依頼 資料アップロード",
    subtitle: "課題番号を指定して資料を法務共有 Drive へ格納",
    body: body + script,
    headExtra: EXTRA_CSS,
    role,
    deptCode,
  });
}
