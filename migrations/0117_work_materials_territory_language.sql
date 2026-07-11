-- ============================================================================
-- 0117: 構成要素(work_materials)に 許諾地域(territory)・許諾言語(language) を追加。
--   個別利用許諾条件書 v3 の 1-3「構成要素の許諾範囲」で、各構成要素(原作・素材)が
--   上流権利により許諾できる地域・言語の「枠」を、構成要素マスタ(work_materials)に
--   単一の真実として持たせる(フォーム限りの保持だとばらつくため)。
--
--   - territory / language は自由記述(例: 「全世界」「日本国内」「全言語」「日本語・英語」)。
--     空 = 個別の制限なし(文書上は「1-1 に準ずる」と表示)。
--   - 取引形態(condition_lines)側の適用スコープ(2-1)とはレイヤーを異にする。
--     こちらは構成要素の枠、2-1 はその枠と 1-1 の内側で製品ごとに定める実適用スコープ。
-- ============================================================================

ALTER TABLE work_materials ADD COLUMN IF NOT EXISTS territory TEXT;

ALTER TABLE work_materials ADD COLUMN IF NOT EXISTS language TEXT;

COMMENT ON COLUMN work_materials.territory IS '許諾地域(枠)。この構成要素が上流権利で許諾できる地域。空=1-1に準ずる。';
COMMENT ON COLUMN work_materials.language  IS '許諾言語(枠)。この構成要素が上流権利で許諾できる言語。空=1-1に準ずる。';
