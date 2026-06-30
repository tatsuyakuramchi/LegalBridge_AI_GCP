import { useEffect, useMemo, useState } from "react"

/**
 * 汎用スキーマ駆動 CSV 取込ページ（全テーブル＋互換ビュー）。
 *   - GET /api/imports/tables                    … 取込可能オブジェクト一覧
 *   - GET /api/imports/tables/:name/template.csv … テンプレ CSV DL
 *   - POST /api/imports/tables/:name             … CSV 取込（multipart file）
 * fetch は apiRouter のモンキーパッチ経由で worker へ振られ、ポータルシークレットも付与される。
 */

interface ImportObject {
  name: string
  kind: "table" | "view"
  columns: number
  required: string[]
  keys: string[][]
}
interface ImportResult {
  object: string
  inserted: number
  updated: number
  errors: { row: number; message: string }[]
  total: number
}

export function GenericImportPage() {
  const [objects, setObjects] = useState<ImportObject[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [mode, setMode] = useState<"strict" | "besteffort">("strict")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [opError, setOpError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch("/api/imports/tables")
        const j = await r.json()
        if (!j.ok) throw new Error(j.error || "一覧取得に失敗しました")
        setObjects(j.objects || [])
      } catch (e: any) {
        setLoadError(String(e?.message || e))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return objects.filter((o) => !f || o.name.toLowerCase().includes(f))
  }, [objects, filter])

  const current = useMemo(() => objects.find((o) => o.name === selected) || null, [objects, selected])

  async function downloadTemplate(name: string) {
    try {
      const r = await fetch(`/api/imports/tables/${encodeURIComponent(name)}/template.csv`)
      if (!r.ok) throw new Error(`テンプレ取得失敗 (${r.status})`)
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `template_${name}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setOpError(String(e?.message || e))
    }
  }

  async function runImport() {
    if (!selected || !file) return
    setBusy(true)
    setResult(null)
    setOpError(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch(
        `/api/imports/tables/${encodeURIComponent(selected)}?mode=${mode}`,
        { method: "POST", body: fd }
      )
      const j = await r.json()
      if (j && typeof j.inserted === "number") {
        setResult(j as ImportResult)
        if (!j.ok && j.error) setOpError(j.error)
      } else {
        throw new Error(j?.error || `取込に失敗しました (${r.status})`)
      }
    } catch (e: any) {
      setOpError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold">汎用 CSV 取込（全テーブル）</h1>
        <p className="text-sm text-gray-500 mt-1">
          各テーブル／互換ビュー(cc/cfc/cli 等)の列からテンプレ CSV を生成し、アップロードで一括 upsert
          します。自然キー（work_code / vendor_code / document_number 等）があればそれで更新、無ければ追加。
          空セルは既定値/NULL。先頭が <code>#</code> の行はコメントとして無視されます。
        </p>
      </div>

      {loadError && (
        <div className="rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
          一覧取得エラー: {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 左: オブジェクト一覧 */}
        <div className="md:col-span-1 border rounded">
          <div className="p-2 border-b">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="テーブル/ビューを検索…"
              className="w-full border rounded px-2 py-1 text-sm"
            />
          </div>
          <div className="max-h-[60vh] overflow-auto divide-y">
            {loading && <div className="p-3 text-sm text-gray-500">読み込み中…</div>}
            {!loading &&
              filtered.map((o) => (
                <button
                  key={o.name}
                  onClick={() => {
                    setSelected(o.name)
                    setResult(null)
                    setOpError(null)
                    setFile(null)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    selected === o.name ? "bg-blue-50 font-semibold" : ""
                  }`}
                >
                  <span>{o.name}</span>
                  <span
                    className={`ml-2 text-xs rounded px-1 ${
                      o.kind === "view" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {o.kind}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">{o.columns}列</span>
                </button>
              ))}
            {!loading && filtered.length === 0 && (
              <div className="p-3 text-sm text-gray-500">該当なし</div>
            )}
          </div>
        </div>

        {/* 右: 取込パネル */}
        <div className="md:col-span-2 border rounded p-4 space-y-4">
          {!current && <div className="text-sm text-gray-500">左から対象を選択してください。</div>}
          {current && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-bold">{current.name}</div>
                  <div className="text-xs text-gray-500">
                    {current.kind} · {current.columns}列
                    {current.required.length > 0 && (
                      <> · 必須: {current.required.join(", ")}</>
                    )}
                  </div>
                  {current.keys.length > 0 && (
                    <div className="text-xs text-gray-500">
                      更新キー: {current.keys.map((k) => `(${k.join(", ")})`).join(" / ")}
                    </div>
                  )}
                  {current.kind === "view" && (
                    <div className="text-xs text-amber-600 mt-1">
                      ※ ビュー。INSTEAD OF トリガ経由で実テーブルへ書き込まれます。
                    </div>
                  )}
                </div>
                <button
                  onClick={() => downloadTemplate(current.name)}
                  className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  ⬇ テンプレ CSV
                </button>
              </div>

              <div className="space-y-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null)
                    setResult(null)
                  }}
                  className="block text-sm"
                />
                <div className="flex items-center gap-4 text-sm">
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={mode === "strict"}
                      onChange={() => setMode("strict")}
                    />
                    strict（1行でも失敗なら全取消）
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="radio"
                      checked={mode === "besteffort"}
                      onChange={() => setMode("besteffort")}
                    />
                    besteffort（成功行のみ登録）
                  </label>
                </div>
                <button
                  onClick={runImport}
                  disabled={!file || busy}
                  className="bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
                >
                  {busy ? "取込中…" : "CSV を取込"}
                </button>
              </div>

              {opError && (
                <div className="rounded border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">
                  {opError}
                </div>
              )}

              {result && (
                <div className="rounded border bg-gray-50 p-3 text-sm space-y-2">
                  <div>
                    対象 <b>{result.object}</b> / 全 {result.total} 行 → 追加{" "}
                    <b className="text-green-700">{result.inserted}</b> · 更新{" "}
                    <b className="text-blue-700">{result.updated}</b> · エラー{" "}
                    <b className={result.errors.length ? "text-red-700" : ""}>{result.errors.length}</b>
                  </div>
                  {result.errors.length > 0 && (
                    <div className="max-h-48 overflow-auto border-t pt-2">
                      {result.errors.slice(0, 50).map((er, i) => (
                        <div key={i} className="text-xs text-red-700">
                          行 {er.row}: {er.message}
                        </div>
                      ))}
                      {result.errors.length > 50 && (
                        <div className="text-xs text-gray-500">…他 {result.errors.length - 50} 件</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
