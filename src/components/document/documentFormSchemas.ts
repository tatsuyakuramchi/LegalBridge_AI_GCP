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

const REGISTRY: Record<string, SchemaBuilder> = {
  // 単票・同意書系
  legal_response: AUTO,
  notice_consent_personal_info_freelance: AUTO,
  // 出版 基本契約(個人/法人): 当事者=許諾者↔アークライト。DB補完(取引先/自社)で充填。
  pub_master_individual: AUTO,
  pub_master_corporate: AUTO,
};

export function isSchemaMigrated(templateId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, templateId);
}

export function buildDocFormSchema(templateId: string, metadata: any, ctx: FkCtx): DocFormSchema | null {
  const b = REGISTRY[templateId];
  return b ? b(metadata, ctx) : null;
}
