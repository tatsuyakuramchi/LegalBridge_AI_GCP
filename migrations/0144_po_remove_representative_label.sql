-- 0144_po_remove_representative_label.sql
-- 発注書(purchase_order)テンプレの宛先(発注先=受注者)ブロックで、法人のとき表示する
-- 代表者行の固定ラベル「代表者　」を削除する。
--
--   Before: 代表者　代表取締役 山田 太郎 様
--   After :          代表取締役 山田 太郎 様
--   VENDOR_REPRESENTATIVE_SAMA には肩書(代表取締役 等)＋氏名(＋様)が入るため、
--   「代表者　」の固定ラベルは重複・冗長。トークンのみを表示する。
--
--   本番 worker/search-api は TEMPLATE_SOURCE=db のため DB 版 current を貼替。
--   disk: services/worker/templates/purchase_order.html と同一内容。冪等。
--   実装方式は 0132 を踏襲(current html_source を REPLACE→新版 INSERT→current 差替)。

DO $mig_po_rep_lbl$
DECLARE
  tid        INTEGER;
  cur_html   TEXT;
  cur_schema JSONB;
  new_html   TEXT;
  vid        INTEGER;
  anchor      TEXT := $anchor$<div style="margin-top:3px; font-size:10pt;">代表者　{{VENDOR_REPRESENTATIVE_SAMA}}</div>$anchor$;
  replacement TEXT := $repl$<div style="margin-top:3px; font-size:10pt;">{{VENDOR_REPRESENTATIVE_SAMA}}</div>$repl$;
BEGIN
  SELECT dt.id, v.html_source, v.field_schema
    INTO tid, cur_html, cur_schema
    FROM document_templates dt
    LEFT JOIN document_template_versions v ON v.id = dt.current_version_id
   WHERE dt.template_key = 'purchase_order';

  IF tid IS NULL THEN
    RAISE NOTICE '0144: purchase_order template not found, skipping';
    RETURN;
  END IF;

  -- 既に「代表者　」ラベルが無い(=再適用 or 未適用の別版)場合はスキップ。
  IF position(anchor IN cur_html) = 0 THEN
    RAISE NOTICE '0144: 代表者 label anchor not found (already removed or template drift), skipping';
    RETURN;
  END IF;

  new_html := REPLACE(cur_html, anchor, replacement);

  IF new_html = cur_html THEN
    RAISE NOTICE '0144: no change produced, skipping';
    RETURN;
  END IF;

  INSERT INTO document_template_versions (template_id, version_no, html_source, field_schema, comment, created_by)
  VALUES (tid,
          COALESCE((SELECT MAX(version_no) FROM document_template_versions WHERE template_id = tid), 0) + 1,
          new_html,
          cur_schema,
          '0144: 発注先(法人)の代表者行から固定ラベル「代表者　」を削除',
          'migration-0144')
  RETURNING id INTO vid;

  UPDATE document_templates SET current_version_id = vid, updated_at = now() WHERE id = tid;
  RAISE NOTICE '0144: purchase_order 代表者 label removed (new version_id=%)', vid;
END $mig_po_rep_lbl$;
