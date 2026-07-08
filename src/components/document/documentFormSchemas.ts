/**
 * documentFormSchemas — 各テンプレの入力フォーム スキーマ登録所。
 *
 * ここに登録されたテンプレは DocumentForm から SchemaDocumentForm へ委譲され、
 * 新デザイン(色付きカード + col チップ)で描画される。未登録テンプレは従来の
 * DocumentForm 分岐(旧デザイン)にフォールバックするので、段階移行が安全に行える。
 *
 * PDF テンプレは不変。スキーマはフィールドのキー名を一切変えない
 * (templates_config.json の変数キーをそのまま並べるだけ)。
 */
import { autoSectionsFromMetadata, type DocFormSchema, type FkCtx, type FkSectionSchema } from "./SchemaDocumentForm";
import { maintenanceSpecBuilder } from "./schemas/maintenanceSpec";
import { inspectionCertificateBuilder } from "./schemas/inspectionCertificate";
import { royaltyStatementBuilder } from "./schemas/royaltyStatement";
import { purchaseOrderBuilder } from "./schemas/purchaseOrder";

// group メタから順序付きの {group→fieldIds} を得る(hidden 除外)。
function groupList(metadata: any): { order: string[]; groups: Record<string, string[]> } {
  const vars = metadata?.vars || {};
  const groups: Record<string, string[]> = {};
  const order: string[] = [];
  Object.entries(vars).forEach(([id, m]: [string, any]) => {
    if (m?.hidden === true || m?.type === "hidden") return;
    const g = m?.group || "General";
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(id);
  });
  return { order, groups };
}
function groupFields(metadata: any, name: string): { fieldIds: string[] } {
  return { fieldIds: groupList(metadata).groups[name] || [] };
}
function restSections(metadata: any, exclude: string[]): FkSectionSchema[] {
  const { order, groups } = groupList(metadata);
  const ex = new Set(exclude);
  return order.filter((g) => !ex.has(g)).map((g) => ({ title: g, fieldIds: groups[g] }));
}

/** テンプレ → スキーマ生成関数。metadata から動的に組み立てる。 */
type SchemaBuilder = (metadata: any, ctx: FkCtx) => DocFormSchema;

// バッチ1: マスタ非依存 or 素直な group 構成の単票系。auto-section で新デザイン化。
//   (これまで DocumentForm の汎用フォールバックで描画されていたもの)
const AUTO: SchemaBuilder = (metadata) => ({ sections: autoSectionsFromMetadata(metadata) });

// 出版 基本契約(個人/法人): 冒頭に許諾者(取引先)の DB検索補完を置き、
//   選択で vendor.* にひも付く全フィールド(氏名/法人名/住所/代表者 等)を一括充填。
const pubMaster: SchemaBuilder = (metadata) => ({
  sections: [
    {
      title: "当事者 — 許諾者(取引先マスタ)",
      accent: "sky",
      searches: [
        {
          entity: "vendor",
          label: "許諾者を検索して充填",
          help: "取引先マスタから選ぶと、氏名/法人名・住所・代表者など(vendor.*)を自動入力します。",
          fillDbPrefix: "vendor.",
        },
      ],
    },
    ...autoSectionsFromMetadata(metadata),
  ],
});

// 法務相談 回答書: 担当者(法務)を DB検索補完で充填できるようにする。
const legalResponse: SchemaBuilder = (metadata) => ({
  sections: [
    {
      title: "担当者(法務)",
      accent: "sky",
      searches: [
        {
          entity: "staff",
          label: "担当者を検索して充填",
          help: "担当者マスタから選ぶと、担当者名など(staff.*)を自動入力します。",
          fillDbPrefix: "staff.",
        },
      ],
    },
    ...autoSectionsFromMetadata(metadata),
  ],
});

// --- バッチ2: 基本契約系 / NDA ------------------------------------------------
// 取引先(vendor)の生データ → 各テンプレの当事者キーへ写す小ヘルパ。
const vpick = (raw: any, map: Record<string, string>): Record<string, any> => {
  const p: Record<string, any> = {};
  for (const [k, src] of Object.entries(map)) {
    const v = raw?.[src];
    if (v !== undefined && v !== null && v !== "") p[k] = v;
  }
  return p;
};
const invoiceT = (raw: any) =>
  raw?.invoice_registration_number
    ? `T${String(raw.invoice_registration_number).replace(/^[TtＴｔ]\s*/, "").trim()}`
    : "";
// company(自社) 充填マップ(companyProfile のキー)。
const SELF3 = (name: string, addr: string, rep: string) => ({
  [name]: "name",
  [addr]: "address",
  [rep]: "representative",
});

