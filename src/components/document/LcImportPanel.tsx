/**
 * LcImportPanel — 個別利用許諾条件書フォームの「過去の契約・発注書から構成要素(LC)を取り込む」導線。
 *
 * 背景(New ito の例): ある作品の金銭条件は、締結済み利用許諾契約由来のマテリアル(例: ito の
 *   ゲームデザイン)と、同じ相手方が発注書で制作した成果物(例: New ito 用イラスト)といった、
 *   複数の原作マテリアルで構成されることがある。ユーザーは「過去の利用許諾条件を検索」「過去の
 *   発注書を検索」から原作マテリアルを引いて金銭条件を組み立てたい。
 *
 * 実装: 既存の UnifiedContractPicker(利用許諾条件書・発注書を横断検索)で文書を選び、
 *   GET /api/v3/documents/:documentNumber/lc-candidates で「その文書に紐づく構成要素候補
 *   (material_code + 金銭条件 or 発注者帰属成果物)」を取得。ユーザーがチェックして取り込むと、
 *   親フォームの master_materials に行を追加する(条件があれば copied として料率を引用)。
 */

import * as React from "react";
import { Loader2, PackageSearch, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedContractPicker, type ContractDetail } from "./UnifiedContractPicker";

/** GET /api/v3/documents/:documentNumber/lc-candidates が返す1候補。 */
export type LcCandidate = {
  source: "license_condition" | "po_deliverable";
  material_code: string | null;
  material_name: string | null;
  rights_holder: string | null;
  source_condition_id: number | null;
  condition_name: string | null;
  rate_pct: number | null;
  mg_amount: number | null;
  ag_amount: number | null;
  calc_method: string | null;
  calc_type: string | null;
  region_language_label: string | null;
  currency: string | null;
  item_name: string | null;
  deliverable_ownership: string | null;
  document_number: string | null;
  contract_title: string | null;
  record_type: string | null;
  /** 素材未リンクの利用許諾CL(source_material_id IS NULL)。取込後にフォームで編集可。 */
  unlinked?: boolean;
};

interface Props {
  /** 既に構成要素に入っている material_code(重複取り込み防止)。 */
  existingCodes: Set<string>;
  /** 選択候補を取り込む。親が master_materials 行化(必要なら material 新規作成)する。 */
  onImport: (candidates: LcCandidate[]) => Promise<void> | void;
}

const summarize = (c: LcCandidate): string => {
  const parts: string[] = [];
  if (c.rate_pct != null) parts.push(`料率 ${c.rate_pct}%`);
  if (c.calc_type) parts.push(String(c.calc_type));
  if (c.mg_amount) parts.push(`MG ¥${Number(c.mg_amount).toLocaleString("ja-JP")}`);
  if (c.region_language_label) parts.push(c.region_language_label);
  if (c.source === "po_deliverable" && !c.rate_pct)
    parts.push(c.material_code ? "条件未設定(要入力)" : "未登録素材(取込時に作成)");
  if (c.unlinked)
    parts.push(c.rate_pct != null ? "素材未リンク(取込可)" : "条件ブランク(取込後に編集)");
  return parts.join(" / ") || "(条件詳細なし)";
};

const candKey = (c: LcCandidate, i: number) =>
  `${c.source}:${c.material_code ?? c.item_name ?? ""}:${c.source_condition_id ?? i}`;

