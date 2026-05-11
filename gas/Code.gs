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

      // One-stop search: fan out to both data sources IN PARALLEL via
      // UrlFetchApp.fetchAll so the total wait is max(backlog, contract)
      // rather than the sum. This keeps us inside Slack's 3-second
      // view_submission budget even when Contract-Status is mid-warm.
      //
      //   1. Backlog issues
      //   2. Contract status (separate GAS Web App)
      //
      // Either side may return { __error } — we render them
      // independently inside the results modal so a partial failure
      // doesn't hide the other section.
      const parallelResults = querySearchInParallel_(keyword);
      const backlogData = parallelResults.backlog;
      const contractData = parallelResults.contract;
      return jsonResponse_({
        response_action: 'update',
        view: getSearchResultsModal_(keyword, {
          backlog: backlogData,
          contract: contractData,
        }),
      });
    }
  }

  return jsonResponse_({ ok: true });
}

// -----------------------------------------------------------------------
//  Cloud Run integration
// -----------------------------------------------------------------------

function forwardLegalRequest_(submission) {
  const baseUrl = scriptProperty_('CLOUD_RUN_BASE_URL');
  if (!baseUrl) {
    console.error('CLOUD_RUN_BASE_URL is not configured.');
    notifyUserOfError_(submission.slack_user_id, 'サーバ未設定のため処理できませんでした。');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(`${baseUrl}/api/internal/slack/legal-request`, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify(submission),
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) {
      console.log('Forwarded legal request OK:', res.getContentText());
    } else {
      console.error('Cloud Run rejected legal request:', code, res.getContentText());
      notifyUserOfError_(
        submission.slack_user_id,
        `処理に失敗しました（HTTP ${code}）。法務担当者へ直接お問い合わせください。`
      );
    }
  } catch (err) {
    console.error('Failed to forward legal request:', err);
    notifyUserOfError_(submission.slack_user_id, 'サーバ接続エラーが発生しました。');
  }
}

function runSearchAndReply_(keyword, userId) {
  // Kept as a DM-based fallback. The active code path is now the
  // in-modal results view rendered by getSearchResultsModal_, but this
  // remains useful if we ever surface search outside of a modal flow.
  const baseUrl = scriptProperty_('CLOUD_RUN_BASE_URL');
  if (!baseUrl) {
    notifyUserOfError_(userId, 'サーバ未設定のため検索できませんでした。');
    return;
  }
  try {
    const res = UrlFetchApp.fetch(
      `${baseUrl}/api/search/issues?query=${encodeURIComponent(keyword)}`,
      { method: 'get', muteHttpExceptions: true }
    );
    if (res.getResponseCode() >= 300) {
      notifyUserOfError_(userId, `検索 API エラー（HTTP ${res.getResponseCode()}）`);
      return;
    }
    const data = JSON.parse(res.getContentText());
    const blocks = buildSearchResultBlocks_(keyword, data);
    slackPost_('chat.postMessage', {
      channel: userId,
      text: `🔍 検索結果: ${keyword}`,
      blocks: blocks,
    });
  } catch (err) {
    console.error('Search failed:', err);
    notifyUserOfError_(userId, '検索中にエラーが発生しました。');
  }
}

/**
 * Synchronously searches Backlog for issues matching the keyword.
 * Calls Backlog's REST API directly via UrlFetchApp — no Cloud Run
 * hop — so the entire /法務検索 flow lives inside GAS.
 *
 * Required script properties:
 *   BACKLOG_HOST         arclight.backlog.com
 *   BACKLOG_API_KEY      …
 *   BACKLOG_PROJECT_KEY  LEGAL
 *
 * Returns:
 *   { backlogIssues: [...] }
 *   { __error: 'description' } on failure (never throws so the
 *   caller can render the message inline in the results modal).
 */

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

