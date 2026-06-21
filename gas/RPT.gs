/**
 * LegalBridge — 関連当事者取引（RPT）統合モジュール【安全版】
 *
 * 本ファイルは Code.gs（Slack Gateway + 法務ポータル）と同一 GAS プロジェクトに
 * 置く前提の統合モジュール。独自の HTTP / 認証スタックを持たず、Code.gs の
 * 既存インフラを再利用する（＝二重実装を排した安全版）。
 *
 *   読取  : callLegalBridgeApi_(path, 'get'|'post', payload)    ← search-API
 *   書込  : callWorkerApi_(path, 'post'|'put'|'patch', payload)  ← worker
 *   取引先: searchContractStatus(payload)                        ← 既存 contract-check
 *   設定  : scriptProperty_(key)
 *
 * ── 1ファイルに統合したい場合 ─────────────────────────────
 *   本モジュールの中身を Code.gs の末尾（keepWarm の前など）に貼り付ければ
 *   物理的にも 1 ファイルに統合できる（doGet / 既存ラッパーはそのまま流用）。
 *
 * ── ページ登録（Code.gs の APP_CONFIG.pages に 2 行追加）─────
 *   related_party:      { file: 'guide_related_party', title: '関連当事者取引 判定・決議 実務ガイド' },
 *   related_party_tool: { file: 'related_party',       title: '関連当事者取引 判定ツール' }
 *
 * ── ScriptProperty ───────────────────────────────────────
 *   RPT_ADMIN_EMAILS      書込・議案履歴を許可する管理者メール（カンマ区切り）。
 *                         未設定時は deploy 側アクセス制御に委ね、警告ログのみ（fail-open）。
 *   RPT_READS_ADMIN_ONLY  'true' で読取（マスタ取得・取引先検索）も管理者限定。
 *                         既定 false（ガイド埋め込みフォームを事業部が使えるように）。
 */

// ============================================================
//  認可（安全版：設定で締められる。書込は管理者限定）
// ============================================================
function rptCurrentEmail_() {
  try { return (Session.getActiveUser() && Session.getActiveUser().getEmail()) || ''; }
  catch (e) { return ''; }
}

/** true=管理者 / false=非管理者 / null=判定不能（RPT_ADMIN_EMAILS 未設定） */
function rptIsAdmin_() {
  var raw = scriptProperty_('RPT_ADMIN_EMAILS');
  if (!raw || !String(raw).trim()) return null;
  var me = rptCurrentEmail_().toLowerCase();
  if (!me) return false;
  var list = String(raw).split(',').map(function (s) { return s.trim().toLowerCase(); })
                        .filter(function (s) { return s.length > 0; });
  return list.indexOf(me) >= 0;
}

/** 書込・機微読取の前に必ず通す。非管理者は遮断。未設定時は deploy 制御に委ねる。 */
function rptRequireAdmin_() {
  var v = rptIsAdmin_();
  if (v === false) throw new Error('権限がありません（関連当事者取引は管理者限定の操作です）。');
  if (v === null) {
    console.warn('RPT: RPT_ADMIN_EMAILS 未設定。管理者チェックを deploy のアクセス制御に委ねています。');
  }
}

/** 読取アクセス。既定は全ポータル利用者に開放（ガイド埋め込みフォーム用）。 */
function rptRequireReadAccess_() {
  if (String(scriptProperty_('RPT_READS_ADMIN_ONLY') || '').toLowerCase() === 'true') {
    rptRequireAdmin_();
  }
}

// ============================================================
//  読取（search-API を再利用）
// ============================================================
function rptGetMasters() {
  rptRequireReadAccess_();
  return {
    entities:      callLegalBridgeApi_('/api/rpt/entities', 'get'),
    officers:      callLegalBridgeApi_('/api/rpt/officers', 'get'),
    shareholdings: callLegalBridgeApi_('/api/rpt/shareholdings', 'get')
  };
}

