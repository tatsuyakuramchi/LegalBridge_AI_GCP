/**
 * slackGateway — Slack `/法務依頼`・`/法務検索` の受け口 (Phase 31: GAS からの移管)
 *
 *   POST /slack/commands       — slash command (/法務依頼, /法務検索)
 *   POST /slack/interactivity  — block_actions / view_submission
 *
 * 背景: GAS (Apps Script) 経由では V8 ランタイムのスピンアップ (2〜5 秒) と
 * 302 リダイレクト応答のオーバーヘッドにより、Slack の 3 秒制限を構造的に
 * 満たせない (「Slackに接続できません」多発)。search-api は min-instances=1
 * の常時起動 Cloud Run のため、ここへ受け口を移す。
 *
 * ロジックは gas/Code.gs の 1:1 移植を基本とし、次の点だけ最適化している:
 *   - 契約番号 lookup / 契約状況検索は同一プロセス内呼び出し (REST 往復なし)
 *   - 起票・紐付けなど重い処理は worker の *-run EP へ fire-and-forget 中継
 *     (完了/失敗は worker が DM 通知)
 *   - Slack 署名検証 (SLACK_SIGNING_SECRET 設定時のみ。GAS は未検証だった)
 *
 * Slack App 側の設定変更 (手動):
 *   - slash /法務依頼・/法務検索 の Request URL → https://<search-api>/slack/commands
 *   - Interactivity の Request URL → https://<search-api>/slack/interactivity
 * ロールバックは URL を GAS に戻すだけ (GAS 側コードは温存)。
 */
import crypto from "node:crypto";
import express from "express";
import { query } from "../lib/db.ts";
import { hasSigningSecret, signLinkQs } from "../lib/signedUrl.ts";

const SLACK_API = "https://slack.com/api";

export type SlackGatewayDeps = {
  workerBaseUrl: string;
  portalSecret: string;
  botToken: string;
  signingSecret: string;
  searchContractStatus: (input: any) => Promise<any>;
  enrichWithBacklogStatus: (result: any) => Promise<void>;
  backlogHost: string;
  backlogProjectKey: string;
  allowedSearchChannelIds: string;
};

// -----------------------------------------------------------------------
//  定数 (gas/Code.gs と同一)
// -----------------------------------------------------------------------

const REQUEST_TYPE_TO_BACKLOG_TYPE: Record<string, string> = {
  legal_consult: "法務相談",
  nda: "NDA",
  outsourcing: "業務委託基本契約",
  license_master: "ライセンス契約",
  lic_individual: "個別利用許諾条件",
  sales_master: "売買契約（当社買手）",
  purchase_order: "発注書",
  delivery_inspec: "納品リクエスト",
  license_calc: "売上報告案件",
};

const REQUEST_TYPE_LABELS_UI: Record<string, string> = {
  legal_consult: "法務レビュー",
  nda: "秘密保持契約 (NDA)",
  outsourcing: "業務委託基本契約",
  license_master: "ライセンス基本契約",
  lic_individual: "個別利用許諾条件",
  sales_master: "売買基本契約",
  purchase_order: "発注書",
  delivery_inspec: "納品 / 検収書",
  license_calc: "利用許諾計算書",
  deadline_change: "納期変更依頼",
};

const LINE_ITEM_MAX = 5;

type LineItemField = {
  key: string;
  label: string;
  kind: "text" | "multiline" | "date" | "select" | "radio";
  optional?: boolean;
  placeholder?: string;
  initialValue?: string;
  initialDays?: number;
  options?: { value: string; text: string }[];
};

const LINE_ITEM_FIELDS: Record<string, { label: string; fields: LineItemField[] }> = {
  purchase_order: {
    label: "発注明細",
    fields: [
      { key: "name", label: "発注の概要名称", kind: "text", placeholder: "例: 〇〇制作業務" },
      {
        key: "ip_ownership", label: "IP帰属", kind: "radio",
        options: [
          { value: "transfer", text: "当社へ譲渡（譲渡型）" },
          { value: "license", text: "利用許諾（ロイヤリティ有）" },
        ],
      },
      { key: "work_spec", label: "業務内容・仕様（できるだけ具体的に）", kind: "multiline", placeholder: "箇条書きで記入してください" },
      { key: "work_deadline", label: "業務納期", kind: "date", initialDays: 30 },
      {
        key: "payment_method", label: "支払方法", kind: "select",
        options: [
          { value: "lump_sum", text: "一括" },
          { value: "installments", text: "分割" },
          { value: "royalty", text: "ロイヤリティ歩合" },
          { value: "monthly", text: "月払い" },
          { value: "quarterly", text: "四半期払い" },
          { value: "yearly", text: "年払い" },
        ],
      },
      { key: "payment_due", label: "支払期日", kind: "date", initialDays: 60 },
      { key: "amount", label: "金額（税抜）", kind: "text", placeholder: "例: 100000（分割・歩合の場合は算定方法を記載）" },
      { key: "royalty_terms", label: "料率・基準価格・MG/AG〔利用許諾ありのときのみ〕", kind: "text", optional: true, placeholder: "例: 料率5% / 基準価格1,650円 / MG 100,000円" },
      { key: "remarks", label: "特約・備考", kind: "text", optional: true, placeholder: "無ければ「無し」" },
    ],
  },
  lic_individual: {
    label: "許諾明細",
    fields: [
      { key: "original_work", label: "原著作物名（対象作品）", kind: "text", placeholder: "例: 『〇〇』（原作および派生作品を含む 等の補記も可）" },
      {
        key: "usage_type", label: "展開区分（条件書の種類）", kind: "radio",
        options: [
          { value: "boardgame", text: "ボードゲーム（個別利用許諾条件書）" },
          { value: "publication", text: "出版（出版等利用許諾条件書）" },
          { value: "other", text: "その他" },
        ],
      },
      { key: "product_name", label: "対象製品（予定）名", kind: "text", placeholder: "例: ボードゲーム「〇〇」/ 書籍『〇〇』" },
      {
        key: "exclusivity", label: "独占性", kind: "radio",
        options: [
          { value: "exclusive", text: "独占" },
          { value: "non_exclusive", text: "非独占" },
        ],
      },
      { key: "license_start", label: "許諾開始日", kind: "date", initialDays: 30 },
      { key: "license_term", label: "許諾期間", kind: "text", placeholder: "例: 基本契約の満了日まで / 発売日から3年間" },
      {
        key: "money_own", label: "金銭条件① 自社製造・自社販売", kind: "multiline", optional: true,
        placeholder: "例: 国内・日本語 / ロイヤリティ5% × 上代(MSRP) / MG 100,000円 / 四半期締め翌月末払い",
      },
      {
        key: "money_sublicense", label: "金銭条件② サブライセンス（ライセンスアウト）", kind: "multiline", optional: true,
        placeholder: "例: 北米・英語 / サブライセンス収入の50% / 半期締め翌月末払い",
      },
      {
        key: "money_product_out", label: "金銭条件③ 自社製造・他社販売（プロダクトアウト）", kind: "multiline", optional: true,
        placeholder: "例: 国内・日本語 / 卸価格 × 5% × 出荷数 / 四半期締め翌月末払い",
      },
      { key: "supervision_credit", label: "監修・クレジット表示", kind: "text", optional: true, placeholder: "例: 要監修（発売前確認） / © 表記「〇〇」" },
      { key: "remarks", label: "特記事項", kind: "text", optional: true, placeholder: "無ければ「無し」" },
    ],
  },
  delivery_inspec: {
    label: "納品明細",
    fields: [
      {
        key: "target_doc_number",
        label: "対象契約番号（この明細の発注書番号。空欄なら共通の番号を使用）",
        kind: "text", optional: true, placeholder: "例: ARC-PO-2026-0002",
      },
      { key: "item_name", label: "品名・業務内容", kind: "text", placeholder: "例: 〇〇イラスト制作 一式" },
      { key: "delivery_no", label: "納品回数 (第 n 回納品)", kind: "text", placeholder: "1", initialValue: "1" },
      { key: "order_amount", label: "金額（税抜）", kind: "text", placeholder: "100000" },
      { key: "delivery_date", label: "納品日 (YYYY-MM-DD)", kind: "date", initialDays: 0 },
      { key: "inspection_deadline", label: "検収期限 (YYYY-MM-DD)", kind: "date", initialDays: 14 },
    ],
  },
  license_calc: {
    label: "計算明細",
    fields: [
      { key: "product_name", label: "対象製品・作品", kind: "text", placeholder: "例: ボードゲーム「〇〇」" },
      { key: "period", label: "対象期間", kind: "text", placeholder: "例: 2026年4月〜2026年6月" },
      { key: "sales", label: "販売数・売上高", kind: "text", placeholder: "例: 1,200個 / ¥1,980,000" },
      { key: "royalty_terms", label: "料率・単価", kind: "text", placeholder: "例: 料率5% / 単価100円" },
      { key: "remarks", label: "備考", kind: "text", optional: true },
    ],
  },
};

