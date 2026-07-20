/**
 * DuplicateFinder — 重複候補の検出 → ID統合カートへの導線。
 *
 * 原作 / 作品 / 案件 を一覧取得し、正規化した名称が一致するレコードを「重複候補」として
 * まとめる。各グループの「統合カートへ」で、その候補群を sessionStorage に載せて
 * /master/merge?prefill=1 へ遷移し、ID統合カートに投入する(孤立させず統合)。
 *
 * 連結チェック(DataLinkagePanel)の中に据える点検→統合の入口。
 */
import * as React from "react"
import { useNavigate } from "react-router-dom"
import { GitMerge, Loader2, RefreshCw, Copy } from "lucide-react"

type Kind = "source_ip" | "work" | "matter" | "vendor" | "staff"
type Opt = { id: string; code?: string; label: string; sub?: string }

const KINDS: Array<{ key: Kind; label: string; url: string }> = [
  { key: "source_ip", label: "原作", url: "/api/v3/source-ips" },
  { key: "work", label: "作品", url: "/api/v3/works" },
  { key: "matter", label: "案件", url: "/api/matters" },
  { key: "vendor", label: "取引先", url: "/api/master/vendors" },
  { key: "staff", label: "担当者", url: "/api/master/staff" },
]

const s = (v: any) => (v == null ? "" : String(v))
// 名称の正規化: 前後空白除去・小文字化・空白/記号除去(全半角の揺れを吸収)。
const norm = (v: string) =>
  s(v)
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[()（）\[\]「」『』・,.，。\-—―~〜!！?？]/g, "")

function unwrap(d: any): any[] {
  if (Array.isArray(d)) return d
  if (!d || typeof d !== "object") return []
  for (const k of ["matters", "rows", "items", "data", "results", "list"]) if (Array.isArray(d[k])) return d[k]
  return []
}

function toOpt(kind: Kind, r: any): Opt {
  if (kind === "matter") return { id: s(r.id), code: s(r.matter_code || r.code), label: s(r.title || r.name) || `案件 #${s(r.id)}`, sub: s(r.status || r.matter_status || "") }
  if (kind === "vendor") return { id: s(r.id), code: s(r.vendor_code), label: s(r.vendor_name) || s(r.trade_name) || s(r.vendor_code), sub: "取引先 " + s(r.vendor_code) }
  if (kind === "staff") return { id: s(r.id), code: s(r.slack_user_id), label: s(r.staff_name) || s(r.email) || s(r.slack_user_id), sub: s(r.department || r.email || "") }
  const code = s(r.source_code || r.work_code)
  return { id: s(r.id), code, label: s(r.title), sub: (kind === "source_ip" ? "原作 " : "作品 ") + code }
}

export const DuplicateFinder: React.FC = () => {
  const navigate = useNavigate()
  const [kind, setKind] = React.useState<Kind>("source_ip")
  const [groups, setGroups] = React.useState<Opt[][] | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)

  const scan = React.useCallback(async (k: Kind) => {
    setLoading(true); setErr(null); setGroups(null)
    try {
      const cfg = KINDS.find((x) => x.key === k)!
      const res = await fetch(cfg.url)
      const rows = unwrap(await res.json()).map((r) => toOpt(k, r)).filter((o) => o.label.trim())
      // 名称キーでグルーピング → 2件以上を重複候補に。
      const by: Record<string, Opt[]> = {}
      for (const o of rows) {
        const key = norm(o.label)
        if (!key) continue
        ;(by[key] = by[key] || []).push(o)
      }
      const dups = Object.values(by).filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)
      setGroups(dups)
    } catch (e: any) {
      setErr(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  const sendToCart = (g: Opt[]) => {
    sessionStorage.setItem("lb_merge_prefill", JSON.stringify({ kind, items: g }))
    navigate("/data-maintenance/merge?prefill=1")
  }

  return (
    <div className="border border-border rounded-sm p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Copy className="w-4 h-4 text-muted-foreground" />
        <span className="text-[12px] font-mono font-bold">重複候補の検出 → ID統合</span>
        <span className="text-[10px] text-muted-foreground">同名の 原作 / 作品 / 案件 をまとめて統合カートへ</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => { setKind(k.key); scan(k.key) }}
              className={cnj(
                "text-[10px] font-mono rounded-sm px-2.5 py-1 border",
                kind === k.key && groups != null ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground/40"
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => scan(kind)}
          disabled={loading}
          className="text-[10px] font-mono border border-foreground/30 rounded-sm px-2.5 py-1 flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} 検出
        </button>
      </div>

      {err && <p className="text-[11px] font-mono text-destructive">検出に失敗: {err}</p>}

      {groups == null ? (
        <p className="text-[11px] text-muted-foreground">種別を選ぶか「検出」で、同名の重複候補を洗い出します。</p>
      ) : groups.length === 0 ? (
        <p className="text-[11px] font-mono text-success">重複候補は見つかりませんでした。</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] font-mono text-warning">{groups.length} グループの重複候補（同名）が見つかりました。</p>
          {groups.map((g, i) => (
            <div key={i} className="border border-warning/40 rounded-sm bg-warning/10 dark:bg-warning p-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-mono font-bold truncate">{g[0].label}<span className="text-muted-foreground font-normal">（{g.length}件）</span></span>
                <button
                  type="button"
                  onClick={() => sendToCart(g)}
                  className="shrink-0 text-[10px] font-mono border border-primary text-primary rounded-sm px-2 py-0.5 flex items-center gap-1 hover:bg-primary"
                >
                  <GitMerge className="w-3 h-3" /> 統合カートへ
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {g.map((o) => (
                  <span key={o.id} className="text-[9.5px] font-mono border border-border rounded px-1.5 py-0.5 bg-background">
                    {o.code || o.id}{o.sub ? ` · ${o.sub}` : ""}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// cn の軽量版(このファイル内専用。falsy を除去して結合)。
function cnj(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ")
}

export default DuplicateFinder
