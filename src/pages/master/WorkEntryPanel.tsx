/**
 * WorkEntryPanel — 自社作品(works, kind=own)と原作(source_ips = works kind=licensed_in)の登録・編集。
 *
 * 入口は「検索が先」: まず既存を検索して選ぶ(→編集) か、無ければ「新規作成」(→登録)。
 * 既存作品の重複登録を防ぎ、試験データの手直しをそのままできる。
 *   - 原作    : GET/POST/PUT /api/v3/source-ips
 *   - 自社作品: GET/POST/PUT /api/v3/works
 * コード列(source_code / work_code)は空欄で自動採番・不変。権利元は VendorSearchSelect で ID 検索。
 */

import * as React from "react"
import { Loader2, Plus, Pencil, X, Search, Trash2 } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { WorkPicker, toWorkPickerItem, type WorkPickerItem } from "@/src/components/work/WorkPicker"

const DIVISIONS: Array<{ v: string; label: string }> = [
  { v: "BDG", label: "BDG（ボードゲーム）" },
  { v: "PUB", label: "PUB（出版）" },
]
const WORK_TYPES = ["board_game", "trpg_book", "supplement", "digital"]
const STATUSES = ["planning", "in_production", "released", "suspended", "discontinued"]

const selCls =
  "w-full h-8 rounded-md border border-border bg-background px-2.5 text-[12px] font-mono focus:outline-none focus:ring-1 focus:ring-ring"

const toArray = (s: string): string[] => s.split(/[,\n、]/).map((x) => x.trim()).filter(Boolean)

function Field(props: { label: string; col?: string; help?: string; req?: boolean; auto?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline gap-2 flex-wrap">
        <label className="font-mono text-[11px] font-bold">{props.label}</label>
        {props.req && <span className="text-[10px] font-mono font-bold text-rose-600">*必須</span>}
        {props.col && (
          <span className="font-mono text-[8.5px] text-muted-foreground border border-border rounded px-1 bg-muted/40">{props.col}</span>
        )}
        {props.auto && <span className="font-mono text-[8.5px] text-amber-600 border border-amber-500 rounded px-1">空欄で自動採番</span>}
      </div>
      {props.help && <p className="font-mono text-[9.5px] text-muted-foreground leading-snug">{props.help}</p>}
      {props.children}
    </div>
  )
}

