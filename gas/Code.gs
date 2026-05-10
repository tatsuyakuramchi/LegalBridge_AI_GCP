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
    const keyword = (params.text || '').trim();
    if (!keyword) {
      return jsonResponse_({
        response_type: 'ephemeral',
        text: 'キーワードを指定してください。例: `/法務検索 NDA`',
      });
    }
    // Run search asynchronously and DM the result back to the user.
    runSearchAndReply_(keyword, userId);
    return jsonResponse_({
      response_type: 'ephemeral',
      text: `🔎 *${keyword}* を検索しています… 結果は DM にお送りします。`,
    });
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
    return jsonResponse_({ ok: true });
  }

  // 2. Modal submissions
  if (payload.type === 'view_submission') {
    const callbackId = payload.view && payload.view.callback_id;

    if (callbackId === 'legal_request_modal') {
      const submission = parseLegalRequestSubmission_(payload);
      // Forward to Cloud Run asynchronously. We MUST ack within 3 seconds
      // so we kick the call off and return an empty 200 immediately.
      forwardLegalRequest_(submission);
      return jsonResponse_({ response_action: 'clear' });
    }

    if (callbackId === 'legal_search_modal') {
      const keyword =
        (payload.view.state.values.keyword_block &&
          payload.view.state.values.keyword_block.keyword_input.value) ||
        '';
      runSearchAndReply_(keyword, payload.user.id);
      return jsonResponse_({ response_action: 'clear' });
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

function getLegalRequestModal_(selectedType) {
  selectedType = selectedType || 'legal_consult';

  const typeLabels = {
    legal_consult: '法務相談 (legal_consult)',
    nda: '秘密保持契約 (nda)',
    outsourcing: '業務委託基本契約 (outsourcing)',
    license_master: 'ライセンス基本契約 (license_master)',
    lic_individual: '個別利用許諾条件 (lic_individual)',
    purchase_order: '発注書 (purchase_order)',
    delivery_inspec: '納品 / 検収書 (delivery_inspec)',
    license_calc: '利用許諾計算リクエスト (license_calc)',
    sales_master: '売買基本契約 (sales_master)',
  };

  const requestTypeOptions = Object.keys(typeLabels).map(function (key) {
    return { text: { type: 'plain_text', text: typeLabels[key] }, value: key };
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
      label: { type: 'plain_text', text: '依頼種別 (Request Type)' },
      dispatch_action: true,
      element: {
        type: 'static_select',
        action_id: 'request_type_input',
        initial_option: {
          text: {
            type: 'plain_text',
            text: typeLabels[selectedType] || typeLabels.legal_consult,
          },
          value: selectedType,
        },
        placeholder: { type: 'plain_text', text: '種別を選択してください' },
        options: requestTypeOptions,
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

