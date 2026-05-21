/**
 * ImportPage (Phase 8) — 過去文書のレジストレーション。
 *
 * 既に紙 / メール / 旧システムで成立済みの契約や発注を、PDF を再生成
 * せずに DB だけに入れたいケースのためのフォーム。
 *
 * - 発注書: order_items + order_line_items に投入。後続の検収書
 *   フォームから親 PO として参照できるようになる。
 * - 個別利用許諾条件書: license_contracts + license_financial_conditions
 *   に投入。後続のロイヤリティ計算書フォームから条件を選べる。
 *
 * Backlog 課題なし運用に対応するため、issue_key 未指定でも worker
 * 側で IMPORT-<ts> を採番する。元 PDF へのリンク (drive_link) を入れる
 * と、external_assets にも登録され、後続文書の「PO 紐付」「個別紐付」
 * ボタンから選べるようになる。
 */

import * as React from "react"
import {
  Database,
  FileInput,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  Coins,
  Briefcase,
  Link as LinkIcon,
  Loader2,
  FileSpreadsheet,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { cn } from "@/lib/utils"
import {
  LineItemTable,
  type LineItem,
} from "@/src/components/document/LineItemTable"
import {
  ExpenseTable,
  type ExpenseItem,
} from "@/src/components/document/ExpenseTable"
import {
  FinancialConditionTable,
  type FinancialCondition,
} from "@/src/components/document/FinancialConditionTable"
import { BulkImportDialog } from "@/src/components/document/BulkImportDialog"
// Phase 22.21.34: 取引先マスター CSV 一括取込
import { VendorCsvImportDialog } from "@/src/components/master/VendorCsvImportDialog"
import { PendingPdfPanel } from "@/src/components/document/PendingPdfPanel"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"

type Tab =
  | "purchase_order"
  | "individual_license_terms"
  | "license_master"
  | "service_master"
  | "nda"
  | "sales_master"
  | "pending_pdf"
  | "ringi_master"
  // Phase 22.21.34: 取引先マスター CSV 一括取込
  | "vendor_master"

const Section: React.FC<{
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  headerActions?: React.ReactNode
}> = ({ title, icon, children, headerActions }) => (
  <section className="border border-border rounded-sm bg-card/60">
    <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider">
        {icon}
        <span className="font-bold">{title}</span>
      </div>
      {headerActions && <div className="flex gap-2">{headerActions}</div>}
    </header>
    <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
      {children}
    </div>
  </section>
)

const Field: React.FC<{
  label: string
  required?: boolean
  hint?: string
  full?: boolean
  children: React.ReactNode
}> = ({ label, required, hint, full, children }) => (
  <label className={cn("space-y-1", full && "md:col-span-2")}>
    <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
      <span>{label}</span>
      {required && <span className="text-red-600">*</span>}
    </div>
    {children}
    {hint && (
      <div className="text-[9px] font-mono text-muted-foreground/60">
        {hint}
      </div>
    )}
  </label>
)

const inputClass = cn(
  "w-full text-[11px] font-mono bg-transparent",
  "border-b border-input py-1 px-1 focus:outline-none focus:border-foreground",
  "placeholder:text-muted-foreground/40 placeholder:text-[10px]"
)

const SideButton: React.FC<{
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
}> = ({ label, onClick, disabled, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      "text-[8px] font-mono px-2 py-0.5 uppercase border rounded-sm transition-colors",
      disabled
        ? "border-input text-muted-foreground/40 cursor-not-allowed"
        : "border-foreground/30 text-foreground hover:bg-muted"
    )}
  >
    {label}
  </button>
)

// ---------------------------------------------------------------------
// 発注書インポートフォーム
// ---------------------------------------------------------------------

const initialOrderForm = {
  issue_key: "",
  document_number: "",
  drive_link: "",
  vendor_code: "",
  vendor_name: "",
  description: "",
  tax_rate: 10,
  due_date: "",
  items: [] as LineItem[],
  // Phase 17i: 経費 (交通費等・税込み額)
  expenses: [] as ExpenseItem[],
}

