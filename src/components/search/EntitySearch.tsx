/**
 * EntitySearch — マスタDBの統一検索補完モジュール。
 *
 * 担当者(staff) / 取引先(vendor) / 原作(source_ip) / 原作マテリアル(work_material) /
 * 作品(work) を、単一のコンポーネント <EntitySearchSelect entity=… /> で
 * 「入力途中で DB を検索 → 選択 → 呼び出し側へ返す」補完に統一する。
 *
 * 目的: これまで散在していた VendorSearchSelect / WorkPicker / MaterialSearchSelect /
 *   ledger ピッカー等を1つの API・1つの見た目へ集約し、管理しやすくする。
 *   データ源は AppData(vendors/staff/ledgers) と /api/v3/*(works/source-ips/materials)。
 *
 * 返却は EntityOption(id/code/label/sub/raw)。呼び出し側は onSelect でどの
 * formData キーに何を書くかを決める(このモジュールは formData を知らない)。
 */
import * as React from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useAppData } from "@/src/context/AppDataContext";

export type EntityKind = "vendor" | "staff" | "source_ip" | "work" | "work_material" | "ledger" | "matter" | "issue";

export interface EntityOption {
  id: string;
  code?: string;
  label: string;
  sub?: string;
  raw: any;
}

export const ENTITY_LABEL: Record<EntityKind, string> = {
  vendor: "取引先",
  staff: "担当者",
  source_ip: "原作",
  work: "作品",
  work_material: "原作マテリアル",
  ledger: "原作(台帳)",
  matter: "案件",
  issue: "依頼",
};

// AppData 由来(fetch 不要)の種別。remote 取得が要る種別と分ける。
const FROM_CONTEXT: Record<EntityKind, "vendors" | "staff" | "ledgers" | "issues" | null> = {
  vendor: "vendors",
  staff: "staff",
  ledger: "ledgers",
  issue: "issues",
  source_ip: null,
  work: null,
  work_material: null,
  matter: null,
};

const s = (v: any) => (v == null ? "" : String(v));

function mapOption(entity: EntityKind, r: any): EntityOption {
  switch (entity) {
    case "vendor":
      return { id: s(r.id ?? r.vendor_code), code: s(r.vendor_code), label: s(r.vendor_name) || s(r.vendor_code), sub: s(r.vendor_code), raw: r };
    case "staff":
      return { id: s(r.id ?? r.slack_user_id), code: s(r.slack_user_id), label: s(r.staff_name) || s(r.name), sub: s(r.department || r.role || ""), raw: r };
    case "source_ip":
      return { id: s(r.id), code: s(r.source_code || r.work_code), label: s(r.title), sub: "原作 " + s(r.source_code || r.work_code), raw: r };
    case "work":
      return { id: s(r.id), code: s(r.work_code), label: s(r.title), sub: "作品 " + s(r.work_code), raw: r };
    case "work_material":
      return { id: s(r.id), code: s(r.material_code), label: s(r.material_name) || s(r.material_code), sub: s(r.material_code), raw: r };
    case "ledger":
      return { id: s(r.id), code: s(r.ledger_code), label: s(r.title), sub: s(r.ledger_code), raw: r };
    case "matter":
      return { id: s(r.id), code: s(r.matter_code || r.code), label: s(r.title || r.name) || `案件 #${s(r.id)}`, sub: s(r.status || r.matter_status || ""), raw: r };
    case "issue":
      return { id: s(r.issueKey || r.issue_key), code: s(r.issueKey || r.issue_key), label: s(r.summary) || s(r.issueKey), sub: s(r.status?.name || r.statusName || r.issueKey), raw: r };
  }
}

/** remote 取得が要る種別の fetch URL。work_material は parentId(原作 id) が必須。 */
function remoteUrl(entity: EntityKind, parentId?: string | number | null): string | null {
  if (entity === "source_ip") return "/api/v3/source-ips";
  if (entity === "work") return "/api/v3/works";
  if (entity === "matter") return "/api/matters";
  if (entity === "work_material") return parentId ? `/api/v3/works/${encodeURIComponent(String(parentId))}/materials` : null;
  return null;
}