// -----------------------------------------------------------------------
//  小物ヘルパー
// -----------------------------------------------------------------------

function isoDatePlusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function buildVendorSearchUrl(selfBase: string, keyword: string): string {
  if (!selfBase) return "";
  const url = `${selfBase}/search/vendor?q=${encodeURIComponent(keyword || "")}`;
  if (hasSigningSecret()) {
    try {
      return url + "&" + signLinkQs("list", 600);
    } catch {
      /* fall through */
    }
  }
  return url;
}

function buildPaymentContractsUrl(selfBase: string): string {
  return selfBase ? `${selfBase}/payments/contracts` : "";
}

// DM のリンクは数日後にクリックされることがあるため、取引先検索 (10 分) より
// 大幅に長い TTL にする。書込専用ページ + 社内 Slack にしか出ないリンクなので許容。
const UPLOAD_LINK_TTL_SEC = 30 * 24 * 60 * 60;

/**
 * 資料アップロードページへの署名付き URL。
 *
 * IAP を経由しない run.app 直リンクでも開けるよう、/search/vendor と同じ
 * HMAC 署名方式 (requireSignedUrlOrIap) を使う。uploaderEmail を渡すと
 * `u=<email>` を resourceId (`upload:<email>`) に束縛して署名するので、
 * ページ/API 側は署名検証済みの u をアップロード者として信頼できる
 * (改ざんすると署名不一致で 401)。
 */
function buildAttachmentUploadUrl(
  selfBase: string,
  issueKey?: string,
  uploaderEmail?: string
): string {
  if (!selfBase) return "";
  const params: string[] = [];
  if (issueKey) params.push(`issue=${encodeURIComponent(issueKey)}`);
  const email = String(uploaderEmail || "").trim().toLowerCase();
  if (hasSigningSecret()) {
    try {
      if (email) {
        params.push(`u=${encodeURIComponent(email)}`);
        params.push(signLinkQs(`upload:${email}`, UPLOAD_LINK_TTL_SEC));
      } else {
        params.push(signLinkQs("upload", UPLOAD_LINK_TTL_SEC));
      }
    } catch {
      /* secret 未設定なら素の URL (IAP 経由でのみ開ける) */
    }
  }
  const url = `${selfBase}/attachments/upload`;
  return params.length ? `${url}?${params.join("&")}` : url;
}

// -----------------------------------------------------------------------
//  モーダルビルダー (gas/Code.gs 移植)
// -----------------------------------------------------------------------

function buildLineItemBlocks(type: string, index: number): any[] {
  const conf = LINE_ITEM_FIELDS[type];
  if (!conf) return [];

  const blocks: any[] = [
    { type: "divider" },
    {
      type: "section",
      block_id: `li_${index}_head_block`,
      text: { type: "mrkdwn", text: `*📄 ${conf.label} ${index}*` },
    },
  ];

  conf.fields.forEach((f) => {
    const actionId = `li_${index}_${f.key}_input`;
    let element: any;
    if (f.kind === "date") {
      element = { type: "datepicker", action_id: actionId };
      if (typeof f.initialDays === "number") {
        element.initial_date = isoDatePlusDays(f.initialDays);
      }
    } else if (f.kind === "select") {
      element = {
        type: "static_select",
        action_id: actionId,
        placeholder: { type: "plain_text", text: "選択してください" },
        options: (f.options || []).map((o) => ({
          text: { type: "plain_text", text: o.text },
          value: o.value,
        })),
      };
    } else if (f.kind === "radio") {
      element = {
        type: "radio_buttons",
        action_id: actionId,
        options: (f.options || []).map((o) => ({
          text: { type: "plain_text", text: o.text },
          value: o.value,
        })),
      };
    } else {
      element = { type: "plain_text_input", action_id: actionId };
      if (f.kind === "multiline") element.multiline = true;
      if (f.placeholder) element.placeholder = { type: "plain_text", text: f.placeholder };
      if (f.initialValue) element.initial_value = f.initialValue;
    }

    blocks.push({
      type: "input",
      block_id: `li_${index}_${f.key}_block`,
      optional: !!f.optional,
      label: { type: "plain_text", text: f.label },
      element,
    });
  });

  return blocks;
}

function getLineItemSectionBlocks(type: string, count: number): any[] {
  const conf = LINE_ITEM_FIELDS[type];
  if (!conf) return [];
  const n = Math.max(1, Math.min(Number(count) || 1, LINE_ITEM_MAX));

  let blocks: any[] = [];
  for (let i = 1; i <= n; i++) {
    blocks = blocks.concat(buildLineItemBlocks(type, i));
  }

  const buttons: any[] = [];
  if (n < LINE_ITEM_MAX) {
    buttons.push({
      type: "button",
      action_id: "li_add",
      text: { type: "plain_text", text: "➕ 明細を追加" },
    });
  }
  if (n > 1) {
    buttons.push({
      type: "button",
      action_id: "li_remove",
      text: { type: "plain_text", text: "➖ 最後の明細を削除" },
    });
  }
  if (buttons.length > 0) {
    blocks.push({ type: "actions", block_id: "li_actions_block", elements: buttons });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `明細は最大 ${LINE_ITEM_MAX} 件まで追加できます (現在 ${n} 件)。`,
      },
    ],
  });
  return blocks;
}

function formatLineItemsText(submission: any): string {
  const conf = LINE_ITEM_FIELDS[submission.request_type];
  const items = submission.line_items || [];
  if (!conf || items.length === 0) return "";

  const out: string[] = [`【${conf.label}】(${items.length} 件)`];
  items.forEach((item: any, idx: number) => {
    out.push(`■ ${conf.label} ${idx + 1}`);
    conf.fields.forEach((f) => {
      const raw = item[f.key];
      if (raw === null || raw === undefined || raw === "") return;
      let display = raw;
      if ((f.kind === "radio" || f.kind === "select") && f.options) {
        f.options.forEach((o) => {
          if (o.value === raw) display = o.text;
        });
      }
      if (f.kind === "multiline") {
        out.push(`${f.label}:`);
        out.push(String(display));
      } else {
        out.push(`${f.label}: ${display}`);
      }
    });
    out.push("");
  });
  return out.join("\n");
}

