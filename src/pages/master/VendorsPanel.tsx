import * as React from "react"
import {
  Search,
  Plus,
  Building2,
  Trash2,
  Star,
  FileSpreadsheet,
  ExternalLink,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { cn } from "@/lib/utils"

// Phase 22.13: 担当者 (vendor_contacts) の型
type VendorContact = {
  id?: number
  contact_name: string
  contact_department?: string
  title?: string
  email?: string
  phone?: string
  is_primary?: boolean
  sort_order?: number
  remarks?: string
}

const empty = {
  vendor_name: "",
  vendor_code: "",
  trade_name: "",
  pen_name: "",
  entity_type: "corporate",
  vendor_suffix: "",
  aliases: "",
  // 連絡先
  contact_department: "",
  contact_name: "",
  phone: "",
  email: "",
  address: "",
  // 税務・インボイス
  withholding_enabled: false,
  is_invoice_issuer: false,
  invoice_registration_number: "",
  // 振込先
  bank_name: "",
  branch_name: "",
  account_type: "普通",
  account_number: "",
  account_holder_kana: "",
  // Phase 22.13: 代表者 + 担当者 (1:N)
  vendor_rep: "",
  contacts: [] as VendorContact[],
  // Phase 22.21.119: search-api 側に揃えて追加
  corporate_number: "",
  transaction_category: "",
  capital_yen: "" as string | number,
  employee_count: "" as string | number,
  subcontract_act_applicable: false,
  master_updated_at: "",
  main_business: "",
  payment_terms: "",
  rating: "",
  antisocial_check_result: "",
  master_contract_ref: "",
  bank_info: "",
}

export function VendorsPanel() {
  const { vendors, refreshVendors, showNotification } = useAppData()
  // Phase 22.21.35: CSV 一括取込は search-api 側 (/imports/vendor) に集約。
  //   admin-ui からは新タブで開くだけ。保守対象を search-api に一本化。
  const vendorImportUrl = (() => {
    const base =
      (import.meta as any).env?.VITE_API_READ_URL ||
      (typeof window !== "undefined" ? window.location.origin : "")
    return `${base.replace(/\/$/, "")}/imports/vendor`
  })()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)
  const [detail, setDetail] = React.useState<any>(null)

  const filtered = vendors.filter(
    (v) =>
      v.vendor_name.toLowerCase().includes(search.toLowerCase()) ||
      v.vendor_code.toLowerCase().includes(search.toLowerCase()) ||
      (v.trade_name && v.trade_name.toLowerCase().includes(search.toLowerCase()))
  )

  const open = !!editing || creating || !!detail
  const data = creating ? draft : editing || detail
  const set = (patch: any) => {
    if (creating) setDraft({ ...draft, ...patch })
    else if (editing) setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDetail(null)
    setDraft(empty)
  }

  const [saving, setSaving] = React.useState(false)

  // Worker /api/master/vendors は POST のみ (ON CONFLICT DO UPDATE で upsert)
  // なので新規・編集とも同じ POST で送る。旧コードは PUT を使っていたが
  // 該当ハンドラが無く 404 で詰まっていた。
  const save = async () => {
    setSaving(true)
    try {
      const isEdit = !!editing
      const res = await fetch("/api/master/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        showNotification(
          isEdit
            ? `「${data?.vendor_name || data?.vendor_code}」を更新しました`
            : `「${data?.vendor_name || data?.vendor_code}」を登録しました`,
          "success"
        )
        await refreshVendors()
        close()
      } else {
        let detail = ""
        try {
          const j = await res.json()
          detail = j?.error ? `: ${j.error}` : ""
        } catch {
          // body は text のことも
        }
        showNotification(`保存に失敗しました (HTTP ${res.status})${detail}`, "error")
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="取引先名・取引先コードで検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {vendors.length} entries
        </span>
        <div className="flex-1" />
        {/* Phase 22.21.35: CSV 一括取込ボタン (search-api 側のページを新タブで開く) */}
        <Button
          variant="outline"
          asChild
          title="取引先 CSV 一括取込 (search-api 側で dry-run プレビュー対応)"
        >
          <a href={vendorImportUrl} target="_blank" rel="noreferrer">
            <FileSpreadsheet />
            CSV 一括取込
            <ExternalLink className="ml-0.5 h-3 w-3 opacity-60" />
          </a>
        </Button>
        <Button
          onClick={() => {
            setDraft(empty)
            setCreating(true)
          }}
        >
          <Plus />
          取引先を追加
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {filtered.map((v, idx) => (
          <Card
            key={`vendor-${v.vendor_code || idx}`}
            className="cursor-pointer hover:border-foreground transition-all"
            onClick={() => {
              // Phase 25.1: 一覧 (listVendors) は既に contacts/addresses/
              //   bank_accounts を含む完全な行を返すため、まず手元の行で詳細を
              //   開いて即編集可能にする。その上で detail エンドポイントでの補完を
              //   試みるが、404/エラー時は握りつぶす。
              //   (vendor_code に "/"・空白・"#" 等が含まれると encode しない URL で
              //    path 不一致になり 404 になる事故があったため encodeURIComponent。)
              setDetail(v)
              setEditing(v)
              const code = String(v.vendor_code || "").trim()
              if (!code) return
              fetch(`/api/master/vendors/${encodeURIComponent(code)}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                  if (d && !d.error && (d.vendor_code || d.id)) {
                    setDetail(d)
                    setEditing(d)
                  }
                })
                .catch(() => {})
            }}
          >
            <CardContent className="px-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="h-4">
                  {v.vendor_code}
                </Badge>
              </div>
              <p className="text-sm font-mono font-bold uppercase line-clamp-2">
                {v.vendor_name}
              </p>
              <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                {v.trade_name || "—"}
              </p>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-border rounded-md">
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No vendors registered.
            </p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        {/* Phase 22.14: max-h-[90vh] + flex column で modal が viewport を
            突き抜けないようにする。DialogBody 単体の overflow-y-auto だけだと
            DialogContent 自体が肥大化して top/bottom が画面外に出る問題を解消。 */}
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {creating
                ? "新規取引先の登録"
                : editing
                ? "取引先の編集"
                : "取引先詳細"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="grid grid-cols-2 gap-3 overflow-y-auto flex-1 min-h-0">
            {/* ── SEC 01 / 基本情報 ──────────────────────────────────── */}
            <SectionHead label="SEC · 01 / 基本情報" />
            <Field label="取引先コード *">
              <Input
                value={data?.vendor_code || ""}
                disabled={!creating}
                onChange={(e) => set({ vendor_code: e.target.value })}
                placeholder="例: 2-20-1234"
              />
            </Field>
            <Field label="区分">
              <NativeSelect
                value={data?.entity_type || "corporate"}
                disabled={!creating && !editing}
                onChange={(e) => set({ entity_type: e.target.value })}
              >
                <option value="">(未指定)</option>
                <option value="corporate">法人</option>
                <option value="individual">個人</option>
                <option value="sole_proprietor">個人事業主</option>
              </NativeSelect>
            </Field>
            <Field label="正式名称 *" className="col-span-2">
              <Input
                value={data?.vendor_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ vendor_name: e.target.value })}
                placeholder="例: 株式会社サンプル"
              />
            </Field>
            <Field label="屋号 / 略称">
              <Input
                value={data?.trade_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ trade_name: e.target.value })}
              />
            </Field>
            <Field label="ペンネーム">
              <Input
                value={data?.pen_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ pen_name: e.target.value })}
              />
            </Field>
            <Field label="敬称サフィックス">
              <Input
                value={data?.vendor_suffix || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ vendor_suffix: e.target.value })}
                placeholder="様 / 御中"
              />
            </Field>
            <Field label="別名 (aliases)">
              <Input
                value={data?.aliases || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ aliases: e.target.value })}
                placeholder="カンマ区切りで複数可"
              />
            </Field>
            <Field label="代表者名" className="col-span-2">
              <Input
                placeholder="例: 代表取締役 山田太郎"
                value={data?.vendor_rep || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ vendor_rep: e.target.value })}
              />
              <p className="text-[10px] font-mono text-muted-foreground mt-1">
                法人の場合のみ記入。肩書込みで契約書 / 発注書 / 検収書 PDF の
                代表者欄に転記されます (個人事業主は省略可)。
              </p>
            </Field>
            <Field label="法人番号">
              <Input
                value={data?.corporate_number || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ corporate_number: e.target.value })}
                placeholder="13 桁"
                maxLength={13}
              />
            </Field>
            <Field label="取引内容区分">
              <NativeSelect
                value={data?.transaction_category || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ transaction_category: e.target.value })}
              >
                <option value="">(未指定)</option>
                <option value="goods_sale">物品売買</option>
                <option value="service">業務委託・役務</option>
                <option value="license">ライセンス</option>
                <option value="other">その他</option>
              </NativeSelect>
            </Field>
            <Field label="資本金 (円)">
              <Input
                type="number"
                min="0"
                step="1"
                value={(data?.capital_yen as any) ?? ""}
                disabled={!creating && !editing}
                onChange={(e) => {
                  const v = e.target.value
                  const next: any = { capital_yen: v }
                  // 取適法判定: 資本金 1000 万以下 OR 従業員数 100 人以下
                  const cap = Number(v) || 0
                  const emp = Number(data?.employee_count) || 0
                  if (cap > 0 || emp > 0) {
                    next.subcontract_act_applicable =
                      (cap > 0 && cap <= 10000000) ||
                      (emp > 0 && emp <= 100)
                  }
                  set(next)
                }}
              />
            </Field>
            <Field label="従業員数 (人)">
              <Input
                type="number"
                min="0"
                step="1"
                value={(data?.employee_count as any) ?? ""}
                disabled={!creating && !editing}
                onChange={(e) => {
                  const v = e.target.value
                  const next: any = { employee_count: v }
                  const cap = Number(data?.capital_yen) || 0
                  const emp = Number(v) || 0
                  if (cap > 0 || emp > 0) {
                    next.subcontract_act_applicable =
                      (cap > 0 && cap <= 10000000) ||
                      (emp > 0 && emp <= 100)
                  }
                  set(next)
                }}
              />
            </Field>
            <Field label="取適法適用判定">
              <Input
                value={
                  data?.subcontract_act_applicable === true
                    ? "適用あり (下請法対象)"
                    : data?.capital_yen || data?.employee_count
                    ? "適用なし"
                    : ""
                }
                readOnly
                placeholder="資本金・従業員数から自動判定"
              />
            </Field>
            <Field label="取引先マスタ更新日">
              <Input
                type="date"
                value={
                  data?.master_updated_at
                    ? String(data.master_updated_at).substring(0, 10)
                    : ""
                }
                disabled={!creating && !editing}
                onChange={(e) => set({ master_updated_at: e.target.value })}
              />
            </Field>
            <Field label="取引先主要事業" className="col-span-2">
              <Input
                value={data?.main_business || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ main_business: e.target.value })}
              />
            </Field>
            <Field label="決済条件">
              <Input
                value={data?.payment_terms || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ payment_terms: e.target.value })}
                placeholder="例: 月末締め翌月末払い"
              />
            </Field>
            <Field label="評点">
              <Input
                value={data?.rating || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ rating: e.target.value })}
              />
            </Field>
            <Field label="反社チェック結果" className="col-span-2">
              <NativeSelect
                value={data?.antisocial_check_result || ""}
                disabled={!creating && !editing}
                onChange={(e) =>
                  set({ antisocial_check_result: e.target.value })
                }
              >
                <option value="">(未確認)</option>
                <option value="clear">問題なし</option>
                <option value="pending">確認中</option>
                <option value="ng">NG</option>
              </NativeSelect>
            </Field>

            {/* ── SEC 02 / 連絡先 ──────────────────────────────────── */}
            <SectionHead label="SEC · 02 / 連絡先" />
            <Field label="担当部署">
              <Input
                value={data?.contact_department || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ contact_department: e.target.value })}
              />
            </Field>
            <Field label="担当者">
              <Input
                value={data?.contact_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ contact_name: e.target.value })}
              />
            </Field>
            <Field label="電話番号 (代表 / メイン)">
              <Input
                type="tel"
                placeholder="03-1234-5678"
                value={data?.phone || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ phone: e.target.value })}
              />
            </Field>
            <Field label="メールアドレス">
              <Input
                type="email"
                placeholder="contact@example.com"
                value={data?.email || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
            <Field label="住所" className="col-span-2">
              <Input
                value={data?.address || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ address: e.target.value })}
              />
            </Field>

            {/* ── SEC 03 / 税務・インボイス ──────────────────────── */}
            <SectionHead label="SEC · 03 / 税務・インボイス" />
            <Field label="源泉徴収">
              <label className="flex items-center gap-2 h-9">
                <input
                  type="checkbox"
                  checked={!!data?.withholding_enabled}
                  disabled={!creating && !editing}
                  onChange={(e) =>
                    set({ withholding_enabled: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <span className="text-xs font-mono">源泉徴収を行う</span>
              </label>
              <p className="text-[10px] font-mono text-muted-foreground">
                個人取引先は通常 ON (Excel 出力で 10.21% 自動控除)
              </p>
            </Field>
            <Field label="適格請求書発行事業者 (インボイス)">
              <label className="flex items-center gap-2 h-9">
                <input
                  type="checkbox"
                  checked={!!data?.is_invoice_issuer}
                  disabled={!creating && !editing}
                  onChange={(e) =>
                    set({ is_invoice_issuer: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <span className="text-xs font-mono">インボイス発行事業者</span>
              </label>
            </Field>
            <Field label="インボイス登録番号" className="col-span-2">
              <Input
                value={data?.invoice_registration_number || ""}
                disabled={!creating && !editing}
                onChange={(e) =>
                  set({ invoice_registration_number: e.target.value })
                }
                placeholder="T1234567890123"
                maxLength={50}
              />
            </Field>

            {/* ── SEC 04 / 振込先 ──────────────────────────────────── */}
            <SectionHead label="SEC · 04 / 振込先" />
            <Field label="銀行名">
              <Input
                value={data?.bank_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ bank_name: e.target.value })}
              />
            </Field>
            <Field label="支店名">
              <Input
                value={data?.branch_name || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ branch_name: e.target.value })}
              />
            </Field>
            <Field label="口座種別">
              <NativeSelect
                value={data?.account_type || "普通"}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_type: e.target.value })}
              >
                <option value="普通">普通</option>
                <option value="当座">当座</option>
                <option value="貯蓄">貯蓄</option>
              </NativeSelect>
            </Field>
            <Field label="口座番号">
              <Input
                value={data?.account_number || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_number: e.target.value })}
              />
            </Field>
            <Field label="口座名義 (カナ)" className="col-span-2">
              <Input
                value={data?.account_holder_kana || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ account_holder_kana: e.target.value })}
              />
            </Field>

            {/* ── SEC 05 / その他 ────────────────────────────────────── */}
            <SectionHead label="SEC · 05 / その他" />
            <Field label="マスター契約参照" className="col-span-2">
              <Input
                value={data?.master_contract_ref || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ master_contract_ref: e.target.value })}
                placeholder="既存契約番号 / URL 等"
              />
            </Field>
            <Field label="銀行情報メモ" className="col-span-2">
              <Input
                value={data?.bank_info || ""}
                disabled={!creating && !editing}
                onChange={(e) => set({ bank_info: e.target.value })}
                placeholder="自由記述"
              />
            </Field>

            {/* Phase 22.13: 取引先側 窓口担当者リスト (1 取引先 N 担当者)。
                 ※ ここで言う「担当者」は取引先側の窓口担当者 (相手方の人)。
                   当社側の担当者はマスター > スタッフ で管理。
                 ★ primary 1 件の名前が vendor.contact_name にミラーされ、
                   発注書 / 検収書テンプレの「取引先担当者」フィールドに転記。 */}
            <div className="col-span-2 mt-2 border-t border-border pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-mono font-bold uppercase tracking-[0.16em]">
                  取引先 窓口担当者 ({Array.isArray(data?.contacts) ? data.contacts.length : 0} 件)
                </Label>
                {(creating || editing) && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => {
                      const next: VendorContact[] = Array.isArray(data?.contacts)
                        ? [...data.contacts]
                        : []
                      next.push({
                        contact_name: "",
                        contact_department: "",
                        title: "",
                        email: "",
                        phone: "",
                        is_primary: next.length === 0, // 1 件目は自動 primary
                        sort_order: next.length,
                      })
                      set({ contacts: next })
                    }}
                  >
                    <Plus className="h-3 w-3" />
                    窓口担当者を追加
                  </Button>
                )}
              </div>
              <p className="text-[10px] font-mono text-muted-foreground leading-relaxed">
                <strong>取引先側</strong>の窓口になる人を登録 (= 相手方の連絡先)。
                当社側の担当者は <strong>マスター &gt; スタッフ</strong> 画面で別途管理してください。
                <br />
                ★ マーク = メイン窓口。発注書 / 検収書 PDF の「取引先担当者」欄に
                この名前 / 部署が転記されます。複数登録時は 1 件だけ ★ にしてください
                (なければ先頭を自動で ★)。
              </p>
              {!Array.isArray(data?.contacts) || data.contacts.length === 0 ? (
                <div className="text-[11px] font-mono text-muted-foreground italic py-3 text-center border border-dashed border-border rounded-sm">
                  担当者がまだ登録されていません{creating || editing ? " — 上の「追加」ボタンから追加してください" : ""}
                </div>
              ) : (
                <div className="space-y-2">
                  {data.contacts.map((c: VendorContact, idx: number) => (
                    <div
                      key={idx}
                      className={cn(
                        "rounded-sm border p-2.5 space-y-2",
                        c.is_primary
                          ? "border-emerald-300 bg-emerald-50/50"
                          : "border-border bg-card"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          disabled={!creating && !editing}
                          onClick={() => {
                            const next = data.contacts.map(
                              (x: VendorContact, i: number) => ({
                                ...x,
                                is_primary: i === idx,
                              })
                            )
                            set({ contacts: next })
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 border rounded-sm transition-colors",
                            c.is_primary
                              ? "border-emerald-500 bg-emerald-100 text-emerald-800"
                              : "border-border text-muted-foreground hover:border-foreground"
                          )}
                          title="このメンバーをメイン担当者にする"
                        >
                          <Star
                            className={cn(
                              "h-3 w-3",
                              c.is_primary && "fill-emerald-600"
                            )}
                          />
                          {c.is_primary ? "メイン担当者" : "メインに設定"}
                        </button>
                        {(creating || editing) && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = data.contacts.filter(
                                (_: any, i: number) => i !== idx
                              )
                              // primary を消したら先頭を昇格
                              if (
                                c.is_primary &&
                                next.length > 0 &&
                                !next.some((x: VendorContact) => x.is_primary)
                              ) {
                                next[0].is_primary = true
                              }
                              set({ contacts: next })
                            }}
                            className="text-muted-foreground hover:text-destructive p-1"
                            title="この担当者を削除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1 col-span-2">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            氏名 *
                          </Label>
                          <Input
                            placeholder="例: 田中 一郎"
                            value={c.contact_name || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, contact_name: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            部署
                          </Label>
                          <Input
                            placeholder="例: 営業部"
                            value={c.contact_department || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = {
                                ...c,
                                contact_department: e.target.value,
                              }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            役職
                          </Label>
                          <Input
                            placeholder="例: 課長"
                            value={c.title || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, title: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            メール
                          </Label>
                          <Input
                            type="email"
                            placeholder="example@vendor.co.jp"
                            value={c.email || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, email: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                            電話
                          </Label>
                          <Input
                            type="tel"
                            placeholder="03-xxxx-xxxx"
                            value={c.phone || ""}
                            disabled={!creating && !editing}
                            onChange={(e) => {
                              const next = [...data.contacts]
                              next[idx] = { ...c, phone: e.target.value }
                              set({ contacts: next })
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              閉じる
            </Button>
            {(creating || editing) && (
              <Button onClick={save} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1 ${className || ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}

// Phase 22.21.119: search-api 側の SEC ヘッダと同じ視覚言語。
function SectionHead({ label }: { label: string }) {
  return (
    <div className="col-span-2 mt-3 pt-2 border-t border-border">
      <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-foreground/70">
        {label}
      </span>
    </div>
  )
}
