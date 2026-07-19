# DQ 初期データ是正 記録（2026-07-18）

DQ 基盤（migration 0136 ＋評価エンジン ＋Data Quality Center）を実機投入した直後の
初回スキャンで検出された不足 Issue に対する、初期データ是正の記録。実 DB（Cloud SQL）に対して
Cloud Shell / psql から実施。破壊的操作は全てバックアップ表＋トランザクションで実施。

## 結果サマリー

| 指標 | 開始 | 完了時 |
|---|---|---|
| BLOCKER | 88 | 34（全て COND-FIN-001＝実データ入力待ち） |
| WORK-ID-001 | 31 | **0** |
| WORK-REL-001 | 24 | **0** |
| ERROR 合計 | ~52 | 23（MAT-RGT-002 18 ＋ WORK-MAT-001 5） |

構造的な残骸・誤フラグ・重複は解消。残りは Arclight 側の実データ入力／方針判断で、
**DQ Center の担当・期限・修正導線を用いた通常運用へ引き渡し**。

## 実施内容

1. **孤児条件（work未リンク）の仕分け**（COND-FIN-001 起点）
   - 24件を精査 → 23件が真に未リンク（work_id/source_work_id/source_material_id 全NULL）。
   - うち **15件は capability_id が documents に紐づかない dangling（取込み残骸）**・下流参照0 →
     バックアップ後に削除（`_cleanup_orphan_cl_20260718`）。
   - 残8件（シノビガミ等シリーズ・MONSTER MAKER）は実在＝リンク＋財務補完の運用対象。

2. **LIC-LO 合成work（#1000000014）＋海外許諾8条件**
   - 海外ライセンシー（Asmodee 等）を暫定登録した残骸（capability dangling・下流参照0）。
   - 8条件＋空になった合成work を削除（`_cleanup_liclo_cl_/work_20260718`）。アウト側テーブルへは後日手動投入。

3. **WORK-ID-001（作品の種別欠落 31件）**
   - テストデータ2作品（＋テスト素材5件）を削除（`_cleanup_test_works_/mats_20260718`）。
   - 実作品28件に `work_type`（board_game / trpg_book）を一括付与（分類は業務確認済み）。

4. **WORK-REL-001（派生フラグ誤り 24件）**
   - Arclight 自社オリジナル20作品を `is_original=true` に一括修正（誤って false になっていた）。
   - 残りは重複作品（下記5で解消）。

5. **重複作品の統合（5グループ・12→5作品）**
   - ito {30←31,15} / モンスターメーカー {28←29} / ラブレター {23←22} /
     シンデレラが多すぎる {39←38} / 東京ラヴクラフト {35←33,34}。
   - アプリの統合ツール（`/api/v3/merge/execute`）と同等の**「works への全FK列を pg_constraint から
     動的検出して survivor へ付替え → loser削除」**を SQL で atomic 実施。
   - `material_categories`（UNIQUE(work_id,genre)）は同genre統合・残り移動で衝突回避。
   - loser 作品行は `_cleanup_dupwork_20260718` にバックアップ。

## バックアップ表（不要になれば drop 可）

- `_cleanup_orphan_cl_20260718` — 孤児条件15件
- `_cleanup_liclo_cl_20260718` / `_cleanup_liclo_work_20260718` — LIC-LO 8条件＋合成work
- `_cleanup_test_works_20260718` / `_cleanup_test_mats_20260718` — テスト2作品＋5素材
- `_cleanup_dupwork_20260718` — 重複7作品

## 残り（DQ Center 運用へ引き渡し）

| rule | n | 内容 | 運用 |
|---|---|---|---|
| COND-FIN-001 | 34 | royalty条件の料率/計算基礎/通貨 欠落 | 契約から入力（「修正」導線 → 条件詳細） |
| WORK-MAT-001 | 5 | 制作/公開作品に素材0件 | 素材登録（ito クラシック/レインボー・タイムボム・花嫁が多すぎる 等） |
| MAT-RGT-002 | 18 | 外部権利素材の権利者欠落 | 方針判断（自社owned 一括 or 作家ライセンス＋権利者登録）後に処理 |

## 補足（再発防止の候補・未実施）

- 15件の孤児＋LIC-LO は「取込みで work_id＋財務項目＋文書参照が同時に落ちる」パターン。
  取込みパイプラインの欠陥追跡は別途。
- 作品の重複登録が5グループ発生 → 登録時の重複ガード強化（マスタ重複対策 T1/T2 の作品への拡張）も候補。
