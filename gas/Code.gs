/**
 * LegalBridge — Slack Gateway + 法務ポータル (Google Apps Script)
 *
 * Responsibilities
 *  - Slack POST 入口 (`/法務依頼`, `/法務検索`, interactivity payloads)
 *  - 法務部ポータルの HTML 多ページルーティング (doGet)
 *  - 取引先契約状況確認の Cloud Run 連携 API (?api=...)
 *  - Cloud Run /法務検索 への取次 (queryContractStatusOnly_)
 *  - Phase 17s: HMAC 短期署名 URL の発行
 *
 * Environment (script properties — see gas/README.md for setup):
 *  - SLACK_BOT_TOKEN              xoxb-…
 *  - SLACK_SIGNING_SECRET         (optional)
 *  - CLOUD_RUN_BASE_URL           https://legalbridge-…run.app
 *      (旧 ポータル GAS の `LB_API_BASE_URL` でも互換動作 — どちらかに値があれば良い)
 *  - LB_PORTAL_SECRET             legacy 共有シークレット (dual-accept 移行期用)
 *  - LB_SIGNING_SECRET            Phase 17s HMAC 鍵 (推奨)
 *  - BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY
 *  - ALLOWED_SEARCH_CHANNEL_IDS   (任意)
 *
 * 統合履歴:
 *   - 旧 Slack 用 GAS と 旧 法務ポータル GAS を 1 プロジェクトに統合 (Phase 17t)。
 *     ポータルの doGet / APP_CONFIG / 多ページ HTML / 契約状況確認 API は
 *     そのまま温存。Slack の doPost と同居。
 */

const SLACK_API = 'https://slack.com/api';

// -----------------------------------------------------------------------
//  法務ポータル設定 (Phase 17t: 旧 法務ポータル GAS から統合)
// -----------------------------------------------------------------------

const APP_CONFIG = Object.freeze({
  title: '法務部 実務ガイド',
  defaultPage: 'portal',

  pages: {
    portal:        { file: 'legal_portal',   title: '法務部 実務ガイド ポータル' },
    bg:            { file: 'guide_bg',       title: 'BG事業部 契約スキーム実務ガイド' },
    pub:           { file: 'guide_pub',      title: '出版フロー実務ガイド' },
    vendor:        { file: 'guide_vendor',   title: '取引先登録実務ガイド' },
    torihiki:      { file: 'guide_torihiki', title: '取引適正化・フリーランス法 実務ガイド' },
    clause:        { file: 'guide_clause',   title: '契約書 条文解説ガイド' },
    contractcheck: { file: 'contract_check', title: '取引先契約状況確認' }
  },

  downloadLinks: {
    serviceGuideUrl: 'https://docs.google.com/presentation/d/1n0PwoWQJYbsPdzzoC2DYfaLeL5hIFuvoq_PoI9q4kcE/export/pptx',
    licenseGuideUrl: 'https://docs.google.com/presentation/d/1K0LB62rTYYXgKApMN1YwCgp_L9BRcgLoHDqRilaxhLc/export/pptx'
  }
});

/**
 * Cloud Run API が未完成の間は true。
 * Cloud Run 側の /api/contract-check/search が完成したら false に変更してください。
 */
const USE_MOCK_CONTRACT_CHECK = false;

// -----------------------------------------------------------------------
//  doGet — 法務ポータル HTML ルーティング + JSON API
//   (Phase 17t: 旧 法務ポータル GAS から移植)
// -----------------------------------------------------------------------

