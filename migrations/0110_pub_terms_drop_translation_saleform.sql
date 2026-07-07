-- 0110_pub_terms_drop_translation_saleform.sql
-- 出版利用許諾条件書(pub_license_terms)の見直し(Master登録=紙①③/電子②・地域言語制御と整合):
--   - 許諾内容から「翻訳版・海外版出版」行を削除(翻訳=二次的著作物として対象外・別途 / 海外=許諾地域で制御)
--   - 出版条件から「販売形態」行を削除(制限は特約で制御)
--   - 対価・支払条件から「翻訳版・海外版」行を削除
--   - 「商品化・映像化・ゲーム化等」を「二次利用（翻訳・商品化・映像化・ゲーム化等）」に改め、翻訳を明記
--
-- worker は TEMPLATE_SOURCE=db 時に DB(document_template_versions.html_source)を使うため、
-- disk 修正に加え DB 側も更新する。対象文字列のみ置換(冪等・テーブル非存在時 no-op)。
-- ※ 反映には worker 再起動が必要(loadFromDb は起動時キャッシュ)。フォーム項目
--   (翻訳海外版*/販売形態 の除去)は disk templates_config を worker 再デプロイで配信。

DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'document_template_versions'
  ) THEN
    RETURN;
  END IF;

  -- 1) 許諾内容: 翻訳版・海外版出版 行を削除
  UPDATE document_template_versions SET html_source = REPLACE(html_source,
$b$      <tr>
        <td class="col-item">翻訳版・海外版出版</td>
        <td class="col-value">{{翻訳海外版許諾有無}}{{#if (eq 翻訳海外版許諾有無 "許諾する")}}（対象地域・言語：{{翻訳海外版対象地域言語}}）{{/if}}</td>
      </tr>
$b$, '')
  WHERE html_source LIKE '%翻訳版・海外版出版%{{翻訳海外版許諾有無}}%';

  -- 2) 出版条件: 販売形態 行を削除
  UPDATE document_template_versions SET html_source = REPLACE(html_source,
$b$      <tr>
        <td class="col-item">販売形態</td>
        <td class="col-value">{{#if 販売形態}}{{販売形態}}{{else}}紙書籍：小売店販売／EC販売／イベント販売／その他{{#if (eq 電子書籍配信許諾有無 "許諾する")}}<br>電子書籍：主要電子書籍ストアにて配信／自社EC配信／その他{{/if}}{{/if}}</td>
      </tr>
$b$, '')
  WHERE html_source LIKE '%<td class="col-item">販売形態</td>%';

  -- 3) 対価・支払条件: 翻訳版・海外版 行(条件付き)を削除
  UPDATE document_template_versions SET html_source = REPLACE(html_source,
$b$      {{#if (eq 翻訳海外版許諾有無 "許諾する")}}
      <tr>
        <td class="col-item">翻訳版・海外版出版</td>
        <td class="formula-cell">{{#if 翻訳海外版計算式}}{{翻訳海外版計算式}}{{else}}被許諾者受取ライセンス収益 × 料率{{/if}}{{#if 翻訳海外版料率}}（料率 {{翻訳海外版料率}}％）{{/if}}</td>
      </tr>
      {{/if}}
$b$, '')
  WHERE html_source LIKE '%翻訳海外版計算式%formula-cell%' OR html_source LIKE '%{{#if (eq 翻訳海外版許諾有無 "許諾する")}}%';

  -- 4) 二次利用の見出し・本文に翻訳(二次的著作物)を明記
  UPDATE document_template_versions SET html_source = REPLACE(html_source,
$b$          商品化・映像化・ゲーム化等
          <span class="sub-note">通常の条件書では対象外</span>$b$,
$b$          二次利用（翻訳・商品化・映像化・ゲーム化等）
          <span class="sub-note">通常の条件書では対象外（二次的著作物）</span>$b$)
  WHERE html_source LIKE '%商品化・映像化・ゲーム化等%';

  UPDATE document_template_versions SET html_source = REPLACE(html_source,
    '本条件書により当然に許諾されるものではない。商品化、映像化、デジタルゲーム化、',
    '本条件書により当然に許諾されるものではない。翻訳（二次的著作物の作成）、商品化、映像化、デジタルゲーム化、')
  WHERE html_source LIKE '%本条件書により当然に許諾されるものではない。商品化、映像化、%';
END $mig$;
