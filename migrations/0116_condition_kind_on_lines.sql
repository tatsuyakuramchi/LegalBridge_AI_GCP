-- ============================================================================
-- 0116: condition_kind を実体テーブル condition_lines へ持たせる。
--   0041 で(旧)capability_financial_conditions テーブルに condition_kind を足したが、
--   0101 で cfc は VIEW 化され condition_kind は NULL 固定になり、以後 cfc 経由の
--   INSERT では condition_kind が保存されない(＝sublicense_out/license_in の区別が消える)。
--   請求・分配(再許諾受領→ライセンサー分配)は sublicense_out の識別が必須なので、
--   parent_license_condition_id(0114)と同じく実体列を condition_lines に追加し、
--   API は cfc.id = condition_lines.id を使って直接読み書きする。
--
--   バックフィル: 作品モデル由来(capability_id IS NULL, legacy_role='cfc')の条件のみ、
--   source_work_id の works.kind から復元(licensed_in→license_in / それ以外→sublicense_out)。
--   発注書等の文書由来条件(capability_id 有り)は対象外(誤ラベル防止)。
-- ============================================================================
ALTER TABLE condition_lines
  ADD COLUMN IF NOT EXISTS condition_kind VARCHAR(20);

UPDATE condition_lines cl
   SET condition_kind = CASE WHEN w.kind = 'licensed_in' THEN 'license_in' ELSE 'sublicense_out' END
  FROM works w
 WHERE w.id = cl.source_work_id
   AND cl.condition_kind IS NULL
   AND cl.legacy_role = 'cfc'
   AND cl.capability_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_condition_lines_condition_kind
  ON condition_lines(condition_kind);