function doGet(e) {
  e = e || {};
  var params = e.parameter || {};

  // ── ① Slack ハブ用 JSON API ブランチ ──
  if (params.api === 'searchContractStatus') {
    var payload = {
      counterpartyName: params.counterpartyName || '',
      purposeCode:      params.purposeCode      || '',
      workName:         params.workName         || '',
      productName:      params.productName      || '',
      territory:        params.territory        || '',
      language:         params.language         || ''
    };
    if (params.vendorId) payload.vendorId = Number(params.vendorId);

    var result;
    try {
      result = searchContractStatus(payload);
    } catch (err) {
      result = { ok: false, error: String(err) };
    }
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (params.api === 'getContractPurposes') {
    var purposes;
    try {
      purposes = getContractPurposes();
    } catch (err) {
      purposes = { ok: false, error: String(err) };
    }
    return ContentService
      .createTextOutput(JSON.stringify(purposes))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // ── ② HTML 多ページ ──
  var page = normalizePage_(params.page);
  var route = APP_CONFIG.pages[page];
  var template = HtmlService.createTemplateFromFile(route.file);
  template.appUrl = ScriptApp.getService().getUrl();
  template.currentPage = page;
  template.serviceGuideUrl = APP_CONFIG.downloadLinks.serviceGuideUrl;
  template.licenseGuideUrl = APP_CONFIG.downloadLinks.licenseGuideUrl;
  return template
    .evaluate()
    .setTitle(route.title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function normalizePage_(page) {
  var key = String(page || APP_CONFIG.defaultPage).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(APP_CONFIG.pages, key)
    ? key
    : APP_CONFIG.defaultPage;
}

/** HTML テンプレートから別 HTML を埋め込むユーティリティ */
function include(filename, data) {
  var template = HtmlService.createTemplateFromFile(filename);
  if (data) {
    Object.keys(data).forEach(function (key) {
      template[key] = data[key];
    });
  }
  return template.evaluate().getContent();
}

// -----------------------------------------------------------------------
//  Entry point — Slack posts here for both slash commands and interactivity
// -----------------------------------------------------------------------

function doPost(e) {
  try {
    // (Optional) verify Slack signature. Uncomment once SLACK_SIGNING_SECRET
    // is provisioned in script properties; until then we trust the deploy URL
    // is private to Slack's app config.
    // if (!verifySlackSignature(e)) {
    //   return ContentService.createTextOutput('invalid signature').setMimeType(ContentService.MimeType.TEXT);
    // }

    const params = e.parameter || {};

    // Slack slash commands arrive as application/x-www-form-urlencoded with
    // a `command` field. Interactivity payloads arrive with a single
    // `payload` field whose value is a JSON-encoded string.
    if (params.command) {
      return handleSlashCommand_(params);
    }

    if (params.payload) {
      const payload = JSON.parse(params.payload);
      return handleInteractivity_(payload);
    }

    return jsonResponse_({ ok: true });
  } catch (err) {
    console.error('doPost error:', err);
    return jsonResponse_({ error: String(err) });
  }
}

// -----------------------------------------------------------------------
//  Slash commands
// -----------------------------------------------------------------------

function handleSlashCommand_(params) {
  const command = params.command;
  const triggerId = params.trigger_id;
  const userId = params.user_id;
  const userName = params.user_name;

  if (command === '/法務依頼') {
    // Open the modal asynchronously so we can ack immediately.
    openView_(triggerId, getLegalRequestModal_('legal_consult'));
    return jsonResponse_({ response_type: 'ephemeral', text: '依頼フォームを開いています…' });
  }

  if (command === '/法務検索') {
    // Channel allow-list check.
    // ALLOWED_SEARCH_CHANNEL_IDS is a comma-separated list of channel
    // IDs (e.g. "C090WRVD1TM,C012345ABCD") set in script properties.
    // When unset, the command is open to every channel (no-op check).
    var allowListRaw = scriptProperty_('ALLOWED_SEARCH_CHANNEL_IDS');
    if (allowListRaw && String(allowListRaw).trim() !== '') {
      var allowedIds = String(allowListRaw)
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0; });
      var incoming = params.channel_id || '';
      if (allowedIds.indexOf(incoming) === -1) {
        return jsonResponse_({
          response_type: 'ephemeral',
          text:
            '❌ `/法務検索` はこのチャンネルでは利用できません。\n' +
            '指定の法務専用チャンネルでお試しください。',
        });
      }
    }

    // Open the modal so the user can refine their search inline.
    // If keyword text was provided alongside the slash command
    // (`/法務検索 NDA`), pre-fill it as the initial value.
    var initialKeyword = (params.text || '').trim();
    openView_(triggerId, getLegalSearchModal_(initialKeyword));
    return jsonResponse_({ response_type: 'ephemeral', text: '検索フォームを開いています…' });
  }

  return jsonResponse_({
    response_type: 'ephemeral',
    text: `未対応のコマンドです: ${command}`,
  });
}

// -----------------------------------------------------------------------
//  Interactivity (view_submission, block_actions)
// -----------------------------------------------------------------------

function handleInteractivity_(payload) {
  // 1. Dynamic re-render when the request type radio/select changes
  if (payload.type === 'block_actions') {
    const action = (payload.actions || [])[0];
    if (action && action.action_id === 'request_type_input') {
      const selected = (action.selected_option && action.selected_option.value) || 'legal_consult';

      // Phase 22.2: V2 select 用に申請者の未完了候補を取得
      var candidates = [];
      if (selected === 'delivery_inspec' || selected === 'license_calc') {
        candidates = fetchUserCandidates_(payload.user.id, selected);
      } else if (selected === 'deadline_change') {
        candidates = fetchUserCandidates_(payload.user.id, 'any');
      }

      slackPost_('views.update', {
        view_id: payload.view.id,
        hash: payload.view.hash,
        view: getLegalRequestModal_(selected, {
          candidates: candidates,
          slackUserId: payload.user.id,
        }),
      });
    }

    // "もう一度検索" button inside the results modal → swap back to the
    // empty search modal so the user can refine the keyword.
    if (action && action.action_id === 'legal_search_again') {
      slackPost_('views.update', {
        view_id: payload.view.id,
        hash: payload.view.hash,
        view: getLegalSearchModal_(''),
      });
    }
    return jsonResponse_({ ok: true });
  }

  // 2. Modal submissions
  if (payload.type === 'view_submission') {
    const callbackId = payload.view && payload.view.callback_id;

    if (callbackId === 'legal_request_modal') {
      const submission = parseLegalRequestSubmission_(payload);

      // Phase 21: 納期変更依頼は新規 Backlog 課題を起こさず、
      // 直接 worker /api/management/issues/:key/deadline-change を叩いて
      // order_line_items.delivery_date を一括更新する。
      if (submission.request_type === 'deadline_change') {
        // Phase 22.2 V2: 候補 select 値があれば free input より優先
        if (
          submission.target_issue_key_select &&
          submission.target_issue_key_select !== '__NEW__'
        ) {
          submission.target_issue_key = submission.target_issue_key_select;
        }
        handleDeadlineChangeSubmission_(submission);
        return jsonResponse_({ response_action: 'clear' });
      }

      // Phase 22.2 V2: delivery_inspec / license_calc で候補が選択されたら
      // 新規 Backlog 課題を作らず、worker /api/intake/link-trigger を呼ぶ。
      // 既存子課題を「トリガー待ち → 未対応」に進めて、そこに紐付ける。
      if (
        (submission.request_type === 'delivery_inspec' ||
          submission.request_type === 'license_calc') &&
        submission.target_issue_key_select &&
        submission.target_issue_key_select !== '__NEW__'
      ) {
        handleLinkTriggerSubmission_(submission, submission.target_issue_key_select);
        return jsonResponse_({ response_action: 'clear' });
      }

      // Phase 19: GAS 側 intake ack DM (sendIntakeAckDm_) は削除した。
      // 課題作成完了の通知は Cloud Run worker 側で webhook type=1
      // 受信時に notifyIssueEvent("created") で発信される
      // (申請者 DM + 部署チャンネル投稿)。重複送信を避けるためここでは
      // 早期 DM を送らない。
      //
      // sendIntakeAckDm_ 関数自体は本ファイル末尾に残置している
      // (緊急時のロールバック用)。

      // Create the Backlog issue directly from GAS. The Backlog
      // type=1 webhook will hand off to Cloud Run which writes to
      // the DB, renders the document, uploads to Drive, and posts
      // the 🆕 受付完了 通知 via notifyIssueEvent.
      const created = createBacklogIssue_(submission);
      if (created && created.__error) {
        notifyUserOfError_(submission.slack_user_id, created.__error);
      } else if (created && created.issueKey) {
        // Backlog API 成功直後の速報 DM (1〜2 秒)。webhook 到着までの
        // 沈黙 (5〜10 秒) を埋めるための即時フィードバック。
        // Phase 19 の本通知 (notifyIssueEvent) はこの後 worker から来る。
        slackPost_('chat.postMessage', {
          channel: submission.slack_user_id,
          text:
            '✅ Backlog 課題を作成しました: *' + created.issueKey + '*\n' +
            'まもなく詳細な受付通知をお送りします。',
        });
      }
      return jsonResponse_({ response_action: 'clear' });
    }

    if (callbackId === 'legal_search_modal') {
      const keyword =
        (payload.view.state.values.keyword_block &&
          payload.view.state.values.keyword_block.keyword_input.value) ||
        '';

      // Empty keyword → show a validation error inside the modal so the
      // user can correct it without losing context.
      if (!keyword.trim()) {
        return jsonResponse_({
          response_action: 'errors',
          errors: {
            keyword_block: 'キーワードを入力してください。',
          },
        });
      }

      // Only the contract-status lookup runs synchronously here.
      //
      // Why not Backlog too? Earlier revisions called Backlog REST in
      // parallel via UrlFetchApp.fetchAll. Backlog's response time
      // routinely spiked to 2–4 s (and once to 10 s+) which, combined
      // with GAS execution variance, pushed `doPost` past Slack's
      // 3-second view_submission budget and surfaced "Slack に接続で
      // きません" errors for users. Cloud Run's
      // /api/contract-check/search is consistently ~300 ms, so we now
      // call only that and link to Backlog's own search UI for issue
      // discovery — see getSearchResultsModal_.
      const contractData = queryContractStatusOnly_(keyword);
      return jsonResponse_({
        response_action: 'update',
        view: getSearchResultsModal_(keyword, { contract: contractData }),
      });
    }
  }

  return jsonResponse_({ ok: true });
}

// -----------------------------------------------------------------------
//  Backlog: direct issue creation (replaces the Cloud Run intake hop)
// -----------------------------------------------------------------------

// Map the user's `/法務依頼` modal request_type onto a Backlog Issue
// Type name. The Backlog side is configured with these exact names —
// see the BACKLOG_ISSUE_TYPE_* env vars on Cloud Run. Unmapped types
// fall back to "法務相談".
var REQUEST_TYPE_TO_BACKLOG_TYPE = {
  legal_consult: '法務相談',
  nda: 'NDA',
  outsourcing: '業務委託基本契約',
  license_master: 'ライセンス契約',
  lic_individual: '個別利用許諾条件',
  sales_master: '売買契約（当社買手）',
  purchase_order: '発注書',
  delivery_inspec: '納品リクエスト',
  license_calc: '売上報告案件',
};

/** Resolve and cache the numeric Backlog project id. */
function resolveBacklogProjectId_(host, apiKey, projectKey) {
  var cache = CacheService.getScriptCache();
  var key = 'backlog_pid_' + projectKey;
  var cached = cache.get(key);
  if (cached) return cached;
  var res = UrlFetchApp.fetch(
    'https://' + host + '/api/v2/projects/' + encodeURIComponent(projectKey) +
      '?apiKey=' + encodeURIComponent(apiKey),
    { method: 'get', muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 300) {
    throw new Error('Backlog プロジェクト解決失敗 (HTTP ' + res.getResponseCode() + ')');
  }
  var pid = String(JSON.parse(res.getContentText()).id);
  cache.put(key, pid, 3600);
  return pid;
}

/** Resolve and cache issue type id by name within the project. */
function resolveBacklogIssueTypeId_(host, apiKey, projectKey, typeName) {
  var cache = CacheService.getScriptCache();
  var key = 'backlog_itid_' + projectKey + '_' + typeName;
  var cached = cache.get(key);
  if (cached) return cached;
  var res = UrlFetchApp.fetch(
    'https://' + host + '/api/v2/projects/' + encodeURIComponent(projectKey) +
      '/issueTypes?apiKey=' + encodeURIComponent(apiKey),
    { method: 'get', muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 300) {
    throw new Error('Backlog 課題タイプ取得失敗 (HTTP ' + res.getResponseCode() + ')');
  }
  var types = JSON.parse(res.getContentText());
  for (var i = 0; i < types.length; i++) {
    if (types[i].name === typeName) {
      var id = String(types[i].id);
      cache.put(key, id, 3600);
      return id;
    }
  }
  // Fallback to first type id if the configured name is missing.
  if (types.length > 0) {
    var fb = String(types[0].id);
    console.warn('Issue type "' + typeName + '" not found, falling back to ' + types[0].name);
    return fb;
  }
  throw new Error('プロジェクトに課題タイプが定義されていません');
}

/**
 * Creates a Backlog issue for a `/法務依頼` modal submission.
 *
 * The Cloud Run side picks the issue up via the Backlog `type=1`
 * webhook and runs the document-generation pipeline (DB write,
 * template render, Drive upload, ✅ 完了 DM). GAS only needs to send
 * the 📥 受付 DM and the issueKey back to the user.
 *
 * Returns { issueKey, issueId } on success, or
 * { __error: '…' } on failure (never throws).
 */
function createBacklogIssue_(submission) {
  var host = scriptProperty_('BACKLOG_HOST');
  var apiKey = scriptProperty_('BACKLOG_API_KEY');
  var projectKey = scriptProperty_('BACKLOG_PROJECT_KEY');
  if (!host || !apiKey || !projectKey) {
    return {
      __error:
        'Backlog 認証情報が GAS のスクリプトプロパティに揃っていません。' +
        ' (BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY)',
    };
  }

  try {
    var projectId = resolveBacklogProjectId_(host, apiKey, projectKey);

    // Map request_type to issue type name → id.
    var typeName = REQUEST_TYPE_TO_BACKLOG_TYPE[submission.request_type] || '法務相談';
    var issueTypeId = resolveBacklogIssueTypeId_(host, apiKey, projectKey, typeName);

    // Compose the description so the Cloud Run webhook can extract the
    // Slack user id (regex `<@U…>`), the dept, and the raw user input
    // back out and feed them into processLegalRequestSubmission.
    var deliveryNote = submission.delivery_no
      ? ' (第' + submission.delivery_no + '回納品)'
      : '';
    var displaySummary = (submission.summary || '') + deliveryNote;
    var description =
      '依頼タイプ: ' + submission.request_type + '\n' +
      '希望納期: ' + (submission.deadline || '') + '\n' +
      '依頼者: <@' + submission.slack_user_id + '>\n\n' +
      '【相手方情報】\n' +
      '名称: ' + (submission.counterparty || '') + '\n' +
      '区分: ' + (submission.entity_type === 'individual' ? '個人' : '法人') + '\n' +
      '番号/コード: ' + (submission.entity_id || '') + '\n\n' +
      '【詳細】\n' +
      (submission.details || '');

    var body = [
      'projectId=' + encodeURIComponent(projectId),
      'summary=' + encodeURIComponent('【' + submission.request_type + '】' + displaySummary),
      'description=' + encodeURIComponent(description),
      'issueTypeId=' + encodeURIComponent(issueTypeId),
      'priorityId=3',
    ];

    // Custom field id mapping mirrors Cloud Run's env. These ids are
    // stable per Backlog project so we hard-code them here. If they
    // change, update this list and the matching Cloud Run env vars.
    var CF = {
      counterparty: '622801',
      deadline: '622802',
      remarks: '622803',
    };
    if (submission.counterparty) {
      body.push('customField_' + CF.counterparty + '=' + encodeURIComponent(submission.counterparty));
    }
    if (submission.deadline) {
      body.push('customField_' + CF.deadline + '=' + encodeURIComponent(submission.deadline));
    }
    if (submission.details) {
      body.push('customField_' + CF.remarks + '=' + encodeURIComponent(submission.details));
    }

    var res = UrlFetchApp.fetch(
      'https://' + host + '/api/v2/issues?apiKey=' + encodeURIComponent(apiKey),
      {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        muteHttpExceptions: true,
        payload: body.join('&'),
      }
    );
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code >= 300) {
      console.error('Backlog createIssue failed:', code, text);
      return {
        __error:
          'Backlog 課題作成失敗 (HTTP ' + code + '): ' +
          text.substring(0, 400),
      };
    }
    var data = JSON.parse(text);
    return { issueKey: data.issueKey, issueId: data.id };
  } catch (err) {
    console.error('createBacklogIssue_ failed:', err);
    return { __error: '課題作成中にエラー: ' + String(err) };
  }
}

/**
 * Calls Cloud Run /api/contract-check/search and returns the parsed
 * response (or { __error: '…' } on failure). Used by the `/法務検索`
 * view_submission handler.
 *
 * Backlog REST is intentionally NOT called from this hot path — see
 * the comment in handleInteractivity_'s legal_search_modal branch for
 * the rationale. If users need to find related Backlog issues, the
 * results modal links them to Backlog's own search UI.
 *
 * Returns the Cloud Run JSON payload directly, or { __error: '…' } on
 * any failure (so the caller can render the error message inline in
 * the results modal without throwing).
 */
function queryContractStatusOnly_(keyword) {
  // Phase 17t: 統合 callLegalBridgeApi_ に委譲。例外は __error で吸収。
  try {
    return callLegalBridgeApi_(
      '/api/contract-check/search',
      'post',
      { counterpartyName: keyword }
    );
  } catch (err) {
    console.error('queryContractStatusOnly_ failed:', err);
    return { __error: String(err && err.message ? err.message : err) };
  }
}

// -----------------------------------------------------------------------
//  Cloud Run API 統合ラッパ (Phase 17t: 旧 法務ポータル GAS から統合)
//
// ScriptProperty:
//   - CLOUD_RUN_BASE_URL  (新)
//   - LB_API_BASE_URL     (旧 ポータル GAS の互換名 — 上が無ければこちらを読む)
//   - LB_PORTAL_SECRET    (legacy 共有シークレット, dual-accept 期)
// -----------------------------------------------------------------------

function getApiConfig_() {
  var props = PropertiesService.getScriptProperties();
  // 新名 (CLOUD_RUN_BASE_URL) を優先、無ければ旧 LB_API_BASE_URL でフォールバック
  var baseUrl =
    String(props.getProperty('CLOUD_RUN_BASE_URL') || '').trim() ||
    String(props.getProperty('LB_API_BASE_URL') || '').trim();
  return {
    baseUrl: baseUrl,
    secret: String(props.getProperty('LB_PORTAL_SECRET') || '').trim()
  };
}

/**
 * Phase 22.2: 申請者の未完了課題候補を worker から取得する。
 *
 * type 引数:
 *   - 'delivery_inspec' → 発注書由来の納品報告子課題 (request_type='delivery_inspec')
 *   - 'license_calc'    → 個別利用許諾由来の利用許諾報告子課題
 *   - 'any'             → 全て (納期変更依頼用)
 *
 * 戻り値: candidates 配列。 [{ issue_key, request_type, summary, counterparty, status }, ...]
 *         失敗時は空配列を返す (モーダル表示に支障が出ないよう sliently fail)。
 */
function fetchUserCandidates_(slackUserId, type) {
  if (!slackUserId) return [];
  var config = getWorkerConfig_();
  if (!config.baseUrl) return [];
  try {
    var url =
      String(config.baseUrl).replace(/\/+$/, '') +
      '/api/management/users/' + encodeURIComponent(slackUserId) +
      '/candidates?type=' + encodeURIComponent(type || 'any');
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
      console.warn('fetchUserCandidates_ failed: ' + res.getResponseCode());
      return [];
    }
    var data = JSON.parse(res.getContentText());
    return (data && data.candidates) || [];
  } catch (e) {
    console.warn('fetchUserCandidates_ error: ' + e);
    return [];
  }
}

/**
 * Phase 21: worker (legalbridge-document-worker) への直接呼び出し用 config。
 *
 * ScriptProperty `LB_WORKER_BASE_URL` (例: https://legalbridge-document-worker-xxx.run.app)
 * を読み込む。CLOUD_RUN_BASE_URL は search-api を指しているので、書き込み
 * 系 (deadline-change 等) は worker URL を直接叩く必要がある。
 */
function getWorkerConfig_() {
  var props = PropertiesService.getScriptProperties();
  var baseUrl = String(props.getProperty('LB_WORKER_BASE_URL') || '').trim();
  return { baseUrl: baseUrl };
}

/**
 * worker REST 呼び出し用 (Phase 21)。失敗時は throw する。
 */
function callWorkerApi_(path, method, payload) {
  var config = getWorkerConfig_();
  if (!config.baseUrl) {
    throw new Error('LB_WORKER_BASE_URL が未設定です (Apps Script の Script Properties で設定してください)。');
  }
  var url = String(config.baseUrl).replace(/\/+$/, '') +
            (String(path).charAt(0) === '/' ? path : '/' + path);
  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: { 'Content-Type': 'application/json' }
  };
  if (payload) options.payload = JSON.stringify(payload);

  var res = UrlFetchApp.fetch(url, options);
  var status = res.getResponseCode();
  var text = res.getContentText();
  if (status < 200 || status >= 300) {
    throw new Error('worker API error: ' + status + ' ' + String(text).slice(0, 500));
  }
  try { return JSON.parse(text); }
  catch (e) { return { ok: true, raw: text }; }
}

/**
 * Cloud Run へ JSON で REST 呼び出し。成功時は JSON.parse 結果を返す。
 * 失敗時は throw する (caller が try/catch するか、wrap して __error にする)。
 */
function callLegalBridgeApi_(path, method, payload) {
  var config = getApiConfig_();
  if (!config.baseUrl) {
    throw new Error('CLOUD_RUN_BASE_URL (旧 LB_API_BASE_URL) が未設定です。');
  }

  var baseUrl = String(config.baseUrl).replace(/\/+$/, '');
  var apiPath = String(path).charAt(0) === '/' ? path : '/' + path;

  var headers = { 'Content-Type': 'application/json' };
  if (config.secret) {
    headers['X-LB-PORTAL-SECRET'] = config.secret;
  }

  var options = {
    method: method,
    muteHttpExceptions: true,
    headers: headers
  };
  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  var res = UrlFetchApp.fetch(baseUrl + apiPath, options);
  var status = res.getResponseCode();
  var text = res.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('LegalBridge API error: ' + status + ' ' + String(text).slice(0, 500));
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      'LegalBridge API が JSON を返しませんでした (head=' +
        String(text).slice(0, 300) + ')'
    );
  }
}

