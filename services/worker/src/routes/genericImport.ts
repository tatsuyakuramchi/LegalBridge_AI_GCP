/**
 * 汎用スキーマ駆動 CSV 取込ルート。
 *   GET  /api/imports/tables                     … 取込可能オブジェクト一覧（列メタ要約付き）
 *   GET  /api/imports/tables/:name/template.csv  … テンプレ CSV ダウンロード
 *   POST /api/imports/tables/:name               … CSV 取込（multipart file または JSON）
 *                                                   ?mode=strict|besteffort（既定 strict）
 *
 * 実体ロジックは src/lib/genericImportService.ts（db.query のみ依存・単体テスト済）。
 */
import type { Express, RequestHandler } from "express";
import express from "express";
import multer from "multer";
import Papa from "papaparse";
import {
  listObjectNames,
  describeObject,
  buildTemplateCsv,
  importRows,
} from "../lib/genericImportService.ts";

export interface GenericImportDeps {
  query: (text: string, params?: any[]) => Promise<any>;
  requirePortalSecret?: RequestHandler;
}

export function registerGenericImport(app: Express, deps: GenericImportDeps) {
  const db = { query: deps.query };
  const guard: RequestHandler = deps.requirePortalSecret || ((_req, _res, next) => next());
  const upload = multer({ storage: multer.memoryStorage() });

  // 一覧（各オブジェクトの列数・必須列・競合キーを要約）。
  app.get("/api/imports/tables", guard, async (_req, res) => {
    try {
      const objs = await listObjectNames(db);
      const out = await Promise.all(
        objs.map(async (o) => {
          const d = await describeObject(db, o.name);
          const importable = d.columns.filter((c) => c.importable);
          return {
            name: o.name,
            kind: o.kind,
            columns: importable.length,
            required: importable.filter((c) => c.required).map((c) => c.name),
            keys: d.keys, // upsert 競合キー候補（空＝INSERT のみ／ビュー）
          };
        })
      );
      res.json({ ok: true, objects: out });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // テンプレ CSV（ヘッダ＋型注記行）。
  app.get("/api/imports/tables/:name/template.csv", guard, async (req, res) => {
    try {
      const csv = await buildTemplateCsv(db, String(req.params.name));
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="template_${String(req.params.name)}.csv"`
      );
      res.send("﻿" + csv); // BOM 付き（Excel 文字化け回避）
    } catch (e: any) {
      res.status(400).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // 取込本体。multipart(file) or JSON({csv} / {rows})。
  app.post(
    "/api/imports/tables/:name",
    guard,
    upload.single("file"),
    express.json({ limit: "20mb" }),
    async (req, res) => {
      try {
        const name = String(req.params.name);
        const mode = String((req.query as any).mode || "strict") === "besteffort" ? "besteffort" : "strict";

        // 行データの取得: file(CSV) → text(CSV) → rows(JSON)
        let rows: Record<string, any>[] | null = null;
        const fileBuf = (req as any).file?.buffer as Buffer | undefined;
        const body: any = req.body || {};
        const csvText: string | undefined = fileBuf
          ? fileBuf.toString("utf8")
          : typeof body.csv === "string"
            ? body.csv
            : undefined;
        if (csvText != null) {
          const parsed = Papa.parse<Record<string, any>>(csvText.replace(/^﻿/, ""), {
            header: true,
            skipEmptyLines: "greedy",
            transformHeader: (h) => h.trim(),
          });
          const firstField = parsed.meta.fields?.[0];
          rows = (parsed.data || [])
            .filter((r) => r && Object.keys(r).length > 0)
            // "#" 始まりの行（テンプレ型注記行・ユーザコメント）は除外。
            .filter((r) => !(firstField && String(r[firstField] ?? "").trim().startsWith("#")));
        } else if (Array.isArray(body.rows)) {
          rows = body.rows;
        }

        if (!rows) {
          return res
            .status(400)
            .json({ ok: false, error: "CSV(file/csv) または rows(JSON) が必要です" });
        }

        const result = await importRows(db, name, rows, mode as "strict" | "besteffort");
        const ok = result.errors.length === 0 || mode === "besteffort";
        res.status(ok ? 200 : 422).json({ ok, ...result });
      } catch (e: any) {
        res.status(400).json({ ok: false, error: String(e?.message || e) });
      }
    }
  );
}
