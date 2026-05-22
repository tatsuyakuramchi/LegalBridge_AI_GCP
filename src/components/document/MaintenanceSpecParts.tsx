/**
 * MaintenanceSpecParts — 保守仕様書 (別紙) 用の動的編集パーツ群 (Phase 22.21.55)
 *
 * 各動的配列を編集する小型テーブルエディタの集合。
 * すべて pure controlled component で、親 (DocumentForm) が formData の対応 key
 * を渡し、onChange で配列まるごと書き換える。
 *
 *   scopeItems         : 月額保守スコープ一覧
 *   handoverItems      : 初月の引継ぎ残課題一覧
 *   milestones         : 業務開始マイルストーン一覧
 *   responsibilityRows : 責任分担表
 *   scopeOutItems      : スコープ外項目 (文字列配列)
 *
 * フォームの構造はテンプレ準拠で、保存値は document.form_data に JSON で
 * そのまま入る (DB に正規化テーブルを作らない方針 — Phase 22.21.55 設計)。
 */

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

/* ────────────────────────────────────────────────────────────────────
   共通 input セル — 他の dynamic table と同じ視覚スタイル
   ──────────────────────────────────────────────────────────────────── */
const cellInput = (
  value: string | number | undefined,
  onChange: (v: string) => void,
  placeholder?: string,
  type: "text" | "number" = "text"
) => (
  <input
    type={type}
    value={value === undefined || value === null ? "" : String(value)}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className={cn(
      "w-full text-[11px] font-mono bg-transparent",
      "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
      "placeholder:text-muted-foreground/40 placeholder:text-[10px]"
    )}
  />
)

const cellTextarea = (
  value: string | undefined,
  onChange: (v: string) => void,
  placeholder?: string
) => (
  <textarea
    value={value === undefined || value === null ? "" : String(value)}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    rows={2}
    className={cn(
      "w-full text-[11px] font-mono bg-transparent resize-y",
      "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
      "placeholder:text-muted-foreground/40 placeholder:text-[10px]",
      "max-h-[100px]"
    )}
  />
)

const addBtn = (label: string, onClick: () => void) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider",
      "border border-foreground/40 rounded-sm hover:bg-muted transition-colors"
    )}
  >
    <Plus className="h-3 w-3" />
    {label}
  </button>
)

const delBtn = (onClick: () => void) => (
  <button
    type="button"
    onClick={onClick}
    title="この行を削除"
    className="inline-flex items-center justify-center p-1 text-muted-foreground hover:text-destructive transition-colors"
  >
    <Trash2 className="h-3 w-3" />
  </button>
)

/* ────────────────────────────────────────────────────────────────────
   1. scopeItems  — 月額保守スコープ
   { category, content, note }
   ──────────────────────────────────────────────────────────────────── */

export type ScopeItem = { category: string; content: string; note?: string }

