import * as React from "react"
import { RefreshCw, Loader2, BookOpen, FileText } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

// B1(最小): 新スキーマ(work-centric)の閲覧。/api/v3/* を読む。
// apiRouter により GET は search-api(workModel ルート)へ振られる。
// 後で Search 専用フロントへ切り出す前提の seed。

type SourceIp = {
  id: number
  source_code: string
  title: string
  default_rights_holder?: string | null
  material_count?: number | string
}

type ContractRow = {
  id: number
  document_number?: string | null
  contract_title?: string | null
  contract_level?: string | null
  contract_category?: string | null
  lifecycle_stage?: string | null
  primary_vendor?: string | null
  term_count?: number | string
}

export function WorkModelPage() {
  const [sourceIps, setSourceIps] = React.useState<SourceIp[]>([])
  const [contracts, setContracts] = React.useState<ContractRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, c] = await Promise.all([
        fetch("/api/v3/source-ips").then((r) => r.json()),
        fetch("/api/v3/contracts").then((r) => r.json()),
      ])
      setSourceIps(Array.isArray(s) ? s : [])
      setContracts(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">新モデル(work-centric)ビュー</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-2">更新</span>
        </Button>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <BookOpen className="h-4 w-4" /> 原作IP({sourceIps.length})
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {sourceIps.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.title}</div>
                  <Badge variant="secondary">{s.source_code}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  権利者: {s.default_rights_holder || "—"} / 素材 {s.material_count ?? 0}
                </div>
              </CardContent>
            </Card>
          ))}
          {sourceIps.length === 0 && !loading && (
            <div className="text-sm text-muted-foreground">原作IPがありません</div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <FileText className="h-4 w-4" /> 契約({contracts.length})
        </h2>
        <div className="grid gap-2 md:grid-cols-2">
          {contracts.map((c) => (
            <Card key={c.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {c.contract_title || c.document_number || `#${c.id}`}
                  </div>
                  <Badge variant="outline">{c.contract_level || "—"}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {c.contract_category || "—"} / {c.primary_vendor || "—"} /{" "}
                  {c.lifecycle_stage || "—"} / 条件 {c.term_count ?? 0}
                </div>
              </CardContent>
            </Card>
          ))}
          {contracts.length === 0 && !loading && (
            <div className="text-sm text-muted-foreground">契約がありません</div>
          )}
        </div>
      </section>
    </div>
  )
}