// ライセンス基本契約: II. ライセンサー(許諾者=取引先, VENDOR_*) / III. ライセンシー(自社, PARTY_A_*)。
const licenseMaster: SchemaBuilder = (metadata) => ({
  sections: [
    { title: "I. ヘッダ", accent: "sky", ...groupFields(metadata, "I. ヘッダ") },
    {
      title: "II. ライセンサー(許諾者・取引先)",
      accent: "violet",
      searches: [{
        entity: "vendor",
        label: "許諾者(取引先)を検索して充填",
        help: "取引先マスタから選ぶと氏名・住所・代表者・口座・インボイスまで一括充填。",
        onPick: (opt) => ({
          ...vpick(opt.raw, {
            VENDOR_CODE: "vendor_code", VENDOR_NAME: "vendor_name", VENDOR_ADDRESS: "address",
            VENDOR_REP: "vendor_rep", VENDOR_PHONE: "phone", VENDOR_EMAIL: "email",
            BANK_NAME: "bank_name", BRANCH_NAME: "branch_name", ACCOUNT_TYPE: "account_type",
            ACCOUNT_NUMBER: "account_number", ACCOUNT_HOLDER_KANA: "account_holder_kana",
          }),
          VENDOR_REP: opt.raw?.vendor_rep || opt.raw?.contact_name || "",
          IS_INVOICE_ISSUER: !!opt.raw?.is_invoice_issuer,
          invoiceRegistrationDisplay: invoiceT(opt.raw),
        }),
      }],
      ...groupFields(metadata, "II. ライセンサー (許諾者)"),
    },
    {
      title: "III. ライセンシー(被許諾者・自社)",
      accent: "sky",
      selfFills: [{ label: "自社を充填", map: SELF3("PARTY_A_NAME", "PARTY_A_ADDRESS", "PARTY_A_REP") }],
      ...groupFields(metadata, "III. ライセンシー (被許諾者)"),
    },
    ...restSections(metadata, ["I. ヘッダ", "II. ライセンサー (許諾者)", "III. ライセンシー (被許諾者)"]),
  ],
});

// 業務委託基本契約: II. 甲(委託者=自社) / III. 乙(受託者=取引先, VENDOR_*)。
const serviceMaster: SchemaBuilder = (metadata) => ({
  sections: [
    { title: "I. 契約締結日", accent: "sky", ...groupFields(metadata, "I. 契約締結日") },
    {
      title: "II. 甲(委託者・自社)",
      accent: "sky",
      selfFills: [{ label: "自社を充填", map: SELF3("PARTY_A_NAME", "PARTY_A_ADDRESS", "PARTY_A_REP") }],
      ...groupFields(metadata, "II. 甲 (委託者)"),
    },
    {
      title: "III. 乙(受託者・取引先)",
      accent: "violet",
      searches: [{
        entity: "vendor",
        label: "受託者(取引先)を検索して充填",
        onPick: (opt) => ({
          ...vpick(opt.raw, {
            VENDOR_NAME: "vendor_name", VENDOR_ADDRESS: "address",
            BANK_NAME: "bank_name", BRANCH_NAME: "branch_name", ACCOUNT_TYPE: "account_type",
            ACCOUNT_NUMBER: "account_number", ACCOUNT_HOLDER_KANA: "account_holder_kana",
          }),
          VENDOR_REP: opt.raw?.vendor_rep || opt.raw?.contact_name || "",
          VENDOR_IS_CORPORATION: (opt.raw?.entity_type || "").toLowerCase() === "corporate",
          IS_INVOICE_ISSUER: !!opt.raw?.is_invoice_issuer,
          invoiceRegistrationDisplay: invoiceT(opt.raw),
        }),
      }],
      ...groupFields(metadata, "III. 乙 (受託者)"),
    },
    ...restSections(metadata, ["I. 契約締結日", "II. 甲 (委託者)", "III. 乙 (受託者)"]),
  ],
});

// NDA: II. 甲(取引先側, PARTY_A_*) / III. 乙(自社想定, PARTY_B_*)。
const nda: SchemaBuilder = (metadata) => ({
  sections: [
    { title: "I. ヘッダ", accent: "sky", ...groupFields(metadata, "I. ヘッダ") },
    {
      title: "II. 甲(取引先)",
      accent: "violet",
      searches: [{
        entity: "vendor",
        label: "甲(取引先)を検索して充填",
        onPick: (opt) => ({
          PARTY_A_NAME: opt.raw?.vendor_name || "",
          PARTY_A_ADDRESS: opt.raw?.address || "",
          PARTY_A_REP: opt.raw?.vendor_rep || opt.raw?.contact_name || "",
        }),
      }],
      ...groupFields(metadata, "II. 甲 (取引先側)"),
    },
    {
      title: "III. 乙(自社)",
      accent: "sky",
      selfFills: [{ label: "自社を充填", map: SELF3("PARTY_B_NAME", "PARTY_B_ADDRESS", "PARTY_B_REP") }],
      ...groupFields(metadata, "III. 乙 (自社想定)"),
    },
    ...restSections(metadata, ["I. ヘッダ", "II. 甲 (取引先側)", "III. 乙 (自社想定)"]),
  ],
});