export const LcImportPanel: React.FC<Props> = ({ existingCodes, onImport }) => {
  const [docNumber, setDocNumber] = React.useState<string | null>(null);
  const [docTitle, setDocTitle] = React.useState<string>("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [candidates, setCandidates] = React.useState<LcCandidate[] | null>(null);
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [importing, setImporting] = React.useState(false);

  const onPick = async (detail: ContractDetail) => {
    const num = detail.document_number || detail.contract?.document_number || "";
    setDocNumber(num);
    setDocTitle(detail.contract?.contract_title || "");
    setCandidates(null);
    setChecked(new Set());
    setError(null);
    if (!num) {
      setError("文書番号が取得できませんでした");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v3/documents/${encodeURIComponent(num)}/lc-candidates`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCandidates(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(String(e?.message || e));
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const doImport = async () => {
    if (!candidates) return;
    const picked = candidates.filter((c, i) => checked.has(candKey(c, i)));
    if (picked.length === 0) return;
    setImporting(true);
    try {
      await onImport(picked);
      // 取り込んだものはチェック解除(重複防止は親の existingCodes で行 disabled 化)。
      setChecked(new Set());
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="col-span-full mt-3 rounded-md border border-info/40 bg-info/10 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-info">
          <PackageSearch className="h-3.5 w-3.5" />
          過去の契約・発注書から構成要素を取り込む
        </span>
      </div>
      <p className="text-[10px] font-mono text-info">
        締結済みの利用許諾条件書・発注書を検索し、その原作マテリアル(＋金銭条件)を構成要素LCとして取り込みます。
        発注書の受注者帰属条件は料率も引用、発注者帰属の成果物は素材として取り込み料率は金銭条件で入力します。
      </p>

      <UnifiedContractPicker
        acceptableRecordTypes={["license_condition", "individual_contract", "purchase_order"]}
        hasParent={false}
        onPick={onPick}
        onClear={() => {}}
        label="過去の利用許諾条件書 / 発注書を検索"
      />

      {docNumber && (
        <div className="text-[10px] font-mono text-info">
          対象文書: <span className="font-bold">{docNumber}</span>
          {docTitle ? `（${docTitle}）` : ""}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground py-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> 構成要素を取得中…
        </div>
      )}
      {error && (
        <div className="text-[10px] font-mono text-destructive py-1">取得に失敗しました: {error}</div>
      )}
      {!loading && candidates && candidates.length === 0 && (
        <div className="text-[10px] text-muted-foreground py-1">
          この文書から取り込める構成要素は見つかりませんでした。
        </div>
      )}

      {!loading && candidates && candidates.length > 0 && (
        <div className="space-y-1.5">
          <ul className="space-y-1">
            {candidates.map((c, i) => {
              const key = candKey(c, i);
              const already = !!c.material_code && existingCodes.has(c.material_code);
              const on = checked.has(key);
              return (
                <li
                  key={key}
                  className={cn(
                    "flex items-center gap-2 rounded-sm border px-2 py-1",
                    already
                      ? "border-slate-200 bg-slate-50 opacity-60"
                      : "border-info/40 bg-white/70"
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    disabled={already}
                    checked={on}
                    onChange={() => toggle(key)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "text-[8px] font-mono font-bold px-1 py-0.5 rounded-sm border",
                          c.source === "license_condition"
                            ? "bg-teal-100 text-teal-800 border-teal-300"
                            : "bg-primary/10 text-primary border-primary/40"
                        )}
                      >
                        {c.source === "license_condition" ? "利用許諾条件" : "発注書成果物"}
                      </span>
                      <span className="text-[11px] font-mono font-bold truncate">
                        {c.material_code ? `[${c.material_code}] ` : ""}
                        {c.material_name || c.item_name || "(名称なし)"}
                      </span>
                      {c.rights_holder && (
                        <span className="text-[9px] text-muted-foreground">
                          権利元: {c.rights_holder}
                        </span>
                      )}
                      {already && (
                        <span className="text-[9px] font-mono text-slate-500">取込済み</span>
                      )}
                    </div>
                    <div className="text-[9px] font-mono text-info truncate">
                      {summarize(c)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => void doImport()}
            disabled={importing || checked.size === 0}
            className="w-full text-[11px] font-mono px-2 py-1.5 rounded border border-info text-info hover:bg-info/10 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 取り込み中…
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> 選択した {checked.size} 件を構成要素に取り込む
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default LcImportPanel;