function querySearchSync_(keyword) {
  const host = scriptProperty_('BACKLOG_HOST');
  const apiKey = scriptProperty_('BACKLOG_API_KEY');
  const projectKey = scriptProperty_('BACKLOG_PROJECT_KEY');

  if (!host || !apiKey || !projectKey) {
    return {
      __error:
        'Backlog 認証情報が GAS のスクリプトプロパティに揃っていません。' +
        ' (BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY)',
    };
  }

  try {
    // 1. Resolve project ID from project key (cached in CacheService
    //    so we skip the round-trip after the first call).
    const cache = CacheService.getScriptCache();
    const cacheKey = 'backlog_pid_' + projectKey;
    var projectId = cache.get(cacheKey);
    if (!projectId) {
      const projectRes = UrlFetchApp.fetch(
        'https://' + host + '/api/v2/projects/' + encodeURIComponent(projectKey) +
          '?apiKey=' + encodeURIComponent(apiKey),
        { method: 'get', muteHttpExceptions: true }
      );
      if (projectRes.getResponseCode() >= 300) {
        return {
          __error:
            'Backlog プロジェクト解決に失敗 (HTTP ' +
            projectRes.getResponseCode() + ')',
        };
      }
      projectId = String(JSON.parse(projectRes.getContentText()).id);
      cache.put(cacheKey, projectId, 3600); // 1h
    }

    // 2. Issue search. Backlog supports `keyword` for free-text match
    //    against summary + description + comments.
    const params = [
      'apiKey=' + encodeURIComponent(apiKey),
      'projectId[]=' + projectId,
      'keyword=' + encodeURIComponent(keyword),
      'count=20',
      'sort=updated',
      'order=desc',
    ].join('&');

    const issuesRes = UrlFetchApp.fetch(
      'https://' + host + '/api/v2/issues?' + params,
      { method: 'get', muteHttpExceptions: true }
    );
    if (issuesRes.getResponseCode() >= 300) {
      return {
        __error:
          'Backlog 課題検索に失敗 (HTTP ' + issuesRes.getResponseCode() + ')',
      };
    }

    const raw = JSON.parse(issuesRes.getContentText());
    // Flatten the parts of each issue we render in the modal.
    const backlogIssues = (Array.isArray(raw) ? raw : []).map(function (i) {
      return {
        issueKey: i.issueKey,
        summary: i.summary,
        status: i.status && i.status.name,
        issueType: i.issueType && i.issueType.name,
        assigneeName: i.assignee && i.assignee.name,
        updated: i.updated,
        url: 'https://' + host + '/view/' + i.issueKey,
      };
    });
    return { backlogIssues: backlogIssues };
  } catch (err) {
    console.error('querySearchSync_ failed:', err);
    return { __error: 'Backlog API 呼び出し中にエラー: ' + String(err) };
  }
}

/**
 * Synchronously calls the Contract-Status GAS Web App's JSON endpoint.
 *
 * That Web App is a separate Apps Script project (originally a
 * browser-only HTML/`google.script.run` UI). To make its DB lookup
 * reachable from this Slack hub it needs a small `doGet` shim:
 *
 *   function doGet(e) {
 *     if (e.parameter.api === 'searchContractStatus') {
 *       const payload = {
 *         counterpartyName: e.parameter.counterpartyName || '',
 *         purposeCode:     e.parameter.purposeCode     || '',
 *         workName:        e.parameter.workName        || '',
 *         productName:     e.parameter.productName     || '',
 *         territory:       e.parameter.territory       || '',
 *         language:        e.parameter.language        || '',
 *       };
 *       const result = searchContractStatus(payload);
 *       return ContentService
 *         .createTextOutput(JSON.stringify(result))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *     return HtmlService.createTemplateFromFile('index').evaluate();
 *   }
 *
 * Required script property in this Slack hub:
 *   CONTRACT_STATUS_WEBAPP_URL
 *
 * Returns the parsed JSON payload, or { __error: '…' } on failure.
 */
function queryContractStatusSync_(counterpartyName) {
  var baseUrl = scriptProperty_('CONTRACT_STATUS_WEBAPP_URL');
  if (!baseUrl) {
    return {
      __error:
        'CONTRACT_STATUS_WEBAPP_URL がスクリプトプロパティに設定されていません。',
    };
  }
  try {
    var url =
      baseUrl +
      (baseUrl.indexOf('?') >= 0 ? '&' : '?') +
      'api=searchContractStatus' +
      '&counterpartyName=' + encodeURIComponent(counterpartyName);
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var code = res.getResponseCode();
    if (code >= 300) {
      return {
        __error:
          '契約状況 API がエラーを返しました (HTTP ' + code + ').' +
          ' Web App の公開設定 / URL を確認してください。',
      };
    }
    var body = res.getContentText();
    try {
      return JSON.parse(body);
    } catch (_parseErr) {
      // The Web App returned HTML (likely because the doGet wasn't
      // updated to handle ?api=searchContractStatus).
      return {
        __error:
          '契約状況 API が JSON を返しませんでした。Contract-Status GAS の doGet を更新してください。',
      };
    }
  } catch (err) {
    console.error('queryContractStatusSync_ failed:', err);
    return { __error: '契約状況 API への接続に失敗: ' + String(err) };
  }
}

/**
 * Runs Backlog search and Contract-Status lookup IN PARALLEL via
 * UrlFetchApp.fetchAll. Used by the `/法務検索` view_submission handler
 * to stay inside Slack's 3-second budget.
 *
 * Returns: { backlog: <backlogData|{__error}>, contract: <contractData|{__error}> }
 */