function getLegalRequestModal(
  selectedType: string,
  opts: { candidates?: any[]; liCount?: number; uploadEmail?: string } = {},
  selfBase = ""
): any {
  selectedType = selectedType || "legal_consult";
  const candidates = opts.candidates || [];
  const liCount = Math.max(1, Math.min(Number(opts.liCount) || 1, LINE_ITEM_MAX));

  const REQUEST_GROUPS = [
    {
      label: "法務レビュー",
      options: [{ value: "legal_consult", text: "法務レビュー" }],
    },
    {
      label: "文書作成",
      options: [
        { value: "nda", text: "秘密保持契約 (NDA)" },
        { value: "outsourcing", text: "業務委託基本契約" },
        { value: "license_master", text: "ライセンス基本契約" },
        { value: "lic_individual", text: "個別利用許諾条件" },
        { value: "sales_master", text: "売買基本契約" },
        { value: "purchase_order", text: "発注書" },
      ],
    },
    {
      label: "支払書類作成",
      options: [
        { value: "delivery_inspec", text: "納品 / 検収書" },
        { value: "license_calc", text: "利用許諾計算書" },
      ],
    },
    {
      label: "その他",
      options: [{ value: "deadline_change", text: "納期変更依頼" }],
    },
  ];

  let initialLabel = "法務レビュー";
  REQUEST_GROUPS.forEach((g) => {
    g.options.forEach((o) => {
      if (o.value === selectedType) initialLabel = o.text;
    });
  });

  const optionGroups = REQUEST_GROUPS.map((g) => ({
    label: { type: "plain_text", text: g.label },
    options: g.options.map((o) => ({
      text: { type: "plain_text", text: o.text },
      value: o.value,
    })),
  }));

  const baseBlocks: any[] = [
    {
      type: "input",
      block_id: "request_type_block",
      label: { type: "plain_text", text: "依頼種別" },
      dispatch_action: true,
      element: {
        type: "static_select",
        action_id: "request_type_input",
        initial_option: {
          text: { type: "plain_text", text: initialLabel },
          value: selectedType,
        },
        placeholder: { type: "plain_text", text: "種別を選択してください" },
        option_groups: optionGroups,
      },
    },
  ];

  // 納期変更依頼は別フォームで完結する
  if (selectedType === "deadline_change") {
    const deadlineCandidateBlocks: any[] = [];
    if (candidates.length > 0) {
      deadlineCandidateBlocks.push({
        type: "input",
        block_id: "target_issue_key_select_block",
        label: { type: "plain_text", text: "対象 Backlog 課題 (候補から選択)" },
        optional: true,
        element: {
          type: "static_select",
          action_id: "target_issue_key_select_input",
          placeholder: { type: "plain_text", text: "未完了の依頼から選択…" },
          options: candidates.slice(0, 25).map((c: any) => {
            let label = `[${c.issue_key}] ${(c.summary || "").slice(0, 60)}`;
            if (c.counterparty) label += ` / ${c.counterparty.slice(0, 20)}`;
            return {
              text: { type: "plain_text", text: label.slice(0, 75) },
              value: c.issue_key,
            };
          }),
        },
      });
    }

    return {
      type: "modal",
      callback_id: "legal_request_modal",
      title: { type: "plain_text", text: "納期変更依頼" },
      submit: { type: "plain_text", text: "送信" },
      blocks: baseBlocks
        .concat([
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text:
                  "⚠️ *この依頼は新規 Backlog 課題を作成しません。* " +
                  "指定した Backlog 課題の **未完了業務明細すべて** の納期が " +
                  "一括で新日付に変更されます。明細ごとに違う日付にしたい場合は " +
                  "法務担当者へ admin-ui 経由での変更を依頼してください。",
              },
            ],
          },
        ])
        .concat(deadlineCandidateBlocks)
        .concat([
          {
            type: "input",
            block_id: "target_issue_key_block",
            label: { type: "plain_text", text: "対象 Backlog 課題キー (候補にない場合のみ入力)" },
            optional: candidates.length > 0,
            element: {
              type: "plain_text_input",
              action_id: "target_issue_key_input",
              placeholder: { type: "plain_text", text: "LEGAL-123" },
            },
          },
          {
            type: "input",
            block_id: "new_delivery_date_block",
            label: { type: "plain_text", text: "新しい納期" },
            element: {
              type: "datepicker",
              action_id: "new_delivery_date_input",
              initial_date: isoDatePlusDays(1),
            },
          },
          {
            type: "input",
            block_id: "change_reason_block",
            label: { type: "plain_text", text: "変更理由" },
            element: {
              type: "plain_text_input",
              action_id: "change_reason_input",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "例: 仕様変更により制作期間が必要なため",
              },
            },
          },
        ]),
    };
  }

  // 通常 (新規依頼) の form
  const vendorSearchUrl = buildVendorSearchUrl(selfBase, "");
  const entityIdHelpBlock = {
    type: "context",
    block_id: "entity_id_help_block",
    elements: [
      {
        type: "mrkdwn",
        text: vendorSearchUrl
          ? `🔎 取引先コードが分からない場合は <${vendorSearchUrl}|取引先マスタを検索> (法務検索ポータル)`
          : "🔎 取引先コードは法務検索ポータル (取引先マスタ) で確認できます。",
      },
    ],
  };

  // 法務レビュー: レビュー対象文書は資料アップロードページ経由の導線を出す
  const reviewUploadBlocks: any[] = [];
  if (selectedType === "legal_consult") {
    const uploadPageUrl = buildAttachmentUploadUrl(selfBase, undefined, opts.uploadEmail);
    reviewUploadBlocks.push({
      type: "context",
      block_id: "review_upload_help_block",
      elements: [
        {
          type: "mrkdwn",
          text:
            "📎 *レビューしてほしい文書の添付方法*: " +
            (uploadPageUrl
              ? `<${uploadPageUrl}|資料アップロードページ>`
              : "資料アップロードページ") +
            " からアップロードしてください。依頼の送信後に届く DM のリンクからも開けます" +
            "(課題番号は DM でお知らせします)。",
        },
      ],
    });
  }

  // 検収書 / 計算書のときは候補 select を表示
  const candidateBlocks: any[] = [];
  if (
    (selectedType === "delivery_inspec" || selectedType === "license_calc") &&
    candidates.length > 0
  ) {
    candidateBlocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            "💡 *候補が見つかりました*。下のセレクタで該当する子課題を選択すると" +
            "、新規 Backlog 課題は作成されず、既存の子課題に紐付けて起票されます。" +
            "該当課題が見つからない場合は「新規作成」を選択してください。",
        },
      ],
    });
    candidateBlocks.push({
      type: "input",
      block_id: "target_issue_key_select_block",
      label: { type: "plain_text", text: "対象課題 (候補から選択)" },
      element: {
        type: "static_select",
        action_id: "target_issue_key_select_input",
        placeholder: { type: "plain_text", text: "選択してください" },
        options: [
          {
            text: { type: "plain_text", text: "🆕 新規作成 (該当課題なし)" },
            value: "__NEW__",
          },
        ].concat(
          candidates.slice(0, 24).map((c: any) => {
            let label = `[${c.issue_key}] ${(c.summary || "").slice(0, 60)}`;
            if (c.counterparty) label += ` / ${c.counterparty.slice(0, 20)}`;
            return {
              text: { type: "plain_text", text: label.slice(0, 75) },
              value: c.issue_key,
            };
          })
        ),
      },
    });
  }

  // 検収書・計算書は取引先手入力の代わりに契約番号で特定する
  const isDocNumberControlled =
    selectedType === "delivery_inspec" || selectedType === "license_calc";

  let counterpartyBlocks: any[];
  if (isDocNumberControlled) {
    const paymentContractsUrl = buildPaymentContractsUrl(selfBase);
    counterpartyBlocks = [
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*対象契約 (Target Contract)*" },
      },
      {
        type: "input",
        block_id: "target_doc_number_block",
        optional: true,
        label: { type: "plain_text", text: "対象の発注書番号 / 契約書番号" },
        element: {
          type: "plain_text_input",
          action_id: "target_doc_number_input",
          placeholder: { type: "plain_text", text: "例: ARC-PO-2026-0001" },
        },
      },
      {
        type: "context",
        block_id: "target_doc_number_help_block",
        elements: [
          {
            type: "mrkdwn",
            text:
              (paymentContractsUrl
                ? `🔎 番号が分からない場合は <${paymentContractsUrl}|支払対象契約検索> で確認できます（自部署の契約のみ表示）。`
                : "🔎 番号は支払対象契約検索ページで確認できます。") +
              " 取引先は契約から自動で特定されます。上の候補から選択した場合、番号の入力は不要です。" +
              (selectedType === "delivery_inspec"
                ? " 明細ごとに契約が異なる場合は、各明細の「対象契約番号」に入力してください（空欄の明細はこの共通番号を使用。複数契約の検収書は法務が一括発行します）。"
                : ""),
          },
        ],
      },
    ];
  } else {
    counterpartyBlocks = [
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: "*取引先情報 (Counterparty Info)* — 入力は任意" },
      },
      {
        type: "context",
        block_id: "counterparty_help_block",
        elements: [
          {
            type: "mrkdwn",
            text:
              (vendorSearchUrl
                ? `🔎 既存の取引先は <${vendorSearchUrl}|取引先マスタを検索> で名称・コードを確認できます。`
                : "🔎 既存の取引先は法務検索ポータル (取引先マスタ) で確認できます。") +
              " *新規 (未登録) の取引先の場合は、下の「相談・依頼詳細」に名称・所在地などを記載してください。*",
          },
        ],
      },
      {
        type: "input",
        block_id: "counterparty_block",
        optional: true,
        label: { type: "plain_text", text: "相手方名称" },
        element: {
          type: "plain_text_input",
          action_id: "counterparty_input",
          placeholder: { type: "plain_text", text: "株式会社〇〇" },
        },
      },
      {
        type: "input",
        block_id: "entity_type_block",
        optional: true,
        label: { type: "plain_text", text: "区分" },
        element: {
          type: "radio_buttons",
          action_id: "entity_type_input",
          initial_option: { text: { type: "plain_text", text: "法人" }, value: "corporate" },
          options: [
            { text: { type: "plain_text", text: "法人" }, value: "corporate" },
            { text: { type: "plain_text", text: "個人" }, value: "individual" },
          ],
        },
      },
      {
        type: "input",
        block_id: "entity_id_block",
        optional: true,
        label: { type: "plain_text", text: "法人番号 / 社内個人コード" },
        element: {
          type: "plain_text_input",
          action_id: "entity_id_input",
          placeholder: { type: "plain_text", text: "13桁の番号、または社内コード" },
        },
      },
      entityIdHelpBlock,
    ];
  }

  const blocks = baseBlocks
    .concat(reviewUploadBlocks)
    .concat(candidateBlocks)
    .concat([
      {
        type: "input",
        block_id: "summary_block",
        label: { type: "plain_text", text: "件名" },
        element: {
          type: "plain_text_input",
          action_id: "summary_input",
          placeholder: { type: "plain_text", text: "例: 秘密保持契約の審査依頼" },
        },
      },
      {
        type: "input",
        block_id: "deadline_block",
        label: { type: "plain_text", text: "希望納期（文書作成等）" },
        element: {
          type: "datepicker",
          action_id: "deadline_input",
          initial_date: isoDatePlusDays(7),
        },
      },
    ])
    .concat(counterpartyBlocks)
    .concat([
      { type: "divider" },
      {
        type: "input",
        block_id: "details_block",
        label: { type: "plain_text", text: "相談・依頼詳細" },
        element: {
          type: "plain_text_input",
          action_id: "details_input",
          multiline: true,
        },
      },
    ]);

  let finalBlocks = blocks;
  if (LINE_ITEM_FIELDS[selectedType]) {
    finalBlocks = blocks.concat(getLineItemSectionBlocks(selectedType, liCount));
  }

  return {
    type: "modal",
    callback_id: "legal_request_modal",
    title: { type: "plain_text", text: "法務相談・契約審査" },
    private_metadata: JSON.stringify({
      li_count: LINE_ITEM_FIELDS[selectedType] ? liCount : 0,
    }),
    blocks: finalBlocks,
    submit: { type: "plain_text", text: "送信" },
  };
}

