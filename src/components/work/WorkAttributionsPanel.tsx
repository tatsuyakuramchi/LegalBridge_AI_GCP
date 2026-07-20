/**
 * WorkAttributionsPanel — PLW-D: 「作品1:文書N:明細N」集約ビュー。
 *
 * ある作品に *明細単位で* 帰属する 文書・明細・利用許諾条件を、文書ごとに束ねて表示する。
 * 発注書1枚に複数タイトルが混在しても、各作品から見れば「自分に紐づく明細/条件」だけを
 * 横断的に一覧できる(作品 = 文書 N : 明細 N)。
 *
 * データ源: GET /api/v3/works/:id/attributions
 *   (capability_line_items.work_id / condition_lines.work_id = 0084 で帰属)。
 */

import React from "react";
import { Loader2, FileText, Package, Scale } from "lucide-react";

type LineItem = {
  line_no?: number;
  item_name?: string | null;
  amount_ex_tax?: number | null;
  deliverable_ownership?: string | null;
  calc_method?: string | null;
};
type Condition = {
  line_no?: number;
  condition_no?: number | null;
  label?: string | null;
  payment_scheme?: string | null;
  rate_pct?: number | null;
  amount_ex_tax?: number | null;
  calc_method?: string | null;
};
type DocGroup = {
  capability_id: number;
  document_number: string | null;
  contract_title: string | null;
  record_type: string | null;
  line_items: LineItem[];
  conditions: Condition[];
};

const yen = (n: any) =>
  n == null || n === "" ? "—" : "¥" + (Number(n) || 0).toLocaleString("ja-JP");

export const WorkAttributionsPanel: React.FC<{ workId: string | number }> = ({
  workId,
}) => {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [docs, setDocs] = React.useState<DocGroup[] | null>(null);

  React.useEffect(() => {
    if (!workId) {
      setDocs(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const r = await fetch(
          `/api/v3/works/${encodeURIComponent(String(workId))}/attributions`
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!cancelled)
          setDocs(Array.isArray(d?.documents) ? d.documents : []);
      } catch (e: any) {
        if (!cancelled) {
          setError(String(e?.message || e));
          setDocs([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workId]);

  if (!workId) return null;

  const totalDocs = docs?.length ?? 0;
  const totalLines =
    docs?.reduce((s, d) => s + d.line_items.length + d.conditions.length, 0) ?? 0;

  return (
    <div className="border border-primary/40 rounded-md bg-primary/10 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5">
        <FileText className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-mono font-bold text-primary">
          この作品に紐づく文書・明細（作品 1 : 文書 N : 明細 N）
        </span>
        {!loading && docs && (
          <span className="text-[10px] font-mono text-primary">
            文書 {totalDocs} / 明細・条件 {totalLines}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 取得中…
        </div>
      )}
      {error && (
        <div className="text-[10px] font-mono text-destructive py-1">
          取得に失敗しました: {error}
        </div>
      )}
      {!loading && docs && docs.length === 0 && (
        <div className="text-[10px] text-muted-foreground py-1">
          この作品に明細単位で帰属する文書はまだありません（明細の作品割当が未設定か、文書単位帰属のみ）。
        </div>
      )}

      {!loading && docs && docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((d) => (
            <div
              key={d.capability_id}
              className="rounded-sm bg-white/70 border border-primary/40 px-2 py-1.5"
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-mono font-bold">
                  {d.document_number || `capability#${d.capability_id}`}
                </span>
                {d.record_type && (
                  <span className="text-[8px] px-1 py-0.5 rounded-sm bg-muted text-muted-foreground">
                    {d.record_type}
                  </span>
                )}
                {d.contract_title && (
                  <span className="text-[9px] text-muted-foreground truncate">
                    {d.contract_title}
                  </span>
                )}
              </div>

              {d.line_items.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.line_items.map((li, i) => (
                    <li
                      key={`li-${i}`}
                      className="flex items-center gap-1.5 text-[10px] font-mono"
                    >
                      <Package className="h-3 w-3 text-success shrink-0" />
                      <span className="text-muted-foreground">#{li.line_no}</span>
                      <span className="truncate flex-1">{li.item_name || "—"}</span>
                      {li.deliverable_ownership && (
                        <span className="text-[8px] px-1 rounded-sm bg-muted text-muted-foreground">
                          {li.deliverable_ownership}
                        </span>
                      )}
                      <span className="text-foreground">{yen(li.amount_ex_tax)}</span>
                    </li>
                  ))}
                </ul>
              )}

              {d.conditions.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {d.conditions.map((c, i) => (
                    <li
                      key={`c-${i}`}
                      className="flex items-center gap-1.5 text-[10px] font-mono"
                    >
                      <Scale className="h-3 w-3 text-primary shrink-0" />
                      <span className="text-muted-foreground">
                        条件{c.condition_no ?? c.line_no}
                      </span>
                      <span className="truncate flex-1">{c.label || "—"}</span>
                      {c.payment_scheme && (
                        <span className="text-[8px] px-1 rounded-sm bg-primary/10 text-primary border border-primary/40">
                          {c.payment_scheme}
                        </span>
                      )}
                      <span className="text-foreground">
                        {c.rate_pct != null ? `${c.rate_pct}%` : yen(c.amount_ex_tax)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WorkAttributionsPanel;
