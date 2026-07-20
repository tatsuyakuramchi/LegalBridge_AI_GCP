/**
 * sublicenseOutTerms — 再許諾条件書 (sublicense_out_terms) の入力フォーム。
 *
 * 編集入口の一本化: 契約レスの再許諾条件(condition_kind='sublicense_out')は、従来
 * SublicenseConditionPanel が直接 CRUD していたが、条件データの入力口を「文書作成
 * フォーム」に一本化する。本フォームで被許諾者・対象作品・再許諾元(親 license_in)・
 * 対価条件(FinancialConditionTable: 許諾地域/言語含む)を入力し、生成時に worker の
 * /generate(sublicense_out_terms 分岐)が upsertMasterContract 経由で condition_lines
 * (direction=receivable / condition_kind='sublicense_out')を作成する。
 *
 * SchemaDocumentForm 経由で描画する。独自レイアウトのため単一 bare セクションで差し込む。
 */
import * as React from "react"
import { FormSection } from "../FormSection"
import { WorkPicker, toWorkPickerItem } from "@/src/components/work/WorkPicker"
import { EntitySearchSelect } from "../../search/EntitySearch"
import { FkField } from "../formkit/DocFormKit"
import {
  FinancialConditionTable,
  type FinancialCondition,
} from "../FinancialConditionTable"
import type { DocFormSchema, FkCtx } from "../SchemaDocumentForm"
import { Building2, User, Coins, BookMarked, Link2 } from "lucide-react"

type CondRow = {
  id: number
  condition_no?: number | null
  region_language_label?: string | null
  rate_pct?: any
  calc_type?: string | null
}