// ── アンサーバックビュー ────────────────────────────────────────────────

function getSubmissionCompleteView(opts: {
  heading?: string;
  issueKey?: string;
  requestType?: string;
  summary?: string;
  uploadUrl?: string;
  noteLines?: string[];
}): any {
  const fields: any[] = [];
  if (opts.issueKey) {
    fields.push({ type: "mrkdwn", text: "*課題番号*\n`" + opts.issueKey + "`" });
  }
  if (opts.requestType) {
    fields.push({
      type: "mrkdwn",
      text: "*依頼種別*\n" + (REQUEST_TYPE_LABELS_UI[opts.requestType] || opts.requestType),
    });
  }
  if (opts.summary) {
    fields.push({ type: "mrkdwn", text: "*件名*\n" + String(opts.summary).slice(0, 120) });
  }

  const blocks: any[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "✅ *" + (opts.heading || "依頼を受け付けました") + "*",
      },
    },
  ];
  if (fields.length > 0) blocks.push({ type: "section", fields });
  (opts.noteLines || []).forEach((line) => {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: line }] });
  });
  if (opts.uploadUrl) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `📎 資料 (レビュー対象文書・参考資料) の添付は <${opts.uploadUrl}` +
          "|資料アップロードページ> からお願いします (課題番号は入力済みで開きます)。",
      },
    });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "詳しい受付通知は DM でお送りします。この画面は閉じて構いません。",
      },
    ],
  });

  return {
    type: "modal",
    callback_id: "legal_request_complete_modal",
    title: { type: "plain_text", text: "受付完了" },
    close: { type: "plain_text", text: "閉じる" },
    blocks,
  };
}

function getSubmissionErrorView(message: any): any {
  return {
    type: "modal",
    callback_id: "legal_request_error_modal",
    title: { type: "plain_text", text: "エラー" },
    close: { type: "plain_text", text: "戻る" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "⚠️ *送信処理でエラーが発生しました*" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: String(message || "不明なエラー").slice(0, 2900) },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "「戻る」で入力画面に戻れます (入力内容は保持されています)。" +
              "時間をおいて再送しても解決しない場合は法務担当までご連絡ください。",
          },
        ],
      },
    ],
  };
}

// ── /法務検索 モーダル ──────────────────────────────────────────────────

function getLegalSearchModal(initialKeyword?: string): any {
  const keywordElement: any = {
    type: "plain_text_input",
    action_id: "keyword_input",
    placeholder: {
      type: "plain_text",
      text: "件名、取引先名、Backlog キー、依頼種別など",
    },
  };
  if (initialKeyword) keywordElement.initial_value = initialKeyword;

  return {
    type: "modal",
    callback_id: "legal_search_modal",
    title: { type: "plain_text", text: "法務検索" },
    submit: { type: "plain_text", text: "検索" },
    close: { type: "plain_text", text: "閉じる" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "キーワードを入力して *検索* を押してください。",
        },
      },
      {
        type: "input",
        block_id: "keyword_block",
        label: { type: "plain_text", text: "検索キーワード" },
        element: keywordElement,
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "🔎 過去の法務依頼 (legal_requests) と取引先マスター (vendors) を横断検索します。部分一致 / 大文字小文字を区別しません。",
          },
        ],
      },
    ],
  };
}

function masterStatusLabel(master: any): string {
  if (!master || !master.exists) return "— 未締結";
  const num = master.documentNumber ? ` (${master.documentNumber})` : "";
  return "✅ 締結済" + num;
}

function appendVendorInfoBlock(blocks: any[], cp: any): void {
  if (!cp) return;
  const ent = (v: any) =>
    v === "corporate" ? "法人" : v === "individual" ? "個人" : v || "";
  const bool = (b: any) => (b === true ? "対象" : b === false ? "対象外" : "");
  const comma = (n: any) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const yen = (n: any) => (n === null || n === undefined || n === "" ? "" : "¥" + comma(n));
  const ppl = (n: any) => (n === null || n === undefined || n === "" ? "" : comma(n) + " 名");

  const pairs = [
    ["屋号", cp.tradeName],
    ["ペンネーム", cp.penName],
    ["敬称", cp.vendorSuffix],
    ["別名", cp.aliases],
    ["区分", ent(cp.entityType)],
    ["法人番号", cp.corporateNumber],
    ["登録番号", cp.invoiceRegistrationNumber],
    ["適格請求書", bool(cp.isInvoiceIssuer)],
    ["源泉徴収", bool(cp.withholdingEnabled)],
    ["下請法", bool(cp.subcontractActApplicable)],
    ["住所", cp.address],
    ["電話", cp.phone],
    ["メール", cp.email],
    ["担当部署", cp.contactDepartment],
    ["担当者", cp.contactName],
    ["取引区分", cp.transactionCategory],
    ["支払条件", cp.paymentTerms],
    ["主要事業", cp.mainBusiness],
    ["資本金", yen(cp.capitalYen)],
    ["従業員数", ppl(cp.employeeCount)],
    ["格付", cp.rating],
    ["反社チェック", cp.antisocialCheckResult],
    ["振込先銀行", cp.bankName],
    ["支店", cp.branchName],
    ["口座種別", cp.accountType],
    ["口座番号", cp.accountNumber],
    ["口座名義", cp.accountHolderKana],
    ["基本契約参照", cp.masterContractRef],
    ["マスタ更新日", cp.masterUpdatedAt],
  ].filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== "");

  if (pairs.length === 0) return;

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*🏢 取引先情報*" },
  });

  for (let i = 0; i < pairs.length; i += 10) {
    const chunk = pairs.slice(i, i + 10);
    blocks.push({
      type: "section",
      fields: chunk.map((p) => {
        let v = String(p[1]);
        if (v.length > 300) v = v.slice(0, 297) + "…";
        return { type: "mrkdwn", text: "*" + p[0] + "*\n" + v };
      }),
    });
  }
}

function appendDocumentsByCategorySection(blocks: any[], catData: any): void {
  if (!catData || typeof catData !== "object") return;
  const total = Number(catData.total) || 0;
  if (total === 0) return;

  blocks.push({ type: "divider" });
  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📁 登録文書一覧 (${total}件)`, emoji: true },
  });

  const sections = [
    { key: "basic", label: "🟦 基本契約" },
    { key: "individual", label: "🟩 個別契約" },
    { key: "other", label: "⬛ その他" },
  ];

  sections.forEach((sec) => {
    const rows = Array.isArray(catData[sec.key]) ? catData[sec.key] : [];
    if (rows.length === 0) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `*${sec.label}*  _なし_` }],
      });
      return;
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${sec.label} (${rows.length}件)*` },
    });
    const maxRows = 20;
    const lines = rows.slice(0, maxRows).map((d: any) => {
      const title = d.contract_title || d.template_type || "(無題)";
      const docNo = d.document_number ? " `" + d.document_number + "`" : "";
      const status = d.contract_status
        ? d.contract_status === "executed"
          ? " ✓"
          : ` [${d.contract_status}]`
        : "";
      const backlog = d.backlog_status ? `  🔖 ${d.backlog_status}` : "";
      const linked = d.file_link ? ` <${d.file_link}|📄 開く>` : " _(リンクなし)_";
      return "• " + title + docNo + status + backlog + linked;
    });
    if (rows.length > maxRows) {
      lines.push(`_…他 ${rows.length - maxRows} 件_`);
    }
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  });
}

