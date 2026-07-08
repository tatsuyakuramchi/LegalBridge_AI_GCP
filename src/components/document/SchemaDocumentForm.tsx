/**
 * SchemaDocumentForm — 設定駆動の文書入力フォーム。
 *
 * 巨大な per-template JSX(DocumentForm の if 分岐)を、宣言的なセクション
 * スキーマ + 共通プリミティブ(DocFormKit)へ置き換える器。
 *
 * 重要契約: PDF テンプレ(Handlebars)は不変。よって
 *   - フィールドの値/キーは templates_config.json と FormField をそのまま使う
 *     (このフォームは formData のキー名を一切変えない)。
 *   - 特殊 UI(マスタ検索・条件表・v3マトリクス 等)は custom セクションで差し込む。
 */
import * as React from "react";
import { DbFillBar, FkSection, FkGrid, FkField, FkSearchRow, FK_ACCENTS, type FkAccent, type FkSearch } from "./formkit/DocFormKit";

export type FkCtx = {
  templateId: string;
  metadata: any;
  formData: any;
  setFormData: (d: any) => void;
  activeVendor?: any;
  companyProfile?: any;
  selectedStaff?: any;
  onSync?: () => void;
};

export type FkSectionSchema = {
  /** 見出し。省略時は group をそのまま使う。 */
  title?: string;
  accent?: FkAccent;
  subtitle?: string;
  actions?: React.ReactNode;
  /** マスタDB検索補完(担当者/取引先/原作/原作マテリアル/作品)。fieldIds より前に描画。 */
  searches?: FkSearch[];
  /** 自社(companyProfile)からの充填ボタン。map: 充填先formDataキー → companyProfile のキー。 */
  selfFills?: Array<{ label?: string; map: Record<string, string> }>;
  /** 任意セクション: <details> で折りたたむ(既定は閉じた状態)。 */
  collapsible?: boolean;
  /** このセクションに載せるフィールド(templates_config の変数キー)。 */
  fieldIds?: string[];
  /** 特殊 UI を差し込む(条件表・マスタ検索 等)。searches の後・fieldIds の前に描画。 */
  custom?: (ctx: FkCtx) => React.ReactNode;
};

export type DocFormSchema = {
  /** DB補完バー(取引先/自社/Staff + Backlog Sync)を出すか。既定 true。 */
  fillBar?: boolean;
  sections: FkSectionSchema[];
};

const leadNum = (s: string) => {
  const m = /^\s*(\d+)/.exec(s || "");
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/** templates_config の group メタから、数字プレフィックス昇順でセクションを自動生成。 */
export function autoSectionsFromMetadata(metadata: any): FkSectionSchema[] {
  const vars: Record<string, any> = metadata?.vars || {};
  const groups: Record<string, string[]> = {};
  const order: string[] = [];
  Object.entries(vars).forEach(([id, meta]: [string, any]) => {
    if (meta?.hidden === true || meta?.type === "hidden") return;
    const g = meta?.group || "General (基本共通)";
    if (!groups[g]) { groups[g] = []; order.push(g); }
    groups[g].push(id);
  });
  return order
    .sort((a, b) => leadNum(a) - leadNum(b))
    .map((g) => ({ title: g, fieldIds: groups[g] }));
}

export function SchemaDocumentForm(props: FkCtx & { schema: DocFormSchema }) {
  const { schema, ...ctx } = props;
  const showFill = schema.fillBar !== false;
  return (
    <div className="space-y-5">
      {showFill && (
        <DbFillBar
          metadata={ctx.metadata}
          formData={ctx.formData}
          setFormData={ctx.setFormData}
          activeVendor={ctx.activeVendor}
          companyProfile={ctx.companyProfile}
          selectedStaff={ctx.selectedStaff}
          onSync={ctx.onSync}
        />
      )}
      {schema.sections.map((sec, i) => {
        const fields = (sec.fieldIds || []).filter((id) => (ctx.metadata?.vars || {})[id] != null || true);
        const selfBtns = (sec.selfFills || []).length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            {sec.selfFills!.map((sf, si) => (
              <button
                key={si}
                type="button"
                disabled={!ctx.companyProfile}
                onClick={() => {
                  const cp = ctx.companyProfile || {};
                  const patch: Record<string, any> = {};
                  Object.entries(sf.map).forEach(([k, src]) => {
                    const v = cp[src];
                    if (v !== undefined && v !== null && v !== "") patch[k] = v;
                  });
                  if (Object.keys(patch).length) ctx.setFormData({ ...ctx.formData, ...patch });
                }}
                title={ctx.companyProfile ? "自社(企業プロフィール)から充填" : "企業プロフィール未設定"}
                className="text-[10px] font-mono border border-border px-2 py-0.5 uppercase rounded disabled:opacity-40 hover:bg-muted"
              >
                {sf.label || "自社を充填"}
              </button>
            ))}
          </span>
        );
        const actions = sec.actions || selfBtns ? (
          <span className="flex items-center gap-2">{sec.actions}{selfBtns}</span>
        ) : undefined;
        const inner = (
          <>
            {sec.searches && sec.searches.length > 0 && (
              <div className="space-y-3">
                {sec.searches.map((sr, si) => (
                  <FkSearchRow
                    key={`${sr.entity}:${si}`}
                    search={sr}
                    metadata={ctx.metadata}
                    formData={ctx.formData}
                    setFormData={ctx.setFormData}
                  />
                ))}
              </div>
            )}
            {sec.custom && sec.custom(ctx)}
            {fields.length > 0 && (
              <FkGrid>
                {fields.map((id) => (
                  <FkField key={id} id={id} metadata={ctx.metadata} formData={ctx.formData} setFormData={ctx.setFormData} />
                ))}
              </FkGrid>
            )}
          </>
        );
        const accent = sec.accent || FK_ACCENTS[i % FK_ACCENTS.length];
        if (sec.collapsible) {
          return (
            <details key={sec.title || i} className="rounded-xl border border-border border-t-[3px] border-t-border bg-card overflow-hidden">
              <summary className="cursor-pointer select-none px-5 py-3 font-mono text-[12px] font-bold text-muted-foreground hover:text-foreground">
                ▶ {sec.title || `セクション ${i + 1}`}（任意）
              </summary>
              <div className="px-5 pb-5 pt-1 space-y-4">{inner}</div>
            </details>
          );
        }
        return (
          <FkSection
            key={sec.title || i}
            title={sec.title || `セクション ${i + 1}`}
            accent={accent}
            subtitle={sec.subtitle}
            actions={actions}
          >
            {inner}
          </FkSection>
        );
      })}
    </div>
  );
}