// -----------------------------------------------------------------------
//  契約状況確認 API (HTML ポータルから呼ばれる)
// -----------------------------------------------------------------------

function getContractPurposes() {
  if (USE_MOCK_CONTRACT_CHECK) {
    return getMockContractPurposes_();
  }
  return callLegalBridgeApi_('/api/contract-check/purposes', 'get');
}

function searchContractStatus(payload) {
  if (USE_MOCK_CONTRACT_CHECK) {
    return getMockContractStatus_(payload);
  }
  return callLegalBridgeApi_('/api/contract-check/search', 'post', payload);
}

/** 旧 HTML 互換用エイリアス (古い contract_check.html が残っていても落ちないように) */
function judgeContractScope(payload) {
  return searchContractStatus(payload);
}

// ----- モックデータ (USE_MOCK_CONTRACT_CHECK=true 時専用) -----

function getMockContractPurposes_() {
  return [
    { purpose_code: 'service_general',       purpose_group: '業務を依頼する',     purpose_label: '制作・編集・デザイン等の業務を依頼したい',   category: 'service',    default_document_type: 'purchase_order' },
    { purpose_code: 'service_creative',      purpose_group: '業務を依頼する',     purpose_label: 'イラスト・原稿・DTP・校正等を依頼したい',     category: 'service',    default_document_type: 'purchase_order' },
    { purpose_code: 'service_event',         purpose_group: '業務を依頼する',     purpose_label: 'イベント運営・スタッフ業務を依頼したい',     category: 'service',    default_document_type: 'purchase_order' },
    { purpose_code: 'license_game',          purpose_group: '作品・IPを利用する', purpose_label: '作品・ゲーム・IPをアナログゲーム化したい',   category: 'license',    default_document_type: 'license_condition' },
    { purpose_code: 'license_localize',      purpose_group: '作品・IPを利用する', purpose_label: '作品を別地域・別言語で展開したい',           category: 'license',    default_document_type: 'license_condition' },
    { purpose_code: 'license_sublicense',    purpose_group: '作品・IPを利用する', purpose_label: '第三者に再許諾・OEM展開したい',             category: 'license',    default_document_type: 'license_condition' },
    { purpose_code: 'publication_paper',     purpose_group: '出版する',           purpose_label: '紙書籍として出版したい',                     category: 'publication', default_document_type: 'publication_contract' },
    { purpose_code: 'publication_ebook',     purpose_group: '出版する',           purpose_label: '電子書籍として配信したい',                   category: 'publication', default_document_type: 'publication_contract' },
    { purpose_code: 'publication_translation', purpose_group: '出版する',         purpose_label: '海外出版・翻訳版を出したい',                 category: 'publication', default_document_type: 'publication_contract' },
    { purpose_code: 'publication_merch',     purpose_group: '出版する',           purpose_label: '出版物・イラストを商品化したい',             category: 'publication', default_document_type: 'publication_contract' },
    { purpose_code: 'publication_video_game', purpose_group: '出版する',          purpose_label: '映像化・ゲーム化したい',                     category: 'publication', default_document_type: 'legal_review' },
    { purpose_code: 'mixed_service_license', purpose_group: '複合取引',           purpose_label: '業務依頼と権利利用の両方がある',             category: 'mixed',       default_document_type: 'purchase_order,license_condition' },
    { purpose_code: 'unknown',               purpose_group: 'その他',             purpose_label: 'どれに該当するかわからない',                 category: 'unknown',     default_document_type: 'legal_review' }
  ];
}

