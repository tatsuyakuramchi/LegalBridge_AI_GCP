/**
 * 作品詳細タブ section の共通 presentational ヘルパ（8タブ移行 Phase 6）。
 *
 * 旧 WorkGraphPanel 内に閉じていた表示専用の定数・小コンポーネント（KindBadge / yen /
 * matDisplay / EdgeRow / 選択肢定数）を、複数タブ section から共有できるよう切り出す。
 * ロジック（state / fetch）は持たない。データは呼び出し側が context から渡す。
 */
import * as React from "react"
import { Globe } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EntityCombobox } from "@/src/components/form"
import type { Edge } from "@/src/pages/works/WorkDetailContext"

export type { Edge }

export const KIND_META: Record<string, { label: string; cls: string }> = {
  license: { label: "利用許諾", cls: "border-primary/40 text-primary" },
  product: { label: "物販", cls: "border-info/40 text-info" },
  service: { label: "委託", cls: "border-warning/40 text-warning" },
}
export const KindBadge = ({ kind }: { kind: string | null }) => {
  const m = kind ? KIND_META[kind] : null
  return m ? <Badge variant="outline" className={m.cls}>{m.label}</Badge> : null
}
export const yen = (v: any) => (v == null || v === "" ? "" : `¥${Number(v).toLocaleString("ja-JP")}`)

// マテリアル表示名: 「{コード} {原作名}　{マテリアル名}」。原作名が無い文脈では「{コード} {マテリアル名}」。
export const matDisplay = (code?: string | null, srcTitle?: string | null, name?: string | null) =>
  (srcTitle
    ? `${code || "—"} ${srcTitle}　${name || ""}`
    : `${code || "—"} ${name || ""}`
  ).trimEnd()

// 作品(own)基本情報インライン編集の選択肢（WorkModelPanel と同一）。
export const WORK_TYPES = ["board_game", "trpg_book", "supplement", "digital"]
export const WORK_STATUS = ["planning", "in_production", "released", "suspended", "discontinued"]
// UIC-13(段階A): 派生種別。
export const DERIV_CHOICES: [string, string][] = [
  ["", "(なし・原版)"],
  ["translation", "翻訳"],
  ["edition", "版"],
  ["title_change", "改題"],
  ["localization", "地域化"],
  ["adaptation", "翻案"],
]
export const DERIV_LABEL: Record<string, string> = Object.fromEntries(DERIV_CHOICES)

export const inlineInputCls =
  "w-full text-[11px] font-mono border-b border-input bg-transparent py-1 focus:outline-none focus:border-foreground"

export function EdgeRow({
  e,
  side,
  materials,
  products,
  sourceWorks,
  onLink,
}: {
  e: Edge
  side: "up" | "down"
  materials: any[]
  products: any[]
  sourceWorks: any[]
  onLink: (edgeId: number, patch: any) => void
}) {
  const node =
    side === "up"
      ? e.source_material_code
        ? `${e.source_material_code} ${e.source_material_name || ""}`
        : e.source_work_code
          ? `${e.source_work_code} ${e.source_work_title || ""}`
          : ""
      : e.product_code
        ? `${e.product_code} ${e.product_name || ""}`
        : ""
  return (
    <div className="border border-border rounded-md px-2.5 py-2 text-[11px] font-mono space-y-1 bg-card">
      <div className="flex items-center gap-1.5 flex-wrap">
        <KindBadge kind={e.transaction_kind} />
        <span className="font-semibold truncate">{e.subject || e.line_code || `#${e.id}`}</span>
      </div>
      {node && <div className="text-muted-foreground truncate">◦ {node}</div>}
      <div className="flex items-center gap-2 text-muted-foreground">
        {e.counterparty && <span className="truncate">{e.counterparty}</span>}
        {e.payment_scheme === "royalty"
          ? e.rate_pct && <span>{e.rate_pct}%</span>
          : e.amount_ex_tax && <span>{yen(e.amount_ex_tax)}</span>}
      </div>
      {/* ④' 許諾地域: 個別条件書の condition_line から引用(読み取り専用)。 */}
      {e.territory_label && (
        <div
          className="flex items-center gap-1 text-[10px] text-muted-foreground/80"
          title="許諾地域・言語（個別条件書の条件明細から引用）"
        >
          <Globe className="h-3 w-3 shrink-0" />
          <span className="truncate">{e.territory_label}</span>
        </div>
      )}
      {e.document_number && (
        <div className="text-[10px] text-muted-foreground/70 truncate">{e.document_number}</div>
      )}
      {side === "up" ? (
        <div className="space-y-1">
          {/* 支払エッジを原作(source_work_id)へ参照リンク */}
          <select
            value={e.source_work_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_work_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を原作に紐付け"
          >
            <option value="">— 原作に紐付け —</option>
            {sourceWorks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.source_code || s.work_code || "—"} {s.title}
              </option>
            ))}
          </select>
          <select
            value={e.source_material_id ?? ""}
            onChange={(ev) => onLink(e.id, { source_material_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この支払を素材に紐付け"
          >
            <option value="">— 素材に紐付け —</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.material_code || "—"} {m.material_name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="space-y-1">
          {/* 受取エッジを受取先(取引先)へ参照リンク。共通 EntityCombobox。 */}
          <EntityCombobox
            entity="vendor"
            value={e.counterparty_vendor_id != null ? String(e.counterparty_vendor_id) : null}
            onSelect={(opt) =>
              onLink(e.id, { counterparty_vendor_id: opt ? Number(opt.id) : null })
            }
            placeholder="受取先(取引先)に紐付け"
          />
          <select
            value={e.product_id ?? ""}
            onChange={(ev) => onLink(e.id, { product_id: ev.target.value ? Number(ev.target.value) : null })}
            className="w-full text-[10px] font-mono border-b border-input bg-transparent py-0.5"
            title="この受取を製品に紐付け"
          >
            <option value="">— 製品に紐付け —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.product_code || "—"} {p.product_name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
