-- 0156_cover_illustration_license_territory.sql
-- 0155 で投入したカバーイラスト利用許諾ひな形の許諾条件を確定させる。
--   (1) 許諾テリトリー: 全世界・全言語(日本語版のほか翻訳版・海外版を含む)を明記。
--   (2) 態様: 【非独占／独占】の選択プレースホルダを「非独占」に確定
--       (乙は他用途に利用可。他社の同種書籍カバーへの利用のみ事前通知・協議)。
-- 0155 は immutable のため編集せず、置換で追補する(migrations/run.mjs の checksum 運用)。
-- replace() ベースなので冪等(2回目以降は置換対象が存在せず no-op)。画面から本文を
-- 編集済みのスニペットも、該当箇所を含む限り安全に更新される。

-- (1) 条件行に「言語を全言語」を追加(範囲明記版・汎用版)。
UPDATE text_snippets
   SET body = replace(
         body,
         '地域を全世界、期間を',
         '地域を全世界、言語を全言語（日本語版のほか、翻訳版及び海外版を含む。）、期間を'
       ),
       updated_at = now()
 WHERE category = 'special_terms'
   AND body LIKE '%地域を全世界、期間を%';

-- (2) 独占／非独占の選択を「非独占」に確定。
UPDATE text_snippets
   SET body = replace(body, '態様を【非独占／独占】とする', '態様を非独占とする'),
       updated_at = now()
 WHERE category = 'special_terms'
   AND body LIKE '%態様を【非独占／独占】とする%';

-- (3) 最小版にも許諾地域・言語を明記する。
UPDATE text_snippets
   SET body = replace(
         body,
         'のカバーイラストとして利用すること（電子書籍版、重版及び本件書籍の宣伝広告における利用を含む。）を許諾する。',
         'のカバーイラストとして利用すること（電子書籍版、重版及び本件書籍の宣伝広告における利用を含む。）を許諾する。許諾の範囲は、地域を全世界、言語を全言語（日本語版のほか、翻訳版及び海外版を含む。）、態様を非独占とする。'
       ),
       updated_at = now()
 WHERE category = 'special_terms'
   AND body LIKE '%のカバーイラストとして利用すること（電子書籍版、重版及び本件書籍の宣伝広告における利用を含む。）を許諾する。%'
   -- 置換後の本文は置換対象を接頭辞として含むため、二重追記を防ぐガードを置く。
   AND body NOT LIKE '%許諾の範囲は、地域を全世界%';
