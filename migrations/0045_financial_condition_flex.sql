-- 0045_financial_condition_flex.sql
-- 文書登録の金銭条件(条件明細)に柔軟性を付与する。
--  - 任意の条件名称(condition_name)
--  - 構造化した計算式タイプ(calc_type): 4種
--      BASE_QTY_RATE : 基準価格 × 個数 × 料率
--      BASE_RATE     : 基準価格 × 料率
--      FIXED         : 固定値 (一括/分割)
--      SUBSCRIPTION  : サブスクリプション (月払い/年払い)
--  - FIXED のサブ種別(fixed_kind): LUMP(一括) / INSTALLMENT(分割)
--  - SUBSCRIPTION のサイクル(subscription_cycle): MONTHLY(月払い) / ANNUAL(年払い)
--  - 固定額 / サブスク単価(unit_amount)
--  - 保証種別(guarantee_type): NONE / MG / AG  (BASE_QTY_RATE / BASE_RATE に適用・排他)
--    ※ MG(最低保証 floor)=mg_amount, AG(前払い保証 累積消化)=ag_amount は既存列を流用。
-- calc_method(ROYALTY/FIXED/SUBSCRIPTION)は後方互換のため calc_type から自動導出して保持。

ALTER TABLE capability_financial_conditions
  ADD COLUMN IF NOT EXISTS condition_name      TEXT,
  ADD COLUMN IF NOT EXISTS calc_type           VARCHAR(30),
  ADD COLUMN IF NOT EXISTS fixed_kind          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS subscription_cycle  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS unit_amount         DECIMAL(15, 2),
  ADD COLUMN IF NOT EXISTS guarantee_type      VARCHAR(10);

-- 既存行の calc_type を calc_method から推定してバックフィル。
UPDATE capability_financial_conditions
   SET calc_type = CASE
       WHEN calc_method = 'SUBSCRIPTION' THEN 'SUBSCRIPTION'
       WHEN calc_method = 'FIXED'        THEN 'FIXED'
       WHEN calc_method = 'ROYALTY'      THEN 'BASE_QTY_RATE'
       ELSE NULL
     END
 WHERE calc_type IS NULL;

-- 既存行の guarantee_type を mg_amount / ag_amount からバックフィル(排他: AG 優先)。
UPDATE capability_financial_conditions
   SET guarantee_type = CASE
       WHEN COALESCE(ag_amount, 0) > 0 THEN 'AG'
       WHEN COALESCE(mg_amount, 0) > 0 THEN 'MG'
       ELSE 'NONE'
     END
 WHERE guarantee_type IS NULL;
