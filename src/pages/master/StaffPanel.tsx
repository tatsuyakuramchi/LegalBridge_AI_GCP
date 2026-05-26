import * as React from "react"
import { Search, Plus, User } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

const empty = { staff_name: "", department: "", slack_user_id: "", email: "" }

export function StaffPanel() {
  const { staffList, refreshStaff, showNotification } = useAppData()
  const [search, setSearch] = React.useState("")
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)

  const filtered = staffList.filter(
    (s) =>
      !search ||
      s.staff_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.department && s.department.toLowerCase().includes(search.toLowerCase()))
  )

  const open = !!editing || creating
  const data = creating ? draft : editing
  const set = (patch: any) => {
    if (creating) setDraft({ ...draft, ...patch })
    else setEditing({ ...editing, ...patch })
  }
  const close = () => {
    setEditing(null)
    setCreating(false)
    setDraft(empty)
  }

  const [saving, setSaving] = React.useState(false)

  // Worker /api/master/staff は POST のみ。
  //   - 編集時: body.id を含めて UPDATE モード (Phase 22.21.120)
  //   - 新規時: slack_user_id で upsert (空ならプレースホルダ自動採番)
  const save = async () => {
    setSaving(true)
    try {
      const isEdit = !!editing
      // Phase 22.21.120: 編集時は id を必ず付ける (Worker 側で UPDATE 経路に入る)。
      const body = isEdit && data?.id != null ? { ...data, id: Number(data.id) } : data
      const res = await fetch("/api/master/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        showNotification(
          isEdit
            ? `「${data?.staff_name || data?.slack_user_id || "(無名)"}」を更新しました`
            : `「${data?.staff_name || data?.slack_user_id || "(無名)"}」を登録しました`,
          "success"
        )
        await refreshStaff()
        close()
      } else {
        // Phase 22.21.120: Worker のエラー詳細 (error / code / constraint) を表示。
        let errBody: any = null
        try {
          errBody = await res.json()
        } catch {
          // text の可能性
          try {
            errBody = { error: await res.text() }
          } catch {}
        }
        const parts: string[] = []
        if (errBody?.error) parts.push(errBody.error)
        if (errBody?.code) parts.push(`code=${errBody.code}`)
        if (errBody?.constraint) parts.push(`constraint=${errBody.constraint}`)
        const detail = parts.length > 0 ? ` — ${parts.join(" / ")}` : ""
        showNotification(
          `保存に失敗しました (HTTP ${res.status})${detail}`,
          "error"
        )
        console.error("Staff save failed:", { status: res.status, errBody })
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
      console.error("Staff save threw:", e)
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
            placeholder="担当者名・部署名で検索…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
          {staffList.length} entries
        </span>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setDraft(empty)
            setCreating(true)
          }}
        >
          <Plus />
          担当者を追加
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((s, idx) => (
          <Card
            key={`staff-${s.slack_user_id || idx}`}
            className="cursor-pointer hover:border-foreground transition-all"
            onClick={() => {
              setEditing(s)
              setCreating(false)
            }}
          >
            <CardContent className="px-4 flex items-center gap-3">
              <Avatar>
                <AvatarFallback>{s.staff_name.charAt(0)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="text-sm font-mono font-bold truncate">
                  {s.staff_name}
                </p>
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground truncate">
                  {s.department || "—"}
                </p>
                <Badge variant="outline" className="mt-1">
                  @{s.slack_user_id}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-border rounded-md">
            <User className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground">
              No staff registered.
            </p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規担当者の登録" : "担当者の編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="氏名 *">
              <Input
                value={data?.staff_name || ""}
                onChange={(e) => set({ staff_name: e.target.value })}
              />
            </Field>
            <Field label="部署">
              <Input
                value={data?.department || ""}
                onChange={(e) => set({ department: e.target.value })}
              />
            </Field>
            <Field label="Slack User ID">
              <Input
                value={data?.slack_user_id || ""}
                disabled={!!editing}
                onChange={(e) => set({ slack_user_id: e.target.value })}
                placeholder="U12345678"
              />
            </Field>
            <Field label="メール">
              <Input
                type="email"
                value={data?.email || ""}
                onChange={(e) => set({ email: e.target.value })}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}
