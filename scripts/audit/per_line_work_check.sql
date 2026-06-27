-- per_line_work_check.sql
-- PLW(明細ごとの作品帰属)の検証クエリ集。psql で順に実行して状況を確認する。
-- 期待: backfill(0085)後、明細/条件の work_id が文書単位リンクから伝播していること。

\echo '== 1) 列の存在確認 =='
SELECT table_name, column_name
  FROM information_schema.columns
 WHERE column_name = 'work_id'
   AND table_name IN ('capability_line_items','capability_financial_conditions','condition_lines')
 ORDER BY table_name;

\echo '== 2) work_id 充足率(明細) =='
SELECT
  COUNT(*)                                   AS total_line_items,
  COUNT(work_id)                             AS with_work_id,
  COUNT(*) - COUNT(work_id)                  AS null_work_id
FROM capability_line_items;

\echo '== 3) work_id 充足率(利用許諾条件) =='
SELECT
  COUNT(*)                                   AS total_conditions,
  COUNT(work_id)                             AS with_work_id,
  COUNT(*) - COUNT(work_id)                  AS null_work_id
FROM capability_financial_conditions;

\echo '== 4) 1文書に複数作品が混在する発注書(=明細単位帰属が効いている例) =='
SELECT cc.id AS capability_id, cc.document_number,
       COUNT(DISTINCT cli.work_id) AS distinct_works
  FROM capability_line_items cli
  JOIN contract_capabilities cc ON cc.id = cli.capability_id
 WHERE cli.work_id IS NOT NULL
 GROUP BY cc.id, cc.document_number
HAVING COUNT(DISTINCT cli.work_id) > 1
 ORDER BY distinct_works DESC
 LIMIT 20;

\echo '== 5) ある作品の集約(作品1:文書N:明細N)。:wid を作品IDに置換 =='
-- 例: \set wid 123
SELECT 'line_item' AS kind, cli.capability_id, cc.document_number,
       cli.line_no, cli.item_name AS label, cli.amount_ex_tax
  FROM capability_line_items cli
  JOIN contract_capabilities cc ON cc.id = cli.capability_id
 WHERE cli.work_id = :wid
UNION ALL
SELECT 'condition' AS kind, cl.capability_id, cc.document_number,
       cl.line_no, COALESCE(cfc.condition_name, cl.subject) AS label, cl.amount_ex_tax
  FROM condition_lines cl
  JOIN contract_capabilities cc ON cc.id = cl.capability_id
  LEFT JOIN capability_financial_conditions cfc ON cfc.id = cl.source_condition_id
 WHERE cl.work_id = :wid
 ORDER BY document_number, kind, line_no;