export const ScopeItemsTable: React.FC<{
  items: ScopeItem[]
  onChange: (next: ScopeItem[]) => void
}> = ({ items, onChange }) => {
  const update = (idx: number, patch: Partial<ScopeItem>) => {
    const next = items.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
            <th className="text-left p-2 w-44">区分</th>
            <th className="text-left p-2">主な対応内容</th>
            <th className="text-left p-2 w-60">注記 (任意)</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-3 text-center text-muted-foreground italic">
                スコープ項目がありません。下の「行追加」から開始。
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={`scope-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-2 align-top">
                  {cellInput(it.category, (v) => update(idx, { category: v }), "例: 軽微な修正")}
                </td>
                <td className="p-2 align-top">
                  {cellTextarea(it.content, (v) => update(idx, { content: v }), "対応内容を記入")}
                </td>
                <td className="p-2 align-top">
                  {cellInput(it.note, (v) => update(idx, { note: v }), "(任意)")}
                </td>
                <td className="p-2 align-top text-right">
                  {delBtn(() => onChange(items.filter((_, i) => i !== idx)))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div>
        {addBtn("行追加", () =>
          onChange([...items, { category: "", content: "", note: "" }])
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   2. handoverItems  — 引継ぎ残課題
   { item, note }
   ──────────────────────────────────────────────────────────────────── */

export type HandoverItem = { item: string; note?: string }

export const HandoverItemsTable: React.FC<{
  items: HandoverItem[]
  onChange: (next: HandoverItem[]) => void
}> = ({ items, onChange }) => {
  const update = (idx: number, patch: Partial<HandoverItem>) => {
    const next = items.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
            <th className="text-left p-2">残課題</th>
            <th className="text-left p-2 w-72">注記 (任意)</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="p-3 text-center text-muted-foreground italic">
                引継ぎ残課題がありません。
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={`ho-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-2 align-top">
                  {cellInput(it.item, (v) => update(idx, { item: v }), "例: スマホ表示のレイアウト崩れ修正")}
                </td>
                <td className="p-2 align-top">
                  {cellInput(it.note, (v) => update(idx, { note: v }), "(任意)")}
                </td>
                <td className="p-2 align-top text-right">
                  {delBtn(() => onChange(items.filter((_, i) => i !== idx)))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div>
        {addBtn("行追加", () =>
          onChange([...items, { item: "", note: "" }])
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   3. milestones  — マイルストーン
   { title, description }
   ──────────────────────────────────────────────────────────────────── */

export type Milestone = { title: string; description: string }

export const MilestonesTable: React.FC<{
  items: Milestone[]
  onChange: (next: Milestone[]) => void
}> = ({ items, onChange }) => {
  const update = (idx: number, patch: Partial<Milestone>) => {
    const next = items.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
            <th className="w-8 p-2">#</th>
            <th className="text-left p-2 w-56">タイトル</th>
            <th className="text-left p-2">説明</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-3 text-center text-muted-foreground italic">
                マイルストーンがありません。
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={`ms-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 align-top">
                  {cellInput(it.title, (v) => update(idx, { title: v }), "例: 環境引継ぎ")}
                </td>
                <td className="p-2 align-top">
                  {cellTextarea(it.description, (v) => update(idx, { description: v }), "例: AWS / CMS / リポジトリ権限を受領")}
                </td>
                <td className="p-2 align-top text-right">
                  {delBtn(() => onChange(items.filter((_, i) => i !== idx)))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div>
        {addBtn("行追加", () =>
          onChange([...items, { title: "", description: "" }])
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   4. responsibilityRows  — 責任分担
   { item, party_a, party_b }
   ──────────────────────────────────────────────────────────────────── */

export type ResponsibilityRow = { item: string; party_a: string; party_b: string }

export const ResponsibilityTable: React.FC<{
  items: ResponsibilityRow[]
  onChange: (next: ResponsibilityRow[]) => void
}> = ({ items, onChange }) => {
  const update = (idx: number, patch: Partial<ResponsibilityRow>) => {
    const next = items.slice()
    next[idx] = { ...next[idx], ...patch }
    onChange(next)
  }
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
            <th className="text-left p-2">業務項目</th>
            <th className="text-left p-2 w-32">発注者 (甲)</th>
            <th className="text-left p-2 w-32">受注者 (乙)</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-3 text-center text-muted-foreground italic">
                責任分担行がありません。
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={`resp-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-2 align-top">
                  {cellInput(it.item, (v) => update(idx, { item: v }), "例: コンテンツ更新")}
                </td>
                <td className="p-2 align-top">
                  {cellInput(it.party_a, (v) => update(idx, { party_a: v }), "○ / △ / -")}
                </td>
                <td className="p-2 align-top">
                  {cellInput(it.party_b, (v) => update(idx, { party_b: v }), "○ / △ / -")}
                </td>
                <td className="p-2 align-top text-right">
                  {delBtn(() => onChange(items.filter((_, i) => i !== idx)))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div>
        {addBtn("行追加", () =>
          onChange([...items, { item: "", party_a: "", party_b: "" }])
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   5. scopeOutItems  — スコープ外 (文字列配列)
   string[]
   ──────────────────────────────────────────────────────────────────── */

export const ScopeOutList: React.FC<{
  items: string[]
  onChange: (next: string[]) => void
}> = ({ items, onChange }) => {
  return (
    <div className="space-y-2">
      <table className="w-full text-[11px] font-mono border-collapse">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-[10px] uppercase tracking-wider">
            <th className="w-8 p-2">#</th>
            <th className="text-left p-2">スコープ外項目</th>
            <th className="w-8 p-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="p-3 text-center text-muted-foreground italic">
                スコープ外項目がありません。
              </td>
            </tr>
          ) : (
            items.map((it, idx) => (
              <tr key={`so-${idx}`} className="border-b border-border/50 hover:bg-muted/20">
                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                <td className="p-2 align-top">
                  {cellInput(
                    it,
                    (v) => {
                      const next = items.slice()
                      next[idx] = v
                      onChange(next)
                    },
                    "例: 新規機能開発・大規模リファクタリング"
                  )}
                </td>
                <td className="p-2 align-top text-right">
                  {delBtn(() => onChange(items.filter((_, i) => i !== idx)))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <div>
        {addBtn("行追加", () => onChange([...items, ""]))}
      </div>
    </div>
  )
}
