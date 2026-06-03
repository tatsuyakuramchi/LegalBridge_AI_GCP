/**
 * /admin ダッシュボードページ (Phase 22.21.36, 22.21.42 で再構成)
 *
 * 管理者 (staff.app_role='admin') 専用の操作集約ページ。
 * 各操作をカード/タイル形式でリンク表示するハブ。具体的な機能は
 * 子ページ (/admin/staff, /imports/legalon, /master/*, /search/* …) に分割。
 *
 * 認可は server.ts 側で requireAppRole({allowedRoles:["admin"]}) を適用済み。
 *
 * UI: search-api 共通テーマ popChrome(macOS風×ポップ)の admin モード。
 */

import { popPage } from "./popChrome.ts";

const EXTRA_CSS = `<style>
.dash-sec{margin-bottom:22px}
.dash-sec h2{font-size:15px;font-weight:800;margin:0 0 4px;color:var(--ink);display:flex;align-items:center;gap:8px}
.dash-sec .muted{font-size:12px;margin-bottom:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.tile{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid var(--line);
  border-radius:var(--radius);padding:15px 17px;box-shadow:0 2px 8px rgba(90,70,180,.05);
  transition:box-shadow .15s,transform .15s;position:relative;overflow:hidden}
.tile::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--accent)}
.tile:hover{box-shadow:var(--shadow);transform:translateY(-2px)}
.tile .title{font-weight:800;font-size:13.5px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.tile .desc{color:var(--muted);font-size:11.5px;margin-top:5px;line-height:1.5}
.tile .arrow{color:var(--accent);font-weight:800}
.tile.users::before{background:linear-gradient(180deg,#a55eea,#8854d0)}
.tile.import::before{background:linear-gradient(180deg,#54a0ff,#5f8bff)}
.tile.master::before{background:linear-gradient(180deg,#1dd1a1,#10ac84)}
.tile.search::before{background:linear-gradient(180deg,#feca57,#ff9f43)}
.tile.preview::before{background:linear-gradient(180deg,#ff9a9e,#ff6b81)}
.tile code{background:#f4f1fb;border-radius:6px;padding:1px 5px;font-size:11px}
.dash-hello{font-size:12.5px;color:var(--muted);margin-bottom:18px}
.dash-hello b{color:var(--ink)}
</style>`;

interface AdminPageOpts {
  currentEmail: string | null;
}