function querySearchInParallel_(keyword) {
  // --- 1. Resolve Backlog config + project ID (cached) ---
  var host = scriptProperty_('BACKLOG_HOST');
  var apiKey = scriptProperty_('BACKLOG_API_KEY');
  var projectKey = scriptProperty_('BACKLOG_PROJECT_KEY');
  var contractUrl = scriptProperty_('CONTRACT_STATUS_WEBAPP_URL');

  var backlogConfigError = null;
  var backlogIssuesUrl = null;
  if (!host || !apiKey || !projectKey) {
    backlogConfigError = {
      __error:
        'Backlog 認証情報が GAS のスクリプトプロパティに揃っていません。' +
        ' (BACKLOG_HOST / BACKLOG_API_KEY / BACKLOG_PROJECT_KEY)',
    };
  } else {
    try {
      var cache = CacheService.getScriptCache();
      var cacheKey = 'backlog_pid_' + projectKey;
      var projectId = cache.get(cacheKey);
      if (!projectId) {
        // One-time synchronous round trip on first call; cached for 1h
        // so steady-state cost is zero.
        var projectRes = UrlFetchApp.fetch(
          'https://' + host + '/api/v2/projects/' + encodeURIComponent(projectKey) +
            '?apiKey=' + encodeURIComponent(apiKey),
          { method: 'get', muteHttpExceptions: true }
        );
        if (projectRes.getResponseCode() >= 300) {
          backlogConfigError = {
            __error:
              'Backlog プロジェクト解決に失敗 (HTTP ' +
              projectRes.getResponseCode() + ')',
          };
        } else {
          projectId = String(JSON.parse(projectRes.getContentText()).id);
          cache.put(cacheKey, projectId, 3600);
        }
      }
      if (projectId) {
        var params = [
          'apiKey=' + encodeURIComponent(apiKey),
          'projectId[]=' + projectId,
          'keyword=' + encodeURIComponent(keyword),
          'count=20',
          'sort=updated',
          'order=desc',
        ].join('&');
        backlogIssuesUrl = 'https://' + host + '/api/v2/issues?' + params;
      }
    } catch (err) {
      console.error('Backlog setup failed:', err);
      backlogConfigError = { __error: 'Backlog 設定エラー: ' + String(err) };
    }
  }

  // --- 2. Build Contract-Status request URL ---
  var contractConfigError = null;
  var contractFetchUrl = null;
  if (!contractUrl) {
    contractConfigError = {
      __error:
        'CONTRACT_STATUS_WEBAPP_URL がスクリプトプロパティに設定されていません。',
    };
  } else {
    contractFetchUrl =
      contractUrl +
      (contractUrl.indexOf('?') >= 0 ? '&' : '?') +
      'api=searchContractStatus' +
      '&counterpartyName=' + encodeURIComponent(keyword);
  }

  // --- 3. Run reachable calls in parallel ---
  var requests = [];
  var tags = []; // parallel array: tags[i] is which call produced responses[i]
  if (backlogIssuesUrl) {
    requests.push({ url: backlogIssuesUrl, method: 'get', muteHttpExceptions: true });
    tags.push('backlog');
  }
  if (contractFetchUrl) {
    requests.push({
      url: contractFetchUrl,
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
    });
    tags.push('contract');
  }

  var responses = [];
  if (requests.length > 0) {
    try {
      responses = UrlFetchApp.fetchAll(requests);
    } catch (err) {
      console.error('fetchAll failed:', err);
      // Both calls effectively failed.
      return {
        backlog: backlogConfigError || { __error: 'API 並列呼び出しエラー: ' + String(err) },
        contract: contractConfigError || { __error: 'API 並列呼び出しエラー: ' + String(err) },
      };
    }
  }

  // --- 4. Parse responses ---
  var backlogData = backlogConfigError;
  var contractData = contractConfigError;

  for (var i = 0; i < responses.length; i++) {
    var res = responses[i];
    var code = res.getResponseCode();
    if (tags[i] === 'backlog') {
      if (code >= 300) {
        backlogData = { __error: 'Backlog 課題検索に失敗 (HTTP ' + code + ')' };
        continue;
      }
      try {
        var raw = JSON.parse(res.getContentText());
        var backlogIssues = (Array.isArray(raw) ? raw : []).map(function (issue) {
          return {
            issueKey: issue.issueKey,
            summary: issue.summary,
            status: issue.status && issue.status.name,
            issueType: issue.issueType && issue.issueType.name,
            assigneeName: issue.assignee && issue.assignee.name,
            updated: issue.updated,
            url: 'https://' + host + '/view/' + issue.issueKey,
          };
        });
        backlogData = { backlogIssues: backlogIssues };
      } catch (parseErr) {
        backlogData = { __error: 'Backlog レスポンスのパースに失敗: ' + String(parseErr) };
      }
    } else if (tags[i] === 'contract') {
      if (code >= 300) {
        var hint = code === 302
          ? ' Contract-Status GAS の「アクセスできるユーザー」を「全員」にし、URL末尾が /exec か確認してください。'
          : ' Web App の公開設定 / URL を確認してください。';
        contractData = {
          __error: '契約状況 API がエラーを返しました (HTTP ' + code + ').' + hint,
        };
        continue;
      }
      try {
        contractData = JSON.parse(res.getContentText());
      } catch (parseErr) {
        contractData = {
          __error:
            '契約状況 API が JSON を返しませんでした。Contract-Status GAS の doGet を更新してください。',
        };
      }
    }
  }

  return { backlog: backlogData, contract: contractData };
}

