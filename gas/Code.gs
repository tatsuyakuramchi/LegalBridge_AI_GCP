/**
 * LegalBridge — Slack ⇄ Cloud Run Gateway (Google Apps Script)
 *
 * Responsibilities
 *  - Receives Slack slash-command requests (`/法務依頼`, `/法務検索`) and
 *    interactivity payloads (view_submission, block_actions).
 *  - Acks back to Slack within 3 seconds (Slack's hard timeout).
 *  - Calls the LegalBridge Cloud Run service via UrlFetchApp for the
 *    heavy lifting (Backlog issue creation, DB writes, document
 *    generation, search across legal_requests / vendors).
 *
 * Environment (script properties — see gas/README.md for setup):
 *  - SLACK_BOT_TOKEN          xoxb-…   (chat:write, commands, views, etc.)
 *  - CLOUD_RUN_BASE_URL       https://legalbridge-…run.app
 *  - SLACK_SIGNING_SECRET     (optional, currently unused — see verifySlackSignature)
 */

const SLACK_API = 'https://slack.com/api';

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
      slackPost_('views.update', {
        view_id: payload.view.id,
        hash: payload.view.hash,
        view: getLegalRequestModal_(selected),
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

      // 1. Send an immediate acknowledgement DM so the submitter has
      //    visible feedback the moment the modal closes, even if a
      //    GAS cold start makes Slack show "didn't respond".
      sendIntakeAckDm_(submission);

      // 2. Create the Backlog issue directly from GAS. The Backlog
      //    type=1 webhook will hand off to Cloud Run which writes to
      //    the DB, renders the document, uploads to Drive, and posts
      //    the ✅ 完了 DM with the link.
      const created = createBacklogIssue_(submission);
      if (created && created.__error) {
        notifyUserOfError_(submission.slack_user_id, created.__error);
      } else if (created && created.issueKey) {
        slackPost_('chat.postMessage', {
          channel: submission.slack_user_id,
          text:
            '✅ Backlog 課題を作成しました: *' + created.issueKey + '*\n' +
            '文書生成が完了次第、別 DM でリンクをお送りします。',
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
  var cloudRunUrl = scriptProperty_('CLOUD_RUN_BASE_URL');
  var portalSecret = scriptProperty_('LB_PORTAL_SECRET');

  if (!cloudRunUrl) {
    return {
      __error: 'CLOUD_RUN_BASE_URL がスクリプトプロパティに設定されていません。',
    };
  }
  var trimmedBase = String(cloudRunUrl).replace(/\/+$/, '');

  var headers = {};
  if (portalSecret) {
    headers['X-LB-PORTAL-SECRET'] = portalSecret;
  }

  try {
    var res = UrlFetchApp.fetch(trimmedBase + '/api/contract-check/search', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: headers,
      payload: JSON.stringify({ counterpartyName: keyword }),
    });
    var code = res.getResponseCode();
    if (code >= 300) {
      return {
        __error:
          'Cloud Run /api/contract-check/search がエラーを返しました (HTTP ' + code + ').' +
          ' CLOUD_RUN_BASE_URL と LB_PORTAL_SECRET を確認してください。',
      };
    }
    try {
      return JSON.parse(res.getContentText());
    } catch (parseErr) {
      return {
        __error: 'Cloud Run /api/contract-check/search が JSON を返しませんでした。',
      };
    }
  } catch (err) {
    console.error('queryContractStatusOnly_ failed:', err);
    return { __error: '契約状況 API 呼び出し中にエラー: ' + String(err) };
  }
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

  // Phase 12: search-api の Web 詳細ページへの URL を組み立て
  // (CLOUD_RUN_BASE_URL + ?q=<keyword>&token=<LB_PORTAL_SECRET>)。
  var cloudRunBase = (scriptProperty_('CLOUD_RUN_BASE_URL') || '').replace(/\/+$/, '');
  var portalSecret = scriptProperty_('LB_PORTAL_SECRET') || '';
  var webDetailUrl = cloudRunBase
    ? cloudRunBase + '/search/vendor?q=' + encodeURIComponent(keyword) +
      (portalSecret ? '&token=' + encodeURIComponent(portalSecret) : '')
    : '';

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
      var linked = d.file_link
        ? ' <' + d.file_link + '|📄 開く>'
        : ' _(リンクなし)_';
      return '• ' + title + docNo + status + linked;
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

function getLegalRequestModal_(selectedType) {
  selectedType = selectedType || 'legal_consult';

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

  const blocks = [
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
  ];

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