function getMockContractStatus_(payload) {
  if (!payload || !payload.counterpartyName) {
    return { ok: false, message: '取引先名を入力してください。' };
  }
  return {
    ok: true,
    counterparty: {
      vendorId: 1,
      vendorCode: 'V-000123',
      vendorName: payload.counterpartyName,
      entityType: 'corporation'
    },
    masterContracts: {
      service:     { exists: true,  status: 'executed', label: '締結済', contractTitle: '業務委託基本契約書',         documentNumber: 'SB-2026-001', effectiveDate: '2026-04-01', expirationDate: '', autoRenewal: true,  availableDocument: 'purchase_order',     documentUrl: '', legalonUrl: '', cloudsignUrl: '', driveUrl: '' },
      license:     { exists: true,  status: 'executed', label: '締結済', contractTitle: 'ライセンス利用許諾基本契約書', documentNumber: 'LB-2026-001', effectiveDate: '2026-04-01', expirationDate: '', autoRenewal: true,  availableDocument: 'license_condition',  documentUrl: '', legalonUrl: '', cloudsignUrl: '', driveUrl: '' },
      publication: { exists: false, status: 'not_found', label: '未締結', contractTitle: '',                           documentNumber: '',           effectiveDate: '',          expirationDate: '', autoRenewal: false, availableDocument: 'publication_contract', documentUrl: '', legalonUrl: '', cloudsignUrl: '', driveUrl: '' }
    },
    licenseConditions: [
      { conditionNumber: 'LIC-2026-001', originalWork: 'サンプル原著作物',  productName: 'サンプル対象製品', territory: '日本',   language: '日本語', status: '有効', documentUrl: '' },
      { conditionNumber: 'LIC-2026-002', originalWork: 'サンプル原著作物2', productName: '海外展開版',       territory: '北米',   language: '英語',   status: '有効', documentUrl: '' }
    ],
    publicationConditions: [
      { conditionNumber: 'PUB-2026-001', workName: 'サンプル出版作品', media: '紙書籍', territory: '日本', language: '日本語', scope: '紙媒体出版', status: '有効', documentUrl: '' }
    ],
    purposeResult: buildMockPurposeResult_(payload),
    suggestedAction: {
      label: '契約状況の確認結果',
      legalReviewRequired: true,
      message: '業務委託基本契約およびライセンス基本契約は締結済みです。出版基本契約は未締結のため、出版取引を行う場合は法務確認が必要です。'
    }
  };
}

function buildMockPurposeResult_(payload) {
  var purposeCode = payload && payload.purposeCode;
  if (!purposeCode) {
    return {
      selected: false,
      label: '今回やりたいことは未選択です',
      judgmentLabel: '契約締結状況のみ表示',
      recommendedDocumentType: '',
      legalReviewRequired: false,
      reasonSummary: '今回やりたいことが選択されていないため、取引先ごとの契約締結状況のみを表示しています。'
    };
  }
  var purposeMap = {
    service_general:        { label: '制作・編集・デザイン等の業務を依頼したい', judgmentLabel: '発注書で進行可能', recommendedDocumentType: 'purchase_order',                 legalReviewRequired: false, reasonSummary: '業務委託基本契約が締結済みであり、今回の業務は発注書で個別条件を定める運用に適合します。' },
    service_creative:       { label: 'イラスト・原稿・DTP・校正等を依頼したい', judgmentLabel: '発注書で進行可能', recommendedDocumentType: 'purchase_order',                 legalReviewRequired: false, reasonSummary: '業務委託基本契約が締結済みであり、制作・編集・デザイン系業務は発注書で進行できる可能性が高いです。' },
    service_event:          { label: 'イベント運営・スタッフ業務を依頼したい', judgmentLabel: '発注書で進行可能', recommendedDocumentType: 'purchase_order',                 legalReviewRequired: false, reasonSummary: '業務委託基本契約が締結済みであれば、イベント運営・スタッフ業務は発注書で個別条件を定めて進行できます。' },
    license_game:           { label: '作品・ゲーム・IPをアナログゲーム化したい', judgmentLabel: '個別利用許諾条件書で確認', recommendedDocumentType: 'license_condition',   legalReviewRequired: false, reasonSummary: 'ライセンス基本契約が締結済みであり、対象作品・対象製品・地域・言語・料率を個別利用許諾条件書で定める必要があります。' },
    license_localize:       { label: '作品を別地域・別言語で展開したい', judgmentLabel: '個別利用許諾条件書または法務確認が必要', recommendedDocumentType: 'license_condition', legalReviewRequired: true,  reasonSummary: '地域・言語の追加はライセンス範囲の確認が必要です。既存の個別利用許諾条件書に含まれない場合、新たな条件書または法務確認が必要です。' },
    license_sublicense:     { label: '第三者に再許諾・OEM展開したい',           judgmentLabel: '法務確認が必要',                recommendedDocumentType: 'license_condition', legalReviewRequired: true,  reasonSummary: '再許諾・OEM展開は基本契約上の再許諾可否、再許諾先、地域、製造・販売範囲の確認が必要です。' },
    publication_paper:      { label: '紙書籍として出版したい',                   judgmentLabel: '出版契約または出版条件の確認が必要', recommendedDocumentType: 'publication_contract', legalReviewRequired: true, reasonSummary: '出版基本契約または作品ごとの出版条件の有無を確認し、対象作品・媒体・地域・言語が一致するか確認してください。' },
    publication_ebook:      { label: '電子書籍として配信したい',                 judgmentLabel: '出版条件の確認が必要',              recommendedDocumentType: 'publication_contract', legalReviewRequired: true, reasonSummary: '電子書籍配信は紙媒体出版とは別に許諾範囲の確認が必要です。電子配信の可否、地域、配信先を確認してください。' },
    publication_translation:{ label: '海外出版・翻訳版を出したい',               judgmentLabel: '法務確認が必要',                   recommendedDocumentType: 'publication_contract', legalReviewRequired: true, reasonSummary: '海外出版・翻訳版は地域・言語・翻訳権の確認が必要です。既存条件に含まれない場合は追加合意が必要です。' },
    publication_merch:      { label: '出版物・イラストを商品化したい',           judgmentLabel: '法務確認が必要',                   recommendedDocumentType: 'publication_contract', legalReviewRequired: true, reasonSummary: '商品化は出版許諾とは別の利用態様になる可能性があります。商品化権・二次利用範囲を確認してください。' },
    publication_video_game: { label: '映像化・ゲーム化したい',                   judgmentLabel: '法務確認が必要',                   recommendedDocumentType: 'legal_review',        legalReviewRequired: true, reasonSummary: '映像化・ゲーム化は通常の出版条件を超える可能性が高いため、個別の法務確認が必要です。' },
    mixed_service_license:  { label: '業務依頼と権利利用の両方がある',           judgmentLabel: '発注書＋個別利用許諾条件書の確認が必要', recommendedDocumentType: 'purchase_order,license_condition', legalReviewRequired: true, reasonSummary: '業務委託と権利利用が混在するため、発注書だけでなく、ライセンス条件書の要否も確認してください。' },
    unknown:                { label: 'どれに該当するかわからない',               judgmentLabel: '法務確認が必要',                   recommendedDocumentType: 'legal_review',        legalReviewRequired: true, reasonSummary: '取引類型を自動判定できないため、法務確認が必要です。' }
  };
  var result = purposeMap[purposeCode];
  if (!result) {
    return {
      selected: true,
      label: purposeCode,
      judgmentLabel: '法務確認が必要',
      recommendedDocumentType: 'legal_review',
      legalReviewRequired: true,
      reasonSummary: '選択された目的コードに対応する判定定義がありません。'
    };
  }
  return Object.assign({ selected: true }, result);
}

// ----- ポータル GAS 由来の動作確認ヘルパー -----

function testGetContractPurposes() {
  var result = getContractPurposes();
  console.log(JSON.stringify(result, null, 2));
}

function testSearchContractStatus() {
  var result = searchContractStatus({
    counterpartyName: '株式会社サンプル',
    purposeCode: 'service_creative',
    workName: 'サンプル作品',
    productName: 'サンプル製品',
    territory: '日本',
    language: '日本語'
  });
  console.log(JSON.stringify(result, null, 2));
}

function debugLegalBridgeConfig() {
  var config = getApiConfig_();
  console.log('baseUrl = ' + config.baseUrl);
  console.log('LB_PORTAL_SECRET length = ' + config.secret.length);
  if (config.secret) {
    console.log(
      'LB_PORTAL_SECRET masked = ' +
        config.secret.slice(0, 3) + '***' + config.secret.slice(-3)
    );
  }
  var signing = scriptProperty_('LB_SIGNING_SECRET') || '';
  console.log('LB_SIGNING_SECRET length = ' + signing.length);
}

