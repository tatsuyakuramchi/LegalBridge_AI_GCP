/**
 * usageReportImportService — 利用報告(サブライセンス売上報告)の CSV 一括取込。
 *
 * 相手方(K社 等)から定期的に届く利用報告を CSV で取り込む。タイトル文字列
 * (改題タイトル含む)を resolveWorksByTitle で作品に名寄せし、その作品の
 * 請求権 deal(相手方/契約番号で絞り込み)に upsertReport する。
 *
 *   POST /api/sublicense/reports/import-csv  { csv, dry_run }
 *
 * 列(日本語/英語ヘッダ対応・順不同):
 *   タイトル(必須) / 相手方 / 契約番号 / 期間ラベル / 利用期間開始 /
 *   利用期間終了(代表日・必須) / 基準 / 実売上 / 実数量 / 単価 / 金額 / メモ
 */

import Papa from "papaparse";
import { listDeals, upsertReport } from "./sublicenseService.ts";
import { resolveWorksByTitle } from "./receivableMapService.ts";

type Row = Record<string, any>;

const HEADERS: Record<string, string[]> = {
  title: ["タイトル", "作品", "作品名", "title", "work"],
  counterparty: ["相手方", "サブライセンシー", "取引先", "counterparty", "sublicensee"],
  contract_number: ["契約番号", "参照契約番号", "contract_number", "contract"],
  period_label: ["期間ラベル", "期間", "対象期間", "period_label"],
  period_start: ["利用期間開始", "開始", "period_start"],
  period_end: ["利用期間終了", "代表日", "終了", "period_end", "period_date"],
  report_basis: ["基準", "report_basis", "basis"],
  reported_sales: ["実売上", "売上", "reported_sales", "sales"],
  reported_quantity: ["実数量", "数量", "reported_quantity", "quantity"],
  unit_price: ["単価", "unit_price"],
  reported_amount: ["金額", "報告金額", "reported_amount", "amount"],
  note: ["メモ", "備考", "note", "remarks"],
};

