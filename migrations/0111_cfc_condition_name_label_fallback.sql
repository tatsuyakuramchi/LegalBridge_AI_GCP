-- ============================================================================
-- 0111: cfc(capability_financial_conditions)ビューへの INSERT/UPDATE で、
--       condition_name が未指定でも region_language_label をラベルとして採用する。
--
-- 背景: 0101 のスキーマ統合で cfc は condition_lines の互換ビューになり、
--   ビュー列 region_language_label は condition_lines.condition_name にバックされる。
--   ところが cfc_ins / cfc_upd は NEW.condition_name しか読まないため、
--   出版利用許諾条件書の生成経路(worker は region_language_label のみを渡し
--   condition_name は渡さない)ではラベルが欠落し、
--   条件明細の「件名(subject = COALESCE(cl.subject, cl.condition_name))」が空になる。
--
--   本マイグレーションは両トリガ関数を CREATE OR REPLACE で置き換え、
--   condition_name = COALESCE(NULLIF(NEW.condition_name,''), NULLIF(NEW.region_language_label,''))
--   とする(既存の呼び出し互換・冪等)。
-- ============================================================================

-- cfc 互換ビューが存在する環境(=0101 適用済)でのみ実行。
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_name = 'capability_financial_conditions'
  ) THEN
    RAISE NOTICE '[0111] capability_financial_conditions ビューが無いためスキップ';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION cfc_ins() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE v_scheme text; v_dir text; v_swork int; v_code text; v_amt numeric; rid int; v_ln int; v_name text;
  BEGIN
    v_ln    := NEW.condition_no;
    v_scheme:= cl_scheme(NEW.calc_method, NEW.rate_pct);
    v_dir   := cl_dir(NEW.capability_id);
    v_swork := COALESCE(NEW.source_work_id, NEW.work_id, cl_resolve_work(NEW.source_material_id));
    v_name  := COALESCE(NULLIF(NEW.condition_name, ''), NULLIF(NEW.region_language_label, ''));
    SELECT line_code INTO v_code FROM condition_lines WHERE document_id=NEW.capability_id AND line_no=v_ln;
    IF v_code IS NULL THEN v_code := cl_next_code(); END IF;
    v_amt := CASE WHEN v_scheme IN ('royalty','subscription') THEN NULL ELSE COALESCE(NEW.unit_amount, NEW.mg_amount, 0) END;
    INSERT INTO condition_lines (
      document_id, capability_id, line_no, legacy_role, line_code, direction, payment_scheme,
      status_flags, is_inbound, is_addon, transaction_kind, condition_name, rate_pct, mg_amount, ag_amount,
      currency, base_price_label, formula_text, payment_terms, calc_period, calc_period_kind, calc_period_close_month,
      counterparty_vendor_id, source_work_id, source_material_id, unit_price, cycle, billing_day, term_start, term_end,
      calc_type, fixed_kind, subscription_cycle, unit_amount, guarantee_type, region_territory, region_language,
      applies_scope, manufacturer, seller, max_region, max_language, quantity, amount_ex_tax, updated_at
    ) VALUES (
      NEW.capability_id, NEW.capability_id, v_ln, 'cfc', v_code, v_dir, v_scheme,
      '{}', false, COALESCE(NEW.is_addon,false), 'license', v_name,
      CASE WHEN v_scheme='royalty' THEN NEW.rate_pct END,
      CASE WHEN v_scheme='royalty' THEN NEW.mg_amount END,
      CASE WHEN v_scheme='royalty' THEN NEW.ag_amount END,
      COALESCE(NEW.currency,'JPY'), NEW.base_price_label, NEW.formula_text, NEW.payment_terms,
      NEW.calc_period, NEW.calc_period_kind, NEW.calc_period_close_month, NEW.counterparty_vendor_id,
      v_swork, NEW.source_material_id, NEW.unit_price, NEW.cycle, NEW.billing_day, NEW.term_start, NEW.term_end,
      NEW.calc_type, NEW.fixed_kind, NEW.subscription_cycle, NEW.unit_amount, NEW.guarantee_type,
      NEW.region_territory, NEW.region_language, NEW.applies_scope, NEW.manufacturer, NEW.seller,
      NEW.max_region, NEW.max_language, NEW.quantity::numeric, v_amt, now()
    )
    ON CONFLICT (document_id, line_no) DO UPDATE SET
      legacy_role='cfc', direction=EXCLUDED.direction, payment_scheme=EXCLUDED.payment_scheme, is_addon=EXCLUDED.is_addon,
      transaction_kind='license', condition_name=EXCLUDED.condition_name, rate_pct=EXCLUDED.rate_pct, mg_amount=EXCLUDED.mg_amount,
      ag_amount=EXCLUDED.ag_amount, currency=EXCLUDED.currency, base_price_label=EXCLUDED.base_price_label,
      formula_text=EXCLUDED.formula_text, payment_terms=EXCLUDED.payment_terms, calc_period=EXCLUDED.calc_period,
      calc_period_kind=EXCLUDED.calc_period_kind, calc_period_close_month=EXCLUDED.calc_period_close_month,
      counterparty_vendor_id=EXCLUDED.counterparty_vendor_id, source_work_id=EXCLUDED.source_work_id,
      source_material_id=EXCLUDED.source_material_id, unit_price=EXCLUDED.unit_price, cycle=EXCLUDED.cycle,
      billing_day=EXCLUDED.billing_day, term_start=EXCLUDED.term_start, term_end=EXCLUDED.term_end, calc_type=EXCLUDED.calc_type,
      fixed_kind=EXCLUDED.fixed_kind, subscription_cycle=EXCLUDED.subscription_cycle, unit_amount=EXCLUDED.unit_amount,
      guarantee_type=EXCLUDED.guarantee_type, region_territory=EXCLUDED.region_territory, region_language=EXCLUDED.region_language,
      applies_scope=EXCLUDED.applies_scope, manufacturer=EXCLUDED.manufacturer, seller=EXCLUDED.seller,
      max_region=EXCLUDED.max_region, max_language=EXCLUDED.max_language, quantity=EXCLUDED.quantity,
      amount_ex_tax=EXCLUDED.amount_ex_tax, updated_at=now()
    RETURNING id INTO rid;
    NEW.id := rid; RETURN NEW;
  END $fn$;

  CREATE OR REPLACE FUNCTION cfc_upd() RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE v_scheme text;
  BEGIN
    v_scheme := cl_scheme(NEW.calc_method, NEW.rate_pct);
    UPDATE condition_lines SET
      line_no=NEW.condition_no, payment_scheme=v_scheme, is_addon=COALESCE(NEW.is_addon,false),
      condition_name=COALESCE(NULLIF(NEW.condition_name,''), NULLIF(NEW.region_language_label,'')),
      rate_pct=CASE WHEN v_scheme='royalty' THEN NEW.rate_pct END,
      mg_amount=CASE WHEN v_scheme='royalty' THEN NEW.mg_amount END,
      ag_amount=CASE WHEN v_scheme='royalty' THEN NEW.ag_amount END,
      currency=COALESCE(NEW.currency,'JPY'), base_price_label=NEW.base_price_label, formula_text=NEW.formula_text,
      payment_terms=NEW.payment_terms, calc_period=NEW.calc_period, calc_period_kind=NEW.calc_period_kind,
      calc_period_close_month=NEW.calc_period_close_month, counterparty_vendor_id=NEW.counterparty_vendor_id,
      source_work_id=COALESCE(NEW.source_work_id, NEW.work_id, cl_resolve_work(NEW.source_material_id)),
      source_material_id=NEW.source_material_id, unit_price=NEW.unit_price, cycle=NEW.cycle, billing_day=NEW.billing_day,
      term_start=NEW.term_start, term_end=NEW.term_end, calc_type=NEW.calc_type, fixed_kind=NEW.fixed_kind,
      subscription_cycle=NEW.subscription_cycle, unit_amount=NEW.unit_amount, guarantee_type=NEW.guarantee_type,
      region_territory=NEW.region_territory, region_language=NEW.region_language, applies_scope=NEW.applies_scope,
      manufacturer=NEW.manufacturer, seller=NEW.seller, max_region=NEW.max_region, max_language=NEW.max_language,
      quantity=NEW.quantity::numeric,
      amount_ex_tax=CASE WHEN v_scheme IN ('royalty','subscription') THEN NULL ELSE COALESCE(NEW.unit_amount,NEW.mg_amount,0) END,
      updated_at=now()
    WHERE id = OLD.id;
    RETURN NEW;
  END $fn$;

  RAISE NOTICE '[0111] cfc_ins / cfc_upd を region_language_label フォールバック対応に更新';
END $guard$;
