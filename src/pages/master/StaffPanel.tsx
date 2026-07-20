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
import { AppFormField, ValidationSummary } from "@/src/components/form"

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
  // 必須: 氏名（FRM-02 ValidationSummary / AppFormField で表示）。
  const nameError: string | null =
    open && !String(data?.staff_name || "").trim() ? "氏名は必須です" : null
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
  const [roleSaving, setRoleSaving] = React.useState(false)

  // 統合 Phase 3: 役割(app_role)変更。search-api の正規 PATCH を直接叩く
  //   (apiRouter が当該パスを READ_URL=search-api へ振る)。
  const changeRole = async (newRole: "admin" | "viewer") => {
    if (!editing?.email) {
      showNotification("メール未登録のため役割を変更できません", "error")
      return
    }
    if ((editing.app_role || "viewer").toLowerCase() === newRole) return
    setRoleSaving(true)
    try {
      const res = await fetch(
        `/api/master/staff/${encodeURIComponent(editing.email)}/role`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ app_role: newRole }),
        }
      )
      const j = await res.json().catch(() => null)
      if (res.ok && j?.ok !== false) {
        setEditing({ ...editing, app_role: newRole })
        showNotification(
          `「${editing.staff_name || editing.email}」を ${newRole} に変更しました`,
          "success"
        )
        await refreshStaff()
      } else {
        showNotification(
          `役割変更に失敗 (HTTP ${res.status})${j?.error ? ` — ${j.error}` : ""}`,
          "error"
        )
      }
    } catch (e: any) {
      showNotification(`サーバーエラー: ${e?.message || e}`, "error")
    } finally {
      setRoleSaving(false)
    }
  }

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
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
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
                <p className="text-sm font-semibold truncate">
                  {s.staff_name}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {s.department || "—"}
                </p>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline">@{s.slack_user_id}</Badge>
                  {(s.app_role || "").toLowerCase() === "admin" ? (
                    <Badge className="bg-info text-white hover:bg-info">
                      admin
                    </Badge>
                  ) : (
                    <Badge variant="secondary">viewer</Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-border rounded-md">
            <User className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
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
            <ValidationSummary issues={nameError ? [{ id: "name", level: "error", message: "氏名を入力してください", fieldId: "staff_name" }] : []} />
            <AppFormField label="氏名" htmlFor="staff_name" required error={nameError}>
              <Input
                id="staff_name"
                value={data?.staff_name || ""}
                onChange={(e) => set({ staff_name: e.target.value })}
              />
            </AppFormField>
            <AppFormField label="部署" htmlFor="staff_dept">
              <Input
                id="staff_dept"
                value={data?.department || ""}
                onChange={(e) => set({ department: e.target.value })}
              />
            </AppFormField>
            <AppFormField
              label="Slack User ID"
              htmlFor="staff_slack"
              hint={editing ? "登録後は変更できません" : undefined}
            >
              <Input
                id="staff_slack"
                value={data?.slack_user_id || ""}
                disabled={!!editing}
                onChange={(e) => set({ slack_user_id: e.target.value })}
                placeholder="U12345678"
              />
            </AppFormField>
            <AppFormField label="メール" htmlFor="staff_email">
              <Input
                id="staff_email"
                type="email"
                value={data?.email || ""}
                onChange={(e) => set({ email: e.target.value })}
              />
            </AppFormField>
            {/* 統合 Phase 3: 役割(app_role)管理。既存担当者かつメール有りのみ。 */}
            {!creating && (
              <AppFormField label="役割 (app_role)" state="referenced">
                {data?.email ? (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        (data?.app_role || "viewer").toLowerCase() === "admin"
                          ? "default"
                          : "outline"
                      }
                      disabled={roleSaving}
                      onClick={() => changeRole("admin")}
                    >
                      admin
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        (data?.app_role || "viewer").toLowerCase() !== "admin"
                          ? "default"
                          : "outline"
                      }
                      disabled={roleSaving}
                      onClick={() => changeRole("viewer")}
                    >
                      viewer
                    </Button>
                    <span className="text-[11px] text-muted-foreground ml-1">
                      {roleSaving
                        ? "変更中…"
                        : `現在: ${(data?.app_role || "viewer").toLowerCase()}`}
                    </span>
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    メール登録後に役割を変更できます。
                  </p>
                )}
              </AppFormField>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={saving}>
              キャンセル
            </Button>
            <Button onClick={save} disabled={saving || !!nameError}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
