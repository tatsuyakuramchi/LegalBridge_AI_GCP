/**
 * BillingPrintPage — 再許諾料 受領・分配 計算書（印刷 / PDF 出力用）。
 *
 * 作品の再許諾条件×受領記録を、印刷に最適化した1枚の計算書として描画する。
 * ブラウザの「印刷 → PDFに保存」で PDF 化する（重い文書生成パイプラインを介さない）。
 * AppShell の外に置き、画面 chrome を被せない。@media print で操作UIを隠す。
 *
 *   GET /api/v3/works/:id/sublicense-conditions
 *   GET /api/v3/work-conditions/:cid/receipts
 */
import * as React from "react"
import { useParams, useSearchParams } from "react-router-dom"

const yen = (n: any, cur = "JPY") =>
  n == null || n === "" ? "—" : `${cur === "JPY" ? "¥" : cur + " "}${Number(n).toLocaleString("ja-JP")}`

export function BillingPrintPage() {
  const { workId = "" } = useParams()
  const [sp] = useSearchParams()
  const title = sp.get("title") || `作品 #${workId}`
  const [conds, setConds] = React.useState<any[]>([])
  const [receiptsByCond, setReceiptsByCond] = React.useState<Record<number, any[]>>({})
  const [loading, setLoading] = React.useState(true)
  const issued = React.useMemo(() => new Date().toLocaleDateString("ja-JP"), [])

  React.useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const cr = await fetch(`/api/v3/works/${encodeURIComponent(workId)}/sublicense-conditions`).then((r) => r.json())
        const cs: any[] = Array.isArray(cr) ? cr : []
        const map: Record<number, any[]> = {}
        await Promise.all(cs.map(async (c) => {
          try {
            const rr = await fetch(`/api/v3/work-conditions/${c.id}/receipts`).then((r) => r.json())
            map[c.id] = Array.isArray(rr) ? rr : []
          } catch { map[c.id] = [] }
        }))
        if (!alive) return
        setConds(cs); setReceiptsByCond(map)
      } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [workId])

  const allReceipts: any[] = Object.values(receiptsByCond).flat()
  const grandRecv = allReceipts.reduce((s: number, x: any) => s + (Number(x.computed_royalty_ex_tax) || 0), 0)
  const grandDist = allReceipts.reduce((s: number, x: any) => s + (Number(x.computed_distribution_ex_tax) || 0), 0)

  return (
    <div className="bp-root">
      <style>{`
        .bp-root { max-width: 820px; margin: 0 auto; padding: 32px 28px; font-family: 'Hiragino Sans','Yu Gothic',sans-serif; color: #1a1a1a; background:#fff; }
        .bp-root h1 { font-size: 20px; font-weight: 800; letter-spacing: .06em; margin: 0 0 4px; }
        .bp-meta { font-size: 12px; color:#555; display:flex; justify-content:space-between; border-bottom:2px solid #333; padding-bottom:8px; margin-bottom:16px; }
        .bp-cond { border:1px solid #ccc; border-radius:6px; margin-bottom:14px; overflow:hidden; }
        .bp-cond-h { background:#f6f6f6; padding:8px 10px; font-size:12px; border-bottom:1px solid #ddd; }
        .bp-cond-h b { font-size:13px; }
        .bp-lic { color:#0a7d43; font-size:11px; }
        .bp-lic.warn { color:#b45309; }
        table.bp-t { width:100%; border-collapse:collapse; font-size:11px; }
        table.bp-t th, table.bp-t td { border-bottom:1px solid #e5e5e5; padding:4px 6px; }
        table.bp-t th { background:#fafafa; text-align:right; font-weight:700; color:#555; }
        table.bp-t th.l, table.bp-t td.l { text-align:left; }
        table.bp-t td { text-align:right; }
        table.bp-t tr.sub td { font-weight:700; border-top:1px solid #999; }
        .bp-grand { display:flex; gap:24px; justify-content:flex-end; border-top:2px solid #333; padding-top:10px; margin-top:8px; font-size:13px; }
        .bp-grand b { font-size:15px; }
        .bp-recv { color:#0369a1; } .bp-dist { color:#be123c; }
        .bp-actions { margin-bottom:16px; }
        .bp-btn { font: 12px monospace; padding:8px 16px; border:1px solid #333; border-radius:4px; background:#111; color:#fff; cursor:pointer; }
        .bp-note { font-size:10px; color:#888; margin-top:20px; line-height:1.6; }
        @media print { .bp-actions { display:none !important; } .bp-root { padding:0; } @page { margin: 14mm; } }
      `}</style>

      <div className="bp-actions">
        <button className="bp-btn" onClick={() => window.print()}>印刷 / PDFに保存</button>
      </div>

      <h1>再許諾料 受領・分配 計算書</h1>
      <div className="bp-meta">
        <span>対象作品：{title}</span>
        <span>発行日：{issued}</span>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "#888" }}>読み込み中…</p>
      ) : conds.length === 0 ? (
        <p style={{ fontSize: 12, color: "#888" }}>この作品に再許諾条件はありません。</p>
      ) : (
        conds.map((c) => {
          const rs = receiptsByCond[c.id] || []
          const cur = c.currency || "JPY"
          const sr = rs.reduce((s, x) => s + (Number(x.computed_royalty_ex_tax) || 0), 0)
          const sd = rs.reduce((s, x) => s + (Number(x.computed_distribution_ex_tax) || 0), 0)
          return (
            <div className="bp-cond" key={c.id}>
              <div className="bp-cond-h">
                <b>再許諾条件 #{c.condition_no ?? c.id}</b>　再許諾先：{c.counterparty_name || "（未設定）"}　料率：{c.rate_pct ?? "—"}%
                {c.region_language_label ? `　地域：${c.region_language_label}` : ""}
                <div className={c.parent_license_condition_id ? "bp-lic" : "bp-lic warn"}>
                  {c.parent_license_condition_id
                    ? `親ライセンスイン：${c.licensor_name || "（未設定）"}　料率 ${c.parent_rate_pct ?? "—"}%${c.licensor_work_title ? `（源泉：${c.licensor_work_title}）` : ""}`
                    : "※ 親ライセンスイン未リンク（分配は算出されていません）"}
                </div>
              </div>
              <table className="bp-t">
                <thead>
                  <tr>
                    <th className="l">期間</th><th>報告売上</th><th>報告数量</th><th>受領再許諾料</th>
                    <th>実受領額</th><th className="l">受領日</th><th>分配基準額</th><th>個数</th><th>ライセンサー支払</th>
                  </tr>
                </thead>
                <tbody>
                  {rs.length === 0 ? (
                    <tr><td className="l" colSpan={9} style={{ textAlign: "center", color: "#999" }}>受領記録なし</td></tr>
                  ) : rs.map((x) => (
                    <tr key={x.id}>
                      <td className="l">{x.period || "—"}</td>
                      <td>{yen(x.reported_sales, cur)}</td>
                      <td>{x.reported_quantity ?? "—"}</td>
                      <td className="bp-recv">{yen(x.computed_royalty_ex_tax, cur)}</td>
                      <td>{yen(x.received_amount, cur)}</td>
                      <td className="l">{x.received_date || "—"}</td>
                      <td>{yen(x.distribution_base, cur)}</td>
                      <td>{x.distribution_qty ?? "—"}</td>
                      <td className="bp-dist">{yen(x.computed_distribution_ex_tax, cur)}</td>
                    </tr>
                  ))}
                  {rs.length > 0 && (
                    <tr className="sub">
                      <td className="l" colSpan={3}>小計</td>
                      <td className="bp-recv">{yen(sr, cur)}</td>
                      <td colSpan={4}></td>
                      <td className="bp-dist">{yen(sd, cur)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )
        })
      )}

      {!loading && conds.length > 0 && (
        <div className="bp-grand">
          <span className="bp-recv">受領再許諾料 合計：<b>{yen(grandRecv)}</b></span>
          <span className="bp-dist">ライセンサー分配 合計：<b>{yen(grandDist)}</b></span>
        </div>
      )}

      <p className="bp-note">
        ※ 金額は税抜表示。受領再許諾料＝報告売上（または数量×単価）×料率。分配（ライセンサーへ支払）＝基準額×個数×親ライセンスイン料率。
        本計算書は社内管理用の集計であり、正式な支払通知・請求書ではありません。
      </p>
    </div>
  )
}
