-- dedup_report.sql  （非破壊・読み取り専用レポート）
--
-- ※ ファイル名に NNNN_ プレフィックスが無いため `npm run migrate` では実行されません。
--   手動で psql から実行して「既存の重複がどれくらいあるか」を把握するためのものです。
--
-- 実行例:
--   psql "$DATABASE_URL" -f migrations/dedup_report.sql
--
-- 重複の定義(今回の方針: 起票×種別 ＋ 内容ハッシュ):
--   (1) 同じ issue_key × template_type（MANUAL- と空は除外）に複数行
--   (2) form_data が実質同一（__系の制御キーを除いて一致）
--   (3) content_hash が同一（0017 以降に保存された分）
-- 削除候補 = 各グループの「最新1件」を残した残り。

\echo '==== A. 概況 ===='
SELECT
  count(*)                                                                              AS 総文書数,
  count(*) FILTER (WHERE COALESCE(is_primary, TRUE)
                     AND COALESCE(lifecycle_status, 'final') = 'final')                 AS 正本_final数,
  count(*) FILTER (WHERE content_hash IS NOT NULL)                                      AS content_hash付き
FROM documents;

\echo ''
\echo '==== B. (issue_key × template_type) で 2件以上ある重複グループ ===='
WITH grp AS (
  SELECT issue_key, template_type, count(*) AS n
    FROM documents
   WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
   GROUP BY issue_key, template_type
  HAVING count(*) > 1
)
SELECT count(*)                  AS 重複グループ数,
       COALESCE(sum(n - 1), 0)   AS 余剰行数_最新1件残し
  FROM grp;

\echo ''
\echo '==== C. うち form_data が実質同一(__系除外)で重複している余剰行数 ===='
WITH norm AS (
  SELECT id, issue_key, template_type, created_at,
         (COALESCE(form_data, '{}'::jsonb)
            - '__pdf_pending' - '__reopen_doc_number' - '__from_pending_doc_number') AS fd
    FROM documents
   WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
),
ranked AS (
  SELECT row_number() OVER (PARTITION BY issue_key, template_type, fd
                            ORDER BY created_at DESC, id DESC) AS rn
    FROM norm
)
SELECT count(*) FILTER (WHERE rn > 1) AS 内容同一の余剰行数
  FROM ranked;

\echo ''
\echo '==== D. content_hash が同一で重複している余剰行数(0017 以降の保存分) ===='
WITH ranked AS (
  SELECT row_number() OVER (PARTITION BY template_type, content_hash
                            ORDER BY created_at DESC, id DESC) AS rn
    FROM documents
   WHERE content_hash IS NOT NULL
)
SELECT count(*) FILTER (WHERE rn > 1) AS 内容ハッシュ同一の余剰行数
  FROM ranked;

\echo ''
\echo '==== E. 重複グループ サンプル(上位20件)===='
SELECT issue_key, template_type, count(*) AS 行数,
       min(document_number) AS 例_最小番号, max(document_number) AS 例_最大番号
  FROM documents
 WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
 GROUP BY issue_key, template_type
HAVING count(*) > 1
 ORDER BY count(*) DESC
 LIMIT 20;
