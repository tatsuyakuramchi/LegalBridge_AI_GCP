/**
 * relatedPartyReads (search-API) — 関連当事者取引(RPT)の読取 API。
 *
 * GAS の RPT.gs (rptGetMasters / rptListAgenda) が callLegalBridgeApi_ 経由で叩く。
 * 書込は worker 側 (services/worker/src/routes/relatedParty.ts)。ここは読取のみ。
 *
 *   GET /api/rpt/entities       … [{ id, name, has_board }]
 *   GET /api/rpt/officers       … [{ officer_key, name, staff_id, roles:[{ entity_id, title, is_director }] }]
 *   GET /api/rpt/shareholdings  … [{ entity_id, holder_kind, holder_id, voting_pct }]
 *   GET /api/rpt/agenda         … [{ id, entity_id, title, txn_type, ... , status }]  (from/to/entity_id で絞込可)
 *
 * 重要: フロント(related_party.html)は id を厳密等価(===)かつ文字列で突き合わせる
 *   (parseParty が "company:123" → "123")。よって全 id を ::text で返し、
 *   サンプルデータ(文字列 id)と同じ挙動に揃える。officers / 個人株主の id は
 *   officer_key を用いる。
 */

import type { Express, RequestHandler } from "express";

export interface RelatedPartyReadsDeps {
  query: (text: string, params?: any[]) => Promise<any>;
  requirePortalSecret: RequestHandler;
}

export function registerRelatedPartyReads(app: Express, deps: RelatedPartyReadsDeps) {
  const { query, requirePortalSecret } = deps;

  // 法人(エンティティ): RPT スコープの vendors
  app.get("/api/rpt/entities", requirePortalSecret, async (_req, res) => {
    try {
      const r = await query(
        `SELECT id::text AS id, vendor_name AS name, has_board
           FROM vendors
          WHERE rpt_entity
          ORDER BY vendor_name`
      );
      res.json(r.rows);
    } catch (err: any) {
      console.error("[GET /api/rpt/entities] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // 役員: officer_key を外部 id として返す。roles に兼任を集約。
  app.get("/api/rpt/officers", requirePortalSecret, async (_req, res) => {
    try {
      const r = await query(
        `SELECT o.officer_key, o.name, o.staff_id,
                COALESCE(
                  json_agg(
                    json_build_object('entity_id', r.entity_id::text, 'title', r.title, 'is_director', r.is_director)
                  ) FILTER (WHERE r.id IS NOT NULL),
                  '[]'
                ) AS roles
           FROM officers o
           LEFT JOIN officer_roles r ON r.officer_id = o.id
          WHERE o.voided_at IS NULL
          GROUP BY o.officer_key, o.name, o.staff_id
          ORDER BY o.name`
      );
      res.json(r.rows);
    } catch (err: any) {
      console.error("[GET /api/rpt/officers] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // 株主構成: 個人株主の holder_id は officer_key を返す(フロントの director.id と一致させる)。
  app.get("/api/rpt/shareholdings", requirePortalSecret, async (_req, res) => {
    try {
      const r = await query(
        `SELECT s.entity_id::text AS entity_id,
                s.holder_kind,
                CASE WHEN s.holder_kind = 'entity'
                     THEN s.holder_entity_id::text
                     ELSE o.officer_key END AS holder_id,
                s.voting_pct
           FROM vendor_shareholdings s
           LEFT JOIN officers o ON o.id = s.holder_officer_id`
      );
      res.json(r.rows);
    } catch (err: any) {
      console.error("[GET /api/rpt/shareholdings] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // 役会議案履歴: ringi_records(board_resolution) ⨝ サイドカー。from/to/entity_id で絞込。
  app.get("/api/rpt/agenda", requirePortalSecret, async (req, res) => {
    try {
      const where: string[] = ["r.decision_type = 'board_resolution'"];
      const params: any[] = [];
      if (req.query.from) {
        params.push(String(req.query.from));
        where.push(`rp.meeting_date >= $${params.length}`);
      }
      if (req.query.to) {
        params.push(String(req.query.to));
        where.push(`rp.meeting_date <= $${params.length}`);
      }
      if (req.query.entity_id) {
        params.push(Number(req.query.entity_id));
        where.push(`rp.entity_id = $${params.length}`);
      }
      const r = await query(
        `SELECT r.id::text AS id, rp.entity_id::text AS entity_id, r.title, rp.txn_type,
                rp.party_a, rp.party_b, rp.amount_ex_tax, rp.is_conflict, rp.is_related_party,
                rp.related_category, rp.conflict_types, rp.excluded_officers,
                rp.rp_status AS status, to_char(rp.meeting_date, 'YYYY-MM-DD') AS meeting_date,
                rp.note, r.ringi_number
           FROM ringi_records r
           JOIN ringi_related_party rp ON rp.ringi_id = r.id
          WHERE ${where.join(" AND ")}
          ORDER BY rp.meeting_date DESC NULLS LAST, r.id DESC`,
        params
      );
      res.json(r.rows);
    } catch (err: any) {
      console.error("[GET /api/rpt/agenda] error:", err);
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });
}
