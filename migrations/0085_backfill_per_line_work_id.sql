-- 0085_backfill_per_line_work_id.sql
-- PLW-E: 明細ごとの作品(0084)の既存データ backfill。
--
--   既存の condition_lines.work_id は、旧来の文書単位リンク
--   (linkWorkMaterialsForCapability / linkBuyoutMaterialsForCapability が
--    ownWorkId=文書 linked_work_id を設定)で多くが埋まっている。
--   新規列 capability_line_items.work_id / capability_financial_conditions.work_id
--   はまだ NULL のため、condition_lines から派生元へ「逆伝播」して埋める。
--     - condition_lines.source_line_item_id → capability_line_items.id
--     - condition_lines.source_condition_id → capability_financial_conditions.id
--
--   これにより作品集約ビュー(GET /api/v3/works/:id/attributions)が、
--   既存の明細/条件も作品単位で拾えるようになる。
--   NULL のままでもフォーム/表示は文書 work にフォールバックするため安全(冪等)。

-- 明細(capability_line_items)へ逆伝播。
UPDATE capability_line_items cli
   SET work_id = sub.work_id
  FROM (
    SELECT DISTINCT ON (cl.source_line_item_id)
           cl.source_line_item_id AS li_id, cl.work_id
      FROM condition_lines cl
     WHERE cl.source_line_item_id IS NOT NULL
       AND cl.work_id IS NOT NULL
     ORDER BY cl.source_line_item_id, cl.id
  ) AS sub
 WHERE cli.id = sub.li_id
   AND cli.work_id IS NULL;

-- 利用許諾条件(capability_financial_conditions)へ逆伝播。
UPDATE capability_financial_conditions cfc
   SET work_id = sub.work_id
  FROM (
    SELECT DISTINCT ON (cl.source_condition_id)
           cl.source_condition_id AS cond_id, cl.work_id
      FROM condition_lines cl
     WHERE cl.source_condition_id IS NOT NULL
       AND cl.work_id IS NOT NULL
     ORDER BY cl.source_condition_id, cl.id
  ) AS sub
 WHERE cfc.id = sub.cond_id
   AND cfc.work_id IS NULL;