function appendRingiDetail(blocks: any[], ringi: any): void {
  const title = ringi.title || "(タイトル未設定)";
  const num = ringi.ringi_number || "-";
  const meta: string[] = [];
  if (ringi.category) meta.push("カテゴリ: " + ringi.category);
  if (ringi.owner_name) meta.push("起案者: " + ringi.owner_name);
  if (ringi.owner_department) meta.push("部署: " + ringi.owner_department);
  if (ringi.approved_at) meta.push("承認日: " + ringi.approved_at);
  if (ringi.status) meta.push("状態: " + ringi.status);
  if (ringi.total_budget) {
    meta.push("予算: ¥" + Number(ringi.total_budget).toLocaleString("ja-JP"));
  }

  blocks.push({
    type: "header",
    text: { type: "plain_text", text: `📋 稟議 ${num} ${title}`, emoji: true },
  });
  if (meta.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: meta.join("  ·  ") }],
    });
  }
  if (ringi.remarks) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "> " + ringi.remarks },
    });
  }
  blocks.push({ type: "divider" });
}

function appendSingleContractDetail(blocks: any[], payload: any): void {
  const cp = payload.counterparty || {};
  const masters = payload.masterContracts || {};
  const name = cp.vendorName || cp.counterpartyName || "-";
  const code = cp.vendorCode || "-";

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*${name}* (\`${code}\`)` },
  });

  appendVendorInfoBlock(blocks, cp);

  const pillLines = [
    "業務委託基本契約: " + masterStatusLabel(masters.service),
    "ライセンス基本契約: " + masterStatusLabel(masters.license),
    "出版基本契約: " + masterStatusLabel(masters.publication),
  ];
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: ">" + pillLines.join("\n>") },
  });

  const licCount = Array.isArray(payload.licenseConditions)
    ? payload.licenseConditions.length
    : 0;
  const pubCount = Array.isArray(payload.publicationConditions)
    ? payload.publicationConditions.length
    : 0;
  if (licCount || pubCount) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `ライセンス個別条件: ${licCount} 件 · 出版個別条件: ${pubCount} 件`,
        },
      ],
    });
  }

  appendDocumentsByCategorySection(blocks, payload.documentsByCategory);
}

function appendContractStatusBlocks(blocks: any[], payload: any): void {
  if (payload && payload.__error) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "⚠️ " + payload.__error },
    });
    return;
  }

  if (payload && payload.ringiMode === true && payload.ringi) {
    appendRingiDetail(blocks, payload.ringi);
    appendDocumentsByCategorySection(blocks, payload.documentsByCategory);
    return;
  }

  let candidates: any[] = [];
  if (payload && Array.isArray(payload.results)) candidates = payload.results;
  else if (payload && Array.isArray(payload.matches)) candidates = payload.matches;
  else if (payload && Array.isArray(payload.candidates)) candidates = payload.candidates;
  else if (payload && Array.isArray(payload.vendorCandidates)) candidates = payload.vendorCandidates;

  if (
    candidates.length === 0 &&
    payload &&
    (payload.counterparty || payload.masterContracts)
  ) {
    appendSingleContractDetail(blocks, payload);
    return;
  }

  if (candidates.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `複数の候補が見つかりました (${candidates.length} 件)。詳細は Web で確認してください。`,
      },
    });
    const LIMIT = 5;
    candidates.slice(0, LIMIT).forEach((c: any) => {
      const cp = c.counterparty || c.vendor || c;
      const name = cp.vendorName || cp.vendor_name || cp.counterpartyName || cp.name || "-";
      const code = cp.vendorCode || cp.vendor_code || "-";
      const masters = c.masterContracts || {};
      const pills = [
        "業務委託 " + (masters.service && masters.service.exists ? "✅" : "—"),
        "ライセンス " + (masters.license && masters.license.exists ? "✅" : "—"),
        "出版 " + (masters.publication && masters.publication.exists ? "✅" : "—"),
      ];

      const cat = c.documentsByCategory || {};
      const bc = Array.isArray(cat.basic) ? cat.basic : [];
      const ic = Array.isArray(cat.individual) ? cat.individual : [];
      const oc = Array.isArray(cat.other) ? cat.other : [];
      const summary = `📁 基本 ${bc.length} / 個別 ${ic.length} / その他 ${oc.length}`;

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${name}* (\`${code}\`)\n>${pills.join(" · ")}\n>${summary}`,
        },
      });

      const miniSections = [
        { label: "🟦 基本契約", rows: bc },
        { label: "🟩 個別契約", rows: ic },
        { label: "⬛ その他", rows: oc },
      ];
      miniSections.forEach((sec) => {
        if (sec.rows.length === 0) return;
        const lines = sec.rows.slice(0, 3).map((d: any) => {
          const title = d.contract_title || d.template_type || "(無題)";
          const docNo = d.document_number ? " `" + d.document_number + "`" : "";
          const linked = d.file_link ? ` <${d.file_link}|📄>` : "";
          return `  ${sec.label}: ${title}${docNo}${linked}`;
        });
        if (sec.rows.length > 3) {
          lines.push(`  _… 他 ${sec.rows.length - 3} 件_`);
        }
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: lines.join("\n") }],
        });
      });
    });
    if (candidates.length > LIMIT) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `他 ${candidates.length - LIMIT} 件あります。` }],
      });
    }
    return;
  }

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "取引先マスタに登録された契約が見つかりませんでした。" },
  });
}

function getSearchResultsModal(
  keyword: string,
  data: { contract: any },
  selfBase: string,
  backlogHost: string,
  backlogProjectKey: string
): any {
  const contractPayload = data.contract || {};

  const backlogSearchUrl =
    `https://${backlogHost}/find/${encodeURIComponent(backlogProjectKey)}` +
    `?simpleSearch=${encodeURIComponent(keyword)}`;

  const blocks: any[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*🔎 検索結果: `" + keyword + "`*" },
    },
    { type: "divider" },
  ];

  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "*📑 契約状況*" },
  });
  appendContractStatusBlocks(blocks, contractPayload);

  const webDetailUrl = buildVendorSearchUrl(selfBase, keyword);

  blocks.push({ type: "divider" });
  const footerButtons: any[] = [
    {
      type: "button",
      action_id: "legal_search_again",
      text: { type: "plain_text", text: "🔁 もう一度検索する" },
      style: "primary",
    },
  ];
  if (webDetailUrl) {
    footerButtons.push({
      type: "button",
      action_id: "legal_search_open_web",
      text: { type: "plain_text", text: "🌐 Web で詳細を見る" },
      url: webDetailUrl,
    });
  }
  footerButtons.push({
    type: "button",
    action_id: "legal_search_open_backlog",
    text: { type: "plain_text", text: "🔗 Backlog で関連課題を検索" },
    url: backlogSearchUrl,
  });
  blocks.push({ type: "actions", elements: footerButtons });

  return {
    type: "modal",
    callback_id: "legal_search_results",
    title: { type: "plain_text", text: "法務検索: 結果" },
    close: { type: "plain_text", text: "閉じる" },
    blocks,
  };
}

// -----------------------------------------------------------------------
//  view_submission parsing (gas/Code.gs 移植)
// -----------------------------------------------------------------------

