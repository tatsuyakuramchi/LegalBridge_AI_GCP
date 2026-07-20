import * as React from "react"
import { Plus, GitBranch, Edit2 } from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AppFormField } from "@/src/components/form"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog"

const empty = {
  department: "",
  approver_slack_id: "",
  stamp_operator_slack_id: "",
  manager_slack_id: "",
  slack_channel_id: "",
  is_active: true,
}

export function RulesPanel() {
  const { workflowRules, refreshWorkflowRules, showNotification } = useAppData()
  const [editing, setEditing] = React.useState<any>(null)
  const [creating, setCreating] = React.useState(false)
  const [draft, setDraft] = React.useState<any>(empty)

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

  const save = async () => {
    try {
      const res = await fetch("/api/master/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        showNotification("ルールを保存しました", "success")
        await refreshWorkflowRules()
        close()
      } else {
        showNotification("保存に失敗しました", "error")
      }
    } catch (e) {
      showNotification("サーバーエラー", "error")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {workflowRules.length} rules
        </span>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setDraft(empty)
            setCreating(true)
          }}
        >
          <Plus />
          ルールを追加
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {workflowRules.map((rule, idx) => (
          <Card key={`rule-${rule.department || idx}`}>
            <CardContent className="px-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">
                    {rule.department}
                  </p>
                </div>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    rule.is_active ? "bg-success" : "bg-muted-foreground/40"
                  }`}
                />
              </div>
              <ul className="space-y-1 text-[10px]">
                <li className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-[0.14em]">
                    承認者
                  </span>
                  <span className="font-bold">
                    @{rule.approver_slack_id || "未設定"}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-[0.14em]">
                    押印担当
                  </span>
                  <span className="font-bold">
                    @{rule.stamp_operator_slack_id || "未設定"}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span className="text-muted-foreground uppercase tracking-[0.14em]">
                    管理者
                  </span>
                  <span className="font-bold">
                    @{rule.manager_slack_id || "未設定"}
                  </span>
                </li>
                <li className="pt-1.5 border-t border-dashed border-border">
                  <span className="block text-muted-foreground uppercase tracking-[0.14em]">
                    返信先チャンネル
                  </span>
                  <span className="font-bold text-info">
                    {rule.slack_channel_id || "デフォルト"}
                  </span>
                </li>
              </ul>
              <Button
                size="xs"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setEditing(rule)
                  setCreating(false)
                }}
              >
                <Edit2 />
                設定編集
              </Button>
            </CardContent>
          </Card>
        ))}
        {workflowRules.length === 0 && (
          <div className="col-span-full p-12 text-center border border-dashed border-border rounded-md">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              No routing rules configured.
            </p>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={(v) => !v && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {creating ? "新規ルーティングルール" : "ルール編集"}
            </DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label="部署名">
              <Input
                value={data?.department || ""}
                disabled={!creating}
                onChange={(e) => set({ department: e.target.value })}
              />
            </Field>
            <Field label="不備承認者 (Slack ID)">
              <Input
                value={data?.approver_slack_id || ""}
                onChange={(e) => set({ approver_slack_id: e.target.value })}
                placeholder="U12345678"
              />
            </Field>
            <Field label="押印・送付担当 (Slack ID)">
              <Input
                value={data?.stamp_operator_slack_id || ""}
                onChange={(e) =>
                  set({ stamp_operator_slack_id: e.target.value })
                }
                placeholder="U12345678"
              />
            </Field>
            <Field label="管理者 (Slack ID)">
              <Input
                value={data?.manager_slack_id || ""}
                onChange={(e) => set({ manager_slack_id: e.target.value })}
                placeholder="U12345678"
              />
            </Field>
            <Field label="返信先チャンネル ID">
              <Input
                value={data?.slack_channel_id || ""}
                onChange={(e) => set({ slack_channel_id: e.target.value })}
                placeholder="C012345678"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              キャンセル
            </Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const required = /\*\s*$/.test(label)
  const cleanLabel = label.replace(/\s*\*\s*$/, "")
  return (
    <AppFormField label={cleanLabel} required={required}>
      {children}
    </AppFormField>
  )
}
