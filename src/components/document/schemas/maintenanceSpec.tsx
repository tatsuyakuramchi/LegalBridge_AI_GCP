/**
 * maintenanceSpec — システム保守仕様書(別紙) の入力スキーマ。
 *
 * SchemaDocumentForm 用のビルダー。スカラ群は fieldIds、親PO検索と動的配列エディタ
 * (MaintenanceSpecParts)は custom セクションで差し込む。旧 DocumentForm 分岐と等価。
 * formData のキー(scopeItems/handoverItems/… や VENDOR_NAME 等)は不変(PDF不変)。
 */
import * as React from "react"
import * as MaintenanceSpecParts from "../MaintenanceSpecParts"
import { DocumentNumberLookup } from "../DocumentNumberLookup"
import type { DocFormSchema, FkCtx, FkSectionSchema } from "../SchemaDocumentForm"

// metadata から group 名でフィールドキー配列を取得(挿入順=templates_config 順)。
function gfields(metadata: any, name: string): string[] {
  const vars = metadata?.vars || {}
  return Object.keys(vars).filter(
    (k) => (vars[k]?.group || "") === name && vars[k]?.hidden !== true && vars[k]?.type !== "hidden"
  )
}

// 親発注書検索(ORDER_NO を手入力せずアーカイブから引いてヘッダを一括反映)。
const ParentPoLookup: React.FC<{ ctx: FkCtx }> = ({ ctx }) => (
  <div className="col-span-full mb-1">
    <DocumentNumberLookup
      label="親発注書をアーカイブから検索 (部分一致 / 空欄で最新一覧)"
      placeholder="例: ARC-PO-2026-0001 / 株式会社X / 通訳"
      initialQuery={ctx.formData.ORDER_NO || ""}
      filterTemplateTypes={["purchase_order", "intl_purchase_order"]}
      onApply={(doc: any) => {
        const fd = doc.form_data || {}
        ctx.setFormData({
          ...ctx.formData,
          ORDER_NO: doc.document_number,
          PROJECT_TITLE: ctx.formData.PROJECT_TITLE || fd.PROJECT_TITLE || "",
          PARTY_A_NAME: ctx.formData.PARTY_A_NAME || fd.PARTY_A_NAME || "",
          VENDOR_NAME: ctx.formData.VENDOR_NAME || fd.VENDOR_NAME || "",
        })
      }}
    />
  </div>
)

// 動的配列エディタ(scopeItems 等)を1つ描画する共通ラッパ。
const arrayEditor = (ctx: FkCtx, key: string, Comp: any, extra?: React.ReactNode) => (
  <div className="col-span-full space-y-2">
    {extra}
    <Comp
      items={Array.isArray(ctx.formData[key]) ? ctx.formData[key] : []}
      onChange={(next: any) => ctx.setFormData({ ...ctx.formData, [key]: next })}
    />
  </div>
)

export function maintenanceSpecBuilder(metadata: any): DocFormSchema {
  const sec = (title: string, group: string, accent?: any): FkSectionSchema => ({
    title,
    accent,
    fieldIds: gfields(metadata, group),
  })
  return {
    sections: [
      {
        title: "I. ヘッダ",
        accent: "sky",
        // 取引先を検索して受託者名(VENDOR_NAME)を充填。法人=正式商号 / 個人=屋号・筆名・氏名。
        searches: [
          {
            entity: "vendor",
            label: "取引先を検索して受託者名を充填",
            onPick: (opt) => {
              const v = opt.raw || {}
              const isCorp = String(v.entity_type || "").toLowerCase() === "corporate" || v.entity_type === "法人"
              return { VENDOR_NAME: isCorp ? v.vendor_name || "" : v.vendor_name || v.pen_name || v.trade_name || "" }
            },
          },
        ],
        selfFills: [{ label: "自社を充填", map: { PARTY_A_NAME: "name" } }],
        custom: (ctx) => <ParentPoLookup ctx={ctx} />,
        fieldIds: gfields(metadata, "I. ヘッダ"),
      },
      sec("II. 月額稼働の構成", "II. 月額稼働の構成", "violet"),
      sec("III. 通常保守", "III. 通常保守", "emerald"),
      sec("IV. 障害対応", "IV. 障害対応", "amber"),
      sec("IV-2. SLA 重大度", "IV-2. SLA 重大度", "amber"),
      sec("V. 時間外費用", "V. 時間外費用", "sky"),
      {
        title: "第2条 保守スコープ（動的）",
        accent: "indigo",
        custom: (ctx) => arrayEditor(ctx, "scopeItems", MaintenanceSpecParts.ScopeItemsTable),
      },
      {
        title: "VI. 初月対応",
        collapsible: true,
        fieldIds: gfields(metadata, "VI. 初月対応 (任意)"),
        custom: (ctx) =>
          arrayEditor(
            ctx,
            "handoverItems",
            MaintenanceSpecParts.HandoverItemsTable,
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">引継ぎ残課題</div>
          ),
      },
      {
        title: "VII. マイルストーン",
        collapsible: true,
        fieldIds: gfields(metadata, "VII. マイルストーン (任意)"),
        custom: (ctx) => arrayEditor(ctx, "milestones", MaintenanceSpecParts.MilestonesTable),
      },
      {
        title: "VIII. 責任分担",
        collapsible: true,
        fieldIds: gfields(metadata, "VIII. 責任分担 (任意)"),
        custom: (ctx) => arrayEditor(ctx, "responsibilityRows", MaintenanceSpecParts.ResponsibilityTable),
      },
      {
        title: "IX. スコープ外",
        collapsible: true,
        fieldIds: gfields(metadata, "IX. スコープ外 (任意)"),
        custom: (ctx) => arrayEditor(ctx, "scopeOutItems", MaintenanceSpecParts.ScopeOutList),
      },
    ],
  }
}