function parseLegalRequestSubmission(payload: any): any {
  const v = payload.view.state.values;
  const safeText = (block: string, action: string) =>
    (v[block] && v[block][action] && v[block][action].value) || "";
  const safeDate = (block: string, action: string) =>
    (v[block] && v[block][action] && v[block][action].selected_date) || "";
  const safeOption = (block: string, action: string) =>
    (v[block] &&
      v[block][action] &&
      v[block][action].selected_option &&
      v[block][action].selected_option.value) ||
    "";

  const deliveryNoRaw = safeText("delivery_no_block", "delivery_no_input");
  const submission: any = {
    slack_user_id: payload.user.id,
    slack_user_name: payload.user.name || payload.user.username || "",
    dept: safeText("dept_block", "dept_input"),
    request_type: safeOption("request_type_block", "request_type_input") || "legal_consult",
    summary: safeText("summary_block", "summary_input"),
    deadline: safeDate("deadline_block", "deadline_input"),
    details: safeText("details_block", "details_input"),
    counterparty: safeText("counterparty_block", "counterparty_input"),
    entity_type: safeOption("entity_type_block", "entity_type_input") || "corporate",
    entity_id: safeText("entity_id_block", "entity_id_input"),
    delivery_no: deliveryNoRaw ? parseInt(deliveryNoRaw, 10) : null,
    order_amount: safeText("order_amount_block", "order_amount_input") || null,
    delivery_date: safeDate("delivery_date_block", "delivery_date_input") || null,
    inspection_deadline:
      safeDate("inspection_deadline_block", "inspection_deadline_input") || null,
    target_issue_key: safeText("target_issue_key_block", "target_issue_key_input"),
    new_delivery_date: safeDate("new_delivery_date_block", "new_delivery_date_input"),
    change_reason: safeText("change_reason_block", "change_reason_input"),
    target_issue_key_select: safeOption(
      "target_issue_key_select_block",
      "target_issue_key_select_input"
    ),
    target_doc_number: safeText("target_doc_number_block", "target_doc_number_input"),
  };

  submission.line_items = [];
  const liConf = LINE_ITEM_FIELDS[submission.request_type];
  if (liConf) {
    let liMeta: any = {};
    try {
      liMeta = JSON.parse((payload.view && payload.view.private_metadata) || "{}");
    } catch {
      liMeta = {};
    }
    const liCount = Math.min(Number(liMeta.li_count) || 0, LINE_ITEM_MAX);
    for (let i = 1; i <= liCount; i++) {
      const item: any = {};
      let hasValue = false;
      liConf.fields.forEach((f) => {
        const block = `li_${i}_${f.key}_block`;
        const actionId = `li_${i}_${f.key}_input`;
        let value: string;
        if (f.kind === "date") {
          value = safeDate(block, actionId);
        } else if (f.kind === "select" || f.kind === "radio") {
          value = safeOption(block, actionId);
        } else {
          value = safeText(block, actionId);
        }
        item[f.key] = value;
        if (value) hasValue = true;
      });
      if (hasValue) submission.line_items.push(item);
    }
  }

  // 検収書: 明細 1 行目を従来フィールドへ埋め戻す (worker 連携互換)
  if (submission.request_type === "delivery_inspec" && submission.line_items.length > 0) {
    const firstItem = submission.line_items[0];
    if (firstItem.delivery_no) {
      submission.delivery_no = parseInt(firstItem.delivery_no, 10) || null;
    }
    submission.order_amount = firstItem.order_amount || submission.order_amount;
    submission.delivery_date = firstItem.delivery_date || submission.delivery_date;
    submission.inspection_deadline =
      firstItem.inspection_deadline || submission.inspection_deadline;
  }

  return submission;
}

// -----------------------------------------------------------------------
//  登録
// -----------------------------------------------------------------------

