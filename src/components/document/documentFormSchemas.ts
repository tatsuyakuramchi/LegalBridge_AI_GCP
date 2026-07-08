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
import { autoSectionsFromMetadata, type DocFormSchema, type FkCtx } from "./SchemaDocumentForm";

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

const REGISTRY: Record<string, SchemaBuilder> = {
  // 単票・同意書系
  legal_response: legalResponse,
  notice_consent_personal_info_freelance: AUTO,
  // 出版 基本契約(個人/法人): 当事者=許諾者↔アークライト。取引先を検索補完で充填。
  pub_master_individual: pubMaster,
  pub_master_corporate: pubMaster,
};

export function isSchemaMigrated(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, templateId);
}

export function buildDocFormSchema(templateId: string, metadata: any, ctx: FkCtx): DocFormSchema | null {
  const b = REGISTRY[templateId];
  return b ? b(metadata, ctx) : null;
}