// -----------------------------------------------------------------------
//  Slack helpers
// -----------------------------------------------------------------------

function openView_(triggerId, view) {
  return slackPost_('views.open', { trigger_id: triggerId, view: view });
}

function slackPost_(method, body) {
  const token = scriptProperty_('SLACK_BOT_TOKEN');
  if (!token) {
    console.error('SLACK_BOT_TOKEN is not configured.');
    return null;
  }
  const res = UrlFetchApp.fetch(`${SLACK_API}/${method}`, {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
    payload: JSON.stringify(body),
  });
  const json = JSON.parse(res.getContentText());
  if (!json.ok) {
    console.error(`Slack ${method} failed:`, json);
  }
  return json;
}

function notifyUserOfError_(userId, message) {
  if (!userId) return;
  slackPost_('chat.postMessage', {
    channel: userId,
    text: `⚠️ ${message}`,
  });
}

/**
 * Phase 22.2: Slack /法務依頼 V2 select で候補課題が選択された場合の処理。
 *
 * 新規 Backlog 課題を作らず、既存子課題に紐付け (= トリガー待ち → 未対応 遷移)
 * + 通常の文書生成パイプラインを起動する。worker の /api/intake/link-trigger
 * を叩く。
 *
 * @param submission   parseLegalRequestSubmission_ の結果
 * @param childIssueKey 紐付け対象の既存子課題キー (例: "LEGAL-200")
 */
function handleLinkTriggerSubmission_(submission, childIssueKey) {
  if (!submission || !submission.slack_user_id) return;
  if (!childIssueKey) return;

  // worker /api/intake/link-trigger を叩く
  var payload = Object.assign({}, submission, {
    existing_issue_key: childIssueKey,
  });

  try {
    var result = callWorkerApi_('/api/intake/link-trigger', 'POST', payload);
    slackPost_('chat.postMessage', {
      channel: submission.slack_user_id,
      text:
        '✅ *既存課題に紐付けて起票しました*\n\n' +
        '*対象課題:* ' + childIssueKey + '\n' +
        (result && result.docNumber ? '*文書番号:* ' + result.docNumber + '\n' : '') +
        (result && result.driveLink ? '*ドキュメント:* ' + result.driveLink + '\n' : '') +
        '\n本課題のステータスを「トリガー待ち → 未対応」に進めました。' +
        'まもなく詳細な受付通知をお送りします。',
    });
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    notifyUserOfError_(
      submission.slack_user_id,
      '既存課題への紐付けに失敗しました: ' + msg
    );
  }
}

/**
 * Phase 21: 納期変更依頼の処理。
 *
 * 申請者の入力 (対象 Backlog 課題キー、新しい納期、変更理由) を受け取り、
 * worker の POST /api/management/issues/:issueKey/deadline-change を叩く。
 * worker 側で:
 *   - その課題の未完了 line_items すべての delivery_date を更新
 *   - Backlog 課題にコメント (履歴) を追加
 *   - 申請者 + 部署チャンネルに Slack 通知 (notifyIssueEvent)
 *
 * GAS 側は実行結果を申請者に即時 DM で返す。エラー時は理由を含めて通知。
 */
function handleDeadlineChangeSubmission_(submission) {
  if (!submission || !submission.slack_user_id) return;

  var issueKey = String(submission.target_issue_key || '').trim().toUpperCase();
  var newDate = String(submission.new_delivery_date || '').trim();
  var reason = String(submission.change_reason || '').trim();

  // バリデーション
  if (!issueKey) {
    notifyUserOfError_(submission.slack_user_id, '対象 Backlog 課題キーが空です。');
    return;
  }
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    notifyUserOfError_(
      submission.slack_user_id,
      '対象 Backlog 課題キーの形式が不正です (例: LEGAL-123)。'
    );
    return;
  }
  if (!newDate) {
    notifyUserOfError_(submission.slack_user_id, '新しい納期が指定されていません。');
    return;
  }
  if (!reason) {
    notifyUserOfError_(submission.slack_user_id, '変更理由を入力してください。');
    return;
  }

  // worker を叩く
  try {
    var result = callWorkerApi_(
      '/api/management/issues/' + encodeURIComponent(issueKey) + '/deadline-change',
      'POST',
      { delivery_date: newDate, reason: reason }
    );

    var updatedCount = (result && result.updated && result.updated.length) || 0;
    var detailLines = (result && result.updated || []).map(function (u) {
      return '  • #' + u.line_no + ' ' + (u.item_name || '') +
             ' (旧: ' + (u.previous_date || '未設定') + ')';
    }).join('\n');

    // 申請者へ完了 DM (本通知は worker の notifyIssueEvent から飛ぶ)
    slackPost_('chat.postMessage', {
      channel: submission.slack_user_id,
      text:
        '✅ *納期変更を実行しました*\n\n' +
        '*課題:* ' + issueKey + '\n' +
        '*新しい納期:* ' + newDate + '\n' +
        '*対象明細:* ' + updatedCount + ' 件\n' +
        (detailLines ? detailLines + '\n\n' : '\n') +
        '*変更理由:* ' + reason + '\n\n' +
        '※ Backlog 課題に変更履歴コメントを追加しました。' +
        '部署チャンネルにも通知済みです。'
    });
  } catch (err) {
    var msg = String(err && err.message ? err.message : err);
    notifyUserOfError_(
      submission.slack_user_id,
      '納期変更に失敗しました: ' + msg
    );
  }
}

/**
 * Posts an immediate "we got your submission" DM to the requester right
 * after the modal closes. This makes the intake feel responsive even
 * though the heavy work (Backlog issue, DB writes, Drive upload,
 * completion DM) still runs in the background on Cloud Run.
 */
function sendIntakeAckDm_(submission) {
  if (!submission || !submission.slack_user_id) return;

  const REQUEST_TYPE_LABELS = {
    legal_consult: '法務相談',
    nda: '秘密保持契約 (NDA)',
    outsourcing: '業務委託基本契約',
    license_master: 'ライセンス基本契約',
    lic_individual: '個別利用許諾条件',
    sales_master: '売買基本契約',
    purchase_order: '発注書',
    delivery_inspec: '納品 / 検収書',
    license_calc: '利用許諾計算書',
  };
  var typeLabel = REQUEST_TYPE_LABELS[submission.request_type] || submission.request_type;

  var fields = [
    { type: 'mrkdwn', text: '*種別*\n' + typeLabel },
    { type: 'mrkdwn', text: '*件名*\n' + (submission.summary || '(未入力)') },
  ];
  if (submission.counterparty) {
    fields.push({ type: 'mrkdwn', text: '*相手方*\n' + submission.counterparty });
  }
  if (submission.deadline) {
    fields.push({ type: 'mrkdwn', text: '*希望納期*\n' + submission.deadline });
  }
  if (submission.dept) {
    fields.push({ type: 'mrkdwn', text: '*依頼部署*\n' + submission.dept });
  }

  slackPost_('chat.postMessage', {
    channel: submission.slack_user_id,
    text: '📥 法務依頼を受け付けました。処理結果は完了次第このスレッドに届きます。',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📥 法務依頼を受け付けました', emoji: true },
      },
      { type: 'section', fields: fields },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🔄 Backlog 課題作成・文書生成を処理中です。完了次第、課題キーと生成ドキュメントのリンクを別 DM でお送りします（通常 5〜10 秒）。',
          },
        ],
      },
    ],
  });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function scriptProperty_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// -----------------------------------------------------------------------
// Phase 17s: HMAC 短期署名 URL ヘルパー
//
// services/api 側の signedUrl.ts と完全に同じ仕様で署名する。
// payload は `${resourceId}.${exp}` を LB_SIGNING_SECRET で HMAC-SHA256 し
// base64url エンコード。
//
// resourceId 規約:
//   - 'list'           → /search/vendor 一覧 (query は payload に含めない)
//   - 'vendor:<id>'    → /search/vendor/:vendorId 詳細
//   - 'ringi:<num>'    → /search/ringi/:number   稟議詳細
//
// LB_SIGNING_SECRET が未設定なら null を返す (caller が legacy token に
// フォールバックする)。
// -----------------------------------------------------------------------

function signResourceQs_(resourceId, ttlSec) {
  var secret = scriptProperty_('LB_SIGNING_SECRET');
  if (!secret) return null;
  var ttl = Number(ttlSec) > 0 ? Number(ttlSec) : 600;
  var exp = Math.floor(Date.now() / 1000) + ttl;
  var rawMac = Utilities.computeHmacSha256Signature(
    String(resourceId) + '.' + exp,
    secret
  );
  // base64url (RFC 4648 §5) — `+`/`/`/`=` を URL safe に
  var sig = Utilities.base64Encode(rawMac)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return 'exp=' + exp + '&sig=' + encodeURIComponent(sig);
}

function signListResourceQs_() {
  return signResourceQs_('list', 600);
}

// -----------------------------------------------------------------------
//  view_submission parsing
// -----------------------------------------------------------------------

