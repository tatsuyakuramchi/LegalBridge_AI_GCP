-- 0141_condition_fee_subject.sql
-- Phase F 第4弾: 条件明細に 利用料名目 の上書き(override)と 凍結スナップショット(snapshot)を持たせる(設計 §6.6)。
--   過去計算書に名目文字列は保存されていない(render 時計算)ため、DB からの literal 抽出は不可。
--   代わりに §6.6 の解決順で「現在解決できる名目」を snapshot にベースライン凍結する。
--   以後の作品名・シリーズ名変更でも、この snapshot を参照すれば過去表示を固定できる。
--   既存列は非破壊。additive・冪等・可逆。
--   ロールバック: ALTER TABLE condition_lines
--                   DROP COLUMN IF EXISTS fee_subject_snapshot,
--                   DROP COLUMN IF EXISTS fee_subject_override;

ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS fee_subject_override TEXT,   -- 手動上書き(解決順 #1)
  ADD COLUMN IF NOT EXISTS fee_subject_snapshot TEXT;   -- 発行時に凍結した名目

-- ベースライン凍結: 解決順 §6.6 で名目を決めて snapshot が空の条件へ埋める(冪等: NULL のみ)。
--   #1 fee_subject_override（今回追加＝当面 NULL）
--   #2 material_rights_sources.fee_subject_name(＋suffix)  ← F3 でリンクした material_rights_source_id 経由
--   #3 権利根源作品タイトル ＋「原作利用料」                ← mrs.source_work_id → works.title
--   #5 マテリアル名 ＋「利用料」                            ← 軸マテリアル material_ref_id / source_material_id
--   （#4 権利根源作品群名は work_families 整理が F5 のため本弾では扱わない）
--   名目が解決できない(全て NULL の)条件は snapshot も NULL のまま(MAT-FEE-002 で将来検出)。
UPDATE condition_lines cl
   SET fee_subject_snapshot = sub.resolved
  FROM (
    SELECT cl2.id,
           COALESCE(
             NULLIF(btrim(cl2.fee_subject_override), ''),
             NULLIF(btrim(COALESCE(mrs.fee_subject_name, '') || COALESCE(mrs.fee_subject_suffix, '')), ''),
             CASE WHEN NULLIF(btrim(sw.title), '') IS NOT NULL
                  THEN '『' || btrim(sw.title) || '』原作利用料' END,
             CASE WHEN NULLIF(btrim(wm.material_name), '') IS NOT NULL
                  THEN btrim(wm.material_name) || '利用料' END
           ) AS resolved
      FROM condition_lines cl2
      LEFT JOIN material_rights_sources mrs ON mrs.id = cl2.material_rights_source_id
      LEFT JOIN works sw           ON sw.id = mrs.source_work_id
      LEFT JOIN work_materials wm  ON wm.id = COALESCE(cl2.material_ref_id, cl2.source_material_id)
  ) sub
 WHERE cl.id = sub.id
   AND cl.fee_subject_snapshot IS NULL
   AND sub.resolved IS NOT NULL;
