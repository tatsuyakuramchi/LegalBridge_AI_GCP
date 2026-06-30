-- 0098_seed_template_preview_guide.sql
-- 「ひな型プレビュー」ガイドを 調べる・判定する(lookup) カテゴリに追加。
--   本文(version)は 0099(gen-portal-guide-seed.mjs 生成)で投入・公開する。
--   ここではメタ行のみ(status は draft で投入)。

INSERT INTO portal_guides
  (guide_key, category_id, guide_num, title, summary, is_overview, sort_order)
VALUES
  ('template_preview',
   (SELECT id FROM portal_guide_categories WHERE cat_key='lookup'),
   '13',
   'ひな型プレビュー',
   '発注書・契約書等のひな型をサンプル情報で HTML 表示／PDF 化して確認。',
   FALSE,
   2)
ON CONFLICT (guide_key) DO UPDATE
  SET category_id=EXCLUDED.category_id, guide_num=EXCLUDED.guide_num,
      title=EXCLUDED.title, summary=EXCLUDED.summary,
      sort_order=EXCLUDED.sort_order, updated_at=now();
