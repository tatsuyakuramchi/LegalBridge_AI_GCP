# サブライセンス条件明細(OUT) → 請求明細 → 受領 連結 設計メモ

> 目的: 「サブライセンス条件明細から請求明細へつなげ、サブライセンス料／プロダクトアウト料を
> 受領したら情報を入れる」流れ(受領＝OUT側の収益管理)を、work_id 一本で連結する設計を整理する。
> 本メモは **設計合意用**。実装は合意後に着手。

作成: 2026-06-07

---

## 1. ユーザーの想定フロー

```
サブライセンス条件明細(OUT)
   ▼  (各期に展開)
請求明細（受領予定）
   ▼  (サブライセンス料 / プロダクトアウト料を受領したら入力)
受領記録（入金）
```

- 条件 = 料率／基準価格／プロダクトアウト等(OUT＝当社が受け取る)。
- 請求明細 = 各期の受領予定(請求権)。
- 受領記録 = 実際に受領した金額(入金台帳)＋必要なら利用許諾料計算書。

---

## 2. 現状の実体マップ（既にあるもの）

受領(OUT)側は **2 系統が並走** しており、まだ繋がっていない。

### (A) 既存「サブライセンス受領」モジュール（自己完結）
| 役割 | 実体 | 場所 |
|---|---|---|
| 条件 | `sublicense_deals`（料率/MG/前払(AG)/基準/周期/期間, work_id×sublicensee） | `0019` / `/api/sublicense/deals` |
| 受領報告(実績) | `sublicense_sales_reports`（period_date, reported_sales, reported_quantity） | `0020` / `/api/sublicense/reports` |
| 受領予定+実績 | 算出ビュー | `/api/sublicense/receipts` |
| 受領確定→入金 | `payments`（`direction=inbound`, `payment_kind=sublicense_income`） | `sublicenseService` 受領確定 |
| 計算書 | `royalty_statements`（`calc_type=sublicense`・「被許諾者受領額」ベース） | 利用許諾料計算書テンプレ |

### (B) 新「作品モデル」条件明細（2.18 で追加）
| 役割 | 実体 | 場所 |
|---|---|---|
| 条件 | `capability_financial_conditions.condition_kind='sublicense_out'`（work_id, source_work_id, 料率, 計算式…） | `0041` / `/api/v3/works/:id/conditions` |

→ **(B) はまだ請求・受領に繋がっていない**。(A) と概念が重複している。

### 関連: 方向(IN/OUT)概念が複数箇所にある（要整理）
- `capability_financial_conditions.condition_kind` = `license_in` / `sublicense_out`（**今回追加・金銭条件の方向**）
- `capability_line_items.flow_direction` = `in`(当社支払) / `out`(当社受領, `is_inbound`)（**伝票明細＝請求権の方向**）
- `payments.direction` = `inbound`(受領) / `outbound`(支払)
- `invoices.direction` = `issued`(発行＝入金側) / `received`(受領＝支払側)

「請求明細」は意味的に **`capability_line_items` の `flow_direction='out'`（請求権明細）** または `invoices(issued)` に対応する。

---

## 3. 目標モデル（条件明細(OUT)を SSOT に）

```
サブライセンス条件明細(OUT)                     ← capability_financial_conditions(condition_kind='sublicense_out')
  ├ 料率 / プロダクトアウト / MG / 前払(AG) / 周期 / 期間   (sublicense_deals の条件部分を吸収)
  ├ work_id(自社作品) / sublicensee(取引先) / source_work_id(原資の原作IP・任意)
  ▼  各期に展開
請求明細（受領予定）                             ← 受領予定スケジュール(請求権)。capability_line_items(flow_direction='out') 候補
  ├ period / 予定額 / 請求書発行(任意=invoices(issued))
  ▼  受領したら入力
受領記録                                         
  ├ 受領報告(実績売上/数量)                      ← sublicense_sales_reports 相当
  ├ payments(inbound, sublicense_income)         ← 入金台帳(受領額)
  └ royalty_statements(calc_type=sublicense)     ← 利用許諾料計算書(任意発行)
```

