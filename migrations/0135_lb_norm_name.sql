-- 0135_lb_norm_name.sql
-- 編集入口の一本化 B系(T1): マスタ重複作成ガード用の名称正規化関数。
--   admin-ui の DuplicateFinder(src/components/master/DuplicateFinder.tsx)と同一ルールで
--   名称を正規化する: 前後空白除去 → 小文字化 → 空白(全角含む)除去 → 記号除去。
--   作品/原作/素材等の「同名なのに別コードで重複登録」を作成 API 側で検出するために使う。
-- 可逆: DROP FUNCTION で除去可(呼び出し側は関数欠如時 fail-open で従来通り INSERT)。

CREATE OR REPLACE FUNCTION lb_norm_name(t text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             lower(btrim(coalesce(t, ''))),
             '[[:space:]　]+', '', 'g'
           ),
           '[][()（）「」『』・,.，。~〜!！?？—―-]', '', 'g'
         );
$$;