function rptListAgenda(params) {
  rptRequireAdmin_(); // 役会議案履歴は機微 → 管理者限定
  var q = [];
  if (params && params.from)     q.push('from=' + encodeURIComponent(params.from));
  if (params && params.to)       q.push('to='   + encodeURIComponent(params.to));
  if (params && params.entityId) q.push('entity_id=' + encodeURIComponent(params.entityId));
  var qs = q.length ? ('?' + q.join('&')) : '';
  return callLegalBridgeApi_('/api/rpt/agenda' + qs, 'get');
}

/**
 * 取引先（vendors）を当事者として検索。
 * 既存 LegalBridge の contract-check search-API（searchContractStatus）を再利用し、
 * エンジンの当事者シェイプに正規化して返す。関連当事者フラグも併せて返す。
 *   戻り値: { ok, vendors:[{ source:'vendor', vendor_id, vendor_code, name,
 *                            kind:'company'|'person', related_party_flag, related_party_type }] }
 */
function rptSearchVendors(keyword) {
  rptRequireReadAccess_();
  var res;
  try {
    res = searchContractStatus({ counterpartyName: String(keyword || '') });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), vendors: [] };
  }
  var out = [];
  function pushVendor(cp) {
    if (!cp) return;
    var name = cp.vendorName || cp.vendor_name || cp.counterpartyName || cp.name || '';
    if (!name) return;
    out.push({
      source: 'vendor',
      vendor_id: cp.vendorId || cp.vendor_id || null,
      vendor_code: cp.vendorCode || cp.vendor_code || '',
      name: name,
      kind: (cp.entityType === 'individual') ? 'person' : 'company',
      related_party_flag: !!(cp.relatedPartyFlag || cp.related_party_flag),
      related_party_type: cp.relatedPartyType || cp.related_party_type || ''
    });
  }
  if (res && res.counterparty) pushVendor(res.counterparty);
  var list = (res && (res.results || res.matches || res.candidates || res.vendorCandidates)) || [];
  list.forEach(function (c) { pushVendor(c.counterparty || c.vendor || c); });
  return { ok: true, vendors: out };
}

// ============================================================
//  書込（worker を再利用・すべて管理者限定）
// ============================================================
function rptSaveEntity(entity) {
  rptRequireAdmin_();
  return (entity && entity.id)
    ? callWorkerApi_('/rpt/entities/' + encodeURIComponent(entity.id), 'put', entity)
    : callWorkerApi_('/rpt/entities', 'post', entity);
}

function rptVoidEntity(id) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/entities/' + encodeURIComponent(id) + ':void', 'post', {});
}

// officer_key 単位で就任行を総入替（社員役員=staff_id、社外役員=name）
function rptSaveOfficer(officer) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/officers', 'put', officer);
}

function rptVoidOfficer(officerKey) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/officers:void', 'post', { officer_key: officerKey });
}

function rptReplaceShareholdings(entityId, list) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/entities/' + encodeURIComponent(entityId) + '/shareholdings',
                        'put', { shareholdings: list || [] });
}

// 役会承認（役会議案履歴）→ 既存 ringi テーブルへ起票（worker 側で rpt_meta.rpt=true 付与）
function rptSaveAgenda(record) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/agenda', 'post', record);
}

function rptUpdateAgendaStatus(id, status) {
  rptRequireAdmin_();
  return callWorkerApi_('/rpt/agenda/' + encodeURIComponent(id), 'patch', { status: status });
}

// ============================================================
//  動作確認ヘルパー（手動実行用）
// ============================================================
function rptDebugConfig() {
  console.log('RPT current email = ' + rptCurrentEmail_());
  console.log('RPT isAdmin = ' + rptIsAdmin_());
  console.log('RPT reads admin-only = ' +
    (String(scriptProperty_('RPT_READS_ADMIN_ONLY') || '').toLowerCase() === 'true'));
}