function parseLegalRequestSubmission_(payload) {
  const v = payload.view.state.values;
  const safeText = (block, action) =>
    (v[block] && v[block][action] && v[block][action].value) || '';
  const safeDate = (block, action) =>
    (v[block] && v[block][action] && v[block][action].selected_date) || '';
  const safeOption = (block, action) =>
    (v[block] && v[block][action] && v[block][action].selected_option &&
      v[block][action].selected_option.value) ||
    '';

  const deliveryNoRaw = safeText('delivery_no_block', 'delivery_no_input');
  return {
    slack_user_id: payload.user.id,
    slack_user_name: payload.user.name || payload.user.username || '',
    dept: safeText('dept_block', 'dept_input'),
    request_type: safeOption('request_type_block', 'request_type_input') || 'legal_consult',
    summary: safeText('summary_block', 'summary_input'),
    deadline: safeDate('deadline_block', 'deadline_input'),
    details: safeText('details_block', 'details_input'),
    counterparty: safeText('counterparty_block', 'counterparty_input'),
    entity_type: safeOption('entity_type_block', 'entity_type_input') || 'corporate',
    entity_id: safeText('entity_id_block', 'entity_id_input'),
    delivery_no: deliveryNoRaw ? parseInt(deliveryNoRaw, 10) : null,
    order_amount: safeText('order_amount_block', 'order_amount_input') || null,
    delivery_date: safeDate('delivery_date_block', 'delivery_date_input') || null,
    inspection_deadline: safeDate('inspection_deadline_block', 'inspection_deadline_input') || null,
    // Phase 21: 納期変更依頼 (deadline_change) 専用フィールド
    target_issue_key: safeText('target_issue_key_block', 'target_issue_key_input'),
    new_delivery_date: safeDate('new_delivery_date_block', 'new_delivery_date_input'),
    change_reason: safeText('change_reason_block', 'change_reason_input'),
    // Phase 22.2 V2: candidate select の値
    //   delivery_inspec / license_calc: '__NEW__' = 新規 / それ以外 = 既存子課題キー
    //   deadline_change: 候補から選択した課題キー (free input より優先)
    target_issue_key_select: safeOption(
      'target_issue_key_select_block',
      'target_issue_key_select_input'
    ),
  };
}

// -----------------------------------------------------------------------
//  Modal block builders
// -----------------------------------------------------------------------

/**
 * Modal for /法務検索. Submitting it dispatches a `view_submission`
 * with callback_id `legal_search_modal`, which is handled in
 * handleInteractivity_ and forwarded to queryContractStatusOnly_ which
 * calls Cloud Run /api/contract-check/search. Backlog issue search is
 * surfaced via a deep-link button in the results modal rather than
 * fetched server-side (avoids Backlog REST's variable latency from
 * pushing Slack past its 3-second view_submission budget).
 *
 * @param {string} [initialKeyword] Optional value the user already
 *   typed alongside the slash command (e.g. `/法務検索 NDA`).
 */
function getLegalSearchModal_(initialKeyword) {
  var keywordElement = {
    type: 'plain_text_input',
    action_id: 'keyword_input',
    placeholder: {
      type: 'plain_text',
      text: '件名、取引先名、Backlog キー、依頼種別など',
    },
  };
  if (initialKeyword) {
    keywordElement.initial_value = initialKeyword;
  }

  return {
    type: 'modal',
    callback_id: 'legal_search_modal',
    title: { type: 'plain_text', text: '法務検索' },
    submit: { type: 'plain_text', text: '検索' },
    close: { type: 'plain_text', text: '閉じる' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'キーワードを入力して *検索* を押してください。結果は DM に届きます。',
        },
      },
      {
        type: 'input',
        block_id: 'keyword_block',
        label: { type: 'plain_text', text: '検索キーワード' },
        element: keywordElement,
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🔎 過去の法務依頼 (legal_requests) と取引先マスター (vendors) を横断検索します。部分一致 / 大文字小文字を区別しません。',
          },
        ],
      },
    ],
  };
}

/**
 * Builds the modal that replaces the search input modal once the user
 * submits. Renders contract-status information from Cloud Run and
 * offers two footer actions:
 *
 *   - 「🔁 もう一度検索する」 — re-opens the empty search input modal.
 *   - 「🔗 Backlog で関連課題を検索する」 — external link straight to
 *     Backlog's search UI with the keyword pre-filled. We avoid
 *     fetching Backlog issues server-side here because Backlog REST's
 *     unpredictable latency (sometimes 4–10 s) made the prior
 *     fetchAll-based design routinely blow Slack's 3-second
 *     view_submission budget. Outsourcing the issue search to
 *     Backlog's native UI is both faster and richer for the user.
 *
 * @param {string} keyword The keyword the user submitted.
 * @param {object} data { contract: <queryResult> }
 *   `contract` carries either its data shape or { __error: '…' }.
 */
function getSearchResultsModal_(keyword, data) {
  data = data || {};
  var contractPayload = data.contract || {};

  var backlogHost = scriptProperty_('BACKLOG_HOST') || 'arclight.backlog.com';
  var backlogProject = scriptProperty_('BACKLOG_PROJECT_KEY') || 'LEGAL';
  // Backlog's web UI accepts a `simpleSearch` query parameter that
  // populates the omnibar. Encode the keyword once; Slack's button URL
  // doesn't need additional escaping.
  var backlogSearchUrl =
    'https://' + backlogHost + '/find/' + encodeURIComponent(backlogProject) +
    '?simpleSearch=' + encodeURIComponent(keyword);

  var blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*🔎 検索結果: `' + keyword + '`*' },
    },
    { type: 'divider' },
  ];

  // ── Contract status (Cloud Run /api/contract-check/search) ────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📑 契約状況*' },
  });
  appendContractStatusBlocks_(blocks, contractPayload);

  // Phase 12 / 17s / 17t: search-api の Web 詳細ページへの URL を組み立て。
  //   優先: LB_SIGNING_SECRET があれば HMAC 短期署名 URL を発行
  //   フォールバック: 旧 LB_PORTAL_SECRET の ?token=
  // 移行期間中は両方 ScriptProperty にあって良い。
  // base URL は CLOUD_RUN_BASE_URL / LB_API_BASE_URL のいずれでも引ける
  // (getApiConfig_ が dual-read する)。
  var cloudRunBase = (getApiConfig_().baseUrl || '').replace(/\/+$/, '');
  var webDetailUrl = '';
  if (cloudRunBase) {
    var signedQs = signListResourceQs_();
    if (signedQs) {
      webDetailUrl =
        cloudRunBase + '/search/vendor?q=' + encodeURIComponent(keyword) +
        '&' + signedQs;
    } else {
      // legacy fallback
      var portalSecret = scriptProperty_('LB_PORTAL_SECRET') || '';
      webDetailUrl =
        cloudRunBase + '/search/vendor?q=' + encodeURIComponent(keyword) +
        (portalSecret ? '&token=' + encodeURIComponent(portalSecret) : '');
    }
  }

  // ── Footer actions ────────────────────────────────────────────
  blocks.push({ type: 'divider' });
  var footerButtons = [
    {
      type: 'button',
      action_id: 'legal_search_again',
      text: { type: 'plain_text', text: '🔁 もう一度検索する' },
      style: 'primary',
    },
  ];
  if (webDetailUrl) {
    footerButtons.push({
      type: 'button',
      action_id: 'legal_search_open_web',
      text: { type: 'plain_text', text: '🌐 Web で詳細を見る' },
      url: webDetailUrl,
    });
  }
  footerButtons.push({
    type: 'button',
    action_id: 'legal_search_open_backlog',
    text: { type: 'plain_text', text: '🔗 Backlog で関連課題を検索' },
    url: backlogSearchUrl,
  });
  blocks.push({
    type: 'actions',
    elements: footerButtons,
  });

  return {
    type: 'modal',
    callback_id: 'legal_search_results',
    title: { type: 'plain_text', text: '法務検索: 結果' },
    close: { type: 'plain_text', text: '閉じる' },
    blocks: blocks,
  };
}

/** Appends contract-status summary blocks. */
function appendContractStatusBlocks_(blocks, payload) {
  if (payload && payload.__error) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '⚠️ ' + payload.__error },
    });
    return;
  }

  // Phase 17c: 稟議モード (5 桁数字検索のとき) — ringi 詳細を先頭に表示
  if (payload && payload.ringiMode === true && payload.ringi) {
    appendRingiDetail_(blocks, payload.ringi);
    appendDocumentsByCategorySection_(blocks, payload.documentsByCategory);
    return;
  }

  // Backend may return either a single result or a multi-candidate list.
  var candidates = [];
  if (payload && Array.isArray(payload.results)) candidates = payload.results;
  else if (payload && Array.isArray(payload.matches)) candidates = payload.matches;
  else if (payload && Array.isArray(payload.candidates)) candidates = payload.candidates;
  else if (payload && Array.isArray(payload.vendorCandidates)) candidates = payload.vendorCandidates;
  else if (payload && (payload.multiple === true)) candidates = [];

  // Single hit (or summary-shaped) → render the detail.
  if (
    candidates.length === 0 &&
    payload &&
    (payload.counterparty || payload.masterContracts)
  ) {
    appendSingleContractDetail_(blocks, payload);
    return;
  }

  // Multiple candidates → render a compact list.
  if (candidates.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '複数の候補が見つかりました (' + candidates.length + ' 件)。詳細は Web で確認してください。',
      },
    });
    var LIMIT = 5;
    candidates.slice(0, LIMIT).forEach(function (c) {
      var cp = c.counterparty || c.vendor || c;
      var name = cp.vendorName || cp.vendor_name || cp.counterpartyName || cp.name || '-';
      var code = cp.vendorCode || cp.vendor_code || '-';
      var masters = c.masterContracts || {};
      var pills = [];
      pills.push('業務委託 ' + (masters.service && masters.service.exists ? '✅' : '—'));
      pills.push('ライセンス ' + (masters.license && masters.license.exists ? '✅' : '—'));
      pills.push('出版 ' + (masters.publication && masters.publication.exists ? '✅' : '—'));

      // Phase 11: 文書カテゴリ別サマリー (件数 + 上位 3 件の Drive リンク)
      var cat = c.documentsByCategory || {};
      var bc = Array.isArray(cat.basic) ? cat.basic : [];
      var ic = Array.isArray(cat.individual) ? cat.individual : [];
      var oc = Array.isArray(cat.other) ? cat.other : [];
      var summary =
        '📁 基本 ' + bc.length + ' / 個別 ' + ic.length + ' / その他 ' + oc.length;

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• *' + name + '* (`' + code + '`)\n>' + pills.join(' · ') + '\n>' + summary,
        },
      });

      // 各カテゴリの上位 3 件を context ブロックで列挙 (件数 > 0 のときだけ)
      var miniSections = [
        { label: '🟦 基本契約', rows: bc },
        { label: '🟩 個別契約', rows: ic },
        { label: '⬛ その他', rows: oc },
      ];
      miniSections.forEach(function (sec) {
        if (sec.rows.length === 0) return;
        var lines = sec.rows.slice(0, 3).map(function (d) {
          var title = d.contract_title || d.template_type || '(無題)';
          var docNo = d.document_number ? ' `' + d.document_number + '`' : '';
          var linked = d.file_link
            ? ' <' + d.file_link + '|📄>'
            : '';
          return '  ' + sec.label + ': ' + title + docNo + linked;
        });
        if (sec.rows.length > 3) {
          lines.push('  _… 他 ' + (sec.rows.length - 3) + ' 件_');
        }
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: lines.join('\n') }],
        });
      });
    });
    if (candidates.length > LIMIT) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '他 ' + (candidates.length - LIMIT) + ' 件あります。',
          },
        ],
      });
    }
    return;
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '取引先マスタに登録された契約が見つかりませんでした。' },
  });
}

