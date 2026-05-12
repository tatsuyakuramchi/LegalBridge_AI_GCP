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
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { cn } from "@/lib/utils"
import {
  LineItemTable,
  type LineItem,
} from "@/src/components/document/LineItemTable"
import {
  FinancialConditionTable,
  type FinancialCondition,
} from "@/src/components/document/FinancialConditionTable"

type Tab =
  | "purchase_order"
  | "individual_license_terms"
  | "license_master"
  | "service_master"

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

  const requiredOk = !!(
    form.vendor_name &&
    form.description &&
    Array.isArray(form.items) &&
    form.items.length > 0
  )

  const pickVendor = (code: string) => {
    const v = vendors.find((x) => x.vendor_code === code)
    if (!v) return
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
          <select
            className={inputClass}
            value={form.vendor_code}
            onChange={(e) => pickVendor(e.target.value)}
          >
            <option value="">— マスターから選択 —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.vendor_code}>
                {v.vendor_code} - {v.vendor_name}
              </option>
            ))}
          </select>
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

      {/* 送信 */}
      <div className="flex items-center justify-end gap-3">
        {result?.ok && (
          <span className="text-[10px] font-mono text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            登録完了: {result.document_number} ({result.line_count} 明細,
            ¥{Number(result.totals?.amount_ex_tax || 0).toLocaleString("ja-JP")})
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
              <select
                className="text-[9px] font-mono border border-foreground/30 rounded-sm px-1 py-0.5 bg-card hover:bg-muted"
                value={selectedVendorCode}
                onChange={(e) => {
                  setSelectedVendorCode(e.target.value)
                  if (e.target.value) fillFromVendor(e.target.value, "licensor")
                }}
              >
                <option value="">取引先選択...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.vendor_code}>
                    {v.vendor_code} {v.vendor_name}
                  </option>
                ))}
              </select>
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
              <select
                className="text-[9px] font-mono border border-foreground/30 rounded-sm px-1 py-0.5 bg-card hover:bg-muted"
                value=""
                onChange={(e) => {
                  if (e.target.value) fillFromVendor(e.target.value, "licensee")
                }}
              >
                <option value="">取引先選択...</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.vendor_code}>
                    {v.vendor_code} {v.vendor_name}
                  </option>
                ))}
              </select>
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
            <select
              className="text-[9px] font-mono border border-foreground/30 rounded-sm px-1 py-0.5 bg-card hover:bg-muted"
              value=""
              onChange={(e) => {
                if (e.target.value) fillFromVendor(e.target.value, "licensor")
              }}
            >
              <option value="">取引先選択...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.vendor_code}>
                  {v.vendor_code} {v.vendor_name}
                </option>
              ))}
            </select>
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
            <select
              className="text-[9px] font-mono border border-foreground/30 rounded-sm px-1 py-0.5 bg-card hover:bg-muted"
              value=""
              onChange={(e) => {
                if (e.target.value) fillFromVendor(e.target.value, "licensee")
              }}
            >
              <option value="">取引先選択...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.vendor_code}>
                  {v.vendor_code} {v.vendor_name}
                </option>
              ))}
            </select>
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
          <select
            className="text-[9px] font-mono border border-foreground/30 rounded-sm px-1 py-0.5 bg-card hover:bg-muted"
            value={form.vendor_code}
            onChange={(e) => fillPartyBFromVendor(e.target.value)}
          >
            <option value="">取引先選択...</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.vendor_code}>
                {v.vendor_code} {v.vendor_name}
              </option>
            ))}
          </select>
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
  const { vendors, companyProfile, showNotification } = useAppData()
  const [tab, setTab] = React.useState<Tab>("purchase_order")

  return (
    <div className="px-6 lg:px-10 py-6 space-y-6 max-w-[1600px] mx-auto">
      <header className="border-b border-border pb-3">
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
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border">
        {(
          [
            { key: "purchase_order", label: "発注書", group: "個別伝票" },
            {
              key: "individual_license_terms",
              label: "個別利用許諾条件書",
              group: "個別伝票",
            },
            {
              key: "license_master",
              label: "ライセンス基本契約書",
              group: "基本契約",
            },
            {
              key: "service_master",
              label: "業務委託基本契約書",
              group: "基本契約",
            },
          ] as { key: Tab; label: string; group: string }[]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-[11px] font-mono uppercase tracking-wider border-b-2 transition-colors relative",
              tab === t.key
                ? "border-foreground text-foreground font-bold"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            title={t.group}
          >
            {t.label}
          </button>
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
    </div>
  )
}
