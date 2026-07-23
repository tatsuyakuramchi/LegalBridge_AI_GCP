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

// PDF(maintenance_spec)の第7〜9条の条番号を算出する。
//   第1〜5条は固定。第6条(初月)以降は存在するセクションだけを連番。
//   ※ services/worker/server.ts の computeMaintenanceArticleNos と同一ロジック。
//     PDF と入力フォームで条番号が一致するよう両者を揃えること。
function articleNos(fd: any): {
  milestone?: number
  responsibility?: number
  scopeOut?: number
} {
  const nonEmpty = (v: any) => Array.isArray(v) && v.length > 0
  let n = 5
  if (fd?.firstMonthSection) n += 1 // 第6条 初月(任意)
  const o: { milestone?: number; responsibility?: number; scopeOut?: number } = {}
  if (nonEmpty(fd?.milestones)) o.milestone = n += 1
  if (nonEmpty(fd?.responsibilityRows)) o.responsibility = n += 1
  if (nonEmpty(fd?.scopeOutItems)) o.scopeOut = n += 1
  return o
}

// 動的セクションの「第N条」バッジ。項目があれば採番結果、無ければ採番前の案内を出す。
const ArticleBadge: React.FC<{ no?: number }> = ({ no }) =>
  no ? (
    <span className="inline-block text-[11px] font-mono font-bold px-2 py-0.5 rounded-sm bg-foreground text-background">
      第{no}条
    </span>
  ) : (
    <span className="text-[10px] text-muted-foreground">
      ※ 項目を1つ以上追加すると、前のセクションからの続き番号で自動採番されます
    </span>
  )

export function maintenanceSpecBuilder(metadata: any): DocFormSchema {
  const sec = (title: string, group: string, accent?: any): FkSectionSchema => ({
    title,
    accent,
    fieldIds: gfields(metadata, group),
  })
  return {
    // セクションの見出しは PDF の条番号(第N条)に揃える。旧版はローマ数字(I〜IX)で
    //   PDF の条番号とずれており「今どの条を入力しているか」が分かりにくかった。
    //   並び順も PDF に合わせ、第2条(保守スコープ)を第1条の直後へ移動。
    sections: [
      {
        title: "ヘッダ（対象案件・当事者）",
        accent: "sky",
        // 取引先を検索して受託者名(VENDOR_NAME)を充填。法人=正式商号 / 個人=屋号・筆名・氏名。
        searches: [
          {
            entity: "vendor",
            label: "取引先を検索して受託者名を充填",
            onPick: (opt) => {
              const v = opt.raw || {}
              const isCorp = String(v.entity_type || "").toLowerCase() === "corporate" || v.entity_type === "法人"
              return {
                VENDOR_NAME: isCorp ? v.vendor_name || "" : v.vendor_name || v.pen_name || v.trade_name || "",
                // 取引先マスタ参照を id で確定(名称照合フォールバックに依存しない)。
                VENDOR_ID: v.id ?? "",
                VENDOR_CODE: v.vendor_code || "",
              }
            },
          },
        ],
        selfFills: [{ label: "自社を充填", map: { PARTY_A_NAME: "name" } }],
        custom: (ctx) => <ParentPoLookup ctx={ctx} />,
        fieldIds: gfields(metadata, "I. ヘッダ"),
      },
      sec("第1条　月額稼働の構成", "II. 月額稼働の構成", "violet"),
      {
        title: "第2条　月額保守に含まれる対応内容（スコープ）",
        accent: "indigo",
        custom: (ctx) => arrayEditor(ctx, "scopeItems", MaintenanceSpecParts.ScopeItemsTable),
      },
      sec("第3条　通常保守の対応時間", "III. 通常保守", "emerald"),
      sec("第4条　障害発生時の対応時間・連絡ルート", "IV. 障害対応", "amber"),
      {
        title: "第4条　SLA（重大度別 目標復旧時間）",
        subtitle: "第4条の一部です",
        accent: "amber",
        fieldIds: gfields(metadata, "IV-2. SLA 重大度"),
      },
      sec("第5条　時間外の費用", "V. 時間外費用", "sky"),
      {
        title: "第6条　初月の対応範囲",
        collapsible: true,
        fieldIds: gfields(metadata, "VI. 初月対応 (任意)"),
        custom: (ctx) =>
          arrayEditor(
            ctx,
            "handoverItems",
            MaintenanceSpecParts.HandoverItemsTable,
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">引継ぎ残課題</div>
          ),
      },
      {
        title: "発注後の業務開始手順（マイルストーン）",
        collapsible: true,
        fieldIds: gfields(metadata, "VII. マイルストーン (任意)"),
        custom: (ctx) =>
          arrayEditor(
            ctx,
            "milestones",
            MaintenanceSpecParts.MilestonesTable,
            <ArticleBadge no={articleNos(ctx.formData).milestone} />
          ),
      },
      {
        title: "責任分担",
        collapsible: true,
        fieldIds: gfields(metadata, "VIII. 責任分担 (任意)"),
        custom: (ctx) =>
          arrayEditor(
            ctx,
            "responsibilityRows",
            MaintenanceSpecParts.ResponsibilityTable,
            <ArticleBadge no={articleNos(ctx.formData).responsibility} />
          ),
      },
      {
        title: "月額保守スコープ外（別途見積）",
        collapsible: true,
        fieldIds: gfields(metadata, "IX. スコープ外 (任意)"),
        custom: (ctx) =>
          arrayEditor(
            ctx,
            "scopeOutItems",
            MaintenanceSpecParts.ScopeOutList,
            <ArticleBadge no={articleNos(ctx.formData).scopeOut} />
          ),
      },
    ],
  }
}