// API の応答ゆらぎ(配列 / {matters} / {rows} / {items} / {data})を吸収して配列化。
function unwrapList(d: any): any[] {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== "object") return [];
  for (const k of ["matters", "rows", "items", "data", "results", "list"]) {
    if (Array.isArray(d[k])) return d[k];
  }
  return [];
}

export interface EntitySearchSelectProps {
  entity: EntityKind;
  /** work_material の親原作 id(source_ip の id)。未指定だと空一覧。 */
  parentId?: string | number | null;
  /** 現在の選択(表示用)。code もしくは id いずれかで一致判定。 */
  value?: string | null;
  onSelect: (opt: EntityOption | null) => void;
  placeholder?: string;
  className?: string;
  /** 検索なし初期表示の最大件数(既定 50)。 */
  limit?: number;
}

export const EntitySearchSelect: React.FC<EntitySearchSelectProps> = ({
  entity,
  parentId,
  value,
  onSelect,
  placeholder,
  className,
  limit = 50,
}) => {
  const app = useAppData() as any;
  const ctxKey = FROM_CONTEXT[entity];
  const [remote, setRemote] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);

  // remote 取得(source_ip / work / work_material)。
  React.useEffect(() => {
    if (ctxKey) return; // context 由来は取得不要
    const url = remoteUrl(entity, parentId);
    if (!url) { setRemote([]); return; }
    let alive = true;
    setLoading(true);
    fetch(url)
      .then((r) => r.json())
      .then((d) => { if (alive) setRemote(unwrapList(d)); })
      .catch(() => { if (alive) setRemote([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [entity, ctxKey, parentId]);

  const ctxField = ctxKey === "staff" ? "staffList" : ctxKey; // AppData の実フィールド名(staff→staffList)
  const rows: any[] = ctxKey ? (Array.isArray(app?.[ctxField as string]) ? app[ctxField as string] : []) : remote;
  const options = React.useMemo(() => rows.map((r) => mapOption(entity, r)), [rows, entity]);

  const selected = React.useMemo(() => {
    if (!value) return null;
    return options.find((o) => o.code === value || o.id === value) || null;
  }, [options, value]);

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options.slice(0, limit);
    return options
      .filter((o) => `${o.label} ${o.sub || ""} ${o.code || ""}`.toLowerCase().includes(term))
      .slice(0, limit);
  }, [options, q, limit]);

  const baseCls = "w-full min-h-8 rounded-md border border-border bg-background text-[12px] font-mono";

  // 選択済み表示(バッジ + 解除)。
  if (selected && !open) {
    return (
      <div className={`${baseCls} flex items-center gap-2 px-2.5 py-1 ${className || ""}`}>
        <span className="text-[9px] font-bold text-muted-foreground border border-border rounded px-1 bg-muted/40 shrink-0">
          {ENTITY_LABEL[entity]}
        </span>
        <span className="font-bold truncate">{selected.label}</span>
        {selected.sub && <span className="text-muted-foreground truncate">{selected.sub}</span>}
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => { onSelect(null); setOpen(true); }}
          aria-label="選択を解除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`relative ${className || ""}`}>
      <div className={`${baseCls} flex items-center gap-1.5 px-2.5`}>
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder || `${ENTITY_LABEL[entity]}を検索（名称 / コード）`}
          className="flex-1 bg-transparent py-1.5 focus:outline-none"
          disabled={entity === "work_material" && !parentId}
        />
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
      </div>
      {entity === "work_material" && !parentId && (
        <p className="font-mono text-[9px] text-amber-600 mt-1">先に原作を選択してください。</p>
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {filtered.map((o) => (
            <button
              key={`${o.id}:${o.code || ""}`}
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] font-mono hover:bg-muted/60"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(o); setQ(""); setOpen(false); }}
            >
              <span className="font-bold truncate">{o.label}</span>
              {o.sub && <span className="text-muted-foreground text-[10px] truncate ml-auto">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {open && !loading && filtered.length === 0 && (
        <div className="absolute z-30 mt-1 w-full rounded-md border border-border bg-popover shadow-lg px-2.5 py-2 text-[11px] font-mono text-muted-foreground">
          該当なし
        </div>
      )}
    </div>
  );
};
