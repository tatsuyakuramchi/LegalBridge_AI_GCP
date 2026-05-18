/**
 * QuickCreateIssueModal — RequestsPage から呼ぶ Backlog 課題のクイック起案ダイアログ
 * (Phase 22.6)
 *
 * ユースケース:
 *   法務が口頭/メールで受けた依頼を Backlog 課題として即時起案するトリガー。
 *   Slack 起票と違って PDF 自動生成も Slack DM もしない最小フロー。
 *
 * 課題名の均一化:
 *   フォーマットは固定で `【${typeLabel}】${counterparty}｜${subTopic}` を生成。
 *   ユーザーは自由入力できず、選択肢と短いテキストフィールドの組み合わせで
 *   組み上げる (= 案件管理側で課題名ばらつきが起きないようにする)。
 *
 * 相手方:
 *   - 取引先マスター (VendorSearchSelect) から選択 → vendor_name + vendor_code を取得
 *   - 未登録の場合は手入力モードに切替可能
 */

import * as React from "react"
import { Sparkles, Loader2, ChevronRight } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { VendorSearchSelect } from "@/src/components/document/VendorSearchSelect"
import { cn } from "@/lib/utils"

/**
 * 起案テンプレート: Backlog の親タイプ (issueTypeLabel) + 内部 request_type + UI ラベル。
 *
 * issueTypeLabel は Backlog プロジェクト側で実際に存在する種別名と一致させる必要がある。
 * (Phase 22 のリプロジェクトで 5 種類に整理済み: 契約審査 / 法務相談 / 事務手続 /
 *  納品・検収 / 利用許諾計算)。
 *
 * subTopicDefault は modal を開いたときの "サブテーマ" 初期値。ユーザーが編集可能。
 */
type IssueTemplate = {
  id: string
  issueTypeLabel: string
  requestType: string
  label: string
  subTopicDefault: string
}

const ISSUE_TEMPLATES: IssueTemplate[] = [
  {
    id: "contract_outsourcing",
    issueTypeLabel: "契約審査",
    requestType: "outsourcing",
    label: "業務委託契約",
    subTopicDefault: "業務委託基本契約書",
  },
  {
    id: "contract_nda",
    issueTypeLabel: "契約審査",
    requestType: "nda",
    label: "NDA",
    subTopicDefault: "秘密保持契約",
  },
  {
    id: "contract_license_master",
    issueTypeLabel: "契約審査",
    requestType: "license_master",
    label: "ライセンス基本契約",
    subTopicDefault: "ライセンス基本契約書",
  },
  {
    id: "contract_lic_individual",
    issueTypeLabel: "契約審査",
    requestType: "lic_individual",
    label: "個別利用許諾",
    subTopicDefault: "個別利用許諾条件書",
  },
  {
    id: "contract_sales_master",
    issueTypeLabel: "契約審査",
    requestType: "sales_master",
    label: "売買基本契約",
    subTopicDefault: "売買基本契約書",
  },
  {
    id: "contract_other",
    issueTypeLabel: "契約審査",
    requestType: "contract",
    label: "その他契約",
    subTopicDefault: "",
  },
  {
    id: "purchase_order",
    issueTypeLabel: "契約審査",
    requestType: "purchase_order",
    label: "発注書",
    subTopicDefault: "発注書",
  },
  {
    id: "delivery_inspec",
    issueTypeLabel: "納品・検収",
    requestType: "delivery_inspec",
    label: "検収",
    subTopicDefault: "検収書",
  },
  {
    id: "license_calc",
    issueTypeLabel: "利用許諾計算",
    requestType: "license_calc",
    label: "利用許諾料計算",
    subTopicDefault: "利用許諾料計算書",
  },
  {
    id: "legal_consult",
    issueTypeLabel: "法務相談",
    requestType: "legal_consult",
    label: "法務相談",
    subTopicDefault: "",
  },
  {
    id: "notification",
    issueTypeLabel: "事務手続",
    requestType: "legal_request",
    label: "通知書・その他事務",
    subTopicDefault: "",
  },
]

