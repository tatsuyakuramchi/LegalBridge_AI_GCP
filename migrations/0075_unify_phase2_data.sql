-- 0075_unify_phase2_data.sql
-- 作品・原作統合 Phase 2（データ移行・分類）
--   設計書 v3.0 / ドライラン結果に基づく確定移行。すべて小規模・冪等。
--   (1) 種別NULL(全11件=per_unit 委託業務)を service に確定
--   (2) IP原作2件を LO 再採番(旧コードは legacy_code 保全)+ 対応 Ledger/素材を作成
--   (3) work_materials に material_no / material_code({work_code}-NNN) / is_default を補完

-- (0) 旧コード保全列(再採番の安全網)
ALTER TABLE works ADD COLUMN IF NOT EXISTS legacy_code VARCHAR(40);

-- (1) 種別NULL の per_unit を service に確定(発注書による委託業務)
UPDATE condition_lines
   SET transaction_kind = 'service'
 WHERE transaction_kind IS NULL
   AND payment_scheme = 'per_unit';

-- (2) IP原作 → LO 再採番 + 対応 Ledger/デフォルト素材を作成
--     年は IP-YYYY-NNNN の YYYY を踏襲。LO 番号は ledgers+works の当年最大+1。
DO $$
DECLARE
  rec     RECORD;
  yr      TEXT;
  nextno  INT;
  newcode TEXT;
  lid     INT;
BEGIN
  FOR rec IN
    SELECT id, work_code, title
      FROM works
     WHERE kind = 'licensed_in'
       AND work_code LIKE 'IP-%'
       AND legacy_code IS NULL          -- 冪等: 再採番済みは除外
     ORDER BY id
  LOOP
    yr := split_part(rec.work_code, '-', 2);
    SELECT COALESCE(MAX(
             CASE WHEN code ~ ('^LO-' || yr || '-[0-9]+$')
                  THEN split_part(code, '-', 3)::int ELSE 0 END), 0)
      INTO nextno
      FROM (
        SELECT ledger_code AS code FROM ledgers
        UNION ALL
        SELECT work_code AS code FROM works
      ) c;
    nextno  := nextno + 1;
    newcode := 'LO-' || yr || '-' || lpad(nextno::text, 4, '0');

    UPDATE works
       SET legacy_code = rec.work_code,
           work_code   = newcode,
           updated_at  = now()
     WHERE id = rec.id;

    INSERT INTO ledgers (ledger_code, title, is_active)
      VALUES (newcode, rec.title, true)
      ON CONFLICT (ledger_code) DO NOTHING;

    SELECT id INTO lid FROM ledgers WHERE ledger_code = newcode;

    INSERT INTO materials (ledger_id, material_no, material_code, material_name, is_default, is_active)
      VALUES (lid, 1, newcode || '-001', rec.title, true, true)
      ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- (3) work_materials の素材コード/連番/デフォルトを補完(再採番後に実行)
--     1 work 配下で id 昇順に連番、先頭を原作本体(is_default)とする。
WITH numbered AS (
  SELECT wm.id,
         w.work_code,
         ROW_NUMBER() OVER (PARTITION BY wm.work_id ORDER BY wm.id) AS rn
    FROM work_materials wm
    JOIN works w ON w.id = wm.work_id
   WHERE wm.material_code IS NULL          -- 冪等: 未採番のみ
)
UPDATE work_materials wm
   SET material_no   = numbered.rn,
       material_code = numbered.work_code || '-' || lpad(numbered.rn::text, 3, '0'),
       is_default    = (numbered.rn = 1),
       updated_at    = now()
  FROM numbered
 WHERE numbered.id = wm.id;
