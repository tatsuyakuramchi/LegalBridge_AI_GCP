/**
 * VendorCsvImportDialog — Phase 22.21.34
 *
 * 取引先マスター CSV 一括取込ダイアログ。
 *
 *   - GET /api/master/vendors/template.csv      … テンプレ DL
 *   - POST /api/master/vendors/import-csv       … 取り込み (dry_run + duplicate_mode)
 *
 *   フロー:
 *     1. ファイルを選択 (.csv)
 *     2. duplicate_mode を選ぶ (overwrite / skip / fill_only)
 *     3. [プレビュー] で dry_run=true を実行 → 件数 + preview / errors を表示
 *     4. [取り込み実行] で dry_run=false を実行 → 同じ集計 + 完了通知
 *     5. onCompleted で親 (VendorsPanel / ImportPage) のマスター再取得を促す
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Upload,
  Download,
  Play,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileSpreadsheet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type DuplicateMode = "overwrite" | "skip" | "fill_only";

type ImportResult = {
  ok: boolean;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors?: Array<{ row: number; vendor_code: string; error: string }>;
  preview?: Array<{
    row: number;
    vendor_code: string;
    action: "insert" | "update" | "skip" | "fill_only";
    vendor_name: string;
  }>;
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}

export const VendorCsvImportDialog: React.FC<Props> = ({
  open,
  onClose,
  onCompleted,
}) => {
  const [csvContent, setCsvContent] = React.useState<string>("");
  const [fileName, setFileName] = React.useState<string>("");
  const [dupMode, setDupMode] = React.useState<DuplicateMode>("overwrite");
  const [submitting, setSubmitting] = React.useState(false);
  const [submitMode, setSubmitMode] = React.useState<
    "preview" | "import" | null
  >(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // 取り込み実行 (dry_run=false) が完了したかを保持。result.ok と組み合わせて
  // 「プレビュー結果」と「実行結果」を見分ける。
  const [lastWasDryRun, setLastWasDryRun] = React.useState(true);

  // ダイアログを閉じるときに state をクリーンアップ
  React.useEffect(() => {
    if (!open) {
      setCsvContent("");
      setFileName("");
      setDupMode("overwrite");
      setResult(null);
      setError(null);
      setSubmitting(false);
      setSubmitMode(null);
      setLastWasDryRun(true);
    }
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError(".csv ファイルを選択してください");
      return;
    }
    setError(null);
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      // BOM があれば除去
      const text = String(reader.result || "").replace(/^﻿/, "");
      setCsvContent(text);
    };
    reader.onerror = () => setError("ファイル読み込みに失敗しました");
    reader.readAsText(file, "UTF-8");
  };

  const downloadTemplate = async () => {
    try {
      const res = await fetch("/api/master/vendors/template.csv");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "vendor_sample.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(`テンプレ DL 失敗: ${e?.message || e}`);
    }
  };

  const submit = async (dryRun: boolean) => {
    if (!csvContent) {
      setError("先に CSV ファイルを選択してください");
      return;
    }
    setSubmitting(true);
    setSubmitMode(dryRun ? "preview" : "import");
    setError(null);
    setLastWasDryRun(dryRun);
    try {
      const res = await fetch("/api/master/vendors/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv: csvContent,
          dry_run: dryRun,
          duplicate_mode: dupMode,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setResult(data as ImportResult);
      if (!dryRun) {
        // 実取り込み完了 → 親へ通知
        onCompleted?.();
      }
    } catch (e: any) {
      setError(`${dryRun ? "プレビュー" : "取り込み"}失敗: ${e?.message || e}`);
      setResult(null);
    } finally {
      setSubmitting(false);
      setSubmitMode(null);
    }
  };

  const dupModeOptions: Array<{ value: DuplicateMode; label: string; desc: string }> = [
    {
      value: "overwrite",
      label: "上書き (Overwrite)",
      desc: "既存の vendor_code は CSV の値で全列上書き",
    },
    {
      value: "skip",
      label: "スキップ (Skip)",
      desc: "既存の vendor_code は何もせず CSV を無視 (新規のみ追加)",
    },
    {
      value: "fill_only",
      label: "空欄のみ補完 (Fill only)",
      desc: "既存の vendor_code で 空の列だけ CSV で埋める (有値は維持)",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : null)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4" />
            取引先マスター CSV 一括取込
          </DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {/* (1) テンプレ DL */}
          <div className="rounded-sm border border-input bg-muted/30 p-3 flex items-center justify-between gap-3">
            <div className="text-[11px] font-mono">
              <div className="font-bold mb-0.5">1. テンプレ CSV をダウンロード</div>
              <div className="text-muted-foreground">
                Excel で開いて行を編集し UTF-8 CSV として保存してください。
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadTemplate}
              className="flex-shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              テンプレ DL
            </Button>
          </div>

          {/* (2) ファイル選択 */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]">
              2. CSV ファイルを選択
            </Label>
            <div className="flex items-center gap-2">
              <label
                htmlFor="vendor-csv-input"
                className={cn(
                  "flex-1 inline-flex items-center gap-2 px-3 py-2 rounded-sm border border-dashed cursor-pointer transition-colors",
                  fileName
                    ? "border-emerald-400 bg-emerald-50 hover:bg-emerald-100 text-emerald-900"
                    : "border-input bg-card hover:bg-muted text-muted-foreground"
                )}
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">
                  {fileName || "ここをクリックして .csv を選択"}
                </span>
              </label>
              <input
                id="vendor-csv-input"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {fileName && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setFileName("");
                    setCsvContent("");
                    setResult(null);
                  }}
                  title="ファイル解除"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            {csvContent && (
              <div className="text-[10px] font-mono text-muted-foreground">
                {csvContent.split(/\r?\n/).filter((l) => l.trim()).length - 1}{" "}
                行 (ヘッダ除く)
              </div>
            )}
          </div>

          {/* (3) duplicate_mode */}
          <div className="space-y-1.5">
            <Label className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]">
              3. 重複時の動作 (vendor_code が既存の場合)
            </Label>
            <NativeSelect
              value={dupMode}
              onChange={(e) => setDupMode(e.target.value as DuplicateMode)}
              disabled={submitting}
            >
              {dupModeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <div className="text-[10px] font-mono text-muted-foreground">
              {dupModeOptions.find((o) => o.value === dupMode)?.desc}
            </div>
          </div>

          {/* (4) アクション */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => submit(true)}
              disabled={!csvContent || submitting}
            >
              {submitMode === "preview" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              プレビュー (dry-run)
            </Button>
            <Button
              onClick={() => submit(false)}
              disabled={!csvContent || submitting}
            >
              {submitMode === "import" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              取り込み実行
            </Button>
          </div>

          {/* エラー */}
          {error && (
            <div className="border border-destructive/30 bg-destructive/10 text-destructive rounded-sm px-3 py-2 text-[11px] font-mono flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {/* 結果サマリ */}
          {result && (
            <div
              className={cn(
                "border rounded-sm px-3 py-2 text-[11px] font-mono space-y-2",
                lastWasDryRun
                  ? "border-blue-300 bg-blue-50 text-blue-900"
                  : "border-emerald-300 bg-emerald-50 text-emerald-900"
              )}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-bold">
                  {lastWasDryRun
                    ? `🔍 プレビュー結果 (dry-run)`
                    : `✅ 取り込み完了`}
                </span>
                <span className="ml-2">
                  合計 <strong>{result.total}</strong> 件 ／ 成功{" "}
                  <strong>{result.succeeded}</strong> ／ スキップ{" "}
                  <strong>{result.skipped}</strong> ／ エラー{" "}
                  <strong>{result.failed}</strong>
                </span>
              </div>
              {/* preview action 内訳 */}
              {result.preview && result.preview.length > 0 && (
                <div className="border border-current/20 rounded-sm bg-white/50 max-h-[180px] overflow-y-auto">
                  <table className="w-full text-[10px] font-mono">
                    <thead>
                      <tr className="border-b border-current/20 bg-white/40">
                        <th className="p-1 text-left w-12">行</th>
                        <th className="p-1 text-left w-32">vendor_code</th>
                        <th className="p-1 text-left">vendor_name</th>
                        <th className="p-1 text-left w-24">action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.preview.slice(0, 200).map((p, i) => (
                        <tr key={i} className="border-t border-current/10">
                          <td className="p-1 text-muted-foreground">{p.row}</td>
                          <td className="p-1 font-bold">{p.vendor_code}</td>
                          <td className="p-1">{p.vendor_name}</td>
                          <td className="p-1">
                            <span
                              className={cn(
                                "px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-wider",
                                p.action === "insert"
                                  ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                  : p.action === "update"
                                    ? "border-amber-400 bg-amber-50 text-amber-700"
                                    : p.action === "skip"
                                      ? "border-muted-foreground/30 bg-muted text-muted-foreground"
                                      : "border-blue-400 bg-blue-50 text-blue-700"
                              )}
                            >
                              {p.action}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {/* errors */}
              {result.errors && result.errors.length > 0 && (
                <div className="border border-destructive/30 bg-destructive/5 rounded-sm max-h-[120px] overflow-y-auto">
                  <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-destructive font-bold">
                    ❌ エラー ({result.errors.length} 件)
                  </div>
                  <table className="w-full text-[10px] font-mono">
                    <tbody>
                      {result.errors.slice(0, 100).map((er, i) => (
                        <tr key={i} className="border-t border-destructive/10">
                          <td className="p-1 text-muted-foreground w-12">
                            行 {er.row}
                          </td>
                          <td className="p-1 font-bold w-32">{er.vendor_code}</td>
                          <td className="p-1 text-destructive break-all">
                            {er.error}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {lastWasDryRun && result.failed === 0 && (
                <div className="text-[10px] font-mono text-blue-700/80 italic">
                  ✓ エラーなし。問題なければ「取り込み実行」で本番反映できます。
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
