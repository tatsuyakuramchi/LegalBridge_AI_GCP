-- 0094_seed_portal_guides.sql
-- 法務ポータルのカテゴリ + ガイドメタを投入する(0093 の器へ)。
--   - HTML 本体(html_source)は持たない。配置済み guides/<key>.html を
--     migrations/sync-guides-to-db.mjs が版として投入し status を published にする。
--   - 再実行で published 状態をリセットしないよう、ON CONFLICT では status /
--     current_version_id を更新しない(メタのみ更新)。
--   - contractcheck(基本契約範囲確認)/related_party(関連当事者取引)は
--     ガイドから除外(前者=検索機能に集約、後者=後日アプリ化)。

-- ── カテゴリ(配列順=ポータルの表示順) ───────────────────────────
INSERT INTO portal_guide_categories (cat_key, label, color, description, sort_order) VALUES
  ('transactions', 'A. 取引を進める',          '#27500a', '取引が決まってからの社内手続き・取引先登録・出版フロー', 1),
  ('contracts',    'B. 契約を設計・理解する',   '#0c447c', 'スキーム選択・条文の意味・契約実務の基準',               2),
  ('lookup',       'C. 調べる・判定する',       '#085041', '取引先・契約・文書・稟議・条件明細の検索',               3),
  ('compliance',   'D. 法律・コンプライアンス', '#c47d1a', '取適法・フリーランス法／個人情報／試遊インストラクション', 4)
ON CONFLICT (cat_key) DO UPDATE
  SET label=EXCLUDED.label, color=EXCLUDED.color,
      description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, updated_at=now();

-- ── ガイド(head)。category_id は cat_key から解決。status は draft(準備中)で投入し、
--    sync-guides-to-db.mjs がファイル投入時に published へ。 ───────────────
INSERT INTO portal_guides
  (guide_key, category_id, guide_num, title, summary, is_overview, sort_order)
VALUES
  ('guide',     NULL,                                                            '00', '法務部 実務ガイド ご利用案内',                       'やりたいことから適切なガイドにたどり着くための「歩き方」。',          TRUE,  0),
  -- A. 取引を進める
  ('tetsuzuki', (SELECT id FROM portal_guide_categories WHERE cat_key='transactions'), '05', 'ライセンス契約・業務委託契約 取引社内手続きガイド', '決定→検索→文書作成・審査→締結→支払の5ステップ。まず全体像を掴むならここ。', FALSE, 1),
  ('vendor',    (SELECT id FROM portal_guide_categories WHERE cat_key='transactions'), '03', '新規取引先登録手続きガイド',                         '登録情報欄付き契約書で、契約確認と取引先登録を同時に完結。',          FALSE, 2),
  ('pub',       (SELECT id FROM portal_guide_categories WHERE cat_key='transactions'), '02', '出版事業部 契約・書類発行フローガイド',              '執筆依頼あり（業務委託＋利用許諾）／既成原稿のみ（利用許諾）でフローが分岐。', FALSE, 3),
  -- B. 契約を設計・理解する
  ('bg',        (SELECT id FROM portal_guide_categories WHERE cat_key='contracts'),    '01', 'BG事業部 契約スキーム実務ガイド',                    '「誰が製造を管理するか」から推奨スキーム（S1〜S7）・必要契約・落とし穴を表示。', FALSE, 1),
  ('clause',    (SELECT id FROM portal_guide_categories WHERE cat_key='contracts'),    '06', '契約書 条文解説ガイド',                              '業務委託・ライセンス基本契約書を逐条解説。甲乙の立場の違いに注意。',   FALSE, 2),
  ('knowledge', (SELECT id FROM portal_guide_categories WHERE cat_key='contracts'),    '09', '法務ナレッジブック',                                 '契約類型・著作権・構成要素・条項ライブラリ・チェックリストの実務基準。', FALSE, 3),
  -- C. 調べる・判定する
  ('search',    (SELECT id FROM portal_guide_categories WHERE cat_key='lookup'),       '07', '法務データ検索ガイド',                               '取引先・契約・文書・稟議・条件明細の検索（事業部向けの使い方）。',     FALSE, 1),
  -- D. 法律・コンプライアンス
  ('torihiki',  (SELECT id FROM portal_guide_categories WHERE cat_key='compliance'),   '04', '取引適正化・フリーランス法 実務ガイド（法解釈）',    'この取引が法律の対象か／その根拠を2段階で確認。',                     FALSE, 1),
  ('eventinst', (SELECT id FROM portal_guide_categories WHERE cat_key='compliance'),   '12', '試遊インストラクション 業務委託ガイド',              '偽装請負を避ける進め方・禁止事項・募集メール文例（運営部門向け）。',   FALSE, 2),
  ('privacy',   (SELECT id FROM portal_guide_categories WHERE cat_key='compliance'),   '10', '個人情報 運用ガイド（事業部向け）',                  'イベント・キャンペーン・会員・中古買取の取得〜廃棄〜漏えい対応。',     FALSE, 3)
ON CONFLICT (guide_key) DO UPDATE
  SET category_id=EXCLUDED.category_id, guide_num=EXCLUDED.guide_num,
      title=EXCLUDED.title, summary=EXCLUDED.summary,
      is_overview=EXCLUDED.is_overview, sort_order=EXCLUDED.sort_order, updated_at=now();
  -- 注: status / current_version_id / needs_runtime は意図的に更新しない
  --     (公開状態・現行版・運用フラグは sync スクリプトと管理画面が所有)。