interface QuickCreateIssueModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const QuickCreateIssueModal: React.FC<QuickCreateIssueModalProps> = ({
  open,
  onOpenChange,
}) => {
  const { vendors, refreshIssues, showNotification } = useAppData()

  const [templateId, setTemplateId] = React.useState<string>(
    ISSUE_TEMPLATES[0].id
  )
  const [counterpartyMode, setCounterpartyMode] = React.useState<
    "master" | "manual"
  >("master")
  const [selectedVendorCode, setSelectedVendorCode] = React.useState<string>("")
  const [manualCounterparty, setManualCounterparty] = React.useState<string>("")
  const [subTopic, setSubTopic] = React.useState<string>("")
  const [deadline, setDeadline] = React.useState<string>("")
  const [dept, setDept] = React.useState<string>("")
  const [details, setDetails] = React.useState<string>("")
  const [submitting, setSubmitting] = React.useState<boolean>(false)

  // テンプレを変えたら subTopic のデフォルトに置換 (空のときだけ)
  const currentTemplate =
    ISSUE_TEMPLATES.find((t) => t.id === templateId) || ISSUE_TEMPLATES[0]
  const prevTemplateIdRef = React.useRef<string>(templateId)
  React.useEffect(() => {
    if (prevTemplateIdRef.current === templateId) return
    prevTemplateIdRef.current = templateId
    // ユーザーが既に編集していたら尊重、未編集 (デフォルト値 or 空) なら入れ替え
    if (!subTopic || ISSUE_TEMPLATES.some((t) => t.subTopicDefault === subTopic)) {
      setSubTopic(currentTemplate.subTopicDefault)
    }
  }, [templateId, currentTemplate.subTopicDefault, subTopic])

  // 初期化 (open になった瞬間)
  React.useEffect(() => {
    if (!open) return
    setTemplateId(ISSUE_TEMPLATES[0].id)
    setCounterpartyMode("master")
    setSelectedVendorCode("")
    setManualCounterparty("")
    setSubTopic(ISSUE_TEMPLATES[0].subTopicDefault)
    setDeadline("")
    setDept("")
    setDetails("")
    setSubmitting(false)
    prevTemplateIdRef.current = ISSUE_TEMPLATES[0].id
  }, [open])

  // 課題名プレビューを live 計算 (= 実送信時の summary と同じロジック)
  const selectedVendor = React.useMemo(
    () => vendors.find((v) => v.vendor_code === selectedVendorCode) || null,
    [vendors, selectedVendorCode]
  )
  const counterpartyDisplay = React.useMemo(() => {
    if (counterpartyMode === "master") {
      return selectedVendor?.vendor_name || ""
    }
    return manualCounterparty.trim()
  }, [counterpartyMode, selectedVendor, manualCounterparty])

  const previewTitle = `【${currentTemplate.issueTypeLabel}】${
    counterpartyDisplay || "(相手方未指定)"
  }｜${subTopic.trim() || "(内容未指定)"}`

  const canSubmit =
    !submitting &&
    counterpartyDisplay.length > 0 &&
    subTopic.trim().length > 0

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/backlog/issues/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issueTypeLabel: currentTemplate.issueTypeLabel,
          requestType: currentTemplate.requestType,
          counterpartyName: counterpartyDisplay,
          vendorCode:
            counterpartyMode === "master" ? selectedVendorCode : "",
          subTopic: subTopic.trim(),
          deadline,
          dept,
          details,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        showNotification(
          `起案に失敗しました: ${data?.error || res.statusText}`,
          "error"
        )
        return
      }
      showNotification(
        `起案完了: ${data.issueKey} を作成しました`,
        "success"
      )
      // 一覧を即時更新
      await refreshIssues()
      onOpenChange(false)
    } catch (err: any) {
      showNotification(`起案エラー: ${err?.message || err}`, "error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            新規 Backlog 課題を起案
          </DialogTitle>
          <DialogDescription>
            口頭 / メール依頼を受けた案件を Backlog 課題として登録します。課題名は
            自動で 【タイプ】相手方｜サブテーマ の形式で組み立てられます。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5 max-h-[60vh] overflow-y-auto">
          {/* 1. 課題タイプ */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              課題タイプ <span className="text-amber-600">*</span>
            </label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full text-xs font-mono bg-transparent border-b border-input py-1.5 focus:outline-none focus:border-foreground"
            >
              {ISSUE_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.issueTypeLabel}] {t.label}
                </option>
              ))}
            </select>
            <p className="text-[10px] font-mono text-muted-foreground/70">
              Backlog 種別: <strong>{currentTemplate.issueTypeLabel}</strong> /
              内部 type: <code>{currentTemplate.requestType}</code>
            </p>
          </div>

          {/* 2. 相手方 (master / manual 切替) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                相手方 <span className="text-amber-600">*</span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("master")}
                  className={cn(
                    "text-[9px] font-mono px-2 py-0.5 border rounded-sm transition-colors",
                    counterpartyMode === "master"
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:border-foreground"
                  )}
                >
                  マスター
                </button>
                <button
                  type="button"
                  onClick={() => setCounterpartyMode("manual")}
                  className={cn(
                    "text-[9px] font-mono px-2 py-0.5 border rounded-sm transition-colors",
                    counterpartyMode === "manual"
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:border-foreground"
                  )}
                >
                  手入力
                </button>
              </div>
            </div>
            {counterpartyMode === "master" ? (
              <VendorSearchSelect
                vendors={vendors}
                selectedCode={selectedVendorCode}
                onSelect={(v) => setSelectedVendorCode(v?.vendor_code || "")}
                placeholder="取引先マスターから検索 (コード/名称/屋号)"
              />
            ) : (
              <Input
                value={manualCounterparty}
                onChange={(e) => setManualCounterparty(e.target.value)}
                placeholder="例: 株式会社サンプル商事 / 個人事業主 山田太郎"
                className="text-xs font-mono"
              />
            )}
          </div>

          {/* 3. サブテーマ */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              サブテーマ <span className="text-amber-600">*</span>
            </label>
            <Input
              value={subTopic}
              onChange={(e) => setSubTopic(e.target.value)}
              placeholder={
                currentTemplate.subTopicDefault ||
                "例: 業務委託基本契約書ドラフト / 著作権について"
              }
              className="text-xs font-mono"
            />
            <p className="text-[10px] font-mono text-muted-foreground/70">
              課題名に含まれる短い見出し。具体的な文書名やテーマを記入。
            </p>
          </div>

          {/* 4. 希望納期 + 依頼部署 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                希望納期 (任意)
              </label>
              <Input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
                依頼部署 (任意)
              </label>
              <Input
                value={dept}
                onChange={(e) => setDept(e.target.value)}
                placeholder="例: 編集部 / 開発本部"
                className="text-xs font-mono"
              />
            </div>
          </div>

          {/* 5. 詳細メモ */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground">
              詳細メモ (任意)
            </label>
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="背景・経緯・依頼者連絡先など、Backlog の説明欄に残しておきたい内容"
              rows={3}
              className="text-xs font-mono"
            />
          </div>

          {/* プレビュー */}
          <div className="border border-dashed border-border rounded-sm bg-muted/30 p-3 space-y-1">
            <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              作成される課題名 (プレビュー)
            </div>
            <div className="text-sm font-mono font-bold break-all">
              {previewTitle}
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                起案中…
              </>
            ) : (
              <>
                Backlog に起案
                <ChevronRight className="h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
