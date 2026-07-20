/**
 * 取引先マスター CRUD 管理 UI (Phase 17z-4)
 *
 * /master/vendors ページ。
 *
 *   - 検索 + 一覧 (カードグリッド)
 *   - 新規追加 / 編集 (モーダル)
 *   - CSV 一括インポート (Phase 17z-4 で追加)
 *
 * フロント JS はバニラ + fetch API。
 * 共通 chrome (topbar, タブナビ, CSS) は masterChrome.ts から取得。
 */

import { MASTER_CSS, SVG } from "./masterChrome.ts";
import { popAdminPage, adminUiEditBanner } from "./popChrome.ts";
import type { Role } from "../lib/screens.ts";

export function vendorMasterPage(_authIgnored?: unknown, role: Role = "viewer"): string {
  // Phase 17z-2 で恒久 URL 化したので _authIgnored は無視。
  // API は同一オリジン (IAP セッション継承) で素の URL を叩く。
  const apiListUrl = "/api/master/vendors";
  const apiDetailTpl = "/api/master/vendors/__CODE__";
  const apiImportUrl = "/api/master/vendors/import-csv";
  const apiTemplateUrl = "/api/master/vendors/template.csv";

  // 取引先UI一本化: 編集の正典は admin-ui の取引先マスタ(法人番号の重複チェック等が有効)。
  //   ADMIN_UI_URL があれば本ページ上部から誘導する(ダッシュボードのマスタ編集導線と同一方針)。
  const ADMIN_UI = (process.env.ADMIN_UI_URL || "").replace(/\/+$/, "");
  const adminUiBanner = ADMIN_UI
    ? `<a href="${ADMIN_UI}/master/vendors" target="_blank" rel="noopener"
         style="display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:11px 14px;border:1px solid #6c5ce7;border-radius:8px;background:rgba(108,92,231,0.08);text-decoration:none;color:inherit;">
        <span style="font-size:18px;line-height:1;">🖥</span>
        <span style="flex:1;font-size:12.5px;line-height:1.55;">
          <b style="color:#6c5ce7;">取引先マスタは管理UI（admin-ui）に一本化しました。</b>
          新規登録・編集は管理UIで行ってください（法人番号の重複チェック等が有効）。本ページは閲覧・CSV取込の互換用です。
        </span>
        <span style="font-size:12px;color:#6c5ce7;white-space:nowrap;font-weight:600;">管理UIで開く ↗</span>
      </a>`
    : "";

  const body = `
  <div class="container" style="padding:0 0 24px;">
    ${adminUiBanner}

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search">
        ${SVG.search}
        <input type="text" id="search" placeholder="取引先名・コード・屋号・ペンネームで検索…" autocomplete="off">
      </div>
      <select class="tech-select" id="f-entity" title="区分(法人/個人)">
        <option value="">区分: すべて</option>
        <option value="corporate">法人</option>
        <option value="individual">個人</option>
      </select>
      <select class="tech-select" id="f-invoice" title="インボイス発行事業者">
        <option value="">インボイス: すべて</option>
        <option value="yes">対象</option>
        <option value="no">非対象</option>
      </select>
      <select class="tech-select" id="f-withhold" title="源泉徴収">
        <option value="">源泉: すべて</option>
        <option value="yes">対象</option>
        <option value="no">非対象</option>
      </select>
      <span class="count-badge" id="count">— entries</span>
      <div class="spacer"></div>
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted-foreground);cursor:pointer;">
        <input type="checkbox" id="chk-all" style="width:14px;height:14px;cursor:pointer;"> 全選択
      </label>
      <button class="btn" id="btn-delete" style="display:none;background:#c0392b;border-color:#c0392b;color:#fff;">🗑 選択を削除</button>
      <label id="force-wrap" style="display:none;align-items:center;gap:4px;font-size:11px;color:#c0392b;cursor:pointer;" title="参照中の取引先も削除します。参照は NULL に(NOT NULL の関連行は削除)。NULL にした参照は『救済』で再アタッチ可能です。">
        <input type="checkbox" id="force-del" style="width:14px;height:14px;cursor:pointer;"> 強制
      </label>
      <button class="btn outline" id="btn-rescue" style="display:none;" title="強制削除で取引先参照を失った(NULL化された)レコードに、取引先を再アタッチします">🩹 救済</button>
      <button class="btn outline" id="btn-export" title="絞り込み(無ければ全件)の既存データをCSV出力 → 修正 → CSV一括取込で一括更新。住所/振込先/担当はメイン(★)を出力">${SVG.fileText} 修正用CSV出力</button>
      <a class="btn outline" href="${apiTemplateUrl}" download="vendor_template_new.csv" title="新規登録用の空テンプレ(サンプル行入り)">${SVG.fileText} 新規テンプレ(空)</a>
      <button class="btn outline" id="btn-import">${SVG.upload} CSV一括取込</button>
      <button class="btn" id="btn-new">${SVG.plus} 取引先を追加</button>
    </div>
    <p class="muted" style="font-size:11px;margin:-6px 2px 0;">
      修正＝「修正用CSV出力」で既存を出す→編集→「CSV一括取込」 ／ 新規＝「新規テンプレ(空)」に追記→「CSV一括取込」。
    </p>

    <!-- List -->
    <div id="list-wrap">
      <div class="loading">LOADING</div>
    </div>
  </div>

  <!-- View (read-only) Modal -->
  <div class="modal-backdrop" id="view-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag">MST · VENDORS / VIEW</span>
          <h3 class="modal-title" id="view-title">取引先の詳細</h3>
        </div>
        <button class="btn ghost sm" id="view-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body" id="view-body"></div>
      <div class="modal-footer">
        <button class="btn outline" id="view-cancel">閉じる</button>
        <button class="btn" id="view-edit">${SVG.fileText} 編集する</button>
      </div>
    </div>
  </div>

  <!-- Edit / Create Modal -->
  <div class="modal-backdrop" id="modal-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag" id="modal-tag">MST · VENDORS</span>
          <h3 class="modal-title" id="modal-title">取引先の編集</h3>
        </div>
        <button class="btn ghost sm" id="btn-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body">
        <form id="form" autocomplete="off">
          <div class="form-grid">

            <div class="section-head"><span class="retro-tag">SEC · 01 / 基本情報</span></div>

            <div class="field">
              <label class="tech-label">取引先コード<span class="req">*</span></label>
              <input class="tech-input" type="text" name="vendor_code" required maxlength="50" placeholder="例: 2-20-1234">
              <span class="field-help">既存コードを入れると上書き (UPSERT)。新規時のみ編集可能。</span>
            </div>

            <div class="field">
              <label class="tech-label">区分</label>
              <select class="tech-select" name="entity_type">
                <option value="">(未指定)</option>
                <option value="corporate">法人</option>
                <option value="individual">個人</option>
                <option value="sole_proprietor">個人事業主</option>
              </select>
            </div>

            <div class="field col-2">
              <label class="tech-label">正式名称<span class="req">*</span></label>
              <input class="tech-input" type="text" name="vendor_name" required maxlength="255" placeholder="例: 株式会社サンプル">
            </div>

            <div class="field">
              <label class="tech-label">屋号 / 略称</label>
              <input class="tech-input" type="text" name="trade_name" maxlength="255">
            </div>

            <div class="field" data-entity="individual,sole_proprietor">
              <label class="tech-label">ペンネーム</label>
              <input class="tech-input" type="text" name="pen_name" maxlength="255">
              <span class="field-help">作家・絵師等の個人。契約書/発注書のクレジット表記に使用。</span>
            </div>

            <div class="field">
              <label class="tech-label">敬称サフィックス</label>
              <input class="tech-input" type="text" name="vendor_suffix" maxlength="50" placeholder="様 / 御中">
            </div>

            <div class="field">
              <label class="tech-label">別名 (aliases)</label>
              <input class="tech-input" type="text" name="aliases" placeholder="カンマ区切りで複数可">
            </div>

            <!-- Phase 22.21.78: 代表者名 (法人代表者)。契約書 / 発注書 / 検収書 PDF の
                 代表者欄に転記される。肩書込みの形式で記入 (例: 代表取締役 山田太郎)。
                 個人事業主の場合は空でよい。admin-ui の VendorsPanel に揃えるため
                 ここでは entity_type による表示切り替えはしない (空欄なら出力されない)。 -->
            <div class="field col-2" data-entity="corporate">
              <label class="tech-label">代表者名 (法人代表者)</label>
              <input class="tech-input" type="text" name="vendor_rep" maxlength="100" placeholder="例: 代表取締役 山田 太郎">
              <span class="field-help">肩書込みで契約書 / 発注書の代表者欄に転記される。</span>
            </div>

            <div class="field" data-entity="corporate">
              <label class="tech-label">&#27861;&#20154;&#30058;&#21495;</label>
              <input class="tech-input" type="text" name="corporate_number" maxlength="20" placeholder="13&#26689;">
            </div>

            <div class="field">
              <label class="tech-label">&#21462;&#24341;&#20869;&#23481;&#21306;&#20998;</label>
              <select class="tech-select" name="transaction_category" id="transaction_category">
                <option value="">(&#26410;&#25351;&#23450;)</option>
                <option value="goods_sale">&#29289;&#21697;&#22770;&#36023;</option>
                <option value="service">&#26989;&#21209;&#22996;&#35351;&#12539;&#24441;&#21209;</option>
                <option value="license">&#12521;&#12452;&#12475;&#12531;&#12473;</option>
                <option value="other">&#12381;&#12398;&#20182;</option>
              </select>
            </div>

            <div class="field" data-entity="corporate">
              <label class="tech-label">&#36039;&#26412;&#37329;&#65288;&#20870;&#65289;</label>
              <input class="tech-input" type="number" name="capital_yen" id="capital_yen" min="0" step="1">
            </div>

            <div class="field" data-entity="corporate">
              <label class="tech-label">&#24467;&#26989;&#21729;&#25968;&#65288;&#20154;&#65289;</label>
              <input class="tech-input" type="number" name="employee_count" id="employee_count" min="0" step="1">
            </div>

            <div class="field" data-entity="corporate">
              <label class="tech-label">&#21462;&#36969;&#27861;&#36969;&#29992;&#21028;&#23450;</label>
              <input class="tech-input" type="text" name="subcontract_act_applicable_display" id="subcontract_act_applicable_display" readonly>
            </div>

            <div class="field">
              <label class="tech-label">&#21462;&#24341;&#20808;&#12510;&#12473;&#12479;&#26356;&#26032;&#26085;</label>
              <input class="tech-input" type="date" name="master_updated_at">
            </div>

            <div class="field col-2" data-entity="corporate">
              <label class="tech-label">&#21462;&#24341;&#20808;&#20027;&#35201;&#20107;&#26989;</label>
              <input class="tech-input" type="text" name="main_business">
            </div>

            <div class="field">
              <label class="tech-label">&#27770;&#28168;&#26465;&#20214;</label>
              <input class="tech-input" type="text" name="payment_terms" placeholder="&#20363;: &#26376;&#26411;&#32224;&#12417;&#32716;&#26376;&#26411;&#25173;&#12356;">
            </div>

            <div class="field">
              <label class="tech-label">&#35413;&#28857;</label>
              <input class="tech-input" type="text" name="rating">
            </div>

            <div class="field col-2">
              <label class="tech-label">&#21453;&#31038;&#12481;&#12455;&#12483;&#12463;&#32080;&#26524;</label>
              <select class="tech-select" name="antisocial_check_result">
                <option value="">(&#26410;&#30906;&#35469;)</option>
                <option value="clear">&#21839;&#38988;&#12394;&#12375;</option>
                <option value="pending">&#30906;&#35469;&#20013;</option>
                <option value="ng">NG</option>
              </select>
            </div>
            <div class="section-head"><span class="retro-tag">SEC · 02 / 連絡先</span></div>

            <div class="field">
              <label class="tech-label">担当部署</label>
              <input class="tech-input" type="text" name="contact_department" maxlength="100">
            </div>

            <div class="field">
              <label class="tech-label">担当者</label>
              <input class="tech-input" type="text" name="contact_name" maxlength="100">
            </div>

            <div class="field">
              <label class="tech-label">電話番号</label>
              <input class="tech-input" type="tel" name="phone" maxlength="50" placeholder="03-1234-5678">
            </div>

            <div class="field">
              <label class="tech-label">メールアドレス</label>
              <input class="tech-input" type="email" name="email" maxlength="255" placeholder="contact@example.com">
            </div>

            <div class="field col-2">
              <label class="tech-label">住所</label>
              <input class="tech-input" type="text" name="address">
            </div>


            <div class="field col-2">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <label class="tech-label">&#20303;&#25152;&#65288;1:N&#65289;</label>
                <button class="btn outline sm" type="button" id="btn-add-address">&#20303;&#25152;&#12434;&#36861;&#21152;</button>
              </div>
              <div id="addresses-list" style="display:grid;gap:8px;"></div>
            </div>
            <div class="section-head"><span class="retro-tag">SEC · 03 / 税務・インボイス</span></div>

            <div class="checkbox-row">
              <input type="checkbox" id="withholding_enabled" name="withholding_enabled">
              <label for="withholding_enabled">源泉徴収を行う</label>
            </div>

            <div class="checkbox-row">
              <input type="checkbox" id="is_invoice_issuer" name="is_invoice_issuer">
              <label for="is_invoice_issuer">適格請求書発行事業者 (インボイス)</label>
            </div>

            <div class="field col-2">
              <label class="tech-label">インボイス登録番号</label>
              <input class="tech-input" type="text" name="invoice_registration_number" maxlength="50" placeholder="T1234567890123">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 04 / 振込先</span></div>

            <div class="field">
              <label class="tech-label">銀行名</label>
              <input class="tech-input" type="text" name="bank_name">
            </div>

            <div class="field">
              <label class="tech-label">支店名</label>
              <input class="tech-input" type="text" name="branch_name">
            </div>

            <div class="field">
              <label class="tech-label">口座種別</label>
              <select class="tech-select" name="account_type">
                <option value="">(未指定)</option>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
                <option value="貯蓄">貯蓄</option>
              </select>
            </div>

            <div class="field">
              <label class="tech-label">口座番号</label>
              <input class="tech-input" type="text" name="account_number" maxlength="50">
            </div>

            <div class="field col-2">
              <label class="tech-label">口座名義 (カナ)</label>
              <input class="tech-input" type="text" name="account_holder_kana">
            </div>

            <div class="section-head"><span class="retro-tag">SEC · 05 / その他</span></div>

            <div class="field col-2">
              <label class="tech-label">マスター契約参照</label>
              <input class="tech-input" type="text" name="master_contract_ref" placeholder="既存契約番号 / URL 等">
            </div>

            <div class="field col-2">
              <label class="tech-label">銀行情報メモ</label>
              <input class="tech-input" type="text" name="bank_info" placeholder="自由記述">
            </div>


            <div class="field col-2">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                <label class="tech-label">&#21475;&#24231;&#24773;&#22577;&#65288;1:N&#65289;</label>
                <button class="btn outline sm" type="button" id="btn-add-bank-account">&#21475;&#24231;&#12434;&#36861;&#21152;</button>
              </div>
              <div id="bank-accounts-list" style="display:grid;gap:8px;"></div>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn outline" id="btn-cancel">キャンセル</button>
        <button class="btn" id="btn-save">保存</button>
      </div>
    </div>
  </div>

  <!-- CSV Import Modal -->
  <div class="modal-backdrop" id="import-backdrop">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-tag">MST · VENDORS / BULK</span>
          <h3 class="modal-title">CSV 一括取込</h3>
        </div>
        <button class="btn ghost sm" id="btn-import-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body">
        <div class="import-card" style="margin: 0;">
          <p class="desc">
            CSV (UTF-8) を選択してアップロードしてください。
            <code>vendor_code</code> と <code>vendor_name</code> が必須、
            それ以外は欠落可。<br>
            既存の <code>vendor_code</code> は重複モードに従って処理されます。
          </p>

          <div class="file-input-wrap">
            <input type="file" id="import-file" accept=".csv,text/csv">
            <span class="count-badge" id="import-filename"></span>
          </div>

          <div style="margin-top: 16px; display: flex; gap: 16px; flex-wrap: wrap;">
            <div class="dup-mode">
              <label class="tech-label" style="margin-right: 4px;">重複時:</label>
              <select id="import-dup-mode" class="tech-select" style="width: auto;">
                <option value="overwrite" selected>overwrite (上書き・推奨)</option>
                <option value="fill_only">fill_only (空欄のみ補完)</option>
                <option value="skip">skip (既存はスキップ)</option>
              </select>
            </div>
            <label class="dup-mode" style="cursor: pointer;">
              <input type="checkbox" id="import-dry-run" checked>
              <span class="tech-label" style="margin: 0;">Dry Run (プレビューのみ)</span>
            </label>
          </div>

          <div style="margin-top: 16px;">
            <a href="${apiTemplateUrl}" download="vendor_sample.csv" class="btn outline sm">
              ${SVG.download} サンプル CSV
            </a>
          </div>

          <div id="import-log" style="margin-top: 16px; font-family: var(--font-mono); font-size: 11px; color: var(--muted-foreground);"></div>
          <div id="import-result"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn outline" id="btn-import-cancel">キャンセル</button>
        <button class="btn" id="btn-import-submit">取込実行</button>
      </div>
    </div>
  </div>

  <!-- 孤立レコード救済(再アタッチ) Modal -->
  <div class="modal-backdrop" id="orphan-backdrop">
    <div class="modal" style="max-width:760px;">
      <div class="modal-head">
        <div>
          <span class="modal-tag">MST · VENDORS / RESCUE</span>
          <h3 style="margin:4px 0 0;">孤立レコードの救済（取引先の再アタッチ）</h3>
        </div>
        <button class="btn ghost sm" id="orphan-close" aria-label="閉じる">${SVG.x}</button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow:auto;">
        <p class="muted" style="font-size:12px;margin:0 0 8px;">
          強制削除で取引先参照を失った（NULL 化された）レコードです。各行で取引先を選んで「アタッチ」すると再接続されます。
        </p>
        <div id="orphan-list"><div class="loading">LOADING</div></div>
      </div>
      <div class="modal-footer">
        <button class="btn outline" id="orphan-cancel">閉じる</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    const apiListUrl   = ${JSON.stringify(apiListUrl)};
    const apiDetailTpl = ${JSON.stringify(apiDetailTpl)};
    const apiImportUrl = ${JSON.stringify(apiImportUrl)};
    const $ = (id) => document.getElementById(id);

    let cache = [];
    let filteredCodes = []; // 修正用CSV出力(絞り込み対象)用
    let selected = new Set(); // 選択削除用の vendor_code 集合
    let creating = false;

    function toast(msg, kind) {
      const t = $('toast');
      t.textContent = msg;
      t.className = 'toast show ' + (kind || '');
      setTimeout(() => { t.className = 'toast ' + (kind || ''); }, 3200);
    }

    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

    const ICON_BUILDING = ${JSON.stringify(SVG.building)};

    /* ----- list ----- */
    async function loadList() {
      $('list-wrap').innerHTML = '<div class="loading">LOADING</div>';
      try {
        const res = await fetch(apiListUrl);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        cache = data.rows || [];
        renderList();
      } catch (e) {
        $('list-wrap').innerHTML =
          '<div class="loading" style="color: hsl(8 70% 45%);">FETCH FAILED — ' + (e?.message || e) + '</div>';
      }
    }

    function renderList() {
      const q = $('search').value.trim().toLowerCase();
      const fe = $('f-entity').value;
      const fi = $('f-invoice').value;
      const fw = $('f-withhold').value;
      const isCorp = (v) => v.entity_type === 'corporate' || v.entity_type === '法人';
      const isInd = (v) =>
        v.entity_type === 'individual' || v.entity_type === 'sole_proprietor' || v.entity_type === '個人';
      const rows = cache.filter(v => {
        if (q) {
          const hay = [v.vendor_code, v.vendor_name, v.trade_name, v.pen_name, v.aliases]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        if (fe === 'corporate' && !isCorp(v)) return false;
        if (fe === 'individual' && !isInd(v)) return false;
        if (fi === 'yes' && !v.is_invoice_issuer) return false;
        if (fi === 'no' && v.is_invoice_issuer) return false;
        if (fw === 'yes' && !v.withholding_enabled) return false;
        if (fw === 'no' && v.withholding_enabled) return false;
        return true;
      });
      filteredCodes = rows.map(v => v.vendor_code).filter(Boolean);

      const narrowed = q || fe || fi || fw;
      $('count').textContent = narrowed
        ? rows.length + ' / ' + cache.length + ' ENTRIES'
        : cache.length + ' ENTRIES';

      if (rows.length === 0) {
        $('list-wrap').innerHTML =
          '<div class="grid"><div class="empty">NO VENDORS REGISTERED</div></div>';
        return;
      }

      const cards = rows.map(v => {
        const entityBadge = v.entity_type === 'corporate'
          ? '<span class="badge corp">CORP</span>'
          : (v.entity_type === 'individual' || v.entity_type === 'sole_proprietor')
            ? '<span class="badge ind">IND</span>'
            : '';
        const invoiceBadge = v.is_invoice_issuer ? '<span class="badge inv">INV</span>' : '';
        const sub = v.trade_name || v.pen_name || '—';
        return '<div class="card" data-code="' + escAttr(v.vendor_code) + '">'
          + '<div class="card-head">'
          +   '<input type="checkbox" class="row-chk" data-code="' + escAttr(v.vendor_code) + '" title="削除に選択" onclick="event.stopPropagation()" style="width:15px;height:15px;margin-right:6px;cursor:pointer;">'
          +   ICON_BUILDING
          +   '<span class="badge">' + escHtml(v.vendor_code) + '</span>'
          + '</div>'
          + '<p class="card-name">' + escHtml(v.vendor_name) + '</p>'
          + '<p class="card-sub">' + escHtml(sub) + '</p>'
          + '<div class="card-meta">' + entityBadge + ' ' + invoiceBadge + '</div>'
          + '</div>';
      }).join('');

      $('list-wrap').innerHTML = '<div class="grid">' + cards + '</div>';
      $('list-wrap').querySelectorAll('.card[data-code]').forEach(card => {
        card.addEventListener('click', () => openView(card.dataset.code));
      });
      $('list-wrap').querySelectorAll('.row-chk').forEach(chk => {
        chk.checked = selected.has(chk.dataset.code);
        chk.addEventListener('change', () => {
          if (chk.checked) selected.add(chk.dataset.code);
          else selected.delete(chk.dataset.code);
          updateDeleteBtn();
        });
      });
      updateDeleteBtn();
    }

    function updateDeleteBtn() {
      const n = selected.size;
      const btn = $('btn-delete');
      if (!btn) return;
      const show = n > 0 ? '' : 'none';
      btn.style.display = show;
      btn.textContent = '🗑 選択を削除 (' + n + ')';
      const fw = $('force-wrap');
      if (fw) fw.style.display = n > 0 ? 'flex' : 'none';
    }

    async function bulkDelete() {
      const codes = Array.from(selected);
      if (codes.length === 0) return;
      const force = $('force-del') && $('force-del').checked;
      const warn = force
        ? '【強制削除】' + codes.length + ' 件を削除します。参照中の取引先も削除し、参照は NULL に' +
          '(NOT NULL の関連行は削除)します。NULL にした参照は後で「救済」で再アタッチできます。よろしいですか?'
        : codes.length + ' 件の取引先を削除します。住所・口座・窓口担当も削除されます。' +
          '文書・契約・作品などから参照中の取引先はスキップされます。よろしいですか?';
      if (!confirm(warn)) return;
      try {
        const res = await fetch('/api/master/vendors/bulk-delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codes, mode: force ? 'force' : 'skip' }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + res.status));
        const del = (d.deleted || []).length, skip = (d.skipped || []).length;
        selected.clear();
        if ($('force-del')) $('force-del').checked = false;
        await loadList();
        updateDeleteBtn();
        loadOrphanCount();
        let msg = '削除 ' + del + ' 件';
        if (force && (d.nulled || d.removed)) msg += '(参照NULL ' + (d.nulled||0) + ' / 関連削除 ' + (d.removed||0) + ')';
        if (force && d.orphans) msg += ' ・救済対象 ' + d.orphans + ' 件';
        if (skip > 0) msg += ' / スキップ ' + skip + ' 件';
        toast(msg, skip > 0 ? 'error' : 'success');
        if (skip > 0) console.warn('削除スキップ:', d.skipped);
      } catch (e) {
        toast('削除に失敗: ' + (e?.message || e), 'error');
      }
    }

    /* ----- 孤立レコード救済(再アタッチ) ----- */
    let orphans = [];
    async function loadOrphanCount() {
      try {
        const res = await fetch('/api/master/vendor-orphans');
        const d = await res.json();
        orphans = d.rows || [];
      } catch (e) { orphans = []; }
      const b = $('btn-rescue');
      if (b) {
        b.textContent = '🩹 救済' + (orphans.length ? ' (' + orphans.length + ')' : '');
        b.style.display = orphans.length ? '' : 'none';
      }
    }
    function vendorOptions(selectedCode) {
      return '<option value="">— 取引先を選択 —</option>' + cache.map(function(v){
        const c = v.vendor_code;
        return '<option value="' + escAttr(c) + '"' + (c === selectedCode ? ' selected' : '') + '>' +
          escHtml((c ? c + ' : ' : '') + (v.vendor_name || '')) + '</option>';
      }).join('');
    }
    function renderOrphans() {
      const wrap = $('orphan-list');
      if (!orphans.length) { wrap.innerHTML = '<div class="empty" style="padding:16px;">救済対象(取引先未設定)はありません。</div>'; return; }
      wrap.innerHTML = orphans.map(function(o){
        return '<div class="orphan-row" data-id="' + o.id + '" style="display:flex;gap:8px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;font-size:12px;">' +
          '<div style="min-width:220px;flex:1;"><b>' + escHtml(o.child_label || (o.child_table + ' #' + o.child_id)) + '</b>' +
            '<div style="color:var(--muted-foreground);font-size:11px;">' + escHtml(o.child_table) + ' · 旧取引先: ' + escHtml(o.deleted_vendor_name || o.deleted_vendor_code || '—') + '</div></div>' +
          '<select class="tech-select orphan-vendor" style="min-width:220px;">' + vendorOptions(o.deleted_vendor_code) + '</select>' +
          '<button class="btn sm orphan-attach" type="button">アタッチ</button>' +
        '</div>';
      }).join('');
      wrap.querySelectorAll('.orphan-row').forEach(function(row){
        row.querySelector('.orphan-attach').addEventListener('click', function(){
          attachOrphan(Number(row.dataset.id), row.querySelector('.orphan-vendor').value);
        });
      });
    }
    async function openRescue() {
      await loadOrphanCount();
      renderOrphans();
      $('orphan-backdrop').classList.add('open');
    }
    function closeRescue() { $('orphan-backdrop').classList.remove('open'); }
    async function attachOrphan(id, code) {
      if (!code) { toast('取引先を選択してください', 'error'); return; }
      try {
        const res = await fetch('/api/master/vendor-orphans/attach', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, vendor_code: code }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + res.status));
        orphans = orphans.filter(function(o){ return o.id !== id; });
        renderOrphans();
        loadOrphanCount();
        toast('再アタッチしました', 'success');
      } catch (e) { toast('アタッチ失敗: ' + (e?.message || e), 'error'); }
    }

    $('search').addEventListener('input', renderList);
    ['f-entity', 'f-invoice', 'f-withhold'].forEach((id) =>
      $(id).addEventListener('change', renderList)
    );
    // 修正用CSV出力: 選択があれば選択、無ければ絞り込み(無ければ全件)を ?codes= で渡す。
    //   同一オリジン(search-api)なので直接ナビゲートでダウンロードできる。
    $('btn-export').addEventListener('click', () => {
      const codes = selected.size > 0 ? Array.from(selected) : (filteredCodes || []);
      const all = codes.length === cache.length || codes.length === 0;
      const url = all
        ? '/api/master/vendors/export.csv'
        : '/api/master/vendors/export.csv?codes=' + encodeURIComponent(codes.join(','));
      window.location.href = url;
    });

    // 全選択: 現在の絞り込み結果(表示中)を選択 / 解除。
    $('chk-all').addEventListener('change', (e) => {
      if (e.target.checked) filteredCodes.forEach(c => selected.add(c));
      else selected.clear();
      renderList(); // チェック状態を反映
    });
    $('btn-delete').addEventListener('click', bulkDelete);

    /* ----- edit modal ----- */
    function openCreate() {
      creating = true;
      $('modal-tag').textContent = 'MST · VENDORS / NEW';
      $('modal-title').textContent = '取引先の新規追加';
      const form = $('form');
      form.reset();
      form.querySelector('[name=vendor_code]').readOnly = false;
      renderAddresses([]);
      renderBankAccounts([]);
      updateSubcontractDisplay();
      applyEntityVisibility();
      $('modal-backdrop').classList.add('open');
      setTimeout(() => form.querySelector('[name=vendor_code]').focus(), 50);
    }

    /* ----- view (read-only) modal ----- */
    let viewingCode = null;
    const ENTITY_LABEL = { corporate: '法人', individual: '個人', sole_proprietor: '個人事業主' };
    const TXN_LABEL = { goods_sale: '物品売買', service: '業務委託・役務', license: 'ライセンス', other: 'その他' };
    const ANTI_LABEL = { clear: '問題なし', pending: '確認中', ng: 'NG' };

    function dl(label, value) {
      if (value == null || String(value).trim() === '') return '';
      return '<div class="vw-dt">' + escHtml(label) + '</div><div class="vw-dd">' + escHtml(value) + '</div>';
    }
    function yenNum(v) {
      const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
      return Number.isFinite(n) && String(v).trim() !== '' ? n.toLocaleString('ja-JP') : '';
    }
    function dateStr(v) { return v ? String(v).slice(0, 10) : ''; }
    function renderView(v) {
      const entity = ENTITY_LABEL[v.entity_type] || v.entity_type || '';
      const isIndividual = v.entity_type === 'individual' || v.entity_type === 'sole_proprietor';
      const isCorp = v.entity_type === 'corporate';
      const consent = (v.pii_consent_obtained === true)
        ? ('同意取得済' + (v.pii_consent_date ? '（' + dateStr(v.pii_consent_date) + '）' : ''))
        : (isIndividual ? '未取得' : '');
      const aliases = Array.isArray(v.aliases) ? v.aliases.join(', ') : (v.aliases || '');
      // 取適法(下請法)適用判定: 資本金1000万超 or 従業員100人超 → 対象
      const cap = Number(String(v.capital_yen || '').replace(/,/g, ''));
      const emp = Number(String(v.employee_count || '').replace(/,/g, ''));
      let subcontract = '';
      if (v.subcontract_act_applicable === true) subcontract = '対象';
      else if (v.subcontract_act_applicable === false) subcontract = '対象外';
      else if (isCorp && (Number.isFinite(cap) || Number.isFinite(emp)) && (v.capital_yen || v.employee_count))
        subcontract = ((Number.isFinite(cap) && cap >= 10000000) || (Number.isFinite(emp) && emp >= 100)) ? '対象' : '対象外';

      const addrs = Array.isArray(v.addresses) ? v.addresses : [];
      const banks = Array.isArray(v.bank_accounts) ? v.bank_accounts : [];
      const addrHtml = addrs.length
        ? addrs.map((a) => '<div>' + (a.is_primary ? '★ ' : '') + escHtml(a.address_label || '') + ' ' + escHtml(a.address || '') + '</div>').join('')
        : escHtml(v.address || '');
      const bankHtml = banks.length
        ? banks.map((b) => '<div>' + (b.is_primary ? '★ ' : '') + escHtml((b.account_scope === 'overseas' ? '[海外] ' : '') + (b.bank_name || '')) + ' ' + escHtml(b.branch_name || '') + ' ' + escHtml(b.account_type || '') + ' ' + escHtml(b.account_number || b.iban || '') + ' ' + escHtml(b.account_holder_kana || b.account_holder_name || '') + (b.swift_bic ? ' SWIFT:' + escHtml(b.swift_bic) : '') + '</div>').join('')
        : escHtml([v.bank_name, v.branch_name, v.account_type, v.account_number, v.account_holder_kana].filter(Boolean).join(' '));

      let html = '<div class="vw-sec" style="border-top:none;padding-top:0;margin-top:0;">基本情報</div><div class="vw-grid">';
      html += dl('取引先コード', v.vendor_code);
      html += dl('区分', entity);
      html += dl('正式名称', v.vendor_name);
      html += dl('屋号 / 略称', v.trade_name);
      if (isIndividual) html += dl('ペンネーム', v.pen_name);
      html += dl('敬称', v.vendor_suffix);
      html += dl('別名', aliases);
      html += dl('代表者', v.vendor_rep);
      html += dl('法人番号', v.corporate_number);
      html += dl('取引内容区分', TXN_LABEL[v.transaction_category] || v.transaction_category);
      html += dl('資本金(円)', yenNum(v.capital_yen));
      html += dl('従業員数(人)', yenNum(v.employee_count));
      html += dl('取適法 適用判定', subcontract);
      html += dl('取引先主要事業', v.main_business);
      html += dl('決済条件', v.payment_terms);
      html += dl('評点', v.rating);
      html += dl('反社チェック', ANTI_LABEL[v.antisocial_check_result] || v.antisocial_check_result);
      html += dl('取引先マスタ更新日', dateStr(v.master_updated_at));
      if (consent) html += dl('個人情報取得同意', consent);
      html += '</div>';

      const contact = [v.contact_department, v.contact_name, v.phone, v.email].some((x) => x && String(x).trim());
      if (contact) {
        html += '<div class="vw-sec">連絡先</div><div class="vw-grid">';
        html += dl('担当部署', v.contact_department);
        html += dl('担当者', v.contact_name);
        html += dl('電話', v.phone);
        html += dl('メール', v.email);
        html += '</div>';
      }
      if (addrHtml) html += '<div class="vw-sec">住所</div><div class="vw-block">' + addrHtml + '</div>';

      html += '<div class="vw-sec">税務・振込先</div><div class="vw-grid">';
      html += dl('源泉徴収', v.withholding_enabled ? '行う' : '');
      html += dl('適格請求書発行', v.is_invoice_issuer ? '対象' : '');
      html += dl('インボイス登録番号', v.invoice_registration_number);
      html += dl('口座種別', banks.length ? '' : v.account_type);
      html += '</div>';
      if (bankHtml) html += '<div class="vw-block">' + bankHtml + '</div>';

      const other = [v.master_contract_ref, v.bank_info].some((x) => x && String(x).trim());
      if (other) {
        html += '<div class="vw-sec">その他</div><div class="vw-grid">';
        html += dl('マスター契約参照', v.master_contract_ref);
        html += dl('銀行情報メモ', v.bank_info);
        html += '</div>';
      }
      return html;
    }

    async function openView(code) {
      viewingCode = code;
      $('view-title').textContent = code;
      $('view-body').innerHTML = '<div class="loading">LOADING</div>';
      $('view-backdrop').classList.add('open');
      try {
        const url = apiDetailTpl.replace('__CODE__', encodeURIComponent(code));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const v = await res.json();
        $('view-body').innerHTML = renderView(v);
      } catch (e) {
        toast('取得失敗: ' + (e?.message || e), 'error');
        closeViewModal();
      }
    }
    function closeViewModal() { $('view-backdrop').classList.remove('open'); }

    async function openEdit(code) {
      creating = false;
      $('modal-tag').textContent = 'MST · VENDORS / EDIT';
      $('modal-title').textContent = code;
      const form = $('form');
      form.reset();
      $('modal-backdrop').classList.add('open');
      try {
        const url = apiDetailTpl.replace('__CODE__', encodeURIComponent(code));
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const v = await res.json();
        fillForm(v);
        form.querySelector('[name=vendor_code]').readOnly = true;
      } catch (e) {
        toast('取得失敗: ' + (e?.message || e), 'error');
        closeEditModal();
      }
    }

    function closeEditModal() { $('modal-backdrop').classList.remove('open'); }

    function calcSubcontractApplicable(capital, employees) {
      const c = Number(String(capital || '').replace(/,/g, ''));
      const e = Number(String(employees || '').replace(/,/g, ''));
      return (Number.isFinite(c) && c >= 10000000) || (Number.isFinite(e) && e >= 100);
    }

    function updateSubcontractDisplay() {
      const applicable = calcSubcontractApplicable($('capital_yen').value, $('employee_count').value);
      $('subcontract_act_applicable_display').value = applicable ? '対象' : '対象外';
    }

    function rowStyle() {
      return 'border:1px solid var(--border);padding:10px;display:grid;grid-template-columns:80px 1fr 1fr 44px;gap:8px;align-items:center;';
    }

    function renderAddresses(rows) {
      const list = $('addresses-list');
      const items = Array.isArray(rows) && rows.length ? rows : [{ address_label: 'primary', address: '', is_primary: true }];
      list.innerHTML = items.map((a, idx) =>
        '<div class="address-row" style="' + rowStyle() + '">'
        + '<label class="tech-label" style="display:flex;gap:6px;align-items:center;margin:0;"><input type="radio" name="primary_address" ' + (a.is_primary || idx === 0 ? 'checked' : '') + '>代表</label>'
        + '<input class="tech-input" data-address-field="address_label" placeholder="種別" value="' + escAttr(a.address_label || '') + '">'
        + '<input class="tech-input" data-address-field="address" placeholder="住所" value="' + escAttr(a.address || '') + '">'
        + '<button type="button" class="btn ghost sm" data-remove-address>' + ${JSON.stringify(SVG.x)} + '</button>'
        + '</div>'
      ).join('');
      list.querySelectorAll('[data-remove-address]').forEach((btn) => {
        btn.addEventListener('click', () => {
          btn.closest('.address-row').remove();
          if (!list.querySelector('input[name=primary_address]:checked') && list.querySelector('input[name=primary_address]')) {
            list.querySelector('input[name=primary_address]').checked = true;
          }
        });
      });
    }

    function renderBankAccounts(rows) {
      const list = $('bank-accounts-list');
      const items = Array.isArray(rows) && rows.length ? rows : [{
        account_scope: 'domestic', is_primary: true,
      }];
      // DB 列幅に合わせた maxlength。value too long(VARCHAR 超過)による 500 を入力段階で防ぐ。
      const ML = { swift_bic: 20, iban: 64, routing_number: 40, bank_country: 2, currency: 3,
                   intermediary_bank_swift: 20, account_type: 50, account_number: 50 };
      const fld = (name, ph, val, span) =>
        '<input class="tech-input" data-bank-field="' + name + '" placeholder="' + ph + '" value="' + escAttr(val || '') + '"'
          + (ML[name] ? ' maxlength="' + ML[name] + '"' : '')
          + (span ? ' style="grid-column: span ' + span + ';"' : '') + '>';
      const grpStyle = 'grid-template-columns:repeat(3,1fr);gap:8px;';
      list.innerHTML = items.map((a, idx) => {
        const scope = a.account_scope === 'overseas' ? 'overseas' : 'domestic';
        return '<div class="bank-row" style="border:1px solid var(--border);padding:10px;display:grid;gap:8px;">'
          + '<div style="display:flex;gap:12px;align-items:center;justify-content:space-between;">'
          +   '<div style="display:flex;gap:12px;align-items:center;">'
          +     '<label class="tech-label" style="display:flex;gap:6px;align-items:center;margin:0;"><input type="radio" name="primary_bank_account" ' + (a.is_primary || idx === 0 ? 'checked' : '') + '>代表</label>'
          +     '<select class="tech-select" data-bank-field="account_scope" style="width:auto;">'
          +       '<option value="domestic"' + (scope === 'domestic' ? ' selected' : '') + '>国内</option>'
          +       '<option value="overseas"' + (scope === 'overseas' ? ' selected' : '') + '>海外</option>'
          +     '</select>'
          +   '</div>'
          +   '<button type="button" class="btn ghost sm" data-remove-bank-account>' + ${JSON.stringify(SVG.x)} + '</button>'
          + '</div>'
          + '<div data-bank-group="domestic" style="display:' + (scope === 'domestic' ? 'grid' : 'none') + ';' + grpStyle + '">'
          +   fld('bank_name', '銀行名', a.bank_name)
          +   fld('branch_name', '支店名', a.branch_name)
          +   fld('account_type', '種別 (普通/当座/貯蓄)', a.account_type)
          +   fld('account_number', '口座番号', a.account_number)
          +   fld('account_holder_kana', '口座名義 (カナ)', a.account_holder_kana, 2)
          + '</div>'
          + '<div data-bank-group="overseas" style="display:' + (scope === 'overseas' ? 'grid' : 'none') + ';' + grpStyle + '">'
          +   fld('bank_name', 'Bank name (英字)', a.bank_name)
          +   fld('swift_bic', 'SWIFT / BIC', a.swift_bic)
          +   fld('iban', 'IBAN', a.iban)
          +   fld('account_number', 'Account No.', a.account_number)
          +   fld('account_holder_name', 'Account holder (英字)', a.account_holder_name)
          +   fld('routing_number', 'Routing / ABA / sort', a.routing_number)
          +   fld('bank_country', '国コード ISO 2文字 (US/GB/CN)', a.bank_country)
          +   fld('currency', '通貨 ISO 3文字 (USD/EUR)', a.currency)
          +   fld('bank_address', 'Bank address', a.bank_address)
          +   fld('intermediary_bank_swift', '中継銀行 SWIFT', a.intermediary_bank_swift)
          +   fld('intermediary_bank_name', '中継銀行名', a.intermediary_bank_name, 2)
          + '</div>'
          + '</div>';
      }).join('');
      list.querySelectorAll('[data-remove-bank-account]').forEach((btn) => {
        btn.addEventListener('click', () => {
          btn.closest('.bank-row').remove();
          if (!list.querySelector('input[name=primary_bank_account]:checked') && list.querySelector('input[name=primary_bank_account]')) {
            list.querySelector('input[name=primary_bank_account]').checked = true;
          }
        });
      });
      list.querySelectorAll('[data-bank-field=account_scope]').forEach((sel) => {
        sel.addEventListener('change', () => {
          const row = sel.closest('.bank-row');
          const ov = sel.value === 'overseas';
          row.querySelector('[data-bank-group=domestic]').style.display = ov ? 'none' : 'grid';
          row.querySelector('[data-bank-group=overseas]').style.display = ov ? 'grid' : 'none';
        });
      });
    }

    function readAddresses() {
      return Array.from(document.querySelectorAll('.address-row')).map((row, idx) => ({
        address_label: row.querySelector('[data-address-field=address_label]')?.value.trim() || '',
        address: row.querySelector('[data-address-field=address]')?.value.trim() || '',
        is_primary: !!row.querySelector('input[name=primary_address]')?.checked,
        sort_order: idx,
      })).filter((a) => a.address);
    }

    function readBankAccounts() {
      return Array.from(document.querySelectorAll('.bank-row')).map((row, idx) => {
        const scope = row.querySelector('[data-bank-field=account_scope]')?.value === 'overseas' ? 'overseas' : 'domestic';
        const grp = row.querySelector('[data-bank-group=' + scope + ']');
        const g = (name) => (grp && grp.querySelector('[data-bank-field=' + name + ']')?.value.trim()) || '';
        const base = {
          is_primary: !!row.querySelector('input[name=primary_bank_account]')?.checked,
          sort_order: idx,
          account_scope: scope,
          bank_name: g('bank_name'),
          account_number: g('account_number'),
        };
        if (scope === 'domestic') {
          return Object.assign(base, {
            branch_name: g('branch_name'),
            account_type: g('account_type'),
            account_holder_kana: g('account_holder_kana'),
          });
        }
        return Object.assign(base, {
          swift_bic: g('swift_bic'),
          iban: g('iban'),
          account_holder_name: g('account_holder_name'),
          routing_number: g('routing_number'),
          bank_country: g('bank_country'),
          currency: g('currency'),
          bank_address: g('bank_address'),
          intermediary_bank_swift: g('intermediary_bank_swift'),
          intermediary_bank_name: g('intermediary_bank_name'),
        });
      }).filter((a) => a.bank_name || a.account_number || a.account_holder_name || a.iban || a.swift_bic);
    }

    function fillForm(v) {
      const form = $('form');
      Array.from(form.elements).forEach(el => {
        if (!el.name) return;
        if (el.name === 'subcontract_act_applicable_display') return;
        if (el.type === 'checkbox') el.checked = !!v[el.name];
        else if (el.type === 'date' && v[el.name]) el.value = String(v[el.name]).slice(0, 10);
        else el.value = v[el.name] == null ? '' : v[el.name];
      });
      renderAddresses(v.addresses || (v.address ? [{ address: v.address, is_primary: true }] : []));
      renderBankAccounts(v.bank_accounts || ((v.bank_name || v.account_number) ? [{
        bank_name: v.bank_name,
        branch_name: v.branch_name,
        account_type: v.account_type,
        account_number: v.account_number,
        account_holder_kana: v.account_holder_kana,
        is_primary: true,
      }] : []));
      updateSubcontractDisplay();
      applyEntityVisibility();
    }

    function readForm() {
      const form = $('form');
      const out = {};
      Array.from(form.elements).forEach(el => {
        if (!el.name) return;
        if (el.name === 'subcontract_act_applicable_display') return;
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else out[el.name] = el.value.trim();
      });
      out.addresses = readAddresses();
      out.bank_accounts = readBankAccounts();
      const primaryAddress = out.addresses.find(a => a.is_primary) || out.addresses[0];
      if (primaryAddress) out.address = primaryAddress.address;
      const primaryAccount = out.bank_accounts.find(a => a.is_primary) || out.bank_accounts[0];
      if (primaryAccount) {
        out.bank_name = primaryAccount.bank_name;
        out.branch_name = primaryAccount.branch_name;
        out.account_type = primaryAccount.account_type;
        out.account_number = primaryAccount.account_number;
        out.account_holder_kana = primaryAccount.account_holder_kana;
      }
      out.subcontract_act_applicable = calcSubcontractApplicable(out.capital_yen, out.employee_count);
      return out;
    }

    // 全UIリニューアル A(ステップ2+3): SSR ポータルは閲覧専用。取引先の新規/編集は
    //   admin-ui に集約(POST /api/master/vendors は撤去)。CSV 一括取込は引き続き利用可。
    void openCreate; void openEdit; // 旧エディタ関数は温存(未使用)。
    $('btn-new').addEventListener('click', () => toast('取引先の新規登録・編集は admin-ui の取引先マスタで行ってください（本ポータルは閲覧・CSV取込の互換用です）', 'error'));
    $('btn-add-address').addEventListener('click', () => {
      const rows = readAddresses();
      rows.push({ address_label: '', address: '', is_primary: rows.length === 0, sort_order: rows.length });
      renderAddresses(rows);
    });
    $('btn-add-bank-account').addEventListener('click', () => {
      const rows = readBankAccounts();
      rows.push({ account_scope: 'domestic', is_primary: rows.length === 0, sort_order: rows.length });
      renderBankAccounts(rows);
    });

    // 区分(法人/個人)による項目の表示切替。data-entity を持つ .field を出し分け。
    //   未指定(空)時は全表示(既存データを隠さない)。
    function applyEntityVisibility() {
      const sel = $('form').querySelector('[name=entity_type]');
      const et = (sel && sel.value) || '';
      document.querySelectorAll('[data-entity]').forEach((el) => {
        const allow = String(el.getAttribute('data-entity') || '').split(',').map((s) => s.trim());
        el.style.display = (!et || allow.indexOf(et) >= 0) ? '' : 'none';
      });
    }
    $('form').querySelector('[name=entity_type]').addEventListener('change', () => {
      applyEntityVisibility();
      // 新規作成時のみ: 個人/個人事業主は源泉徴収を既定ON(法人は触らない)。
      if (creating) {
        const et = $('form').querySelector('[name=entity_type]').value;
        if (et === 'individual' || et === 'sole_proprietor') $('withholding_enabled').checked = true;
      }
    });
    $('capital_yen').addEventListener('input', updateSubcontractDisplay);
    $('employee_count').addEventListener('input', updateSubcontractDisplay);
    $('btn-close').addEventListener('click', closeEditModal);
    $('btn-cancel').addEventListener('click', closeEditModal);
    $('modal-backdrop').addEventListener('click', (e) => {
      if (e.target === $('modal-backdrop')) closeEditModal();
    });
    // View(閲覧)モーダル: 閉じる / 編集へ
    $('view-close').addEventListener('click', closeViewModal);
    $('view-cancel').addEventListener('click', closeViewModal);
    $('view-edit').addEventListener('click', () => {
      // SSR read-only 化: 編集は admin-ui に集約。
      toast('取引先の編集は admin-ui の取引先マスタで行ってください', 'error');
    });
    $('view-backdrop').addEventListener('click', (e) => {
      if (e.target === $('view-backdrop')) closeViewModal();
    });

    $('btn-save').addEventListener('click', async () => {
      const payload = readForm();
      if (!payload.vendor_code) { toast('取引先コードは必須です', 'error'); return; }
      if (!payload.vendor_name) { toast('正式名称は必須です', 'error'); return; }
      // 海外口座の桁数チェック(DB列幅超過による保存失敗を分かりやすく前段で止める)。
      for (const a of (payload.bank_accounts || [])) {
        if (a.account_scope !== 'overseas') continue;
        if (a.bank_country && a.bank_country.length > 2) {
          toast('銀行の「国コード」は ISO の2文字で入力してください(例: US / GB / CN)。国名ではなくコードです。', 'error');
          return;
        }
        if (a.currency && a.currency.length > 3) {
          toast('「通貨」は ISO の3文字コードで入力してください(例: USD / EUR / JPY)。', 'error');
          return;
        }
      }
      $('btn-save').disabled = true;
      try {
        const res = await fetch(apiListUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data?.error || ('HTTP ' + res.status));
        }
        toast(creating ? '登録しました' : '更新しました', 'success');
        closeEditModal();
        await loadList();
      } catch (e) {
        toast('保存失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-save').disabled = false;
      }
    });

    /* ----- import modal ----- */
    function openImport() {
      $('import-file').value = '';
      $('import-filename').textContent = '';
      $('import-dry-run').checked = true;
      $('import-dup-mode').value = 'overwrite';
      $('import-log').textContent = '';
      $('import-result').innerHTML = '';
      $('btn-import-submit').disabled = false;
      $('import-backdrop').classList.add('open');
    }

    function closeImport() { $('import-backdrop').classList.remove('open'); }

    $('btn-import').addEventListener('click', openImport);
    $('btn-import-close').addEventListener('click', closeImport);
    $('btn-import-cancel').addEventListener('click', closeImport);
    $('import-backdrop').addEventListener('click', (e) => {
      if (e.target === $('import-backdrop')) closeImport();
    });

    $('import-file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      $('import-filename').textContent = f
        ? f.name + ' (' + Math.round(f.size / 1024) + ' KB)'
        : '';
    });

    $('btn-import-submit').addEventListener('click', async () => {
      const f = $('import-file').files[0];
      if (!f) { toast('ファイルを選択してください', 'error'); return; }
      const dryRun = $('import-dry-run').checked;
      const dupMode = $('import-dup-mode').value;
      $('btn-import-submit').disabled = true;
      $('import-log').textContent = '⏳ サーバー処理中…';
      $('import-result').innerHTML = '';

      try {
        const csvText = await f.text();
        const res = await fetch(apiImportUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: csvText, dry_run: dryRun, duplicate_mode: dupMode }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.ok === false) {
          throw new Error(data?.error || ('HTTP ' + res.status));
        }
        $('import-log').textContent = dryRun
          ? '✅ Dry Run 完了 (DB は変更されていません)'
          : '✅ 取込完了';
        renderImportResult(data);
        if (!dryRun) {
          toast('取込完了: 成功 ' + (data.succeeded || 0) + ' 件', 'success');
          await loadList();
        }
      } catch (e) {
        $('import-log').textContent = '❌ 失敗: ' + (e?.message || e);
        toast('取込失敗: ' + (e?.message || e), 'error');
      } finally {
        $('btn-import-submit').disabled = false;
      }
    });

    function renderImportResult(r) {
      const errBlock = (r.errors && r.errors.length > 0)
        ? '<div class="error-list">'
          + r.errors.map(e => '<div class="row">行 ' + e.row + ' [' + escHtml(e.vendor_code) + ']: ' + escHtml(e.error) + '</div>').join('')
          + '</div>'
        : '';
      $('import-result').innerHTML =
        '<div class="summary-grid">'
        + '<div class="stat"><div class="label">Total</div><div class="value">' + (r.total || 0) + '</div></div>'
        + '<div class="stat ok"><div class="label">Succeeded</div><div class="value">' + (r.succeeded || 0) + '</div></div>'
        + '<div class="stat warn"><div class="label">Skipped</div><div class="value">' + (r.skipped || 0) + '</div></div>'
        + '<div class="stat err"><div class="label">Failed</div><div class="value">' + (r.failed || 0) + '</div></div>'
        + '</div>'
        + errBlock;
    }

    /* ----- 救済 modal wiring ----- */
    $('btn-rescue').addEventListener('click', openRescue);
    $('orphan-close').addEventListener('click', closeRescue);
    $('orphan-cancel').addEventListener('click', closeRescue);
    $('orphan-backdrop').addEventListener('click', (e) => {
      if (e.target === $('orphan-backdrop')) closeRescue();
    });

    /* ----- init ----- */
    loadList();
    loadOrphanCount();
  </script>`;

  return popAdminPage({
    active: "vendors",
    role,
    masterCss: MASTER_CSS,
    title: "取引先マスタ",
    subtitle: "Master · External partners",
    body: adminUiEditBanner("/master/vendors") + body,
    headExtra: `<style>
.vw-grid{display:grid;grid-template-columns:120px 1fr;gap:6px 14px;align-items:baseline;margin:4px 0 6px}
.vw-dt{color:var(--muted);font-size:11.5px;font-weight:800}
.vw-dd{font-size:13px;color:var(--ink);word-break:break-word}
.vw-sec{margin:14px 0 6px;font-size:11.5px;font-weight:800;color:var(--accent);border-top:1px solid var(--line);padding-top:10px}
.vw-block{font-size:12.5px;color:var(--ink);line-height:1.7}
</style>`,
  });
}
