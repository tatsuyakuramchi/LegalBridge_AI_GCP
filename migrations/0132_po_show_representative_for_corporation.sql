-- 0132_po_show_representative_for_corporation.sql
-- 発注書(purchase_order)テンプレの宛先(発注先=受注者)ブロックに、相手方が法人の
-- ときだけ代表者を表示する。
--
--   フォーム側(src/components/document/schemas/purchaseOrder.tsx)は、取引先が法人の
--   ときのみ VENDOR_REPRESENTATIVE_SAMA(=「代表者名 様」)を form_data に充填する
--   (個人取引先では空)。テンプレ側は宛先の会社名(御中)の直下に
--   {{#if VENDOR_REPRESENTATIVE_SAMA}} で条件表示するだけでよく、法人限定表示は
--   トークンの有無で自然に担保される。
--
--   本番 worker/search-api は TEMPLATE_SOURCE=db のため DB 版 current を貼替。
--   disk: services/worker/templates/purchase_order.html と同一内容。冪等。
--
--   実装方式: 950 行の全文再掲は誤植リスクが高いので、current 版の html_source を
--   REPLACE で 1 箇所だけ差し替えた新バージョンを INSERT し、current_version_id を
--   差し替える(既存の版採番/ポインタ運用を踏襲、版は不変のまま新版追加)。

DO $mig_po_rep$
DECLARE
  tid        INTEGER;
  cur_html   TEXT;
  cur_schema JSONB;
  new_html   TEXT;
  vid        INTEGER;
  anchor     TEXT := $anchor$<div class="vendor-name">{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}}　{{VENDOR_SUFFIX}}{{else}}　御中{{/if}}</div>$anchor$;
  replacement TEXT := $repl$<div class="vendor-name">{{VENDOR_NAME}}{{#if VENDOR_SUFFIX}}　{{VENDOR_SUFFIX}}{{else}}　御中{{/if}}</div>
      {{#if VENDOR_REPRESENTATIVE_SAMA}}<div style="margin-top:3px; font-size:10pt;">代表者　{{VENDOR_REPRESENTATIVE_SAMA}}</div>{{/if}}$repl$;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema
    INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'purchase_order';

  IF tid IS NULL THEN
    RAISE NOTICE '0132: purchase_order template not found, skipping';
    RETURN;
  END IF;

  -- 既に代表者行が入っている(=再適用)場合はスキップ。
  IF cur_html LIKE '%VENDOR_REPRESENTATIVE_SAMA}}<div style="margin-top:3px; font-size:10pt;">代表者%' THEN
    RAISE NOTICE '0132: purchase_order already shows representative, skipping';
    RETURN;
  END IF;

  IF position(anchor IN cur_html) = 0 THEN
    RAISE NOTICE '0132: anchor not found in current purchase_order html, skipping (template drift)';
    RETURN;
  END IF;

  new_html := REPLACE(cur_html, anchor, replacement);

  IF new_html = cur_html THEN
    RAISE NOTICE '0132: no change produced, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          new_html,
          cur_schema,
          '0132: 発注先が法人のとき宛先に代表者(VENDOR_REPRESENTATIVE_SAMA)を表示',
          'migration-0132')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
  RAISE NOTICE '0132: purchase_order representative row applied (new version_id=%)', vid;
END $mig_po_rep$;
