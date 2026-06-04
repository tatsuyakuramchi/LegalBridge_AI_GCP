-- 0028_purpose_flow_direction.sql
-- 登録フォーム入口の「目的(purpose)」に方向(in/out)を持たせ、ライセンスイン/アウト・
-- プロダクトイン/アウトを直接選べるようにする(ユーザー決定)。
--
-- purposes は GET /api/contract-check/purposes (SELECT *) でフロントに返るため、
-- flow_direction 列を足せば登録入口の選択肢に方向が含まれる。生成時は worker が
-- formData の方向を capability / 明細の flow_direction に反映する(別コミット)。
--
-- 参照先 contract_purposes(0001)。additive・冪等。

ALTER TABLE contract_purposes
  ADD COLUMN IF NOT EXISTS flow_direction VARCHAR(10);   -- 'in'(当社支払) / 'out'(当社受領)

-- 既存 purpose に方向を付与(意味が明確なもののみ)。
--   業務委託=当社が依頼(支払)→in / ゲーム化・別地域展開=当社が他社IPを利用→in /
--   再許諾(サブライセンス)=当社が許諾→out。
--   出版・複合・不明は契約ごとに向きが変わるため NULL 据え置き(画面で指定)。
UPDATE contract_purposes SET flow_direction = 'in'
 WHERE flow_direction IS NULL
   AND purpose_code IN ('service_general','service_creative','service_event','license_game','license_localize');
UPDATE contract_purposes SET flow_direction = 'out'
 WHERE flow_direction IS NULL
   AND purpose_code IN ('license_sublicense');

-- 方向を明示した4ジャンルを登録入口に追加(直接選択用)。
INSERT INTO contract_purposes
  (purpose_code, purpose_group, purpose_label, category, required_contract_type,
   default_document_type, require_work_name, require_territory, require_language, sort_order, flow_direction)
VALUES
  ('license_in',  '方向で登録', 'ライセンスイン — 他社の作品・IPの利用許諾を受ける(当社が支払)',
     'license', 'license_basic', 'license_condition', TRUE, FALSE, FALSE, 41, 'in'),
  ('license_out', '方向で登録', 'ライセンスアウト — 自社の作品・IPを第三者に許諾する(当社が受領)',
     'license', 'license_basic', 'license_condition', TRUE, FALSE, FALSE, 42, 'out'),
  ('product_in',  '方向で登録', 'プロダクトイン — 商品/製品を仕入れる(当社が支払)',
     'sales', 'legal_review', 'legal_review', FALSE, FALSE, FALSE, 131, 'in'),
  ('product_out', '方向で登録', 'プロダクトアウト — 商品/製品を供給する(当社が受領)',
     'sales', 'legal_review', 'legal_review', FALSE, FALSE, FALSE, 132, 'out')
ON CONFLICT (purpose_code) DO UPDATE SET
  purpose_group = EXCLUDED.purpose_group,
  purpose_label = EXCLUDED.purpose_label,
  category = EXCLUDED.category,
  required_contract_type = EXCLUDED.required_contract_type,
  default_document_type = EXCLUDED.default_document_type,
  sort_order = EXCLUDED.sort_order,
  flow_direction = EXCLUDED.flow_direction,
  active = TRUE,
  updated_at = CURRENT_TIMESTAMP;
