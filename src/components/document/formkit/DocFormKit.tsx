/**
 * DocFormKit — 文書入力フォームの新デザイン共通プリミティブ。
 *
 * 目的: 19テンプレの入力フォームを、PubLicenseEntryPanel と同じ
 *   「色付き上ボーダーのカード + セクション見出し + col チップ付きフィールド」
 *   の意匠へ統一する。PDF テンプレ(Handlebars)は不変のため、フィールドの
 *   値・キーは既存の FormField / templates_config.json をそのまま使う。
 *
 * ここは「見た目の器」だけを提供し、フィールド描画は既存 <FormField> に委譲する。
 */
import * as React from "react";
import { Database } from "lucide-react";
import { FormField } from "../FormField";

// セクションのアクセント色(上ボーダー/見出し)。順に循環させて視覚的リズムを作る。
export const FK_ACCENTS = ["sky", "violet", "emerald", "indigo", "amber", "rose"] as const;
export type FkAccent = (typeof FK_ACCENTS)[number];

const ACCENT_TOP: Record<FkAccent, string> = {
  sky: "border-t-sky-500",
  violet: "border-t-violet-500",
  emerald: "border-t-emerald-500",
  indigo: "border-t-indigo-500",
  amber: "border-t-amber-500",
  rose: "border-t-rose-500",
};
const ACCENT_TEXT: Record<FkAccent, string> = {
  sky: "text-sky-600",
  violet: "text-violet-600",
  emerald: "text-emerald-600",
  indigo: "text-indigo-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
};

/** 色付き上ボーダーのセクションカード。 */
export interface FkSectionProps {
  title: string;
  accent?: FkAccent | undefined;
  subtitle?: string | undefined;
  actions?: React.ReactNode | undefined;
  children: React.ReactNode;
}
export const FkSection: React.FC<FkSectionProps> = (props) => {
  const accent = props.accent || "sky";
  return (
    <div className={`rounded-xl border border-border border-t-[3px] ${ACCENT_TOP[accent]} bg-card p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h4 className={`font-mono text-[13px] font-bold ${ACCENT_TEXT[accent]}`}>{props.title}</h4>
          {props.subtitle && (
            <p className="font-mono text-[9.5px] text-muted-foreground leading-snug mt-1">{props.subtitle}</p>
          )}
        </div>
        {props.actions}
      </div>
      {props.children}
    </div>
  );
};

/** セクション内のフィールドグリッド(2カラム、textarea 等は自動で全幅)。 */
export const FkGrid: React.FC<{ children: React.ReactNode }> = (props) => {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">{props.children}</div>;
};

/**
 * DB補完バー: metadata の dbField(vendor./company./staff.) を持つフォームで、
 *   取引先・自社・担当者マスタから一括補完 + Backlog Sync。
 *   ロジックは DocumentForm の fillByPrefix と同一(汎用)。
 */
export function DbFillBar(props: {
  metadata: any;
  formData: any;
  setFormData: (d: any) => void;
  activeVendor?: any;
  companyProfile?: any;
  selectedStaff?: any;
  onSync?: () => void;
}) {
  const metaVars: Record<string, any> = props.metadata?.vars || {};
  const dbFieldOf = (id: string) => String(metaVars[id]?.dbField || "");
  const hasPrefix = (p: string) => Object.keys(metaVars).some((id) => dbFieldOf(id).startsWith(p));
  const resolveDbValue = (dbField: string): any => {
    const dot = dbField.indexOf(".");
    if (dot < 0) return undefined;
    const src = dbField.slice(0, dot);
    const key = dbField.slice(dot + 1);
    if (src === "vendor") return props.activeVendor ? props.activeVendor[key] : undefined;
    if (src === "staff") return props.selectedStaff ? props.selectedStaff[key] : undefined;
    if (src === "company") {
      if (!props.companyProfile) return undefined;
      const alias: Record<string, string> = { rep: "representative" };
      return props.companyProfile[alias[key] || key];
    }
    return undefined;
  };
  const fillByPrefix = (prefix: string) => {
    const patch: Record<string, any> = {};
    Object.keys(metaVars).forEach((id) => {
      const f = dbFieldOf(id);
      if (!f.startsWith(prefix)) return;
      const v = resolveDbValue(f);
      if (v !== undefined && v !== null && v !== "") patch[id] = v;
    });
    if (Object.keys(patch).length > 0) props.setFormData({ ...props.formData, ...patch });
  };
  const btn = (label: string, onClick: () => void, disabled: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "上部バーで対象 (取引先 / 担当者) を選択してください" : `${label} マスタから一括補完`}
      className="text-[10px] font-mono border border-border px-2 py-0.5 uppercase rounded disabled:opacity-40 hover:bg-muted"
    >
      {label}
    </button>
  );
  const hasVendor = hasPrefix("vendor.");
  const hasCompany = hasPrefix("company.");
  const hasStaff = hasPrefix("staff.");
  if (!hasVendor && !hasCompany && !hasStaff && !props.onSync) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">DB 補完</span>
      {hasVendor && btn("取引先", () => fillByPrefix("vendor."), !props.activeVendor)}
      {hasCompany && btn("自社", () => fillByPrefix("company."), !props.companyProfile)}
      {hasStaff && btn("Sync Staff", () => fillByPrefix("staff."), !props.selectedStaff)}
      {props.onSync && (
        <button
          type="button"
          onClick={props.onSync}
          className="text-[10px] font-mono bg-blue-600 text-white px-2 py-0.5 uppercase rounded flex items-center gap-1 ml-auto"
        >
          <Database className="w-2 h-2" /> Backlog Sync
        </button>
      )}
    </div>
  );
}

/** metadata の 1 フィールドを FormField で描画(値・キーは既存契約のまま)。 */
export interface FkFieldProps {
  id: string;
  metadata: any;
  formData: any;
  setFormData: (d: any) => void;
  labelOverride?: string | undefined;
}
export const FkField: React.FC<FkFieldProps> = (props) => {
  const meta = (props.metadata?.vars || {})[props.id] || { label: props.id, group: "General" };
  const label = props.labelOverride || meta.label || props.id.replace(/_/g, " ");
  return (
    <FormField
      id={props.id}
      meta={{ ...meta, label }}
      value={props.formData[props.id]}
      onChange={(v) => props.setFormData({ ...props.formData, [props.id]: v })}
    />
  );
};