const SublicenseOutTermsForm: React.FC<{ ctx: FkCtx }> = ({ ctx }) => {
  const { metadata, formData, setFormData, activeVendor, worksList = [] } = ctx

  // group メタ → {group → fieldIds}
  const groupedVars = React.useMemo(() => {
    const groups: Record<string, string[]> = {}
    Object.entries(metadata?.vars || {}).forEach(([id, meta]: [string, any]) => {
      const g = meta?.group || "General"
      if (!groups[g]) groups[g] = []
      groups[g].push(id)
    })
    return groups
  }, [metadata])

  const renderField = (id: string, customLabel?: string) => (
    <FkField
      key={id}
      id={id}
      metadata={metadata}
      formData={formData}
      setFormData={setFormData}
      labelOverride={customLabel}
    />
  )
  // hidden 項目(ID 保持用)は自前描画しない。
  const renderGroup = (group: string) =>
    (groupedVars[group] || [])
      .filter((id) => (metadata?.vars?.[id]?.type || "") !== "hidden")
      .map((id) => renderField(id))

  const patch = (p: Record<string, any>) => setFormData({ ...formData, ...p })

  // 被許諾者(サブライセンシー)を取引先マスタから充填。
  const fillSublicensee = (raw: any) => {
    if (!raw) return
    const isCorp =
      (raw.entity_type || "").toLowerCase() === "corporate" ||
      (raw.entity_type || "") === "法人"
    patch({
      被許諾者名: raw.vendor_name || raw.trade_name || "",
      被許諾者住所: raw.address || "",
      被許諾者種別: isCorp ? "法人" : "個人",
      被許諾者取引先ID: raw.id != null ? Number(raw.id) : "",
      counterparty_vendor_id: raw.id != null ? Number(raw.id) : "",
    })
  }

  // 対象作品(自社作品)を選択 → 対象作品ID/名 を充填。
  const workItems = React.useMemo(
    () => (worksList as any[]).filter((w) => w?.title).map((w) => toWorkPickerItem(w)),
    [worksList]
  )
  const onPickWork = (item: { id: string; title?: string } | null) => {
    if (!item) {
      patch({ 対象作品ID: "", source_work_id: "", 親ライセンス条件ID: "", 親ライセンス表示: "" })
      return
    }
    patch({
      対象作品ID: item.id,
      source_work_id: item.id,
      対象作品名: item.title || formData.対象作品名 || "",
      // 作品が変わったら親ライセンス選択はリセット。
      親ライセンス条件ID: "",
      親ライセンス表示: "",
    })
  }

  // 再許諾元(親 license_in 条件)候補: 対象作品の条件から license_in を抽出。
  const [parentConds, setParentConds] = React.useState<CondRow[]>([])
  const workId = formData.対象作品ID || formData.source_work_id || ""
  React.useEffect(() => {
    let aborted = false
    if (!workId) {
      setParentConds([])
      return
    }
    ;(async () => {
      try {
        const r = await fetch(`/api/v3/works/${encodeURIComponent(String(workId))}/conditions`)
        const rows = await r.json()
        if (aborted) return
        const list = (Array.isArray(rows) ? rows : []).filter(
          (c: any) => (c.condition_kind || "") === "license_in"
        )
        setParentConds(list)
      } catch {
        if (!aborted) setParentConds([])
      }
    })()
    return () => {
      aborted = true
    }
  }, [workId])

  const conditions: FinancialCondition[] = Array.isArray(formData.financial_conditions)
    ? (formData.financial_conditions as FinancialCondition[])
    : []

  return (
    <div className="space-y-8">
      <FormSection title="I. 基本情報" icon={<BookMarked className="w-4 h-4" />}>
        {renderGroup("I. 基本情報")}
      </FormSection>

      <FormSection
        title="II. 被許諾者 (サブライセンシー)"
        variant="amber"
        icon={<User className="w-4 h-4" />}
        headerActions={
          activeVendor ? (
            <button
              type="button"
              className="retro-btn text-[10px] px-2 py-1"
              onClick={() => fillSublicensee(activeVendor)}
            >
              取引先を充填
            </button>
          ) : null
        }
      >
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            取引先を検索して被許諾者を充填（DB検索補完）
          </label>
          <EntitySearchSelect
            entity="vendor"
            onSelect={(o) => o && fillSublicensee(o.raw)}
            placeholder="取引先を検索（名称 / コード）"
          />
        </div>
        {renderGroup("II. 被許諾者")}
      </FormSection>

      <FormSection title="III. 対象作品" variant="blue" icon={<Building2 className="w-4 h-4" />}>
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            対象作品(自社作品)を選択
          </label>
          <WorkPicker items={workItems} value={String(workId || "")} onSelect={onPickWork} />
        </div>
        {renderGroup("III. 対象作品")}
      </FormSection>

      <FormSection title="IV. 再許諾元 (親ライセンス)" icon={<Link2 className="w-4 h-4" />}>
        <div className="col-span-full space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            再許諾元の利用許諾条件 (license_in)（任意）
          </label>
          {!workId ? (
            <p className="text-[11px] text-muted-foreground">
              先に対象作品を選択すると、その作品の許諾(license_in)条件から選べます。
            </p>
          ) : (
            <select
              className="w-full text-[12px] font-mono border-b border-input py-1.5 bg-transparent focus:outline-none focus:border-foreground transition-colors"
              value={String(formData.親ライセンス条件ID || "")}
              onChange={(e) => {
                const id = e.target.value
                const sel = parentConds.find((c) => String(c.id) === id)
                patch({
                  親ライセンス条件ID: id || "",
                  親ライセンス表示: sel
                    ? `#${sel.condition_no ?? ""} ${sel.region_language_label || ""}`.trim()
                    : "",
                })
              }}
            >
              <option value="">（指定しない）</option>
              {parentConds.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  #{c.condition_no ?? ""} {c.region_language_label || "(無題)"}
                  {c.rate_pct != null ? ` / ${c.rate_pct}%` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
      </FormSection>

      <FormSection title="V. 対価・条件 (再許諾)" variant="blue" icon={<Coins className="w-4 h-4" />}>
        <div className="col-span-full">
          <FinancialConditionTable
            conditions={conditions}
            onChange={(next) => patch({ financial_conditions: next })}
          />
          <p className="mt-2 text-[10.5px] text-muted-foreground">
            当社が受け取る再許諾(sublicense_out)条件です。料率/MG/AG・許諾地域・許諾言語を入力してください。
          </p>
        </div>
      </FormSection>
    </div>
  )
}

export function sublicenseOutTermsBuilder(_metadata: any): DocFormSchema {
  return {
    sections: [
      {
        title: "再許諾条件書",
        bare: true,
        custom: (ctx: FkCtx) => <SublicenseOutTermsForm ctx={ctx} />,
      },
    ],
  }
}