export function registerSlackGateway(app: express.Express, deps: SlackGatewayDeps): void {
  const workerBase = deps.workerBaseUrl.replace(/\/+$/, "");

  // ── Slack Web API 呼び出し ──────────────────────────────────────────
  async function slackApi(method: string, body: any): Promise<any> {
    if (!deps.botToken) {
      console.error("[slackGateway] SLACK_BOT_TOKEN is not configured.");
      return null;
    }
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${deps.botToken}`,
      },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    if (!json || !json.ok) {
      console.error(`[slackGateway] Slack ${method} failed:`, JSON.stringify(json)?.slice(0, 500));
    }
    return json;
  }

  function notifyUserOfError(userId: string, message: string): void {
    if (!userId) return;
    void slackApi("chat.postMessage", { channel: userId, text: `⚠️ ${message}` });
  }

  // ── worker 呼び出し ────────────────────────────────────────────────
  function workerHeaders(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (deps.portalSecret) h["x-lb-portal-secret"] = deps.portalSecret;
    return h;
  }

  /** fire-and-forget。失敗時は依頼者へ ⚠️ DM。 */
  function dispatchWorker(path: string, payload: any, userId: string, label: string): void {
    fetch(`${workerBase}${path}`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          throw new Error(`worker ${path} HTTP ${r.status} ${text.slice(0, 300)}`);
        }
      })
      .catch((e) => {
        console.error(`[slackGateway] ${label} dispatch failed:`, e);
        notifyUserOfError(
          userId,
          `${label}の処理起動に失敗しました。お手数ですが再度お試しいただくか、法務担当までご連絡ください。`
        );
      });
  }

  async function callWorkerSync(path: string, payload: any): Promise<any> {
    const r = await fetch(`${workerBase}${path}`, {
      method: "POST",
      headers: workerHeaders(),
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    if (!r.ok) {
      throw new Error(`worker API error: ${r.status} ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { ok: true, raw: text };
    }
  }

  /** Slack ユーザー → staff メール (アップロードリンクの署名束縛用)。 */
  async function getStaffEmailBySlackId(slackUserId: string): Promise<string> {
    if (!slackUserId) return "";
    try {
      const r = await query(
        `SELECT email FROM staff
          WHERE slack_user_id = $1 AND COALESCE(email, '') <> ''
          LIMIT 1`,
        [slackUserId]
      );
      return String(r.rows[0]?.email || "").trim().toLowerCase();
    } catch (e) {
      console.warn("[slackGateway] getStaffEmailBySlackId failed:", e);
      return "";
    }
  }

  async function fetchUserCandidates(slackUserId: string, type: string): Promise<any[]> {
    if (!slackUserId) return [];
    try {
      const r = await fetch(
        `${workerBase}/api/management/users/${encodeURIComponent(slackUserId)}` +
          `/candidates?type=${encodeURIComponent(type || "any")}`
      );
      if (!r.ok) {
        console.warn(`[slackGateway] fetchUserCandidates failed: ${r.status}`);
        return [];
      }
      const data: any = await r.json();
      return (data && data.candidates) || [];
    } catch (e) {
      console.warn("[slackGateway] fetchUserCandidates error:", e);
      return [];
    }
  }

  // ── 契約番号 lookup (search-api 内 SQL — REST 往復なし) ─────────────
  async function lookupContractNumber(documentNumber: string): Promise<any> {
    try {
      const r = await query(
        `SELECT cc.id, cc.record_type, cc.contract_title, cc.document_number,
                cc.contract_status,
                v.vendor_name, v.vendor_code, v.entity_type,
                d.issue_key
           FROM contract_capabilities cc
           LEFT JOIN vendors v ON v.id = cc.vendor_id
           LEFT JOIN LATERAL (
             SELECT dd.issue_key FROM documents dd
              WHERE dd.document_number = cc.document_number
              ORDER BY dd.created_at DESC LIMIT 1
           ) d ON TRUE
          WHERE UPPER(cc.document_number) = UPPER($1)
            AND COALESCE(cc.is_primary, TRUE) = TRUE
            AND COALESCE(cc.lifecycle_status, 'final') = 'final'
          ORDER BY cc.updated_at DESC NULLS LAST
          LIMIT 1`,
        [documentNumber]
      );
      const row = r.rows[0];
      if (!row) return { ok: true, found: false };
      return {
        ok: true,
        found: true,
        documentNumber: row.document_number,
        recordType: row.record_type,
        contractTitle: row.contract_title,
        contractStatus: row.contract_status,
        vendorName: row.vendor_name || "",
        vendorCode: row.vendor_code || "",
        entityType: row.entity_type || "",
        issueKey: row.issue_key || "",
      };
    } catch (e) {
      console.error("[slackGateway] lookupContractNumber failed:", e);
      return { __error: String(e) };
    }
  }

  // ── Slack 署名検証 ─────────────────────────────────────────────────
  const urlencodedWithRaw = express.urlencoded({
    extended: true,
    limit: "1mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  });

  function verifySlackSignature(req: any): boolean {
    if (!deps.signingSecret) {
      // GAS 時代は未検証だった。secret 未設定なら警告のみで通す
      // (SLACK_SIGNING_SECRET を env / app_settings に設定すれば有効化)。
      console.warn("[slackGateway] SLACK_SIGNING_SECRET unset — signature check skipped.");
      return true;
    }
    const ts = String(req.headers["x-slack-request-timestamp"] || "");
    const sig = String(req.headers["x-slack-signature"] || "");
    if (!ts || !sig) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const base = `v0:${ts}:${req.rawBody ? req.rawBody.toString("utf8") : ""}`;
    const mac =
      "v0=" +
      crypto.createHmac("sha256", deps.signingSecret).update(base).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig));
    } catch {
      return false;
    }
  }

  function selfBaseOf(req: express.Request): string {
    // Cloud Run は常に https。Slack が叩いてくる公開ホストをそのまま使う。
    return `https://${req.get("host")}`;
  }

  // ── slash commands ─────────────────────────────────────────────────
  app.post("/slack/commands", urlencodedWithRaw, async (req, res) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).send("invalid signature");
    }
    const params: any = req.body || {};
    const command = String(params.command || "");
    const selfBase = selfBaseOf(req);

    try {
      if (command === "/法務依頼") {
        const uploadEmail = await getStaffEmailBySlackId(String(params.user_id || ""));
        const opened = await slackApi("views.open", {
          trigger_id: params.trigger_id,
          view: getLegalRequestModal("legal_consult", { uploadEmail }, selfBase),
        });
        if (opened && opened.ok) return res.status(200).send("");
        return res.json({
          response_type: "ephemeral",
          text: "⚠️ 法務依頼フォームを開けませんでした。時間をおいて再度お試しください。",
        });
      }

      if (command === "/法務検索") {
        const allowListRaw = deps.allowedSearchChannelIds;
        if (allowListRaw && allowListRaw.trim() !== "") {
          const allowedIds = allowListRaw
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          const incoming = params.channel_id || "";
          if (allowedIds.indexOf(incoming) === -1) {
            return res.json({
              response_type: "ephemeral",
              text:
                "❌ `/法務検索` はこのチャンネルでは利用できません。\n" +
                "指定の法務専用チャンネルでお試しください。",
            });
          }
        }
        const initialKeyword = String(params.text || "").trim();
        const opened = await slackApi("views.open", {
          trigger_id: params.trigger_id,
          view: getLegalSearchModal(initialKeyword),
        });
        if (opened && opened.ok) return res.status(200).send("");
        return res.json({
          response_type: "ephemeral",
          text: "⚠️ 検索フォームを開けませんでした。時間をおいて再度お試しください。",
        });
      }

      return res.json({
        response_type: "ephemeral",
        text: `未対応のコマンドです: ${command}`,
      });
    } catch (e) {
      console.error("[slackGateway] /slack/commands failed:", e);
      return res.json({
        response_type: "ephemeral",
        text: "⚠️ 処理中にエラーが発生しました。時間をおいて再度お試しください。",
      });
    }
  });

  // ── interactivity (block_actions / view_submission) ────────────────
  app.post("/slack/interactivity", urlencodedWithRaw, async (req, res) => {
    if (!verifySlackSignature(req)) {
      return res.status(401).send("invalid signature");
    }
    let payload: any;
    try {
      payload = JSON.parse(String((req.body || {}).payload || "{}"));
    } catch {
      return res.status(400).json({ ok: false, error: "invalid payload" });
    }
    const selfBase = selfBaseOf(req);

    try {
      // 1. block_actions — 依頼種別変更 / 明細増減 / もう一度検索
      if (payload.type === "block_actions") {
        const action = (payload.actions || [])[0];

        if (action && action.action_id === "request_type_input") {
          const selected =
            (action.selected_option && action.selected_option.value) || "legal_consult";
          let candidates: any[] = [];
          if (selected === "delivery_inspec" || selected === "license_calc") {
            candidates = await fetchUserCandidates(payload.user.id, selected);
          } else if (selected === "deadline_change") {
            candidates = await fetchUserCandidates(payload.user.id, "any");
          }
          const uploadEmail =
            selected === "legal_consult"
              ? await getStaffEmailBySlackId(payload.user.id)
              : "";
          await slackApi("views.update", {
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: getLegalRequestModal(selected, { candidates, uploadEmail }, selfBase),
          });
        }

        if (action && (action.action_id === "li_add" || action.action_id === "li_remove")) {
          let liMeta: any = {};
          try {
            liMeta = JSON.parse(payload.view.private_metadata || "{}");
          } catch {
            liMeta = {};
          }
          let liCount = Number(liMeta.li_count) || 1;
          liCount = action.action_id === "li_add" ? liCount + 1 : liCount - 1;
          liCount = Math.max(1, Math.min(liCount, LINE_ITEM_MAX));

          const liState = payload.view.state && payload.view.state.values;
          const liType =
            (liState &&
              liState.request_type_block &&
              liState.request_type_block.request_type_input &&
              liState.request_type_block.request_type_input.selected_option &&
              liState.request_type_block.request_type_input.selected_option.value) ||
            "legal_consult";

          let liCandidates: any[] = [];
          if (liType === "delivery_inspec" || liType === "license_calc") {
            liCandidates = await fetchUserCandidates(payload.user.id, liType);
          }
          const liUploadEmail =
            liType === "legal_consult"
              ? await getStaffEmailBySlackId(payload.user.id)
              : "";

          await slackApi("views.update", {
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: getLegalRequestModal(
              liType,
              { candidates: liCandidates, liCount, uploadEmail: liUploadEmail },
              selfBase
            ),
          });
        }

        if (action && action.action_id === "legal_search_again") {
          await slackApi("views.update", {
            view_id: payload.view.id,
            hash: payload.view.hash,
            view: getLegalSearchModal(""),
          });
        }

        return res.json({ ok: true });
      }

      // 2. view_submission
      if (payload.type === "view_submission") {
        const callbackId = payload.view && payload.view.callback_id;

        if (callbackId === "legal_request_modal") {
          return await handleLegalRequestSubmission(payload, selfBase, res);
        }

        if (callbackId === "legal_search_modal") {
          const keyword =
            (payload.view.state.values.keyword_block &&
              payload.view.state.values.keyword_block.keyword_input.value) ||
            "";
          if (!keyword.trim()) {
            return res.json({
              response_action: "errors",
              errors: { keyword_block: "キーワードを入力してください。" },
            });
          }
          let contractData: any;
          try {
            contractData = await deps.searchContractStatus({
              counterpartyName: keyword,
              purposeCode: "",
            });
            if (contractData?.documentsByCategory) {
              await deps.enrichWithBacklogStatus(contractData);
            }
            if (Array.isArray(contractData?.results)) {
              for (const r of contractData.results) {
                if (r?.documentsByCategory) await deps.enrichWithBacklogStatus(r);
              }
            }
          } catch (e: any) {
            contractData = { __error: String(e?.message || e) };
          }
          return res.json({
            response_action: "update",
            view: getSearchResultsModal(
              keyword,
              { contract: contractData },
              selfBase,
              deps.backlogHost,
              deps.backlogProjectKey
            ),
          });
        }
      }

      return res.json({ ok: true });
    } catch (e) {
      console.error("[slackGateway] /slack/interactivity failed:", e);
      return res.json({ ok: true });
    }
  });

  // ── /法務依頼 view_submission 本体 ──────────────────────────────────
  async function handleLegalRequestSubmission(
    payload: any,
    selfBase: string,
    res: express.Response
  ): Promise<any> {
    const submission = parseLegalRequestSubmission(payload);

    // 納期変更依頼: 新規 Backlog 課題は起こさず worker へ
    if (submission.request_type === "deadline_change") {
      if (
        submission.target_issue_key_select &&
        submission.target_issue_key_select !== "__NEW__"
      ) {
        submission.target_issue_key = submission.target_issue_key_select;
      }
      const issueKey = String(submission.target_issue_key || "").trim().toUpperCase();
      const newDate = String(submission.new_delivery_date || "").trim();
      const reason = String(submission.change_reason || "").trim();

      if (!issueKey) {
        return res.json({
          response_action: "errors",
          errors: {
            target_issue_key_block:
              "対象 Backlog 課題キーを入力するか、上の候補から選択してください。",
          },
        });
      }
      if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
        return res.json({
          response_action: "errors",
          errors: { target_issue_key_block: "課題キーの形式が不正です (例: LEGAL-123)。" },
        });
      }
      if (!newDate) {
        return res.json({
          response_action: "errors",
          errors: { new_delivery_date_block: "新しい納期を指定してください。" },
        });
      }
      if (!reason) {
        return res.json({
          response_action: "errors",
          errors: { change_reason_block: "変更理由を入力してください。" },
        });
      }

      try {
        const result = await callWorkerSync("/api/intake/deadline-change-request", {
          slack_user_id: submission.slack_user_id,
          slack_user_name: submission.slack_user_name,
          dept: submission.dept,
          target_issue_key: issueKey,
          new_delivery_date: newDate,
          reason,
        });
        const createdKey = (result && result.issue_key) || "";
        void slackApi("chat.postMessage", {
          channel: submission.slack_user_id,
          text:
            "✅ *納期変更依頼を受け付けました*\n\n" +
            `*対象:* ${issueKey}\n*新しい納期:* ${newDate}\n*変更理由:* ${reason}\n` +
            (createdKey ? `*依頼課題:* ${createdKey}\n` : "") +
            "\n法務担当者が内容を確認後、admin-ui から実行されます。完了時に再度お知らせします。",
        });
        return res.json({
          response_action: "update",
          view: getSubmissionCompleteView({
            heading: "納期変更依頼を受け付けました",
            issueKey: createdKey || issueKey,
            requestType: "deadline_change",
            summary: `${issueKey} の納期を ${newDate} へ変更`,
            noteLines: [
              "法務担当者が内容を確認後に納期が変更されます。完了時に DM でお知らせします。",
            ],
          }),
        });
      } catch (e: any) {
        const msg = String(e?.message || e);
        notifyUserOfError(submission.slack_user_id, `納期変更依頼の起票に失敗しました: ${msg}`);
        return res.json({
          response_action: "push",
          view: getSubmissionErrorView(`納期変更依頼の起票に失敗しました: ${msg}`),
        });
      }
    }

    // 候補選択 (既存子課題への紐付け): worker link-trigger-run へ委譲
    if (
      (submission.request_type === "delivery_inspec" ||
        submission.request_type === "license_calc") &&
      submission.target_issue_key_select &&
      submission.target_issue_key_select !== "__NEW__"
    ) {
      const childKey = submission.target_issue_key_select;
      submission.line_items_text = formatLineItemsText(submission);
      dispatchWorker(
        "/api/intake/link-trigger-run",
        { ...submission, existing_issue_key: childKey },
        submission.slack_user_id,
        "既存課題への紐付け"
      );
      void slackApi("chat.postMessage", {
        channel: submission.slack_user_id,
        text:
          `⏳ *既存課題への紐付けを受け付けました*: ${childKey}\n` +
          "文書の作成処理が完了したら、改めてお知らせします。",
      });
      return res.json({
        response_action: "update",
        view: getSubmissionCompleteView({
          heading: "既存課題に紐付けて受け付けました",
          issueKey: childKey,
          requestType: submission.request_type,
          summary: submission.summary,
          noteLines: [
            "文書の作成処理を開始しました。完了時に DM でお知らせします。",
            "フォームの入力内容 (明細を含む) は対象課題のコメントに記録されます。",
          ],
        }),
      });
    }

    // 利用許諾計算書: 契約番号で対象を特定 (in-process lookup)
    if (submission.request_type === "license_calc") {
      const targetDocNo = String(submission.target_doc_number || "").trim();
      if (!targetDocNo) {
        return res.json({
          response_action: "errors",
          errors: {
            target_doc_number_block:
              "対象の発注書番号 / 契約書番号を入力してください（上の候補から選択した場合は不要です）。",
          },
        });
      }
      const looked = await lookupContractNumber(targetDocNo);
      if (!looked || looked.__error) {
        return res.json({
          response_action: "errors",
          errors: {
            target_doc_number_block:
              "番号の確認中にエラーが発生しました。時間をおいて再度お試しください。",
          },
        });
      }
      if (looked.found !== true) {
        return res.json({
          response_action: "errors",
          errors: {
            target_doc_number_block:
              "この番号の契約が見つかりません。「支払対象契約検索」ページで番号をご確認ください。",
          },
        });
      }
      submission.target_doc_number = looked.documentNumber || targetDocNo;
      submission.target_contract_title = looked.contractTitle || "";
      submission.counterparty = looked.vendorName || "";
      if (looked.vendorCode) submission.entity_id = looked.vendorCode;
      if (looked.entityType === "individual") submission.entity_type = "individual";
    }

    // 検収書: 明細ごとの契約番号に対応 (Phase 28.1)
    if (submission.request_type === "delivery_inspec") {
      const defaultDocNo = String(submission.target_doc_number || "").trim();
      const diItems = submission.line_items || [];

      const diErrors: Record<string, string> = {};
      const itemDocNos: string[] = [];
      for (let di = 0; di < diItems.length; di++) {
        const ownNo = String(diItems[di].target_doc_number || "").trim();
        const effNo = ownNo || defaultDocNo;
        if (!effNo) {
          diErrors[
            ownNo ? `li_${di + 1}_target_doc_number_block` : "target_doc_number_block"
          ] =
            "対象の発注書番号 / 契約書番号を入力してください（明細ごとに違う場合は各明細の「対象契約番号」へ）。";
        }
        itemDocNos.push(effNo);
      }
      if (diItems.length === 0 && !defaultDocNo) {
        diErrors["target_doc_number_block"] =
          "対象の発注書番号 / 契約書番号を入力してください（上の候補から選択した場合は不要です）。";
      }
      if (Object.keys(diErrors).length > 0) {
        return res.json({ response_action: "errors", errors: diErrors });
      }

      const nosToCheck = itemDocNos.length > 0 ? itemDocNos : [defaultDocNo];
      const uniqueNosToLookup = Array.from(new Set(nosToCheck));
      const lookups: Record<string, any> = {};
      await Promise.all(
        uniqueNosToLookup.map(async (n) => {
          lookups[n] = await lookupContractNumber(n);
        })
      );

      const diErrors2: Record<string, string> = {};
      for (let dj = 0; dj < nosToCheck.length; dj++) {
        const lr = lookups[nosToCheck[dj]];
        if (lr && lr.found === true) continue;
        const isOwn =
          diItems.length > 0 &&
          String(diItems[dj].target_doc_number || "").trim() !== "";
        const errBlock = isOwn
          ? `li_${dj + 1}_target_doc_number_block`
          : "target_doc_number_block";
        diErrors2[errBlock] =
          (lr && lr.__error
            ? "番号の確認中にエラーが発生しました。時間をおいて再度お試しください。"
            : "この番号の契約が見つかりません。「支払対象契約検索」ページで番号をご確認ください。") +
          ` [${nosToCheck[dj]}]`;
      }
      if (Object.keys(diErrors2).length > 0) {
        return res.json({ response_action: "errors", errors: diErrors2 });
      }

      const uniqueNos: string[] = [];
      const uniqueVendors: string[] = [];
      for (let dk = 0; dk < nosToCheck.length; dk++) {
        const hit = lookups[nosToCheck[dk]];
        const normNo = hit.documentNumber || nosToCheck[dk];
        if (uniqueNos.indexOf(normNo) === -1) uniqueNos.push(normNo);
        const vn = hit.vendorName || "";
        if (vn && uniqueVendors.indexOf(vn) === -1) uniqueVendors.push(vn);
        if (diItems[dk]) {
          diItems[dk].target_doc_number = normNo + (vn ? `（${vn}）` : "");
        }
      }

      const firstHit = lookups[nosToCheck[0]];
      if (uniqueNos.length === 1) {
        submission.target_doc_number = uniqueNos[0];
        submission.target_contract_title = firstHit.contractTitle || "";
        submission.counterparty = firstHit.vendorName || "";
        if (firstHit.vendorCode) submission.entity_id = firstHit.vendorCode;
        if (firstHit.entityType === "individual") submission.entity_type = "individual";
      } else {
        submission.multi_contract = true;
        submission.target_doc_number = `複数 (${uniqueNos.length}件 — 明細参照)`;
        submission.target_contract_title = "";
        submission.counterparty =
          uniqueVendors.length === 0
            ? ""
            : uniqueVendors.length === 1
              ? uniqueVendors[0]
              : `${uniqueVendors[0]} ほか${uniqueVendors.length - 1}社`;
        submission.entity_id = "";
      }
    }

    // 新規起票: worker create-run へ委譲し、即座に受付完了ビューを返す
    submission.line_items_text = formatLineItemsText(submission);
    submission.backlog_issue_type_name =
      REQUEST_TYPE_TO_BACKLOG_TYPE[submission.request_type] || "法務相談";
    // DM のアップロードリンク用 base。依頼者メールを署名に束縛して渡す
    // (worker が &issue=<課題番号> を追記する)。
    submission.upload_page_base = buildAttachmentUploadUrl(
      selfBase,
      undefined,
      await getStaffEmailBySlackId(submission.slack_user_id)
    );
    if (submission.multi_contract) submission.skip_pdf = true;

    dispatchWorker(
      "/api/intake/create-run",
      submission,
      submission.slack_user_id,
      "法務依頼の起票"
    );

    return res.json({
      response_action: "update",
      view: getSubmissionCompleteView({
        heading: "依頼を受け付けました",
        requestType: submission.request_type,
        summary: submission.summary,
        noteLines: [
          "課題番号を発行しています。発行され次第 DM でお知らせします" +
            " (資料アップロードページへのリンクも届きます)。",
        ],
      }),
    });
  }
}