function buildSearchResultBlocks_(keyword, data) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🔎 検索結果: ${keyword}`, emoji: true },
    },
  ];

  const lr = (data && data.legalRequests) || [];
  const vendors = (data && data.vendors) || [];

  if (lr.length === 0 && vendors.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '該当するデータは見つかりませんでした。別のキーワードでお試しください。',
      },
    });
    return blocks;
  }

  if (lr.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*📁 関連課題 (検収・許諾・その他依頼)*' },
    });
    lr.forEach((r) => {
      const emoji = r.summary && r.summary.indexOf('検収') >= 0
        ? '✅'
        : r.summary && r.summary.indexOf('許諾') >= 0
        ? '💰'
        : '📝';
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} *${r.backlog_issue_key}*: ${r.summary}\n>相手方: ${r.counterparty || '未設定'}`,
        },
      });
    });
  }

  if (vendors.length > 0) {
    if (lr.length > 0) blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*🏢 取引先・パートナーマスター*' },
    });
    vendors.forEach((v) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• \`${v.vendor_code}\` *${v.vendor_name}*\n  _${v.trade_name || ''}_`,
        },
      });
    });
  }

  return blocks;
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
 * handleInteractivity_ and forwarded to runSearchAndReply_.
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
 * submits. Lists matching Backlog issues (queried directly from GAS,
 * no Cloud Run hop) and offers a "もう一度検索" button that swaps the
 * view back to the search input.
 *
 * @param {string} keyword The keyword the user submitted.
 * @param {object} data { backlog: <queryResult>, contract: <queryResult> }
 *   Each side carries either its data shape or { __error: '…' }.
 */
function getSearchResultsModal_(keyword, data) {
  data = data || {};
  var backlogPayload = data.backlog || {};
  var contractPayload = data.contract || {};

  var blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*🔎 検索結果: `' + keyword + '`*' },
    },
    { type: 'divider' },
  ];

  // ── Section 1: Backlog 課題 ────────────────────────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📋 Backlog 課題*' },
  });
  appendBacklogIssuesBlocks_(blocks, backlogPayload);

  blocks.push({ type: 'divider' });

  // ── Section 2: 契約状況 (Contract-Status GAS) ─────────────────
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*📑 契約状況*' },
  });
  appendContractStatusBlocks_(blocks, contractPayload);

  // ── Footer actions ────────────────────────────────────────────
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        action_id: 'legal_search_again',
        text: { type: 'plain_text', text: '🔁 もう一度検索する' },
        style: 'primary',
      },
    ],
  });

  return {
    type: 'modal',
    callback_id: 'legal_search_results',
    title: { type: 'plain_text', text: '法務検索: 結果' },
    close: { type: 'plain_text', text: '閉じる' },
    blocks: blocks,
  };
}

/** Appends Backlog issue rows (or an empty/error notice) to blocks. */
function appendBacklogIssuesBlocks_(blocks, payload) {
  if (payload && payload.__error) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '⚠️ ' + payload.__error },
    });
    return;
  }
  var issues = (payload && payload.backlogIssues) || [];
  if (issues.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '該当する Backlog 課題は見つかりませんでした。' },
    });
    return;
  }
  var DISPLAY_LIMIT = 10;
  issues.slice(0, DISPLAY_LIMIT).forEach(function (i) {
    var typeBadge = i.issueType ? '`' + i.issueType + '` ' : '';
    var statusBadge = i.status ? ' · ' + i.status : '';
    var assignee = i.assigneeName ? '\n>担当: ' + i.assigneeName : '';
    var updated = i.updated
      ? '\n>更新: ' + (i.updated.substring ? i.updated.substring(0, 10) : i.updated)
      : '';
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          typeBadge +
          '<' + i.url + '|*' + (i.issueKey || '—') + '*> ' +
          (i.summary || '') + statusBadge + assignee + updated,
      },
    });
  });
  if (issues.length > DISPLAY_LIMIT) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '他 ' + (issues.length - DISPLAY_LIMIT) + ' 件の Backlog 課題があります。',
        },
      ],
    });
  }
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
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• *' + name + '* (`' + code + '`)\n>' + pills.join(' · '),
        },
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