export function adminDashboardPage(opts: AdminPageOpts): string {
  const email = opts.currentEmail || "(unknown)";

  const body = `
  <div class="dash-hello">あなたのログイン: <b>${escapeHtml(email)}</b> (app_role=admin)</div>

  <!-- ==== 1. ユーザー権限管理 ==== -->
  <section class="dash-sec">
    <h2>👥 ユーザー権限管理</h2>
    <p class="muted">staff の admin / viewer ロールを切り替えます。誤操作防止のため昇格・降格は専用サブページに集約しています。</p>
    <div class="tiles">
      <a class="tile users" href="/admin/staff">
        <div class="title">スタッフ権限管理 <span class="arrow">→</span></div>
        <div class="desc">staff 一覧と admin/viewer 切替ボタン</div>
      </a>
    </div>
  </section>

  <!-- ==== 2. データ取り込み (Imports) ==== -->
  <section class="dash-sec">
    <h2>📥 データ取り込み</h2>
    <p class="muted">大量データを CSV で一括登録します。すべて Dry Run プレビュー付き。</p>
    <div class="tiles">
      <a class="tile import" href="/imports/legalon">
        <div class="title">📋 LegalOn 契約台帳 <span class="arrow">→</span></div>
        <div class="desc">過去の契約 (CloudSign / Drive / 紙) を contract_capabilities へ一括登録</div>
      </a>
      <a class="tile import" href="/imports/vendor">
        <div class="title">🏢 取引先マスタ <span class="arrow">→</span></div>
        <div class="desc">vendor_code をキーに upsert。3 種の重複モードに対応</div>
      </a>
    </div>
  </section>

  <!-- ==== 3. マスター管理 (search-api 内 CRUD) ==== -->
  <section class="dash-sec">
    <h2>🗂️ マスター CRUD</h2>
    <p class="muted">個別レコードの追加・編集・削除。一括登録は上記「データ取り込み」を利用。</p>
    <div class="tiles">
      <a class="tile master" href="/master/staff">
        <div class="title">👤 スタッフマスタ <span class="arrow">→</span></div>
        <div class="desc">staff CRUD + CSV 取込 (経営管理本部・法務のみ)</div>
      </a>
      <a class="tile master" href="/master/vendors">
        <div class="title">🏢 取引先マスタ <span class="arrow">→</span></div>
        <div class="desc">vendors CRUD (個別 1 件単位)</div>
      </a>
      <a class="tile master" href="/master/contracts">
        <div class="title">📜 契約マスタ <span class="arrow">→</span></div>
        <div class="desc">contract_capabilities 詳細表示・LegalOn 統合</div>
      </a>
      <a class="tile preview" href="/templates/preview">
        <div class="title">Template Preview <span class="arrow">→</span></div>
        <div class="desc">現行テンプレートをサンプル情報で HTML 表示 / PDF ダウンロード</div>
      </a>
      <a class="tile master" href="/work-model">
        <div class="title">🎲 作品モデル <span class="arrow">→</span></div>
        <div class="desc">原作IP・自社作品・契約を作品軸で閲覧 (新プラットフォーム /api/v3)</div>
      </a>
      <a class="tile master" href="/master/conditions">
        <div class="title">🧾 条件明細 横断検索 <span class="arrow">→</span></div>
        <div class="desc">支払日 / 納期 / 担当 / 種類 / 取引先で明細を検索・紐付け編集・CSV</div>
      </a>
      <a class="tile master" href="/master/sublicense">
        <div class="title">💴 受領予定(サブライセンス) <span class="arrow">→</span></div>
        <div class="desc">当社が請求/受領するライセンス料(料率×売上 / MG / 前払)</div>
      </a>
    </div>
  </section>

  <!-- ==== 4. 検索ポータル (admin/viewer 共通) ==== -->
  <section class="dash-sec">
    <h2>🔍 検索ポータル (admin / viewer 共通)</h2>
    <p class="muted">viewer ユーザーが利用する検索機能。admin もここから直接 検索可能です。viewer 用案内ページは「Viewer 用ポータルを開く」で確認できます。</p>
    <div class="tiles">
      <a class="tile search" href="/search/vendor">
        <div class="title">🔎 取引先・契約検索 <span class="arrow">→</span></div>
        <div class="desc"><code>/search/vendor?q=&lt;取引先名&gt;</code> — 取引先名や契約類型から</div>
      </a>
      <a class="tile search" href="javascript:void(0)" onclick="promptRingi();return false;">
        <div class="title">📋 稟議番号検索 <span class="arrow">→</span></div>
        <div class="desc"><code>/search/ringi/00001</code> — 5 桁の稟議番号で詳細表示</div>
      </a>
      <a class="tile preview" href="/?preview=viewer" target="_blank" rel="noopener">
        <div class="title">👁️ Viewer 用ポータルを開く <span class="arrow">↗</span></div>
        <div class="desc">別タブで開く — viewer ロールのユーザーが見るランディングページを確認</div>
      </a>
    </div>
  </section>

  <script>
    function promptRingi() {
      const v = prompt('稟議番号 (5 桁の数字) を入力してください', '00001');
      if (!v) return;
      const trimmed = String(v).trim();
      if (!/^\\d{1,5}$/.test(trimmed)) {
        alert('5 桁以内の数字で入力してください');
        return;
      }
      const padded = trimmed.padStart(5, '0');
      window.location.href = '/search/ringi/' + padded;
    }
  </script>`;

  return popPage({
    active: "admin",
    mode: "admin",
    title: "管理ダッシュボード",
    subtitle: "Master Console ハブ",
    body,
    headExtra: EXTRA_CSS,
    pageTitle: "LegalBridge 管理ダッシュボード",
  });
}

function escapeHtml(s: any): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