/** Renders a single counterparty's contract status. */
function appendSingleContractDetail_(blocks, payload) {
  var cp = payload.counterparty || {};
  var masters = payload.masterContracts || {};
  var name = cp.vendorName || cp.counterpartyName || '-';
  var code = cp.vendorCode || '-';

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*' + name + '* (`' + code + '`)',
    },
  });

  // Master contract pills (one line, easy to scan).
  var pillLines = [
    '業務委託基本契約: ' + masterStatusLabel_(masters.service),
    'ライセンス基本契約: ' + masterStatusLabel_(masters.license),
    '出版基本契約: ' + masterStatusLabel_(masters.publication),
  ];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '>' + pillLines.join('\n>') },
  });

  var licCount = Array.isArray(payload.licenseConditions)
    ? payload.licenseConditions.length
    : 0;
  var pubCount = Array.isArray(payload.publicationConditions)
    ? payload.publicationConditions.length
    : 0;
  if (licCount || pubCount) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            'ライセンス個別条件: ' + licCount + ' 件 · 出版個別条件: ' + pubCount + ' 件',
        },
      ],
    });
  }

  // Phase 11: 文書カテゴリ別の一覧 (基本契約 / 個別契約 / その他)
  // 各文書には Drive リンクを <url|タイトル> 形式で添付。
  appendDocumentsByCategorySection_(blocks, payload.documentsByCategory);
}

/**
 * Phase 17c: 稟議モード — 稟議ヘッダ情報を先頭に表示
 */
function appendRingiDetail_(blocks, ringi) {
  var title = ringi.title || '(タイトル未設定)';
  var num = ringi.ringi_number || '-';
  var meta = [];
  if (ringi.category) meta.push('カテゴリ: ' + ringi.category);
  if (ringi.owner_name) meta.push('起案者: ' + ringi.owner_name);
  if (ringi.owner_department) meta.push('部署: ' + ringi.owner_department);
  if (ringi.approved_at) meta.push('承認日: ' + ringi.approved_at);
  if (ringi.status) meta.push('状態: ' + ringi.status);
  if (ringi.total_budget) {
    meta.push('予算: ¥' + Number(ringi.total_budget).toLocaleString('ja-JP'));
  }

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📋 稟議 ' + num + ' ' + title,
      emoji: true,
    },
  });
  if (meta.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: meta.join('  ·  ') }],
    });
  }
  if (ringi.remarks) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '> ' + ringi.remarks },
    });
  }
  blocks.push({ type: 'divider' });
}

/**
 * Phase 11: 「基本契約は何と何 / 個別契約は何と何 / その他は何と何」を
 * Slack モーダルの 3 セクションで描画する。
 *
 * @param {Array} blocks   累積中のブロック配列 (push する)
 * @param {Object} catData {basic:[], individual:[], other:[], total:N}
 */
function appendDocumentsByCategorySection_(blocks, catData) {
  if (!catData || typeof catData !== 'object') return;
  var total = Number(catData.total) || 0;
  if (total === 0) return;

  // 区切り線
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: '📁 登録文書一覧 (' + total + '件)',
      emoji: true,
    },
  });

  var sections = [
    { key: 'basic', label: '🟦 基本契約' },
    { key: 'individual', label: '🟩 個別契約' },
    { key: 'other', label: '⬛ その他' },
  ];

  sections.forEach(function (sec) {
    var rows = Array.isArray(catData[sec.key]) ? catData[sec.key] : [];
    if (rows.length === 0) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '*' + sec.label + '*  _なし_',
          },
        ],
      });
      return;
    }
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*' + sec.label + ' (' + rows.length + '件)*',
      },
    });
    // 各行: タイトル + 文書番号 + ステータス + Drive リンク
    // Slack の section は ~3000 文字制限があるので、20 件で打ち切り。
    var maxRows = 20;
    var displayRows = rows.slice(0, maxRows);
    var lines = displayRows.map(function (d) {
      var title = d.contract_title || d.template_type || '(無題)';
      var docNo = d.document_number ? ' `' + d.document_number + '`' : '';
      var status = d.contract_status
        ? d.contract_status === 'executed'
          ? ' ✓'
          : ' [' + d.contract_status + ']'
        : '';
      // Phase 17d: Backlog 状態 (例: "クラウドサイン待ち")
      var backlog = d.backlog_status
        ? '  🔖 ' + d.backlog_status
        : '';
      var linked = d.file_link
        ? ' <' + d.file_link + '|📄 開く>'
        : ' _(リンクなし)_';
      return '• ' + title + docNo + status + backlog + linked;
    });
    if (rows.length > maxRows) {
      lines.push('_…他 ' + (rows.length - maxRows) + ' 件_');
    }
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    });
  });
}

function masterStatusLabel_(master) {
  if (!master || !master.exists) return '— 未締結';
  var num = master.documentNumber ? ' (' + master.documentNumber + ')' : '';
  return '✅ 締結済' + num;
}

/**
 * Phase 22.2 で第 2 引数 `opts` を追加:
 *   opts.candidates  : worker から取得した申請者の未完了候補配列
 *   opts.slackUserId : 申請者の Slack ID (= block_actions の payload.user.id)
 *
 * delivery_inspec / license_calc / deadline_change のときは候補 static_select
 * を表示し、ユーザーが既存子課題を選択できるようにする (V2 select)。
 */