// 売買基本契約(買/売/掛): 相手方は PARTY_B_*(売主 or 買主=取引先)。II. で始まる当事者グループを検出。
const salesMaster: SchemaBuilder = (metadata) => {
  const { order } = groupList(metadata);
  const partyGroup = order.find((g) => /^II\./.test(g)) || "II. 乙 (売主・取引先)";
  return {
    sections: [
      { title: "I. ヘッダ", accent: "sky", ...groupFields(metadata, "I. ヘッダ") },
      {
        title: partyGroup,
        accent: "violet",
        searches: [{
          entity: "vendor",
          label: "取引先を検索して充填",
          help: "取引先マスタから相手方(売主/買主)を選ぶと氏名・住所・代表者を充填。",
          onPick: (opt) => ({
            PARTY_B_NAME: opt.raw?.vendor_name || "",
            PARTY_B_ADDRESS: opt.raw?.address || "",
            PARTY_B_REPRESENTATIVE: opt.raw?.vendor_rep || opt.raw?.contact_name || "",
          }),
        }],
        ...groupFields(metadata, partyGroup),
      },
      ...restSections(metadata, ["I. ヘッダ", partyGroup]),
    ],
  };
};

// バッチ3(先行): 海外発注書。CONTRACTOR(委託先=取引先)/担当者を検索補完、自社は selfFill。
//   ※ 明細は単一フィールド(ITEM_NAME/PAYMENT_METHOD)のため多行テーブルの custom は不要。
const intlPurchaseOrder: SchemaBuilder = (metadata) => ({
  sections: [
    {
      title: "Basic Context (基本情報)",
      accent: "sky",
      searches: [
        {
          entity: "vendor",
          label: "委託先(Contractor)を検索して充填",
          onPick: (opt) => {
            const isCorp = String(opt.raw?.entity_type || "").toLowerCase() === "corporate" || opt.raw?.entity_type === "法人";
            return {
              CONTRACTOR_NAME: isCorp ? (opt.raw?.vendor_name || "") : (opt.raw?.vendor_name || opt.raw?.pen_name || opt.raw?.trade_name || ""),
              CONTRACTOR_ADDRESS: opt.raw?.address || "",
              CONTRACTOR_EMAIL: opt.raw?.email || "",
            };
          },
        },
        {
          entity: "staff",
          label: "担当者を検索して充填",
          onPick: (opt) => ({
            STAFF_NAME: opt.raw?.staff_name || "",
            STAFF_DEPARTMENT: opt.raw?.department || "",
            STAFF_PHONE: opt.raw?.phone || "",
            STAFF_EMAIL: opt.raw?.email || "",
          }),
        },
      ],
      selfFills: [{ label: "自社を充填", map: { COMPANY_NAME: "name", COMPANY_ADDRESS: "address", COMPANY_REP: "representative" } }],
      ...groupFields(metadata, "Basic Context (基本情報)"),
    },
    ...restSections(metadata, ["Basic Context (基本情報)"]),
  ],
});

const REGISTRY: Record<string, SchemaBuilder> = {
  // 単票・同意書系
  legal_response: legalResponse,
  notice_consent_personal_info_freelance: AUTO,
  // 出版 基本契約(個人/法人): 当事者=許諾者↔アークライト。取引先を検索補完で充填。
  pub_master_individual: pubMaster,
  pub_master_corporate: pubMaster,
  // バッチ2: 基本契約系 / NDA(当事者に取引先の検索補完 + 自社充填)
  license_master: licenseMaster,
  service_master: serviceMaster,
  nda: nda,
  sales_master_buyer: salesMaster,
  sales_master_standard: salesMaster,
  sales_master_credit: salesMaster,
  // バッチ3(先行): 海外発注書。国内発注書/検収書は明細連動が重いため別途 custom で移行。
  intl_purchase_order: intlPurchaseOrder,
  // バッチ5: 保守仕様書(別紙)。動的配列エディタは custom section で再利用。
  maintenance_spec: (metadata) => maintenanceSpecBuilder(metadata),
  // バッチ6: 検収書。独自レイアウト全体を bare セクションで移設(旧 per-template 分岐と等価)。
  inspection_certificate: (metadata) => inspectionCertificateBuilder(metadata),
  // バッチ7: 利用許諾料計算書。独自レイアウト＋3 effects を bare セクション/モジュールへ移設。
  royalty_statement: (metadata) => royaltyStatementBuilder(metadata),
  // バッチ8: 発注書。独自レイアウトを bare セクションへ移設(明細サマリ集計 effect は
  //   intl 発注書と共有のため DocumentForm に残す)。
  purchase_order: (metadata) => purchaseOrderBuilder(metadata),
};

export function isSchemaMigrated(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, templateId);
}

export function buildDocFormSchema(templateId: string, metadata: any, ctx: FkCtx): DocFormSchema | null {
  const b = REGISTRY[templateId];
  return b ? b(metadata, ctx) : null;
}
