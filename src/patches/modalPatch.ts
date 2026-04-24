/**
 * server.ts — getLegalRequestModal & createIssue 差し替えパッチ
 *
 * 既存の getLegalRequestModal() と backlogService.createIssue() 呼び出し部分を
 * 以下のコードに置き換える。
 *
 * 追加import（server.tsの先頭に追加）:
 *   import { MODAL_FIELDS, resolveFieldId } from "./src/config/modalFields.ts";
 */

import { MODAL_FIELDS, resolveFieldId, type ModalField } from "./src/config/modalFields.js";

// ─────────────────────────────────────────────────────────
// 課題種別の選択肢
// ─────────────────────────────────────────────────────────
const ISSUE_TYPE_OPTIONS = [
  { text: "法務相談",                   value: "legal_consultation" },
  { text: "NDA（秘密保持契約）",        value: "nda" },
  { text: "ライセンス基本契約",          value: "license_master" },
  { text: "個別利用許諾条件",            value: "individual_license_terms" },
  { text: "製造イベント / ロイヤリティ計算", value: "manufacturing" },
  { text: "業務委託基本契約",            value: "outsourcing" },
  { text: "発注書 / 企画発注書",         value: "purchase_order" },
  { text: "納品 / 検収書",              value: "delivery_inspection" },
  { text: "支払通知 / 報酬明細書",       value: "payment" },
  { text: "売買基本契約",               value: "sales_master" },
];

// ─────────────────────────────────────────────────────────
// フィールド定義 → Slack Block に変換
// ─────────────────────────────────────────────────────────
function fieldToBlock(f: ModalField): object {
  const base = {
    type: "input",
    block_id: f.blockId,
    optional: f.optional ?? false,
    label: { type: "plain_text", text: f.label },
  } as any;

  if (f.type === "text") {
    base.element = {
      type: "plain_text_input",
      action_id: f.actionId,
      ...(f.placeholder ? { placeholder: { type: "plain_text", text: f.placeholder } } : {}),
    };
  } else if (f.type === "textarea") {
    base.element = {
      type: "plain_text_input",
      action_id: f.actionId,
      multiline: true,
      ...(f.placeholder ? { placeholder: { type: "plain_text", text: f.placeholder } } : {}),
    };
  } else if (f.type === "date") {
    base.element = {
      type: "datepicker",
      action_id: f.actionId,
      placeholder: { type: "plain_text", text: "日付を選択" },
    };
  } else if (f.type === "select") {
    base.element = {
      type: "static_select",
      action_id: f.actionId,
      placeholder: { type: "plain_text", text: "選択してください" },
      options: (f.options || []).map(o => ({
        text: { type: "plain_text", text: o.text },
        value: o.value,
      })),
    };
  }

  return base;
}

// ─────────────────────────────────────────────────────────
// getLegalRequestModal — 刷新版
// ─────────────────────────────────────────────────────────
export function getLegalRequestModal(selectedType: string = "legal_consultation"): object {
  const fields = MODAL_FIELDS[selectedType] ?? MODAL_FIELDS["legal_consultation"];

  // 課題種別セレクター（常に先頭）
  const typeBlock = {
    type: "input",
    block_id: "request_type_block",
    label: { type: "plain_text", text: "依頼種別" },
    element: {
      type: "static_select",
      action_id: "request_type_input",
      initial_option: {
        text: {
          type: "plain_text",
          text: ISSUE_TYPE_OPTIONS.find(o => o.value === selectedType)?.text ?? selectedType,
        },
        value: selectedType,
      },
      options: ISSUE_TYPE_OPTIONS.map(o => ({
        text: { type: "plain_text", text: o.text },
        value: o.value,
      })),
    },
  };

  return {
    type: "modal",
    callback_id: "legal_request_modal",
    title: { type: "plain_text", text: "法務 / 契約依頼" },
    submit: { type: "plain_text", text: "送信" },
    close:  { type: "plain_text", text: "キャンセル" },
    blocks: [typeBlock, ...fields.map(fieldToBlock)],
  };
}

