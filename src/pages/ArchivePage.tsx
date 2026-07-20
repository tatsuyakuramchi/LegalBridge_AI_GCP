import * as React from "react"
import { useNavigate } from "react-router-dom"
import { Search, Plus, Archive as ArchiveIcon, ChevronRight, ExternalLink, Edit3 } from "lucide-react"

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

export function ArchivePage() {
  const { assets, setAssets, showNotification } = useAppData()
  const navigate = useNavigate()
  const [search, setSearch] = React.useState("")
  const [reeditBusy, setReeditBusy] = React.useState<string | null>(null)
  // Phase 23.1: 履歴 (archived_draft / reissued) を表示するトグル。
  //   default: false (final のみ表示)。ON で /api/management/assets?include_history=1
  //   を fetch し直す。
  const [showHistory, setShowHistory] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/management/assets${showHistory ? "?include_history=1" : ""}`
        )
        const data = await res.json()
        if (!cancelled && Array.isArray(data)) setAssets(data)
      } catch (e) {
        console.warn("[ArchivePage] assets re-fetch failed:", e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showHistory, setAssets])

  // Phase 16: 既存文書を再編集モードで開く。
  // asset_number = documents.document_number で紐付くので、
  // /api/documents/by-number/<asset_number> で id を引いてから
  // /documents/new?reopen=<id> に遷移する。
  const handleReedit = async (assetNumber: string) => {
    if (!assetNumber) {
      showNotification("Asset number 未設定の項目は再編集できません", "error")
      return
    }
    setReeditBusy(assetNumber)
    try {
      const res = await fetch(
        `/api/documents/by-number/${encodeURIComponent(assetNumber)}`
      )
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      navigate(`/documents/new?reopen=${data.id}`)
    } catch (e: any) {
      showNotification(
        `再編集モードで開けませんでした: ${e?.message || e}`,
        "error"
      )
    } finally {
      setReeditBusy(null)
    }
  }
  const [openRegister, setOpenRegister] = React.useState(false)
  const [form, setForm] = React.useState<any>({
    asset_name: "",
    asset_type: "contract",
    counterparty: "",
    status: "active",
    file_link: "",
    start_date: "",
    end_date: "",
    backlog_issue_key: "",
  })

  const filtered = assets.filter(
    (a) =>
      a.asset_name?.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_number?.toLowerCase().includes(search.toLowerCase()) ||
      a.counterparty?.toLowerCase().includes(search.toLowerCase())
  )

  const submit = async () => {
    try {
      const res = await fetch("/api/management/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        showNotification("Asset registered.", "success")
        const list = await fetch("/api/management/assets").then((r) => r.json())
        setAssets(Array.isArray(list) ? list : [])
        setOpenRegister(false)
        setForm({
          asset_name: "",
          asset_type: "contract",
          counterparty: "",
          status: "active",
          file_link: "",
          start_date: "",
          end_date: "",
          backlog_issue_key: "",
        })
      } else {
        showNotification("Failed to register asset.", "error")
      }
    } catch (e) {
      showNotification("Server error.", "error")
    }
  }

  return (
    <div className="px-6 py-6 max-w-[1400px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">ARC · LEDGER</p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Archive
          </h2>
          <p className="text-xs text-muted-foreground mt-1.5">
            Immutable record of all legal artifacts generated through Arcs OS.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Filter archive…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          {/* Phase 23.1: 履歴 (archived_draft / reissued) も表示するトグル。
              default は OFF (= 現在の正のみ)。 */}
          <label className="flex items-center gap-1.5 text-[11px] font-mono cursor-pointer select-none border border-input rounded-sm px-2 py-1.5 hover:bg-muted/40">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(e) => setShowHistory(e.target.checked)}
              className="cursor-pointer"
            />
            <span>履歴を表示</span>
          </label>
          <Button onClick={() => setOpenRegister(true)}>
            <Plus />
            Register
          </Button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-border rounded-md">
          <ArchiveIcon className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            No archived assets yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset, idx) => (
            <Card
              key={`asset-${asset.id || idx}`}
              className="group hover:border-foreground transition-all"
            >
              <CardContent className="px-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center bg-muted rounded-sm">
                    <ArchiveIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Phase 22.12: 真の契約 / 旧版 バッジ */}
                    {(asset as any).revision > 0 && (
                      <Badge variant="outline" className="h-4 text-[11px]">
                        Rev. {(asset as any).revision}
                      </Badge>
                    )}
                    {(asset as any).is_primary === false ? (
                      <Badge variant="phosphor" className="h-4 opacity-70" title="旧版 (新リビジョンに置き換えられた)">
                        旧版
                      </Badge>
                    ) : (
                      <Badge variant="success" className="h-4" title="真の契約 (検索一覧に表示される)">
                        ★ 真
                      </Badge>
                    )}
                    {/* Phase 22.21.66: マスター契約ステータス (5 段階) */}
                    {(asset as any).contract_status && (() => {
                      const s = String((asset as any).contract_status)
                      const label =
                        s === "draft" ? "作成中" :
                        s === "awaiting_signature" ? "締結待ち" :
                        s === "executed" ? "締結中" :
                        s === "expired" ? "満了" :
                        s === "terminated" ? "解約済" : s
                      const variant: any =
                        s === "executed" ? "success" :
                        s === "awaiting_signature" ? "warning" :
                        s === "draft" ? "phosphor" :
                        s === "expired" ? "outline" :
                        s === "terminated" ? "destructive" : "outline"
                      return (
                        <Badge variant={variant} className="h-4" title={`マスター契約ステータス: ${label}`}>
                          ● {label}
                        </Badge>
                      )
                    })()}
                    <Badge variant="outline">{asset.asset_type}</Badge>
                  </div>
                </div>
                <div>
                  <p className="text-sm font-mono font-bold truncate">
                    {asset.asset_name}
                  </p>
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mt-1">
                    Ref · {asset.asset_number}
                  </p>
                  {(asset as any).base_document_number &&
                    (asset as any).base_document_number !== asset.asset_number && (
                      <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
                        Base · {(asset as any).base_document_number}
                      </p>
                    )}
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                    With · {asset.counterparty}
                  </p>
                </div>
                <div className="pt-2 border-t border-dashed border-border flex items-center justify-between gap-2">
                  <Badge variant="success">Secured</Badge>
                  <div className="flex items-center gap-1.5">
                    {asset.file_link && (
                      <a
                        href={asset.file_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border rounded-sm px-1.5 py-0.5 flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-2.5 w-2.5" />
                        開く
                      </a>
                    )}
                    {/* Phase 22.12: 旧版を真の契約に戻す手動オーバーライド。
                        is_primary=false の行にだけ表示。 */}
                    {(asset as any).is_primary === false && (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = window.confirm(
                            `${asset.asset_number} を「真の契約」にしますか?\n\n同 base の他の版は旧版扱いになります。`
                          )
                          if (!ok) return
                          try {
                            const res = await fetch(
                              `/api/documents/${encodeURIComponent(asset.asset_number)}/mark-primary`,
                              { method: "POST" }
                            )
                            const data = await res.json()
                            if (!res.ok || !data?.ok) {
                              throw new Error(data?.error || `HTTP ${res.status}`)
                            }
                            showNotification(
                              `${asset.asset_number} を真の契約に設定しました`,
                              "success"
                            )
                            const list = await fetch("/api/management/assets").then((r) => r.json())
                            setAssets(Array.isArray(list) ? list : [])
                          } catch (e: any) {
                            showNotification(
                              `失敗しました: ${e?.message || e}`,
                              "error"
                            )
                          }
                        }}
                        className="text-[11px] uppercase tracking-wider text-success border border-success bg-success/10 hover:bg-success/10 rounded-sm px-1.5 py-0.5 flex items-center gap-1"
                        title="この版を真の契約として設定 (他の版は旧版扱いに)"
                      >
                        ★ 真にする
                      </button>
                    )}
                    {/* Phase 16: 既存文書の再編集 — form_data を pre-fill して
                        DocumentEditorPage を開く。同じ document_number で PDF を
                        差し替え可能。 */}
                    <button
                      type="button"
                      onClick={() => handleReedit(asset.asset_number)}
                      disabled={reeditBusy === asset.asset_number}
                      className="text-[11px] uppercase tracking-wider text-foreground border border-foreground/40 rounded-sm px-1.5 py-0.5 flex items-center gap-1 hover:bg-muted disabled:opacity-50"
                      title="この文書を再編集して PDF を差し替え"
                    >
                      <Edit3 className="h-2.5 w-2.5" />
                      再編集
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Register dialog */}
      <Dialog open={openRegister} onOpenChange={setOpenRegister}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Register Concluded Asset</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  value={form.asset_name}
                  onChange={(e) => setForm({ ...form, asset_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Type</Label>
                <NativeSelect
                  value={form.asset_type}
                  onChange={(e) => setForm({ ...form, asset_type: e.target.value })}
                >
                  <option value="contract">contract</option>
                  <option value="ledger">ledger</option>
                  <option value="other">other</option>
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label>Counterparty</Label>
                <Input
                  value={form.counterparty}
                  onChange={(e) => setForm({ ...form, counterparty: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Backlog issue key</Label>
                <Input
                  value={form.backlog_issue_key}
                  onChange={(e) =>
                    setForm({ ...form, backlog_issue_key: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Start date</Label>
                <Input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>End date</Label>
                <Input
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>File link</Label>
                <Input
                  value={form.file_link}
                  onChange={(e) => setForm({ ...form, file_link: e.target.value })}
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenRegister(false)}>
              Cancel
            </Button>
            <Button onClick={submit}>
              <ExternalLink />
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
