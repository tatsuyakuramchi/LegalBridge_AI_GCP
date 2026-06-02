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
\echo '==== C. ★削除対象★ 内容が完全一致する重複の余剰行数(これが 0018 で消える数)===='
-- 削除基準: 同 issue_key × template_type で、正規化 form_data(__系除外)が完全一致する
--   クラスタごとに「現行(is_primary かつ final)→ 最新」を1件残し、残りを削除。
--   → 削除される行には必ず内容同一の生存行があるため情報欠落なし。
--   → 内容が異なる正規の再発行版(_NNN)は別クラスタなので残る。
WITH norm AS (
  SELECT id, document_number, issue_key, template_type, created_at,
         (CASE WHEN jsonb_typeof(form_data) = 'object'
               THEN form_data - '__pdf_pending' - '__reopen_doc_number' - '__from_pending_doc_number'
               ELSE COALESCE(form_data, '{}'::jsonb) END) AS fd,
         (COALESCE(is_primary, TRUE) AND COALESCE(lifecycle_status, 'final') = 'final') AS is_current
    FROM documents
   WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
),
ranked AS (
  SELECT document_number,
         row_number() OVER (PARTITION BY issue_key, template_type, fd
                            ORDER BY is_current DESC, created_at DESC, id DESC) AS rn
    FROM norm
)
SELECT count(*) FILTER (WHERE rn > 1) AS 削除対象_余剰行数
  FROM ranked;

\echo ''
\echo '==== C-2. 削除対象の document_number サンプル(最大40件)===='
WITH norm AS (
  SELECT id, document_number, issue_key, template_type, created_at,
         (CASE WHEN jsonb_typeof(form_data) = 'object'
               THEN form_data - '__pdf_pending' - '__reopen_doc_number' - '__from_pending_doc_number'
               ELSE COALESCE(form_data, '{}'::jsonb) END) AS fd,
         (COALESCE(is_primary, TRUE) AND COALESCE(lifecycle_status, 'final') = 'final') AS is_current
    FROM documents
   WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
),
ranked AS (
  SELECT document_number, issue_key, template_type,
         row_number() OVER (PARTITION BY issue_key, template_type, fd
                            ORDER BY is_current DESC, created_at DESC, id DESC) AS rn
    FROM norm
)
SELECT document_number AS 削除対象, issue_key, template_type
  FROM ranked WHERE rn > 1
 ORDER BY issue_key, template_type, document_number
 LIMIT 40;

\echo ''
\echo '==== D. (参考)issue×種別 で複数あるグループの内訳(再発行版を含む生データ)===='
SELECT issue_key, template_type, count(*) AS 行数,
       count(DISTINCT base_document_number) AS base系列数,
       min(document_number) AS 例_最小番号, max(document_number) AS 例_最大番号
  FROM documents
 WHERE issue_key IS NOT NULL AND issue_key <> '' AND issue_key NOT LIKE 'MANUAL-%'
 GROUP BY issue_key, template_type
HAVING count(*) > 1
 ORDER BY count(*) DESC
 LIMIT 20;