export function WorkEntryPanel() {
  const { vendors, showNotification } = useAppData() as any
  const [mode, setMode] = React.useState<"own" | "source">("source")
  const [saving, setSaving] = React.useState(false)

  // 検索ゲート
  const [list, setList] = React.useState<any[]>([])
  const [listLoading, setListLoading] = React.useState(false)
  const [pickerVal, setPickerVal] = React.useState<string>("")
  const [view, setView] = React.useState<"gate" | "form">("gate")
  const [editingId, setEditingId] = React.useState<number | null>(null)
  const [editingCode, setEditingCode] = React.useState<string>("")

  // 共通
  const [code, setCode] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [titleKana, setTitleKana] = React.useState("")
  const [altTitles, setAltTitles] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  // 自社作品
  const [division, setDivision] = React.useState<string[]>([])
  const [workType, setWorkType] = React.useState("board_game")
  const [status, setStatus] = React.useState("in_production")
  const [originRingiId, setOriginRingiId] = React.useState("")
  // 原作
  const [vendorCode, setVendorCode] = React.useState("")
  const [vendorId, setVendorId] = React.useState<number | null>(null)
  const [originalPublisher, setOriginalPublisher] = React.useState("")
  const [defaultRightsHolder, setDefaultRightsHolder] = React.useState("")
  const [defaultCreditDisplay, setDefaultCreditDisplay] = React.useState("")
  const [defaultWorkSupplement, setDefaultWorkSupplement] = React.useState("")
  const [defaultApprovalTarget, setDefaultApprovalTarget] = React.useState("")
  const [defaultApprovalTiming, setDefaultApprovalTiming] = React.useState("")

  const endpoint = mode === "own" ? "/api/v3/works" : "/api/v3/source-ips"

  const loadList = React.useCallback(async (m: "own" | "source") => {
    setListLoading(true)
    try {
      const r = await fetch(m === "own" ? "/api/v3/works" : "/api/v3/source-ips")
      const d = await r.json()
      setList(Array.isArray(d) ? d : [])
    } catch {
      setList([])
    } finally {
      setListLoading(false)
    }
  }, [])

  React.useEffect(() => { loadList(mode) }, [mode, loadList])

  const pickerItems: WorkPickerItem[] = React.useMemo(
    () =>
      list.map((s) =>
        toWorkPickerItem(s, {
          code: s.source_code || s.work_code,
          sub: mode === "own" ? (s.work_type || "own") : "原作",
        })
      ),
    [list, mode]
  )

  const clearFields = () => {
    setCode(""); setTitle(""); setTitleKana(""); setAltTitles(""); setRemarks("")
    setDivision([]); setWorkType("board_game"); setStatus("in_production"); setOriginRingiId("")
    setVendorCode(""); setVendorId(null); setOriginalPublisher(""); setDefaultRightsHolder("")
    setDefaultCreditDisplay(""); setDefaultWorkSupplement(""); setDefaultApprovalTarget(""); setDefaultApprovalTiming("")
  }

  const backToGate = () => {
    setView("gate"); setEditingId(null); setEditingCode(""); setPickerVal(""); clearFields()
  }

  // 原作の安全削除。参照(条件明細/文書)ありは 409 → 強制確認。成功後は一覧(gate)へ戻る。
  const deleteSource = async (force = false) => {
    if (!editingId) return
    try {
      const url = `/api/v3/source-ips/${editingId}${force ? "?force=true" : ""}`
      const r = await fetch(url, { method: "DELETE" })
      if (r.status === 409) {
        const info = await r.json().catch(() => ({} as any))
        const msg =
          `原作「${editingCode}」は参照中です:\n` +
          `・マテリアル: ${info.materials ?? 0} 件\n` +
          `・条件明細: ${info.condition_lines ?? 0} 件\n` +
          `・文書(スナップショット): ${info.documents ?? 0} 件\n\n` +
          `強制削除しますか？（マテリアル・条件明細・カテゴリ・台帳も一緒に削除＝不可逆。文書スナップショットは残ります）`
        if (!window.confirm(msg)) return
        return deleteSource(true)
      }
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `HTTP ${r.status}`)
      }
      const j = await r.json()
      showNotification?.(
        `原作を削除しました: ${editingCode}${j.deleted_materials ? `（マテリアル ${j.deleted_materials} / 条件明細 ${j.deleted_condition_lines} も削除）` : ""}`,
        "success"
      )
      await loadList("source")
      backToGate()
    } catch (e: any) {
      showNotification?.(`削除に失敗: ${String(e?.message || e)}`, "error")
    }
  }

  const switchMode = (m: "own" | "source") => {
    setMode(m); setView("gate"); setEditingId(null); setEditingCode(""); setPickerVal(""); clearFields()
  }

  const startNew = () => {
    clearFields(); setEditingId(null); setEditingCode(""); setView("form")
  }

  const startEdit = (row: any) => {
    clearFields()
    setEditingId(row.id)
    setEditingCode(row.source_code || row.work_code || "")
    setCode(row.source_code || row.work_code || "")
    setTitle(row.title || "")
    setTitleKana(row.title_kana || "")
    setAltTitles(Array.isArray(row.alternative_titles) ? row.alternative_titles.join(", ") : "")
    setRemarks(row.remarks || "")
    setDivision(Array.isArray(row.division) ? row.division : [])
    if (mode === "own") {
      setWorkType(row.work_type || "board_game")
      setStatus(row.status || "in_production")
      setOriginRingiId(row.origin_ringi_id != null ? String(row.origin_ringi_id) : "")
    } else {
      setVendorId(row.rights_holder_vendor_id ?? null)
      setVendorCode("")
      setOriginalPublisher(row.original_publisher || "")
      setDefaultRightsHolder(row.default_rights_holder || "")
      setDefaultCreditDisplay(row.default_credit_display || "")
      setDefaultWorkSupplement(row.default_work_supplement || "")
      setDefaultApprovalTarget(row.default_approval_target || "")
      setDefaultApprovalTiming(row.default_approval_timing || "")
    }
    setView("form")
  }

  const toggleDivision = (v: string) =>
    setDivision((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))

  const submit = async () => {
    if (!title.trim()) return showNotification?.("タイトルを入力してください。", "error")
    if (mode === "own" && originRingiId && !/^\d+$/.test(originRingiId.trim())) {
      return showNotification?.("起案稟議IDは数値で入力してください。", "error")
    }
    setSaving(true)
    try {
      const body: Record<string, any> =
        mode === "own"
          ? {
              title: title.trim(),
              title_kana: titleKana.trim() || undefined,
              alternative_titles: toArray(altTitles),
              division,
              work_type: workType,
              status,
              origin_ringi_id: originRingiId.trim() ? Number(originRingiId.trim()) : undefined,
              remarks: remarks.trim() || undefined,
            }
          : {
              title: title.trim(),
              title_kana: titleKana.trim() || undefined,
              alternative_titles: toArray(altTitles),
              rights_holder_vendor_id: vendorId ?? undefined,
              original_publisher: originalPublisher.trim() || undefined,
              default_rights_holder: defaultRightsHolder.trim() || undefined,
              default_credit_display: defaultCreditDisplay.trim() || undefined,
              default_work_supplement: defaultWorkSupplement.trim() || undefined,
              default_approval_target: defaultApprovalTarget.trim() || undefined,
              default_approval_timing: defaultApprovalTiming.trim() || undefined,
              remarks: remarks.trim() || undefined,
            }
      if (!editingId && mode === "own") body.work_code = code.trim() || undefined
      if (!editingId && mode === "source") body.source_code = code.trim() || undefined

      const url = editingId ? `${endpoint}/${editingId}` : endpoint
      const r = await fetch(url, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e?.error || `保存に失敗 (HTTP ${r.status})`)
      }
      const row = await r.json()
      const label = `${row.source_code || row.work_code} ${row.title}`
      showNotification?.(
        editingId
          ? `更新しました: ${label}`
          : mode === "source"
            ? `原作を登録しました: ${label}（本体素材 ${row.source_code || row.work_code}-001 を自動生成）`
            : `自社作品を登録しました: ${label}`,
        "success"
      )
      await loadList(mode)
      backToGate()
    } catch (e: any) {
      showNotification?.(String(e?.message || e), "error")
    } finally {
      setSaving(false)
    }
  }

  const entityLabel = mode === "own" ? "自社作品" : "原作"

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="retro-tag mb-1.5">MST · WORK ENTRY</p>
        <h3 className="text-lg font-mono font-bold">作品 / 原作 登録・編集</h3>
        <p className="text-xs font-mono text-muted-foreground mt-1">
          まず検索して既存を選ぶ(→編集) か、無ければ新規作成(→登録)。コードは空欄で自動採番・不変。
        </p>
        <div className="flex gap-2 mt-3">
          <Button variant={mode === "source" ? "default" : "outline"} size="sm" className="font-mono text-[11px]" onClick={() => switchMode("source")}>
            原作（source_ips）
          </Button>
          <Button variant={mode === "own" ? "default" : "outline"} size="sm" className="font-mono text-[11px]" onClick={() => switchMode("own")}>
            自社作品（works）
          </Button>
        </div>
      </div>

      {view === "gate" ? (
        /* 検索ゲート: 既存を検索して編集 / 無ければ新規作成 */
        <div className={`rounded-xl border border-border border-t-[3px] ${mode === "own" ? "border-t-emerald-500" : "border-t-sky-500"} bg-card p-5 space-y-4`}>
          <Field
            label={`${entityLabel}を検索`}
            help="まず既存を確認。ヒットしたら選んで編集、無ければ下の「新規作成」で登録します。"
          >
            <WorkPicker
              items={pickerItems}
              value={pickerVal}
              onSelect={(it) => { if (it) { setPickerVal(it.id); const row = list.find((x) => String(x.id) === it.id); if (row) startEdit(row) } }}
              placeholder={mode === "own" ? "作品コード / タイトル / 別名" : "原作コード / タイトル / 別名"}
            />
          </Field>
          <div className="flex items-center gap-3 pt-1">
            <div className="h-px bg-border flex-1" />
            <span className="font-mono text-[9.5px] text-muted-foreground">または</span>
            <div className="h-px bg-border flex-1" />
          </div>
          <Button variant="outline" size="sm" onClick={startNew} className="font-mono text-[11px] w-full">
            <Plus className="h-3.5 w-3.5" />
            新規で{entityLabel}を作成
          </Button>
          <p className="font-mono text-[9px] text-muted-foreground">
            {listLoading ? "一覧を読み込み中…" : `登録済み ${list.length} 件`}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 font-mono text-[11px]">
            {editingId ? <Pencil className="h-3.5 w-3.5 text-sky-600" /> : <Plus className="h-3.5 w-3.5 text-emerald-600" />}
            {editingId ? <>編集中: <b>{editingCode}</b>（コードは不変）</> : <>新規 {entityLabel} を作成</>}
            <button type="button" className="ml-auto text-muted-foreground hover:text-destructive inline-flex items-center gap-1" onClick={backToGate}>
              <Search className="h-3.5 w-3.5" /> 検索に戻る
            </button>
          </div>

          <div className={`rounded-xl border border-border border-t-[3px] ${mode === "own" ? "border-t-emerald-500" : "border-t-sky-500"} bg-card p-5 space-y-4`}>
            <Field
              label={mode === "own" ? "作品コード" : "原作コード"}
              col={mode === "own" ? "work_code" : "source_code"}
              auto={!editingId}
              help={editingId ? "コードは不変。" : mode === "own" ? "空欄で W-YYYY-NNNN を自動採番。手動指定も可(既存コード不可)。" : "空欄で LO-YYYY-NNNN を自動採番。"}
            >
              {editingId ? (
                <div className={`${selCls} flex items-center text-muted-foreground`}>{editingCode}</div>
              ) : (
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="（空欄＝自動採番）" className="h-8 text-[12px]" />
              )}
            </Field>

            <Field label="タイトル" col="title" req>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "own" ? "例: New ito" : "例: ito"} className="h-8 text-[12px]" />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="かな" col="title_kana" help="検索用の読み。">
                <Input value={titleKana} onChange={(e) => setTitleKana(e.target.value)} placeholder={mode === "own" ? "にゅーいと" : "いと"} className="h-8 text-[12px]" />
              </Field>
              <Field label="別名" col="alternative_titles[]" help="名寄せ検索でヒット。カンマ/改行区切りで複数可。">
                <Input value={altTitles} onChange={(e) => setAltTitles(e.target.value)} placeholder="別名1, 別名2" className="h-8 text-[12px]" />
              </Field>
            </div>

            {mode === "own" ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="事業部区分" col="division[]" help="複数選択。">
                    <div className="flex gap-2 h-8 items-center">
                      {DIVISIONS.map((d) => (
                        <label key={d.v} className="flex items-center gap-1 font-mono text-[11px]">
                          <input type="checkbox" checked={division.includes(d.v)} onChange={() => toggleDivision(d.v)} />
                          {d.label}
                        </label>
                      ))}
                    </div>
                  </Field>
                  <Field label="作品種別" col="work_type">
                    <select className={selCls} value={workType} onChange={(e) => setWorkType(e.target.value)}>
                      {WORK_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="ステータス" col="status">
                    <select className={selCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                      {STATUSES.map((t) => (<option key={t} value={t}>{t}</option>))}
                    </select>
                  </Field>
                  <Field label="起案稟議ID" col="origin_ringi_id" help="起案となった作品稟議の内部ID(任意・数値)。">
                    <Input value={originRingiId} onChange={(e) => setOriginRingiId(e.target.value)} placeholder="（任意・数値）" className="h-8 text-[12px]" />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="権利元（取引先）" col="rights_holder_vendor_id" help="原作の権利者を取引先マスタから ID 検索。">
                  <VendorSearchSelect
                    vendors={vendors || []}
                    selectedCode={vendorCode}
                    onSelect={(v) => { setVendorCode(v?.vendor_code || ""); setVendorId(v?.id ?? null) }}
                  />
                  {editingId && vendorId != null && !vendorCode && (
                    <p className="font-mono text-[9px] text-muted-foreground">現在の権利元 vendor ID: {vendorId}（変更する場合のみ選択）</p>
                  )}
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="原出版社" col="original_publisher">
                    <Input value={originalPublisher} onChange={(e) => setOriginalPublisher(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
                  </Field>
                  <Field label="既定の権利者表記" col="default_rights_holder" help="条件書に既定で入る権利者名。">
                    <Input value={defaultRightsHolder} onChange={(e) => setDefaultRightsHolder(e.target.value)} placeholder="例: 株式会社ネイド" className="h-8 text-[12px]" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="既定クレジット表示" col="default_credit_display">
                    <Input value={defaultCreditDisplay} onChange={(e) => setDefaultCreditDisplay(e.target.value)} placeholder="例: © ito" className="h-8 text-[12px]" />
                  </Field>
                  <Field label="原著作物 補記" col="default_work_supplement">
                    <Input value={defaultWorkSupplement} onChange={(e) => setDefaultWorkSupplement(e.target.value)} placeholder="例: 原作および派生作品を含む" className="h-8 text-[12px]" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="既定 承認対象" col="default_approval_target">
                    <Input value={defaultApprovalTarget} onChange={(e) => setDefaultApprovalTarget(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
                  </Field>
                  <Field label="既定 承認時期" col="default_approval_timing">
                    <Input value={defaultApprovalTiming} onChange={(e) => setDefaultApprovalTiming(e.target.value)} placeholder="例: 製造前・変更前" className="h-8 text-[12px]" />
                  </Field>
                </div>
                {!editingId && (
                  <div className="rounded-lg border border-amber-500 bg-amber-500/10 px-3 py-2 font-mono text-[9.5px] text-amber-700 leading-snug">
                    <b>自動生成</b>：登録すると works(licensed_in) ＋ ledger ＋ <b>原作本体素材 LO-…-001（core_logic）</b> がまとめて作られます。
                  </div>
                )}
              </>
            )}

            <Field label="備考" col="remarks">
              <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="（任意）" className="h-8 text-[12px]" />
            </Field>
          </div>

          <div className="flex justify-end gap-2 items-center">
            {editingId && mode === "source" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteSource(false)}
                disabled={saving}
                className="font-mono text-[11px] mr-auto border-rose-500 text-rose-600 hover:bg-rose-500/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                この原作を削除
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={backToGate} disabled={saving} className="font-mono text-[11px]">キャンセル</Button>
            <Button size="sm" onClick={submit} disabled={saving} className="font-mono text-[11px]">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {editingId ? "変更を保存" : mode === "own" ? "作品を登録" : "原作を登録"}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default WorkEntryPanel