ポイント:
- **条件の SSOT を `capability_financial_conditions(sublicense_out)` に一本化**し、`sublicense_deals` をそこへ寄せる(段階移行)。
- 受領予定→受領実績→入金は **既存パイプ(sales_reports / payments inbound / royalty_statements)を再利用**。
- 「請求明細」を明示エンティティにするか(=invoices(issued) or 受領予定テーブル)は §6 で決定。

---

## 4. データ連結（案）

条件明細(OUT) を起点に以下の FK/参照で繋ぐ:

- `capability_financial_conditions`(OUT) に **受領先(sublicensee) と 周期/期間** を持たせる
  （`sublicense_deals` 相当の項目を additive 追加: `counterparty_vendor_id`/`cycle`/`term_start`/`term_end`/`mg_amount`/`advance_amount` は既存列で大半カバー、不足分のみ追加）。
- 受領報告 `sublicense_sales_reports` に **`condition_id`(→capability_financial_conditions)** を additive 追加（既存 `deal_id` と併存→移行）。
- `payments`(inbound) に既存の `financial_term_id` があるが、新条件は `capability_financial_conditions` なので
  **`capability_financial_condition_id`** で受領を条件に紐付け（royalty_calculations 同様の FK パターン）。
- `royalty_statements` は既存 `financial_term_id` に加え、必要なら `capability_financial_condition_id` 参照を追加。

> いずれも additive・冪等マイグレーションで、既存(A)を壊さず並走→移行できる。

---

## 5. プロダクトアウト料 / サブライセンス料 の区別

両方とも OUT(受領)。条件明細内で区別:
- `region_language_label` または `condition_no`（BDGプリセット: 1=自社製造, 2=サブライセンス, 3=プロダクトアウト）。
- 受領種別タグ(任意): `calc_method`/ラベルで「サブライセンス料」「プロダクトアウト料」を表示。
- 計算書・入金の `payment_kind` は両方 `sublicense_income` でよいか、`productout_income` を分けるかは §6。

---

## 6. 決めること（Open Questions）

1. **「請求明細」を明示エンティティにするか**
   - 案a: 受領予定を `invoices(direction=issued)` として発行管理（請求書発行まで含む）。
   - 案b: 軽量な「受領予定スケジュール」だけ持ち、入金で実績化（請求書は出さない）。
2. **`sublicense_deals`(A) の扱い**
   - 案a: 条件を `capability_financial_conditions(OUT)` に移行し deals は読み取り専用→廃止。
   - 案b: 当面 deals を残し、新条件明細(OUT)から deals を生成/同期(ブリッジ)。
3. **受領種別**: プロダクトアウト料を `payment_kind` で分けるか(`sublicense_income` 一本か)。
4. **計算根拠**: 受領は「報告売上×料率」(sales)か「製造数×単価」(manufacturing)か、条件の `calc_method`/`basis` で両対応するか。
5. **MG/AG(前払相殺)**: 既存 royalty_statements の MG/AG 消化ロジックを OUT 受領でも使うか。

---

## 7. 実装フェーズ案（合意後）

- **P1**: マイグレーション(additive) — 条件明細(OUT)に受領先/周期等、sales_reports/payments に condition_id 参照を追加。
- **P2**: 条件明細(OUT) → 受領予定(請求明細)展開 API + 一覧 UI（既存 receipts ロジック流用）。
- **P3**: 受領記録(報告→入金 payments inbound) を条件明細に紐付け。利用許諾料計算書(任意)発行。
- **P4**: `sublicense_deals`(A) からの移行(条件の寄せ替え)・重複解消。

> ※ 既存(A)モジュールは P1〜P3 の間も並走し、利用を止めない。P4 で一本化。
