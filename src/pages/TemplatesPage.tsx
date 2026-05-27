import * as React from "react"
import { useNavigate, useParams } from "react-router-dom"
import {
  Plus,
  Search,
  Trash2,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
  FileCode2,
  Save,
  Wand2,
} from "lucide-react"

import { useAppData } from "@/src/context/AppDataContext"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

const COMMON_VARIABLES = [
  "Licensor_名称",
  "Licensor_住所",
  "Licensor_氏名会社名",
  "Licensor_代表者名",
  "Licensee_名称",
  "Licensee_住所",
  "Licensee_氏名会社名",
  "Licensee_代表者名",
  "発行日",
  "契約書番号",
  "台帳ID",
  "許諾開始日",
  "許諾期間注記",
  "監修者",
  "クレジット表示",
  "素材番号",
  "素材名",
  "特記事項_本文",
]

export function TemplatesPage() {
  const { templateList, templateMetadata } = useAppData()
  const [search, setSearch] = React.useState("")
  const [view, setView] = React.useState<"list" | "matrix">("list")
  const [newId, setNewId] = React.useState("")
  const navigate = useNavigate()

  const filtered = templateList.filter((t) => {
    const label = templateMetadata[t]?.label || t
    return (
      label.toLowerCase().includes(search.toLowerCase()) ||
      t.toLowerCase().includes(search.toLowerCase())
    )
  })

  const create = () => {
    if (!newId) return
    fetch(`/api/templates/${newId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "<h1>New Template</h1>\n<p>Variable: {{myVar}}</p>",
      }),
    }).then(() => {
      const created = newId
      setNewId("")
      navigate(`/templates/${created}`)
    })
  }

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-5">
        <div>
          <p className="retro-tag mb-1.5">TPL · STUDIO</p>
          <h2 className="text-2xl font-mono font-bold tracking-tight">
            Blueprint Studio
          </h2>
          <p className="text-xs font-mono text-muted-foreground mt-1.5">
            HTML / Handlebars templates with dynamic variable mapping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as any)}
          >
            <TabsList>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="matrix">Matrix</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            placeholder="new_template_id"
            value={newId}
            onChange={(e) =>
              setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
            }
            className="w-44"
          />
          <Button disabled={!newId} onClick={create}>
            <Plus />
            Create
          </Button>
        </div>
      </header>

      {view === "list" ? (
        <div className="space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filter blueprints…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((t) => {
              const meta = templateMetadata[t] || {}
              const varCount = Object.keys(meta.vars || {}).length
              return (
                <Card
                  key={t}
                  className="cursor-pointer hover:border-foreground transition-all"
                  onClick={() => navigate(`/templates/${t}`)}
                >
                  <CardContent className="px-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <FileCode2 className="h-4 w-4 text-muted-foreground" />
                      <Badge variant="outline">{varCount} vars</Badge>
                    </div>
                    <p className="text-sm font-mono font-bold uppercase line-clamp-2">
                      {meta.label || t.replace(/_/g, " ")}
                    </p>
                    <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
                      {meta.category || "General"} · {t}.html
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      ) : (
        <MatrixView templateList={templateList} templateMetadata={templateMetadata} />
      )}
    </div>
  )
}

function MatrixView({
  templateList,
  templateMetadata,
}: {
  templateList: string[]
  templateMetadata: any
}) {
  const fields = Array.from(
    new Set(
      templateList.flatMap((t) =>
        Object.keys(templateMetadata[t]?.vars || {})
      )
    )
  ).sort()

  return (
    <div className="border border-border bg-card overflow-x-auto rounded-md">
      <table className="w-full border-collapse text-xs font-mono">
        <thead className="bg-muted/40 border-b border-border">
          <tr>
            <th className="p-3 text-left text-[10px] font-bold uppercase tracking-[0.16em] sticky left-0 bg-muted/40 z-10 w-64 border-r border-border">
              Variable / Template
            </th>
            {templateList.map((t) => (
              <th
                key={t}
                className="p-3 text-center text-[11px] uppercase tracking-[0.14em] min-w-[120px] border-r border-border"
              >
                {templateMetadata[t]?.label || t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {fields.map((field) => (
            <tr key={field} className="hover:bg-muted/30">
              <td className="p-2.5 font-bold text-cyan-700 dark:text-cyan-300 sticky left-0 bg-card z-10 border-r border-border">
                {field}
              </td>
              {templateList.map((t) => {
                const m = (templateMetadata[t]?.vars || {})[field]
                return (
                  <td
                    key={`${field}-${t}`}
                    className="p-2.5 text-center border-r border-border"
                  >
                    {m ? (
                      <div className="flex flex-col items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                          {m.label}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TemplateEditorPage() {
  const { id = "" } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    templateMetadata,
    setTemplateMetadata,
    showNotification,
  } = useAppData()
  const [content, setContent] = React.useState<string>("")
  const [fields, setFields] = React.useState<string[]>([])
  const [status, setStatus] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    fetch(`/api/templates/${id}`)
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setContent(""))
    fetch(`/api/templates/${id}/schema`)
      .then((r) => r.json())
      .then((d) => setFields(d.variables || []))
      .catch(() => setFields([]))
  }, [id])

  const meta = templateMetadata[id] || { vars: {} }
  const updateMeta = (patch: any) => {
    setTemplateMetadata({ ...templateMetadata, [id]: { ...meta, ...patch } })
  }
  const updateVar = (field: string, patch: any) => {
    const newVars = {
      ...(meta.vars || {}),
      [field]: { ...((meta.vars || {})[field] || {}), ...patch },
    }
    updateMeta({ vars: newVars })
  }

  const saveContent = async () => {
    setStatus("Saving…")
    await fetch(`/api/templates/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    const schema = await fetch(`/api/templates/${id}/schema`).then((r) => r.json())
    setFields(schema.variables || [])
    setStatus("Saved")
    setTimeout(() => setStatus(null), 2000)
  }

  const saveMeta = async () => {
    await fetch("/api/templates/config/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(templateMetadata),
    })
    showNotification("Metadata saved", "success")
  }

  const remove = async () => {
    await fetch(`/api/templates/${id}`, { method: "DELETE" })
    navigate("/templates")
  }

  const insertVariable = (name: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const placeholder = `{{${name}}}`
    const next = content.substring(0, start) + placeholder + content.substring(end)
    setContent(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.selectionStart = ta.selectionEnd = start + placeholder.length
    })
  }

  return (
    <div className="px-6 py-6 max-w-[1500px] mx-auto space-y-6">
      <header className="flex items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate("/templates")}>
            <ArrowLeft />
          </Button>
          <div>
            <p className="retro-tag mb-1">TPL · {id}</p>
            <h2 className="text-xl font-mono font-bold tracking-tight">
              {meta.label || id.replace(/_/g, " ")}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <Badge variant="success" className="h-5">
              {status}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={saveMeta}>
            <RefreshCw />
            Save metadata
          </Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="destructive" onClick={remove}>
                Confirm delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 />
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardContent className="px-5 space-y-4">
          <p className="retro-tag">Properties</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Display label</Label>
              <Input
                value={meta.label || ""}
                onChange={(e) => updateMeta({ label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <NativeSelect
                value={meta.category || "General"}
                onChange={(e) => updateMeta({ category: e.target.value })}
              >
                <option value="Core Licenses & Terms">Core Licenses & Terms</option>
                <option value="Contracts & Agreements">Contracts & Agreements</option>
                <option value="Sales & Purchase">Sales & Purchase</option>
                <option value="Delivery & Payment">Delivery & Payment</option>
                <option value="International">International</option>
                <option value="Domestic">Domestic</option>
                <option value="General">General / Others</option>
              </NativeSelect>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="retro-tag">Dynamic Variable Logic</p>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
              {fields.length} fields
            </span>
          </div>
          <div className="space-y-1.5">
            {fields.map((field) => {
              const m = (meta.vars || {})[field] || {}
              return (
                <div
                  key={field}
                  className="grid grid-cols-12 gap-2 items-center px-2 py-1.5 border border-border rounded-sm bg-card hover:bg-muted/30 transition-colors"
                >
                  <span className="col-span-2 font-mono text-[10px] font-bold text-cyan-700 dark:text-cyan-300 truncate">
                    {field}
                  </span>
                  <Input
                    placeholder="Label"
                    value={m.label || ""}
                    onChange={(e) => updateVar(field, { label: e.target.value })}
                    className="col-span-3 h-7 text-[11px]"
                  />
                  <NativeSelect
                    value={m.type || "text"}
                    onChange={(e) => updateVar(field, { type: e.target.value })}
                    className="col-span-2 h-7 text-[11px]"
                  >
                    <option value="text">Text</option>
                    <option value="date">Date</option>
                    <option value="textarea">Multi-line</option>
                    <option value="boolean">Boolean</option>
                    <option value="number">Numeric</option>
                  </NativeSelect>
                  <NativeSelect
                    value={m.group || "Default"}
                    onChange={(e) => updateVar(field, { group: e.target.value })}
                    className="col-span-2 h-7 text-[11px]"
                  >
                    <option value="Basic Context (基本情報)">Basic</option>
                    <option value="License/Grant Info (ライセンス)">License</option>
                    <option value="Financial & Payment (金銭)">Financial</option>
                    <option value="Remarks & Extras (その他)">Remarks</option>
                  </NativeSelect>
                  <Input
                    placeholder="Formula (e.g. {A}*{B})"
                    value={m.formula || ""}
                    onChange={(e) => updateVar(field, { formula: e.target.value })}
                    className="col-span-3 h-7 text-[11px]"
                  />
                </div>
              )
            })}
            {fields.length === 0 && (
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground py-6 text-center">
                No fields detected. Save the HTML first.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-9">
          <CardContent className="px-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="retro-tag">Handlebars Source</p>
              <Button size="sm" onClick={saveContent}>
                <Save />
                Save & re-scan
              </Button>
            </div>
            <Textarea
              ref={textareaRef}
              spellCheck={false}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="font-mono text-[11px] leading-relaxed min-h-[480px] bg-foreground text-background"
            />
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-3">
          <CardContent className="px-4 space-y-2">
            <p className="retro-tag">
              <Wand2 className="h-3 w-3" /> Insert Variable
            </p>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-muted-foreground">
              Click to inject placeholder at cursor.
            </p>
            <div className="space-y-0.5 max-h-[420px] overflow-y-auto custom-scrollbar pr-1">
              {COMMON_VARIABLES.map((v) => (
                <button
                  key={v}
                  onClick={() => insertVariable(v)}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-[10px] font-mono text-left bg-muted/30 border border-transparent hover:border-border hover:bg-muted transition-all rounded-sm"
                >
                  <span className="truncate">{v}</span>
                  <Plus className="h-2.5 w-2.5 opacity-0 hover:opacity-100" />
                </button>
              ))}
            </div>
            <CustomVariableInput onInsert={insertVariable} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CustomVariableInput({ onInsert }: { onInsert: (name: string) => void }) {
  const [value, setValue] = React.useState("")
  return (
    <div className="flex gap-1 pt-2 border-t border-border mt-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value) {
            onInsert(value)
            setValue("")
          }
        }}
        placeholder="custom_name"
        className="h-7 text-[10px]"
      />
      <Button
        size="icon-sm"
        onClick={() => {
          if (value) {
            onInsert(value)
            setValue("")
          }
        }}
      >
        <Plus />
      </Button>
    </div>
  )
}
