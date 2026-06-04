-- 0029_mixed_contracts.sql
-- 複合契約(業務委託＋ライセンス)を 1 レコードで扱えるようにする(ユーザー決定)。
--
-- 実務では「成果物の権利は相手方に帰属し、当社は制作対価(業務委託)と利用許諾料
-- (ライセンス)の両方を支払う」契約や、「ライセンス基本契約の中に発注書ベースの
-- 制作対価が含まれる」契約がある。従来はカテゴリで金銭エディタが service / license
-- 排他だったため 1 本に両方を入れられなかった。
--
-- 本マイグレーションでは additive に 2 列を足す:
--   - contract_capabilities.deliverable_ownership : 成果物の権利帰属(当社/相手方/共有)。
--       帰属=相手方のとき利用許諾料の入力を促す根拠として使う。
--   - capability_line_items.fee_type : 明細の費目区分(制作対価/利用許諾料/その他)。
--       複合契約で同一明細表の中の費目を意味づけし、検収書/計算書の補完で区別する。
--
-- 既存の category='mixed' は UI 側で両エディタ(financial_conditions + line_items)を
-- 表示することで対応する(別コミット)。purpose は既存 'mixed_service_license' を流用。
--
-- 参照先 contract_capabilities / capability_line_items(0001)。additive・冪等。

ALTER TABLE contract_capabilities
  ADD COLUMN IF NOT EXISTS deliverable_ownership VARCHAR(20);
  -- 'company'(当社帰属) / 'counterparty'(相手方帰属) / 'shared'(共有) / NULL(未設定)

ALTER TABLE capability_line_items
  ADD COLUMN IF NOT EXISTS fee_type VARCHAR(20);
  -- 'production'(制作対価) / 'royalty'(利用許諾料) / 'other'(その他) / NULL(未指定=制作対価扱い)

-- 既存明細は従来どおり「制作対価」とみなす(業務明細エディタの既定値と整合)。
UPDATE capability_line_items SET fee_type = 'production'
 WHERE fee_type IS NULL;