// ─────────────────────────────────────────────────────────
// モーダル送信値 → Backlog課題作成パラメータ に変換
// ─────────────────────────────────────────────────────────
export function buildBacklogIssueParams(
  requestType: string,
  values: Record<string, any>, // view.state.values
  slackUserId: string,
): {
  summary: string;
  description: string;
  issueTypeId: number;
  priorityId: number;
  parentIssueId?: number;
  customFields: { fieldId: string; value: string }[];
} {
  const fields = MODAL_FIELDS[requestType] ?? [];

  const getVal = (blockId: string, actionId: string): string =>
    values[blockId]?.[actionId]?.value ??
    values[blockId]?.[actionId]?.selected_date ??
    values[blockId]?.[actionId]?.selected_option?.value ??
    "";

  // 標準フィールドの収集
  let summary = "";
  let descriptionParts: string[] = [`依頼者Slack: <@${slackUserId}>`];
  let parentIssueKey = "";

  const customFields: { fieldId: string; value: string }[] = [];

  for (const f of fields) {
    const val = getVal(f.blockId, f.actionId);
    if (!val) continue;

    if (f.backlogNativeField === "summary") {
      summary = val;
    } else if (f.backlogNativeField === "description") {
      descriptionParts.push(`${f.label}: ${val}`);
    } else if (f.backlogNativeField === "parentIssueId") {
      parentIssueKey = val;
    } else if (f.backlogFieldEnvKey) {
      const fieldId = resolveFieldId(f.backlogFieldEnvKey);
      if (fieldId) customFields.push({ fieldId, value: val });
      // カスタム属性もdescriptionに補足として入れる
      descriptionParts.push(`${f.label}: ${val}`);
    }
  }

  // 課題種別ID（env から解決）
  const typeEnvMap: Record<string, string> = {
    legal_consultation:       "BACKLOG_ISSUE_TYPE_LEGAL_CONSULTATION",
    nda:                      "BACKLOG_ISSUE_TYPE_NDA",
    license_master:           "BACKLOG_ISSUE_TYPE_LICENSE_MASTER",
    individual_license_terms: "BACKLOG_ISSUE_TYPE_INDIVIDUAL_LICENSE",
    manufacturing:            "BACKLOG_ISSUE_TYPE_MANUFACTURING",
    outsourcing:              "BACKLOG_ISSUE_TYPE_OUTSOURCING",
    purchase_order:           "BACKLOG_ISSUE_TYPE_PURCHASE_ORDER",
    delivery_inspection:      "BACKLOG_ISSUE_TYPE_DELIVERY",
    payment:                  "BACKLOG_ISSUE_TYPE_PAYMENT",
    sales_master:             "BACKLOG_ISSUE_TYPE_SALES_MASTER",
  };

  const issueTypeId = parseInt(process.env[typeEnvMap[requestType] ?? ""] ?? "1", 10);

  return {
    summary:    summary || `【${requestType}】新規依頼`,
    description: descriptionParts.join("\n"),
    issueTypeId,
    priorityId: 3, // 中
    ...(parentIssueKey ? { parentIssueId: NaN } : {}), // 後でissueKey→IDに変換
    customFields,
  };
}

// ─────────────────────────────────────────────────────────
// backlogService.createIssue の更新版シグネチャ例
// （BacklogService クラス内に追加）
// ─────────────────────────────────────────────────────────
/*
async createIssueWithCustomFields(params: {
  summary: string;
  description: string;
  issueTypeId: number;
  priorityId: number;
  parentIssueId?: number;
  customFields: { fieldId: string; value: string }[];
}): Promise<any> {
  const projectRes = await axios.get(this.getUrl(`/projects/${this.projectKey}`));
  const projectId = projectRes.data.id;

  const body = new URLSearchParams();
  body.append("projectId",    String(projectId));
  body.append("summary",      params.summary);
  body.append("description",  params.description);
  body.append("issueTypeId",  String(params.issueTypeId));
  body.append("priorityId",   String(params.priorityId));

  if (params.parentIssueId) {
    body.append("parentIssueId", String(params.parentIssueId));
  }

  // カスタム属性
  for (const cf of params.customFields) {
    body.append(`customField_${cf.fieldId}`, cf.value);
  }

  const res = await axios.post(this.getUrl("/issues"), body);
  return res.data;
}
*/

// ─────────────────────────────────────────────────────────
// モーダル送信ハンドラ内での呼び出し例
// （slackApp.view("legal_request_modal", ...) 内に置き換える）
// ─────────────────────────────────────────────────────────
/*
slackApp.view("legal_request_modal", async ({ ack, body, view, client }) => {
  await ack();

  const values      = view.state.values;
  const requestType = values.request_type_block.request_type_input.selected_option?.value ?? "legal_consultation";
  const user        = body.user.id;

  const params = buildBacklogIssueParams(requestType, values, user);

  // 親課題キーがあればIDに解決
  const parentKeyVal = values.parent_issue_block?.parent_issue_input?.value;
  if (parentKeyVal) {
    try {
      const parentIssue = await backlogService.getIssue(parentKeyVal.trim());
      params.parentIssueId = parentIssue.id;
    } catch { /* 親課題が見つからなければ無視 */ }
  }

  // Backlog課題作成
  const issue = await backlogService.createIssueWithCustomFields(params);

  // issue_workflows に初期レコード INSERT
  await query(
    `INSERT INTO issue_workflows (backlog_issue_key, issue_type_name, current_status_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (backlog_issue_key) DO NOTHING`,
    [issue.issueKey, requestType, Object.keys(MODAL_FIELDS[requestType]?.[0] ?? {})[0] ?? "起票"]
  );

  // Slack DM で完了通知
  await client.chat.postMessage({
    channel: user,
    text: `✅ 課題を作成しました: *${issue.issueKey}* — ${issue.summary}`,
  });
});
*/