const OrderImportForm: React.FC<{
  vendors: any[]
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}> = ({ vendors, showNotification }) => {
  const [form, setForm] = React.useState({ ...initialOrderForm })
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  const grandTotal = (form.items || []).reduce(
    (s, it) => s + (Number(it.amount_ex_tax) || 0),
    0
  )
  const expensesTotal = (form.expenses || []).reduce(
    (s, e) => s + (Number(e.amount_inc_tax) || 0),
    0
  )

  const requiredOk = !!(
    form.vendor_name &&
    form.description &&
    Array.isArray(form.items) &&
    form.items.length > 0
  )

  const pickVendor = (v: any | null) => {
    if (!v) {
      setForm({ ...form, vendor_code: "", vendor_name: "" })
      return
    }
    setForm({
      ...form,
      vendor_code: v.vendor_code,
      vendor_name: v.vendor_name || "",
    })
  }

  const submit = async () => {
    if (!requiredOk) {
      showNotification("必須項目を埋めてください", "error")
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/imports/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setResult(data)
      showNotification(
        `発注書を登録しました (${data.document_number})`,
        "success"
      )
    } catch (e: any) {
      showNotification(`登録失敗: ${e?.message || e}`, "error")
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* 必須完了バナー */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2 rounded-sm border text-[11px] font-mono",
          requiredOk
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}
      >
        {requiredOk ? (
          <>✓ 登録可能 (取引先 / 概要 / 明細 1 行以上)</>
        ) : (
          <>必須: 取引先名 / 業務概要 / 明細 1 行以上</>
        )}
      </div>

      {/* I. ヘッダ */}
      <Section title="I. ヘッダ" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <Field
          label="Backlog 課題キー"
          hint="空欄なら IMPORT-<timestamp> を自動採番"
        >
          <input
            className={inputClass}
            value={form.issue_key}
            onChange={(e) => setForm({ ...form, issue_key: e.target.value })}
            placeholder="例: ARC-1234 (任意)"
          />
        </Field>
        <Field
          label="発注書番号"
          hint="空欄ならサーバが採番"
        >
          <input
            className={inputClass}
            value={form.document_number}
            onChange={(e) =>
              setForm({ ...form, document_number: e.target.value })
            }
            placeholder="例: PO-2024-005 (任意)"
          />
        </Field>
        <Field label="業務概要" required>
          <input
            className={inputClass}
            value={form.description}
            onChange={(e) =>
              setForm({ ...form, description: e.target.value })
            }
            placeholder="例: ボードゲーム X 製造一式"
          />
        </Field>
        <Field
          label="原本 PDF リンク"
          hint="Drive 共有 URL 等。external_assets に登録され後続文書から参照可能に"
        >
          <input
            className={inputClass}
            value={form.drive_link}
            onChange={(e) => setForm({ ...form, drive_link: e.target.value })}
            placeholder="https://drive.google.com/..."
          />
        </Field>
        <Field label="納期">
          <input
            type="date"
            className={inputClass}
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
        </Field>
        <Field label="税率 (%)">
          <input
            type="number"
            step="0.1"
            className={inputClass}
            value={form.tax_rate}
            onChange={(e) =>
              setForm({ ...form, tax_rate: Number(e.target.value) || 10 })
            }
          />
        </Field>
      </Section>

      {/* II. 取引先 */}
      <Section
        title="II. 取引先"
        icon={<Building2 className="w-3.5 h-3.5" />}
      >
        <Field label="取引先選択 (master)">
          <VendorSearchSelect
            vendors={vendors}
            selectedCode={form.vendor_code}
            onSelect={pickVendor}
            placeholder="— マスターから検索 —"
          />
        </Field>
        <Field label="取引先名" required>
          <input
            className={inputClass}
            value={form.vendor_name}
            onChange={(e) =>
              setForm({ ...form, vendor_name: e.target.value })
            }
            placeholder="例: 株式会社サンプル"
          />
        </Field>
      </Section>

      {/* III. 明細 */}
      <Section
        title={`III. 明細 (合計税抜 ¥ ${grandTotal.toLocaleString("ja-JP")})`}
        icon={<Database className="w-3.5 h-3.5" />}
      >
        <div className="md:col-span-2">
          <LineItemTable
            items={form.items}
            onChange={(items) => setForm({ ...form, items })}
            showPaymentColumns={true}
          />
        </div>
      </Section>

      {/* III-b. 経費 (Phase 17i) — 交通費等・税込み額 */}
      <Section
        title={`III-b. 経費（税込合計 ¥ ${expensesTotal.toLocaleString("ja-JP")}）`}
        icon={<Database className="w-3.5 h-3.5" />}
      >
        <div className="md:col-span-2">
          <ExpenseTable
            expenses={form.expenses}
            onChange={(expenses) => setForm({ ...form, expenses })}
          />
        </div>
      </Section>

      {/* 送信 */}
      <div className="flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            登録完了: {result.document_number} ({result.line_count} 明細
            {result.expense_count ? ` + ${result.expense_count} 経費` : ""},
            ¥{Number(result.totals?.amount_ex_tax || 0).toLocaleString("ja-JP")}
            {result.expensesTotalIncTax
              ? ` / 経費¥${Number(result.expensesTotalIncTax).toLocaleString("ja-JP")}`
              : ""}
            )
          </span>
        )}
        {result?.error && (
          <span className="text-[10px] font-mono text-red-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {result.error}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!requiredOk || submitting}
          className={cn(
            "px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors flex items-center gap-2",
            requiredOk && !submitting
              ? "bg-foreground text-background hover:opacity-80"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileInput className="w-3 h-3" />
          )}
          DB に登録
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// 個別利用許諾条件書インポートフォーム
// ---------------------------------------------------------------------

const initialLicenseForm = {
  issue_key: "",
  contract_number: "",
  ledger_id: "",
  drive_link: "",
  licensor_name: "",
  licensor_address: "",
  licensor_rep: "",
  licensor_is_corporation: true,
  licensee_name: "",
  licensee_address: "",
  licensee_rep: "",
  licensee_is_corporation: true,
  original_work: "",
  product_name_predicted: "",
  license_start_date: "",
  license_period_note: "",
  supervisor: "",
  credit_display: "",
  remarks: "",
  financial_conditions: [] as FinancialCondition[],
}

const LicenseImportForm: React.FC<{
  vendors: any[]
  companyProfile: any
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}> = ({ vendors, companyProfile, showNotification }) => {
  const [form, setForm] = React.useState({ ...initialLicenseForm })
  const [selectedVendorCode, setSelectedVendorCode] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  const requiredOk = !!(
    form.licensor_name &&
    form.licensee_name &&
    form.original_work &&
    Array.isArray(form.financial_conditions) &&
    form.financial_conditions.length > 0
  )

  const fillFromVendor = (code: string, target: "licensor" | "licensee") => {
    const v = vendors.find((x) => x.vendor_code === code)
    if (!v) return
    const corp =
      (v.entity_type || "").toLowerCase() === "corporate" ||
      v.entity_type === "法人"
    if (target === "licensor") {
      setForm({
        ...form,
        licensor_name: v.vendor_name || "",
        licensor_address: v.address || "",
        licensor_rep: v.vendor_rep || v.contact_name || "",
        licensor_is_corporation: corp,
      })
    } else {
      setForm({
        ...form,
        licensee_name: v.vendor_name || "",
        licensee_address: v.address || "",
        licensee_rep: v.vendor_rep || v.contact_name || "",
        licensee_is_corporation: corp,
      })
    }
  }

  const fillFromSelf = (target: "licensor" | "licensee") => {
    if (!companyProfile) return
    if (target === "licensor") {
      setForm({
        ...form,
        licensor_name: companyProfile.name || "",
        licensor_address: companyProfile.address || "",
        licensor_rep: companyProfile.representative || "",
        licensor_is_corporation: true,
      })
    } else {
      setForm({
        ...form,
        licensee_name: companyProfile.name || "",
        licensee_address: companyProfile.address || "",
        licensee_rep: companyProfile.representative || "",
        licensee_is_corporation: true,
      })
    }
  }

  const submit = async () => {
    if (!requiredOk) {
      showNotification("必須項目を埋めてください", "error")
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/imports/license-contract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setResult(data)
      showNotification(
        `個別利用許諾条件書を登録しました (${data.contract_number})`,
        "success"
      )
    } catch (e: any) {
      showNotification(`登録失敗: ${e?.message || e}`, "error")
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2 rounded-sm border text-[11px] font-mono",
          requiredOk
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}
      >
        {requiredOk ? (
          <>✓ 登録可能 (Licensor / Licensee / 原著作物 / 金銭条件 1 件以上)</>
        ) : (
          <>必須: Licensor / Licensee / 原著作物 / 金銭条件 1 件以上</>
        )}
      </div>

      {/* I. ヘッダ */}
      <Section title="I. ヘッダ" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <Field label="Backlog 課題キー" hint="空欄なら IMPORT-<ts>">
          <input
            className={inputClass}
            value={form.issue_key}
            onChange={(e) => setForm({ ...form, issue_key: e.target.value })}
            placeholder="任意"
          />
        </Field>
        <Field label="契約書番号" hint="空欄ならサーバ採番">
          <input
            className={inputClass}
            value={form.contract_number}
            onChange={(e) =>
              setForm({ ...form, contract_number: e.target.value })
            }
            placeholder="例: LIC-2024-001"
          />
        </Field>
        <Field label="台帳 ID" hint="空欄なら契約書番号と同一">
          <input
            className={inputClass}
            value={form.ledger_id}
            onChange={(e) => setForm({ ...form, ledger_id: e.target.value })}
            placeholder="任意"
          />
        </Field>
        <Field label="原本 PDF リンク">
          <input
            className={inputClass}
            value={form.drive_link}
            onChange={(e) => setForm({ ...form, drive_link: e.target.value })}
            placeholder="https://drive.google.com/..."
          />
        </Field>
      </Section>

      {/* II/III. Licensor / Licensee */}
      <div className="space-y-4">
        <Section
          title="II. Licensor (許諾者)"
          icon={<Building2 className="w-3.5 h-3.5" />}
          headerActions={
            <>
              <SideButton
                label="自社"
                onClick={() => fillFromSelf("licensor")}
                disabled={!companyProfile}
              />
              <div className="min-w-[220px]">
                <VendorSearchSelect
                  vendors={vendors}
                  selectedCode={selectedVendorCode}
                  onSelect={(v) => {
                    setSelectedVendorCode(v?.vendor_code || "")
                    if (v) fillFromVendor(v.vendor_code, "licensor")
                  }}
                  placeholder="取引先を検索…"
                  size="compact"
                />
              </div>
            </>
          }
        >
          <Field label="名称" required>
            <input
              className={inputClass}
              value={form.licensor_name}
              onChange={(e) =>
                setForm({ ...form, licensor_name: e.target.value })
              }
            />
          </Field>
          <Field label="住所">
            <input
              className={inputClass}
              value={form.licensor_address}
              onChange={(e) =>
                setForm({ ...form, licensor_address: e.target.value })
              }
            />
          </Field>
          <Field label="代表者名">
            <input
              className={inputClass}
              value={form.licensor_rep}
              onChange={(e) =>
                setForm({ ...form, licensor_rep: e.target.value })
              }
            />
          </Field>
          <Field label="法人/個人">
            <select
              className={inputClass}
              value={form.licensor_is_corporation ? "1" : "0"}
              onChange={(e) =>
                setForm({
                  ...form,
                  licensor_is_corporation: e.target.value === "1",
                })
              }
            >
              <option value="1">法人</option>
              <option value="0">個人</option>
            </select>
          </Field>
        </Section>

        <Section
          title="III. Licensee (被許諾者)"
          icon={<User className="w-3.5 h-3.5" />}
          headerActions={
            <>
              <SideButton
                label="自社"
                onClick={() => fillFromSelf("licensee")}
                disabled={!companyProfile}
              />
              <div className="min-w-[220px]">
                <VendorSearchSelect
                  vendors={vendors}
                  selectedCode=""
                  onSelect={(v) => {
                    if (v) fillFromVendor(v.vendor_code, "licensee")
                  }}
                  placeholder="取引先を検索…"
                  size="compact"
                />
              </div>
            </>
          }
        >
          <Field label="名称" required>
            <input
              className={inputClass}
              value={form.licensee_name}
              onChange={(e) =>
                setForm({ ...form, licensee_name: e.target.value })
              }
            />
          </Field>
          <Field label="住所">
            <input
              className={inputClass}
              value={form.licensee_address}
              onChange={(e) =>
                setForm({ ...form, licensee_address: e.target.value })
              }
            />
          </Field>
          <Field label="代表者名">
            <input
              className={inputClass}
              value={form.licensee_rep}
              onChange={(e) =>
                setForm({ ...form, licensee_rep: e.target.value })
              }
            />
          </Field>
          <Field label="法人/個人">
            <select
              className={inputClass}
              value={form.licensee_is_corporation ? "1" : "0"}
              onChange={(e) =>
                setForm({
                  ...form,
                  licensee_is_corporation: e.target.value === "1",
                })
              }
            >
              <option value="1">法人</option>
              <option value="0">個人</option>
            </select>
          </Field>
        </Section>
      </div>

      {/* IV. 対象作品・期間 */}
      <Section title="IV. 対象作品・期間" icon={<LinkIcon className="w-3.5 h-3.5" />}>
        <Field label="原著作物名" required>
          <input
            className={inputClass}
            value={form.original_work}
            onChange={(e) =>
              setForm({ ...form, original_work: e.target.value })
            }
            placeholder="例: ボードゲーム『◯◯』"
          />
        </Field>
        <Field label="対象製品 (予定) 名">
          <input
            className={inputClass}
            value={form.product_name_predicted}
            onChange={(e) =>
              setForm({ ...form, product_name_predicted: e.target.value })
            }
          />
        </Field>
        <Field label="許諾開始日">
          <input
            type="date"
            className={inputClass}
            value={form.license_start_date}
            onChange={(e) =>
              setForm({ ...form, license_start_date: e.target.value })
            }
          />
        </Field>
        <Field label="許諾期間注記">
          <input
            className={inputClass}
            value={form.license_period_note}
            onChange={(e) =>
              setForm({ ...form, license_period_note: e.target.value })
            }
            placeholder="例: 基本契約の満了日まで"
          />
        </Field>
        <Field label="監修者">
          <input
            className={inputClass}
            value={form.supervisor}
            onChange={(e) =>
              setForm({ ...form, supervisor: e.target.value })
            }
          />
        </Field>
        <Field label="クレジット表示">
          <input
            className={inputClass}
            value={form.credit_display}
            onChange={(e) =>
              setForm({ ...form, credit_display: e.target.value })
            }
          />
        </Field>
        <Field label="特記事項 / 備考" full>
          <textarea
            className={cn(
              inputClass,
              "min-h-[60px] border bg-card rounded-sm px-2 py-1"
            )}
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </Field>
      </Section>

      {/* V. 金銭条件 */}
      <Section
        title="V. 金銭条件 (1〜N)"
        icon={<Coins className="w-3.5 h-3.5" />}
      >
        <div className="md:col-span-2">
          <FinancialConditionTable
            conditions={form.financial_conditions}
            onChange={(financial_conditions) =>
              setForm({ ...form, financial_conditions })
            }
          />
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            登録完了: {result.contract_number} ({result.condition_count} 条件)
          </span>
        )}
        {result?.error && (
          <span className="text-[10px] font-mono text-red-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {result.error}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!requiredOk || submitting}
          className={cn(
            "px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors flex items-center gap-2",
            requiredOk && !submitting
              ? "bg-foreground text-background hover:opacity-80"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileInput className="w-3 h-3" />
          )}
          DB に登録
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// ライセンス基本契約書インポートフォーム
// ---------------------------------------------------------------------

const initialLicenseMasterForm = {
  issue_key: "",
  contract_number: "",
  ledger_id: "",
  drive_link: "",
  basic_contract_name: "",
  issue_date: "",
  licensor_name: "",
  licensor_address: "",
  licensor_rep: "",
  licensor_is_corporation: true,
  licensee_name: "",
  licensee_address: "",
  licensee_rep: "",
  licensee_is_corporation: true,
  original_work: "",
  product_name_predicted: "",
  license_start_date: "",
  license_period_note: "",
  effective_date: "",
  expiration_date: "",
  auto_renewal: false,
  supervisor: "",
  credit_display: "",
  remarks: "",
}

const LicenseMasterImportForm: React.FC<{
  vendors: any[]
  companyProfile: any
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}> = ({ vendors, companyProfile, showNotification }) => {
  const [form, setForm] = React.useState({ ...initialLicenseMasterForm })
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  const requiredOk = !!(
    form.licensor_name &&
    form.licensee_name &&
    (form.basic_contract_name || form.original_work)
  )

  const fillFromVendor = (code: string, target: "licensor" | "licensee") => {
    const v = vendors.find((x) => x.vendor_code === code)
    if (!v) return
    const corp =
      (v.entity_type || "").toLowerCase() === "corporate" ||
      v.entity_type === "法人"
    if (target === "licensor") {
      setForm({
        ...form,
        licensor_name: v.vendor_name || "",
        licensor_address: v.address || "",
        licensor_rep: v.vendor_rep || v.contact_name || "",
        licensor_is_corporation: corp,
      })
    } else {
      setForm({
        ...form,
        licensee_name: v.vendor_name || "",
        licensee_address: v.address || "",
        licensee_rep: v.vendor_rep || v.contact_name || "",
        licensee_is_corporation: corp,
      })
    }
  }

  const fillFromSelf = (target: "licensor" | "licensee") => {
    if (!companyProfile) return
    if (target === "licensor") {
      setForm({
        ...form,
        licensor_name: companyProfile.name || "",
        licensor_address: companyProfile.address || "",
        licensor_rep: companyProfile.representative || "",
        licensor_is_corporation: true,
      })
    } else {
      setForm({
        ...form,
        licensee_name: companyProfile.name || "",
        licensee_address: companyProfile.address || "",
        licensee_rep: companyProfile.representative || "",
        licensee_is_corporation: true,
      })
    }
  }

  const submit = async () => {
    if (!requiredOk) {
      showNotification("必須項目を埋めてください", "error")
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/imports/license-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setResult(data)
      showNotification(
        `ライセンス基本契約書を登録しました (${data.contract_number})`,
        "success"
      )
    } catch (e: any) {
      showNotification(`登録失敗: ${e?.message || e}`, "error")
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2 rounded-sm border text-[11px] font-mono",
          requiredOk
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}
      >
        {requiredOk ? (
          <>✓ 登録可能 (Licensor / Licensee / 基本契約名 or 原著作物)</>
        ) : (
          <>必須: Licensor / Licensee / 基本契約名 or 原著作物</>
        )}
      </div>

      <div className="px-4 py-2 rounded-sm bg-blue-50 border border-blue-200 text-[10px] font-mono text-blue-900">
        ライセンス「基本」契約書は、個別利用許諾条件書の親 (ledger 単位)
        として登録されます。後で個別契約を入れる際は、ledger_id「
        <span className="font-bold">{form.ledger_id || "（自動採番）"}</span>
        」を指定してください。
      </div>

      {/* I. ヘッダ */}
      <Section title="I. ヘッダ" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <Field label="Backlog 課題キー" hint="空欄なら IMPORT-<ts>">
          <input
            className={inputClass}
            value={form.issue_key}
            onChange={(e) => setForm({ ...form, issue_key: e.target.value })}
            placeholder="任意"
          />
        </Field>
        <Field label="契約書番号 / 台帳番号" hint="空欄ならサーバ採番">
          <input
            className={inputClass}
            value={form.contract_number}
            onChange={(e) =>
              setForm({ ...form, contract_number: e.target.value })
            }
            placeholder="例: LIC-MST-2024-001"
          />
        </Field>
        <Field
          label="台帳 ID (ledger_id)"
          hint="後続の個別契約からこの ID で参照される。空欄なら契約書番号と同一"
        >
          <input
            className={inputClass}
            value={form.ledger_id}
            onChange={(e) => setForm({ ...form, ledger_id: e.target.value })}
            placeholder="任意"
          />
        </Field>
        <Field label="基本契約名">
          <input
            className={inputClass}
            value={form.basic_contract_name}
            onChange={(e) =>
              setForm({ ...form, basic_contract_name: e.target.value })
            }
            placeholder="例: ◯◯シリーズ ライセンス基本契約"
          />
        </Field>
        <Field label="締結日">
          <input
            type="date"
            className={inputClass}
            value={form.issue_date}
            onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
          />
        </Field>
        <Field label="原本 PDF リンク">
          <input
            className={inputClass}
            value={form.drive_link}
            onChange={(e) => setForm({ ...form, drive_link: e.target.value })}
            placeholder="https://drive.google.com/..."
          />
        </Field>
      </Section>

      {/* II/III. Licensor / Licensee */}
      <Section
        title="II. Licensor (許諾者)"
        icon={<Building2 className="w-3.5 h-3.5" />}
        headerActions={
          <>
            <SideButton
              label="自社"
              onClick={() => fillFromSelf("licensor")}
              disabled={!companyProfile}
            />
            <div className="min-w-[220px]">
              <VendorSearchSelect
                vendors={vendors}
                selectedCode=""
                onSelect={(v) => {
                  if (v) fillFromVendor(v.vendor_code, "licensor")
                }}
                placeholder="取引先を検索…"
                size="compact"
              />
            </div>
          </>
        }
      >
        <Field label="名称" required>
          <input
            className={inputClass}
            value={form.licensor_name}
            onChange={(e) =>
              setForm({ ...form, licensor_name: e.target.value })
            }
          />
        </Field>
        <Field label="住所">
          <input
            className={inputClass}
            value={form.licensor_address}
            onChange={(e) =>
              setForm({ ...form, licensor_address: e.target.value })
            }
          />
        </Field>
        <Field label="代表者名">
          <input
            className={inputClass}
            value={form.licensor_rep}
            onChange={(e) =>
              setForm({ ...form, licensor_rep: e.target.value })
            }
          />
        </Field>
        <Field label="法人/個人">
          <select
            className={inputClass}
            value={form.licensor_is_corporation ? "1" : "0"}
            onChange={(e) =>
              setForm({
                ...form,
                licensor_is_corporation: e.target.value === "1",
              })
            }
          >
            <option value="1">法人</option>
            <option value="0">個人</option>
          </select>
        </Field>
      </Section>

      <Section
        title="III. Licensee (被許諾者)"
        icon={<User className="w-3.5 h-3.5" />}
        headerActions={
          <>
            <SideButton
              label="自社"
              onClick={() => fillFromSelf("licensee")}
              disabled={!companyProfile}
            />
            <div className="min-w-[220px]">
              <VendorSearchSelect
                vendors={vendors}
                selectedCode=""
                onSelect={(v) => {
                  if (v) fillFromVendor(v.vendor_code, "licensee")
                }}
                placeholder="取引先を検索…"
                size="compact"
              />
            </div>
          </>
        }
      >
        <Field label="名称" required>
          <input
            className={inputClass}
            value={form.licensee_name}
            onChange={(e) =>
              setForm({ ...form, licensee_name: e.target.value })
            }
          />
        </Field>
        <Field label="住所">
          <input
            className={inputClass}
            value={form.licensee_address}
            onChange={(e) =>
              setForm({ ...form, licensee_address: e.target.value })
            }
          />
        </Field>
        <Field label="代表者名">
          <input
            className={inputClass}
            value={form.licensee_rep}
            onChange={(e) =>
              setForm({ ...form, licensee_rep: e.target.value })
            }
          />
        </Field>
        <Field label="法人/個人">
          <select
            className={inputClass}
            value={form.licensee_is_corporation ? "1" : "0"}
            onChange={(e) =>
              setForm({
                ...form,
                licensee_is_corporation: e.target.value === "1",
              })
            }
          >
            <option value="1">法人</option>
            <option value="0">個人</option>
          </select>
        </Field>
      </Section>

      {/* IV. 対象作品 + 有効期間 */}
      <Section
        title="IV. 対象作品 / 有効期間"
        icon={<LinkIcon className="w-3.5 h-3.5" />}
      >
        <Field label="原著作物名">
          <input
            className={inputClass}
            value={form.original_work}
            onChange={(e) =>
              setForm({ ...form, original_work: e.target.value })
            }
          />
        </Field>
        <Field label="対象製品 (予定) 名">
          <input
            className={inputClass}
            value={form.product_name_predicted}
            onChange={(e) =>
              setForm({ ...form, product_name_predicted: e.target.value })
            }
          />
        </Field>
        <Field label="効力発生日">
          <input
            type="date"
            className={inputClass}
            value={form.effective_date}
            onChange={(e) =>
              setForm({ ...form, effective_date: e.target.value })
            }
          />
        </Field>
        <Field label="満了日">
          <input
            type="date"
            className={inputClass}
            value={form.expiration_date}
            onChange={(e) =>
              setForm({ ...form, expiration_date: e.target.value })
            }
          />
        </Field>
        <Field label="自動更新">
          <select
            className={inputClass}
            value={form.auto_renewal ? "1" : "0"}
            onChange={(e) =>
              setForm({ ...form, auto_renewal: e.target.value === "1" })
            }
          >
            <option value="0">なし</option>
            <option value="1">あり</option>
          </select>
        </Field>
        <Field label="許諾期間注記">
          <input
            className={inputClass}
            value={form.license_period_note}
            onChange={(e) =>
              setForm({ ...form, license_period_note: e.target.value })
            }
          />
        </Field>
        <Field label="監修者">
          <input
            className={inputClass}
            value={form.supervisor}
            onChange={(e) =>
              setForm({ ...form, supervisor: e.target.value })
            }
          />
        </Field>
        <Field label="クレジット表示">
          <input
            className={inputClass}
            value={form.credit_display}
            onChange={(e) =>
              setForm({ ...form, credit_display: e.target.value })
            }
          />
        </Field>
        <Field label="特記事項 / 備考" full>
          <textarea
            className={cn(
              inputClass,
              "min-h-[60px] border bg-card rounded-sm px-2 py-1"
            )}
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            登録完了: {result.contract_number} (ledger_id: {result.ledger_id})
          </span>
        )}
        {result?.error && (
          <span className="text-[10px] font-mono text-red-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {result.error}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!requiredOk || submitting}
          className={cn(
            "px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors flex items-center gap-2",
            requiredOk && !submitting
              ? "bg-foreground text-background hover:opacity-80"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileInput className="w-3 h-3" />
          )}
          DB に登録
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// 業務委託基本契約書インポートフォーム
// ---------------------------------------------------------------------

const initialServiceMasterForm = {
  issue_key: "",
  contract_number: "",
  drive_link: "",
  contract_title: "",
  effective_date: "",
  expiration_date: "",
  auto_renewal: false,
  vendor_code: "",
  vendor_name: "",
  party_a_name: "",
  party_a_address: "",
  party_a_rep: "",
  party_b_name: "",
  party_b_address: "",
  party_b_rep: "",
  remarks: "",
}

const ServiceMasterImportForm: React.FC<{
  vendors: any[]
  companyProfile: any
  showNotification: (m: string, t?: "info" | "success" | "error") => void
}> = ({ vendors, companyProfile, showNotification }) => {
  const [form, setForm] = React.useState({ ...initialServiceMasterForm })
  const [submitting, setSubmitting] = React.useState(false)
  const [result, setResult] = React.useState<any>(null)

  const requiredOk = !!(
    form.contract_title &&
    (form.party_a_name || form.party_b_name)
  )

  const fillPartyAFromSelf = () => {
    if (!companyProfile) return
    setForm({
      ...form,
      party_a_name: companyProfile.name || "",
      party_a_address: companyProfile.address || "",
      party_a_rep: companyProfile.representative || "",
    })
  }

  const fillPartyBFromVendor = (code: string) => {
    const v = vendors.find((x) => x.vendor_code === code)
    if (!v) return
    setForm({
      ...form,
      vendor_code: v.vendor_code,
      vendor_name: v.vendor_name || "",
      party_b_name: v.vendor_name || "",
      party_b_address: v.address || "",
      party_b_rep: v.vendor_rep || v.contact_name || "",
    })
  }

  const submit = async () => {
    if (!requiredOk) {
      showNotification("必須項目を埋めてください", "error")
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch("/api/imports/service-master", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      setResult(data)
      showNotification(
        `業務委託基本契約書を登録しました (${data.contract_number})`,
        "success"
      )
    } catch (e: any) {
      showNotification(`登録失敗: ${e?.message || e}`, "error")
      setResult({ ok: false, error: String(e?.message || e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex items-center justify-between gap-3 px-4 py-2 rounded-sm border text-[11px] font-mono",
          requiredOk
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        )}
      >
        {requiredOk ? (
          <>✓ 登録可能 (契約名 / 甲 or 乙 1 つ以上)</>
        ) : (
          <>必須: 契約名 / 甲 or 乙</>
        )}
      </div>

      <div className="px-4 py-2 rounded-sm bg-blue-50 border border-blue-200 text-[10px] font-mono text-blue-900">
        業務委託「基本」契約書は、後続の発注書 / 検収書の親 framework
        として contract_capabilities に登録されます。法務検索 (Slack
        /法務検索) の対象にもなります。
      </div>

      {/* I. ヘッダ */}
      <Section title="I. ヘッダ" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <Field label="Backlog 課題キー" hint="空欄なら IMPORT-<ts>">
          <input
            className={inputClass}
            value={form.issue_key}
            onChange={(e) => setForm({ ...form, issue_key: e.target.value })}
          />
        </Field>
        <Field label="契約書番号" hint="空欄ならサーバ採番">
          <input
            className={inputClass}
            value={form.contract_number}
            onChange={(e) =>
              setForm({ ...form, contract_number: e.target.value })
            }
          />
        </Field>
        <Field label="契約名" required>
          <input
            className={inputClass}
            value={form.contract_title}
            onChange={(e) =>
              setForm({ ...form, contract_title: e.target.value })
            }
            placeholder="例: 株式会社◯◯ 業務委託基本契約"
          />
        </Field>
        <Field label="原本 PDF リンク">
          <input
            className={inputClass}
            value={form.drive_link}
            onChange={(e) => setForm({ ...form, drive_link: e.target.value })}
            placeholder="https://drive.google.com/..."
          />
        </Field>
        <Field label="効力発生日">
          <input
            type="date"
            className={inputClass}
            value={form.effective_date}
            onChange={(e) =>
              setForm({ ...form, effective_date: e.target.value })
            }
          />
        </Field>
        <Field label="満了日">
          <input
            type="date"
            className={inputClass}
            value={form.expiration_date}
            onChange={(e) =>
              setForm({ ...form, expiration_date: e.target.value })
            }
          />
        </Field>
        <Field label="自動更新">
          <select
            className={inputClass}
            value={form.auto_renewal ? "1" : "0"}
            onChange={(e) =>
              setForm({ ...form, auto_renewal: e.target.value === "1" })
            }
          >
            <option value="0">なし</option>
            <option value="1">あり</option>
          </select>
        </Field>
      </Section>

      {/* II. 甲 (委託者) */}
      <Section
        title="II. 甲 (委託者)"
        icon={<Building2 className="w-3.5 h-3.5" />}
        headerActions={
          <SideButton
            label="自社"
            onClick={fillPartyAFromSelf}
            disabled={!companyProfile}
          />
        }
      >
        <Field label="名称">
          <input
            className={inputClass}
            value={form.party_a_name}
            onChange={(e) =>
              setForm({ ...form, party_a_name: e.target.value })
            }
          />
        </Field>
        <Field label="住所">
          <input
            className={inputClass}
            value={form.party_a_address}
            onChange={(e) =>
              setForm({ ...form, party_a_address: e.target.value })
            }
          />
        </Field>
        <Field label="代表者名">
          <input
            className={inputClass}
            value={form.party_a_rep}
            onChange={(e) => setForm({ ...form, party_a_rep: e.target.value })}
          />
        </Field>
      </Section>

      {/* III. 乙 (受託者) */}
      <Section
        title="III. 乙 (受託者)"
        icon={<User className="w-3.5 h-3.5" />}
        headerActions={
          <div className="min-w-[220px]">
            <VendorSearchSelect
              vendors={vendors}
              selectedCode={form.vendor_code}
              onSelect={(v) => {
                if (v) fillPartyBFromVendor(v.vendor_code)
                else
                  setForm({
                    ...form,
                    vendor_code: "",
                    vendor_name: "",
                    party_b_name: "",
                    party_b_address: "",
                    party_b_rep: "",
                  })
              }}
              placeholder="取引先を検索…"
              size="compact"
            />
          </div>
        }
      >
        <Field label="名称">
          <input
            className={inputClass}
            value={form.party_b_name}
            onChange={(e) =>
              setForm({ ...form, party_b_name: e.target.value })
            }
          />
        </Field>
        <Field label="住所">
          <input
            className={inputClass}
            value={form.party_b_address}
            onChange={(e) =>
              setForm({ ...form, party_b_address: e.target.value })
            }
          />
        </Field>
        <Field label="代表者名">
          <input
            className={inputClass}
            value={form.party_b_rep}
            onChange={(e) => setForm({ ...form, party_b_rep: e.target.value })}
          />
        </Field>
        <Field label="備考" full>
          <textarea
            className={cn(
              inputClass,
              "min-h-[60px] border bg-card rounded-sm px-2 py-1"
            )}
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
          />
        </Field>
      </Section>

      <div className="flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            登録完了: {result.contract_number}
            {result.vendor_id && ` (vendor_id: ${result.vendor_id})`}
          </span>
        )}
        {result?.error && (
          <span className="text-[10px] font-mono text-red-700 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {result.error}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!requiredOk || submitting}
          className={cn(
            "px-4 py-2 text-[11px] font-mono uppercase tracking-wider rounded-sm transition-colors flex items-center gap-2",
            requiredOk && !submitting
              ? "bg-foreground text-background hover:opacity-80"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {submitting ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <FileInput className="w-3 h-3" />
          )}
          DB に登録
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Page shell + tabs
// ---------------------------------------------------------------------

export function ImportPage() {
  const { vendors, companyProfile, showNotification, refreshAll } = useAppData()
  const [tab, setTab] = React.useState<Tab>("purchase_order")
  const [bulkOpen, setBulkOpen] = React.useState(false)
  // Phase 22.21.34: 取引先 CSV 取込ダイアログ
  const [vendorCsvOpen, setVendorCsvOpen] = React.useState(false)

  // タブ key → bulk endpoint kind の対応表
  // pending_pdf はインポート系ではないので Map に含めない (Bulk dialog を開かない)
  const BULK_KIND_MAP: Partial<Record<
    Tab,
    | "order"
    | "license-contract"
    | "license-master"
    | "service-master"
    | "nda"
    | "sales-master"
    | "ringi"
  >> = {
    purchase_order: "order",
    individual_license_terms: "license-contract",
    license_master: "license-master",
    service_master: "service-master",
    nda: "nda",
    sales_master: "sales-master",
    ringi_master: "ringi",
  }

  const TAB_LABEL_MAP: Record<Tab, string> = {
    purchase_order: "発注書",
    individual_license_terms: "個別利用許諾条件書",
    license_master: "ライセンス基本契約書",
    service_master: "業務委託基本契約書",
    nda: "その他契約 (NDA)",
    sales_master: "売買基本契約書",
    pending_pdf: "PDF 未作成キュー",
    ringi_master: "稟議マスタ",
    // Phase 22.21.34: 取引先マスター
    vendor_master: "取引先マスタ",
  }

  return (
    <div className="px-6 lg:px-10 py-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="border-b border-border pb-3 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <Database className="w-3 h-3" />
            <span>Imports · Past Document Registration</span>
          </div>
          <h1 className="text-xl font-bold mt-1">過去文書 DB 登録</h1>
          <p className="text-[11px] font-mono text-muted-foreground mt-1 max-w-3xl">
            既に紙 / メール / 旧システムで成立済みの契約や発注を、PDF を再生成
            せずに DB に追記します。後続の検収書・ロイヤリティ計算書からは、
            通常生成した文書と同じく親文書として参照できるようになります。
          </p>
        </div>
        {/* Phase 10: 一括 CSV インポート起動ボタン (現タブに対応する形式で開く)
            pending_pdf タブでは別機能なので非表示
            Phase 22.21.34: vendor_master は別ダイアログ (VendorCsvImportDialog) */}
        {tab !== "pending_pdf" && tab !== "vendor_master" && BULK_KIND_MAP[tab] && (
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-2 hover:bg-muted flex items-center gap-1.5 whitespace-nowrap"
            title={`${TAB_LABEL_MAP[tab]} の CSV 一括インポート`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            CSV 一括インポート
          </button>
        )}
        {tab === "vendor_master" && (
          <button
            type="button"
            onClick={() => setVendorCsvOpen(true)}
            className="text-[10px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-3 py-2 hover:bg-muted flex items-center gap-1.5 whitespace-nowrap"
            title="取引先マスター CSV 一括取込"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            CSV 一括取込
          </button>
        )}
      </header>

      {BULK_KIND_MAP[tab] && (
        <BulkImportDialog
          kind={BULK_KIND_MAP[tab]!}
          label={TAB_LABEL_MAP[tab]}
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          onCompleted={() => {
            // インポート後、ダッシュボード等のマスター系を再取得
            refreshAll?.()
          }}
        />
      )}

      {/* Phase 22.21.34: 取引先 CSV 取込ダイアログ */}
      <VendorCsvImportDialog
        open={vendorCsvOpen}
        onClose={() => setVendorCsvOpen(false)}
        onCompleted={() => {
          refreshAll?.()
        }}
      />

      {/* Phase 16b: グループラベル付きタブバー — カテゴリが視覚的に分かる */}
      <div className="border-b border-border">
        {(
          [
            {
              group: "個別伝票",
              tabs: [
                { key: "purchase_order", label: "発注書" },
                { key: "individual_license_terms", label: "個別利用許諾条件書" },
              ],
            },
            {
              group: "基本契約",
              tabs: [
                { key: "license_master", label: "ライセンス基本契約書" },
                { key: "service_master", label: "業務委託基本契約書" },
                { key: "sales_master", label: "売買基本契約書" },
              ],
            },
            {
              group: "その他契約",
              tabs: [{ key: "nda", label: "NDA (秘密保持)" }],
            },
            {
              group: "マスタ",
              tabs: [
                { key: "ringi_master", label: "📋 稟議マスタ" },
                // Phase 22.21.34: 取引先マスター CSV 一括取込
                { key: "vendor_master", label: "🏢 取引先マスタ" },
              ],
            },
            {
              group: "PDF 生成",
              tabs: [{ key: "pending_pdf", label: "📄 PDF 未作成キュー" }],
            },
          ] as { group: string; tabs: { key: Tab; label: string }[] }[]
        ).map((g) => (
          <div key={g.group} className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0">
            <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground/70 w-24 flex-shrink-0">
              ░ {g.group}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {g.tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "px-3 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm border transition-colors",
                    tab === t.key
                      ? "bg-foreground text-background border-foreground font-bold"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {tab === "purchase_order" && (
        <OrderImportForm
          vendors={vendors || []}
          showNotification={showNotification}
        />
      )}
      {tab === "individual_license_terms" && (
        <LicenseImportForm
          vendors={vendors || []}
          companyProfile={companyProfile}
          showNotification={showNotification}
        />
      )}
      {tab === "license_master" && (
        <LicenseMasterImportForm
          vendors={vendors || []}
          companyProfile={companyProfile}
          showNotification={showNotification}
        />
      )}
      {tab === "service_master" && (
        <ServiceMasterImportForm
          vendors={vendors || []}
          companyProfile={companyProfile}
          showNotification={showNotification}
        />
      )}

      {/* Phase 15: PDF 未作成キュー */}
      {tab === "pending_pdf" && <PendingPdfPanel />}

      {/* Phase 17e: 稟議マスタは CSV 一括インポートのみ対応 */}
      {tab === "ringi_master" && (
        <div className="space-y-4">
          <div className="border border-emerald-200 bg-emerald-50 rounded-sm p-5">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-6 h-6 text-emerald-700 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <div className="font-bold text-emerald-900 text-sm">
                  📋 稟議マスタの一括登録
                </div>
                <p className="text-[11px] font-mono text-emerald-900/80 leading-relaxed">
                  稟議番号 (5 桁数字, 例: 00001) と稟議タイトル / 起案者 /
                  承認日 等を CSV で一括投入できます。各文書 (発注書 /
                  個別利用許諾 / NDA 等) から ringi_numbers 列で参照する前に、
                  稟議マスタ側に先に登録しておくと N:N 紐付けがエラーなく
                  通ります。
                </p>
                <p className="text-[10px] font-mono text-emerald-800/70">
                  既存の稟議番号と同じ値で再 import すると上書き更新 (upsert) されます。
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="text-[11px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-4 py-2 hover:bg-muted flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            稟議マスタ CSV 一括インポートを開く
          </button>
        </div>
      )}

      {/* Phase 22.21.34: 取引先マスタ CSV 一括取込 (VendorCsvImportDialog) */}
      {tab === "vendor_master" && (
        <div className="space-y-4">
          <div className="border border-indigo-200 bg-indigo-50 rounded-sm p-5">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-6 h-6 text-indigo-700 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <div className="font-bold text-indigo-900 text-sm">
                  🏢 取引先マスタ CSV 一括取込
                </div>
                <p className="text-[11px] font-mono text-indigo-900/80 leading-relaxed">
                  取引先 (vendors) を CSV で一括登録・更新できます。vendor_code
                  と vendor_name は必須、その他 (住所 / 担当者 / 振込先 / 法人
                  個人区分 等) は任意です。
                </p>
                <p className="text-[11px] font-mono text-indigo-900/80 leading-relaxed">
                  「プレビュー (dry-run)」で 何件 新規 / 更新 / スキップ / エラー
                  になるかを確認した上で、本番取り込みできます。
                </p>
                <p className="text-[10px] font-mono text-indigo-800/70">
                  既存 vendor_code との重複モードは「上書き / スキップ / 空欄補完」
                  から選択。
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setVendorCsvOpen(true)}
            className="text-[11px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-4 py-2 hover:bg-muted flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            取引先マスタ CSV 一括取込を開く
          </button>
        </div>
      )}

      {/* Phase 14a: NDA / 売買基本 は単一フォーム未提供。
          CSV 一括インポートへの導線のみ表示。 */}
      {(tab === "nda" || tab === "sales_master") && (
        <div className="space-y-4">
          <div className="border border-blue-200 bg-blue-50 rounded-sm p-5">
            <div className="flex items-start gap-3">
              <FileSpreadsheet className="w-6 h-6 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <div className="font-bold text-blue-900 text-sm">
                  {tab === "nda"
                    ? "秘密保持契約書 (NDA)"
                    : "売買基本契約書 (3 バリエーション)"}
                  : CSV 一括インポートのみ対応
                </div>
                <p className="text-[11px] font-mono text-blue-800 leading-relaxed">
                  {tab === "nda"
                    ? "NDA は単一フォーム入力よりも CSV 一括の方が運用しやすいため、一括インポート専用です。右上の「CSV 一括インポート」ボタンからどうぞ。"
                    : "売買基本契約書は buyer / standard / credit の 3 バリエーションを variant 列で振り分けます。テンプレ CSV をダウンロードしてサンプル行を参照してください。"}
                </p>
                <p className="text-[10px] font-mono text-blue-700/80">
                  generate_pdf 列に「未作成」を入れると、登録と同時に PDF も
                  自動生成 + Drive アップロードされます。「作成済」なら DB
                  登録のみ。
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBulkOpen(true)}
            className="text-[11px] font-mono uppercase tracking-wider border border-foreground/30 rounded-sm px-4 py-2 hover:bg-muted flex items-center gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV 一括インポートを開く
          </button>
        </div>
      )}
    </div>
  )
}