function getLegalRequestModal_(selectedType, opts) {
  selectedType = selectedType || 'legal_consult';
  opts = opts || {};
  var candidates = opts.candidates || [];

  // Three top-level intake categories. Each category groups one or more
  // concrete request types so the user picks "what kind of work do I
  // want" first ("法務相談 / 文書作成 / 支払書類作成") and then the
  // specific document inside that category. The leaf `value` is what
  // gets sent to Cloud Run as `request_type`, so server.ts processing
  // (template selection, Backlog issue type, DB writes) stays unchanged.
  const REQUEST_GROUPS = [
    {
      label: '法務相談',
      options: [{ value: 'legal_consult', text: '法務相談' }],
    },
    {
      label: '文書作成',
      options: [
        { value: 'nda', text: '秘密保持契約 (NDA)' },
        { value: 'outsourcing', text: '業務委託基本契約' },
        { value: 'license_master', text: 'ライセンス基本契約' },
        { value: 'lic_individual', text: '個別利用許諾条件' },
        { value: 'sales_master', text: '売買基本契約' },
        { value: 'purchase_order', text: '発注書' },
      ],
    },
    {
      label: '支払書類作成',
      options: [
        { value: 'delivery_inspec', text: '納品 / 検収書' },
        { value: 'license_calc', text: '利用許諾計算書' },
      ],
    },
    // Phase 21: 既存課題の納期を変更する依頼。新規 Backlog 課題は起票せず、
    // 直接 worker /api/management/issues/:key/deadline-change を叩いて
    // order_line_items.delivery_date を一括更新する。
    {
      label: 'その他',
      options: [{ value: 'deadline_change', text: '納期変更依頼' }],
    },
  ];

  // Lookup so we can build the `initial_option` for the select.
  let initialLabel = '法務相談';
  REQUEST_GROUPS.forEach(function (g) {
    g.options.forEach(function (o) {
      if (o.value === selectedType) initialLabel = o.text;
    });
  });

  const optionGroups = REQUEST_GROUPS.map(function (g) {
    return {
      label: { type: 'plain_text', text: g.label },
      options: g.options.map(function (o) {
        return {
          text: { type: 'plain_text', text: o.text },
          value: o.value,
        };
      }),
    };
  });

  const baseBlocks = [
    {
      type: 'input',
      block_id: 'dept_block',
      label: { type: 'plain_text', text: '依頼部署' },
      element: {
        type: 'plain_text_input',
        action_id: 'dept_input',
        placeholder: { type: 'plain_text', text: '〇〇事業部' },
      },
    },
    {
      type: 'input',
      block_id: 'request_type_block',
      label: { type: 'plain_text', text: '依頼種別' },
      dispatch_action: true,
      element: {
        type: 'static_select',
        action_id: 'request_type_input',
        initial_option: {
          text: { type: 'plain_text', text: initialLabel },
          value: selectedType,
        },
        placeholder: { type: 'plain_text', text: '種別を選択してください' },
        option_groups: optionGroups,
      },
    },
  ];

  // Phase 21: 納期変更依頼は別フォームで完結する (新規 Backlog 課題は起こさない)
  if (selectedType === 'deadline_change') {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    // Phase 22.2 V2: 候補 select を構築 (候補があれば)
    var deadlineCandidateBlocks = [];
    if (candidates && candidates.length > 0) {
      deadlineCandidateBlocks.push({
        type: 'input',
        block_id: 'target_issue_key_select_block',
        label: { type: 'plain_text', text: '対象 Backlog 課題 (候補から選択)' },
        optional: true,
        element: {
          type: 'static_select',
          action_id: 'target_issue_key_select_input',
          placeholder: { type: 'plain_text', text: '未完了の依頼から選択…' },
          options: candidates.slice(0, 25).map(function (c) {
            var label = '[' + c.issue_key + '] ' + (c.summary || '').slice(0, 60);
            if (c.counterparty) label += ' / ' + c.counterparty.slice(0, 20);
            return {
              text: { type: 'plain_text', text: label.slice(0, 75) },
              value: c.issue_key,
            };
          }),
        },
      });
    }

    return {
      type: 'modal',
      callback_id: 'legal_request_modal',
      title: { type: 'plain_text', text: '納期変更依頼' },
      submit: { type: 'plain_text', text: '送信' },
      blocks: baseBlocks.concat([
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text:
                '⚠️ *この依頼は新規 Backlog 課題を作成しません。* ' +
                '指定した Backlog 課題の **未完了業務明細すべて** の納期が ' +
                '一括で新日付に変更されます。明細ごとに違う日付にしたい場合は ' +
                '法務担当者へ admin-ui 経由での変更を依頼してください。',
            },
          ],
        },
      ]).concat(deadlineCandidateBlocks).concat([
        {
          type: 'input',
          block_id: 'target_issue_key_block',
          label: { type: 'plain_text', text: '対象 Backlog 課題キー (候補にない場合のみ入力)' },
          optional: candidates && candidates.length > 0,
          element: {
            type: 'plain_text_input',
            action_id: 'target_issue_key_input',
            placeholder: { type: 'plain_text', text: 'LEGAL-123' },
          },
        },
        {
          type: 'input',
          block_id: 'new_delivery_date_block',
          label: { type: 'plain_text', text: '新しい納期' },
          element: {
            type: 'datepicker',
            action_id: 'new_delivery_date_input',
            initial_date: tomorrow,
          },
        },
        {
          type: 'input',
          block_id: 'change_reason_block',
          label: { type: 'plain_text', text: '変更理由' },
          element: {
            type: 'plain_text_input',
            action_id: 'change_reason_input',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '例: 仕様変更により制作期間が必要なため',
            },
          },
        },
      ]),
    };
  }

  // 通常 (新規依頼) の form

  // Phase 22.2 V2: 検収書 / 利用許諾料計算書 のときは候補 select を表示
  // (発注書完了で自動作成された納品報告子課題等への紐付け用)
  var candidateBlocks = [];
  if (
    (selectedType === 'delivery_inspec' || selectedType === 'license_calc') &&
    candidates && candidates.length > 0
  ) {
    candidateBlocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            '💡 *候補が見つかりました*。下のセレクタで該当する子課題を選択すると' +
            '、新規 Backlog 課題は作成されず、既存の子課題に紐付けて起票されます。' +
            '該当課題が見つからない場合は「新規作成」を選択してください。',
        },
      ],
    });
    candidateBlocks.push({
      type: 'input',
      block_id: 'target_issue_key_select_block',
      label: { type: 'plain_text', text: '対象課題 (候補から選択)' },
      element: {
        type: 'static_select',
        action_id: 'target_issue_key_select_input',
        placeholder: { type: 'plain_text', text: '選択してください' },
        options: [
          {
            text: { type: 'plain_text', text: '🆕 新規作成 (該当課題なし)' },
            value: '__NEW__',
          },
        ].concat(
          candidates.slice(0, 24).map(function (c) {
            var label = '[' + c.issue_key + '] ' + (c.summary || '').slice(0, 60);
            if (c.counterparty) label += ' / ' + c.counterparty.slice(0, 20);
            return {
              text: { type: 'plain_text', text: label.slice(0, 75) },
              value: c.issue_key,
            };
          })
        ),
      },
    });
  }

  const blocks = baseBlocks.concat(candidateBlocks).concat([
    {
      type: 'input',
      block_id: 'summary_block',
      label: { type: 'plain_text', text: '件名' },
      element: {
        type: 'plain_text_input',
        action_id: 'summary_input',
        placeholder: { type: 'plain_text', text: '例: 秘密保持契約の審査依頼' },
      },
    },
    {
      type: 'input',
      block_id: 'deadline_block',
      label: { type: 'plain_text', text: '希望納期（文書作成等）' },
      element: {
        type: 'datepicker',
        action_id: 'deadline_input',
        initial_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*取引先情報 (Counterparty Info)*' },
    },
    {
      type: 'input',
      block_id: 'counterparty_block',
      label: { type: 'plain_text', text: '相手方名称' },
      element: {
        type: 'plain_text_input',
        action_id: 'counterparty_input',
        placeholder: { type: 'plain_text', text: '株式会社〇〇' },
      },
    },
    {
      type: 'input',
      block_id: 'entity_type_block',
      label: { type: 'plain_text', text: '区分' },
      element: {
        type: 'radio_buttons',
        action_id: 'entity_type_input',
        initial_option: { text: { type: 'plain_text', text: '法人' }, value: 'corporate' },
        options: [
          { text: { type: 'plain_text', text: '法人' }, value: 'corporate' },
          { text: { type: 'plain_text', text: '個人' }, value: 'individual' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'entity_id_block',
      label: { type: 'plain_text', text: '法人番号 / 社内個人コード' },
      element: {
        type: 'plain_text_input',
        action_id: 'entity_id_input',
        placeholder: { type: 'plain_text', text: '13桁の番号、または社内コード' },
      },
    },
    { type: 'divider' },
    {
      type: 'input',
      block_id: 'details_block',
      label: { type: 'plain_text', text: '相談・依頼詳細' },
      element: {
        type: 'plain_text_input',
        action_id: 'details_input',
        multiline: true,
      },
    },
  ]);

  if (selectedType === 'delivery_inspec') {
    blocks.push(
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*検収書作成用データ*' },
      },
      {
        type: 'input',
        block_id: 'delivery_no_block',
        label: { type: 'plain_text', text: '納品回数 (第 n 回納品)' },
        element: {
          type: 'plain_text_input',
          action_id: 'delivery_no_input',
          placeholder: { type: 'plain_text', text: '1' },
          initial_value: '1',
        },
      },
      {
        type: 'input',
        block_id: 'order_amount_block',
        label: { type: 'plain_text', text: '金額（税抜）' },
        element: {
          type: 'plain_text_input',
          action_id: 'order_amount_input',
          placeholder: { type: 'plain_text', text: '100000' },
        },
      },
      {
        type: 'input',
        block_id: 'delivery_date_block',
        label: { type: 'plain_text', text: '納品日 (YYYY-MM-DD)' },
        element: {
          type: 'datepicker',
          action_id: 'delivery_date_input',
          initial_date: new Date().toISOString().split('T')[0],
        },
      },
      {
        type: 'input',
        block_id: 'inspection_deadline_block',
        label: { type: 'plain_text', text: '検収期限 (YYYY-MM-DD)' },
        element: {
          type: 'datepicker',
          action_id: 'inspection_deadline_input',
          initial_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        },
      }
    );
  }

  return {
    type: 'modal',
    callback_id: 'legal_request_modal',
    title: { type: 'plain_text', text: '法務相談・契約審査' },
    blocks: blocks,
    submit: { type: 'plain_text', text: '送信' },
  };
}

// -----------------------------------------------------------------------
//  (Optional) Slack request signature verification
//
//  Slack signs every payload with HMAC-SHA256 over `v0:<timestamp>:<body>`
//  using the signing secret. doPost() in GAS does not expose raw bytes
//  cleanly, so this is left disabled for now. Once SLACK_SIGNING_SECRET
//  is set in script properties and the GAS deploy URL is locked down to
//  Slack only, callers can opt back in via the call site in doPost().
// -----------------------------------------------------------------------

function verifySlackSignature(_e) {
  const secret = scriptProperty_('SLACK_SIGNING_SECRET');
  if (!secret) return true; // disabled
  // Implementation deferred — see doPost comment.
  return true;
}

// -----------------------------------------------------------------------
//  Warm-up trigger
//
//  Slack enforces a hard 3-second deadline on every slash-command and
//  interactivity request. A cold Apps Script V8 runtime can take 2–5
//  seconds to spin up, which is enough to blow that budget and cause
//  Slack to surface "アプリが応答しなかったため、…は失敗しました".
//
//  To keep the runtime hot, install a time-driven trigger that calls
//  `keepWarm` every minute (Apps Script Editor → Triggers → Add trigger
//  → Function: keepWarm, Event source: Time-driven, Type: Minutes timer,
//  Interval: Every minute). The body is a no-op — just touching the
//  runtime keeps the V8 instance resident.
//
//  Apps Script's per-day execution quota is generous (~6 hours of CPU
//  for consumer accounts, ~6 hours/day for Workspace), so a 1-minute
//  no-op trigger is well within limits.
// -----------------------------------------------------------------------

function keepWarm() {
  // Intentionally minimal: returning a small string is enough to exercise
  // the V8 runtime and reset Apps Script's idle timer.
  return 'ok';
}