function pick(row: Row, key: string): string {
  for (const h of HEADERS[key]) {
    const v = row[h];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function normalizeBasis(v: string): string | null {
  const s = (v || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("製造") || s === "manufacturing") return "manufacturing";
  if (s.includes("利用") || s === "usage") return "usage";
  if (s.includes("売上") || s === "sales") return "sales";
  return null;
}

const numOrNull = (v: string): number | null => {
  if (!v) return null;
  const n = Number(String(v).replace(/[,¥\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export type UsageImportResult = {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  dry_run: boolean;
  rows: Array<{
    row: number;
    title: string;
    period: string;
    status: "ok" | "skip" | "error";
    deal?: string;
    message?: string;
  }>;
};

/** CSV を解析して利用報告を取り込む。dry_run のとき DB 書込なし。 */
export async function importUsageReportsCsv(
  csvText: string,
  opts: { dryRun?: boolean } = {}
): Promise<UsageImportResult> {
  const dryRun = opts.dryRun !== false; // 既定 dry-run
  const parsed = Papa.parse<Row>(csvText, {
    header: true, skipEmptyLines: true, transformHeader: (h) => String(h).trim(),
  });
  const dataRows = (parsed.data || []).filter(
    (r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== "")
  );

  // deal は一度だけロード(work_id / 相手 / 契約番号 で照合)。
  const deals = (await listDeals()).filter((d: any) => d.status !== "closed");
  const dealsByWork: Record<number, any[]> = {};
  for (const d of deals) {
    if (d.work_id == null) continue;
    (dealsByWork[Number(d.work_id)] = dealsByWork[Number(d.work_id)] || []).push(d);
  }

  const result: UsageImportResult = { total: dataRows.length, imported: 0, skipped: 0, failed: 0, dry_run: dryRun, rows: [] };

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNo = i + 2; // 1=ヘッダ
    const title = pick(r, "title");
    const periodEnd = pick(r, "period_end");
    const periodLabel = pick(r, "period_label");
    const periodDisp = periodLabel || periodEnd || "";
    const fail = (message: string) => {
      result.failed++;
      result.rows.push({ row: rowNo, title, period: periodDisp, status: "error", message });
    };

    if (!title) { fail("タイトルが空です"); continue; }
    if (!periodEnd) { fail("利用期間終了(代表日)が空です"); continue; }

    // 1) タイトル → 作品 名寄せ
    let works: any[] = [];
    try { works = await resolveWorksByTitle(title); } catch { works = []; }
    if (works.length === 0) { fail(`作品が見つかりません(タイトル「${title}」)`); continue; }

    // 2) 作品 → 請求権 deal 照合(相手方/契約番号で絞り込み)
    const counterparty = pick(r, "counterparty").toLowerCase();
    const contractNo = pick(r, "contract_number");
    let candidates: any[] = [];
    for (const w of works) candidates = candidates.concat(dealsByWork[w.id] || []);
    if (counterparty) {
      candidates = candidates.filter(
        (d: any) => (d.sublicensee_name || "").toLowerCase().includes(counterparty)
      );
    }
    if (contractNo) {
      candidates = candidates.filter((d: any) => (d.source_contract_number || "") === contractNo);
    }
    // 重複(同一 deal が複数 work 経由)を排除
    const uniq: Record<number, any> = {};
    for (const d of candidates) uniq[d.id] = d;
    candidates = Object.values(uniq);

    if (candidates.length === 0) {
      fail(`作品は見つかりましたが該当の請求権(deal)がありません${counterparty ? "(相手方絞り込み後)" : ""}。請求権台帳で deal を登録してください。`);
      continue;
    }
    if (candidates.length > 1) {
      const names = candidates.map((d: any) => `${d.sublicensee_name || "?"}${d.source_contract_number ? "/" + d.source_contract_number : ""}`).join(" , ");
      fail(`請求権(deal)が複数該当し特定できません: ${names}。CSV に「相手方」または「契約番号」列を足して特定してください。`);
      continue;
    }

    const deal = candidates[0];
    const basis = normalizeBasis(pick(r, "report_basis"));
    const rep = {
      deal_id: deal.id,
      period_date: periodEnd,
      period_end: periodEnd,
      period_label: periodLabel || null,
      period_start: pick(r, "period_start") || null,
      report_basis: basis,
      unit_price: numOrNull(pick(r, "unit_price")),
      reported_amount: numOrNull(pick(r, "reported_amount")),
      reported_sales: numOrNull(pick(r, "reported_sales")),
      reported_quantity: numOrNull(pick(r, "reported_quantity")),
      note: pick(r, "note") || null,
    };
    const hasValue = rep.reported_amount != null || rep.reported_sales != null || rep.reported_quantity != null;
    if (!hasValue) {
      result.skipped++;
      result.rows.push({ row: rowNo, title, period: periodDisp, status: "skip", deal: deal.sublicensee_name || "", message: "金額/売上/数量がいずれも空のためスキップ" });
      continue;
    }

    if (!dryRun) {
      try {
        await upsertReport(rep as any);
      } catch (e: any) {
        fail(`保存に失敗: ${String(e?.message || e)}`);
        continue;
      }
    }
    result.imported++;
    result.rows.push({
      row: rowNo, title, period: periodDisp, status: "ok",
      deal: `${deal.sublicensee_name || "?"}${deal.work_code ? " / " + deal.work_code : ""}`,
    });
  }
  return result;
}

/** サンプル CSV(BOM 付き)。 */
export function getUsageReportSampleCsv(): string {
  const headers = ["タイトル", "相手方", "契約番号", "期間ラベル", "利用期間開始", "利用期間終了", "基準", "実売上", "実数量", "単価", "金額", "メモ"];
  const sample = [
    ["自社作品α", "海外パブリッシャーA", "ARC-SUB-2026-0003", "2026年4月分", "2026-04-01", "2026-04-30", "売上", "1200000", "", "", "", "月次報告"],
    ["The Renamed Title", "K社", "", "2026年4月分", "2026-04-01", "2026-04-30", "売上", "800000", "", "", "", "改題タイトルで名寄せ"],
    ["自社作品β", "国内メーカーB", "", "2026年Q1", "2026-01-01", "2026-03-31", "製造時", "", "5000", "300", "", "製造数ベース"],
  ];
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return "﻿" + [headers, ...sample].map((r) => r.map(cell).join(",")).join("\r\n");
}
