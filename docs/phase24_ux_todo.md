# Phase 24 — UX 改修 残課題

Phase 23（contract_capabilities 統一）の後、Wave1/2/4 + 23.0.4 修正バンドル まで実施済み。
本ドキュメントは別 PC で続きを進めるための実装ガイド。

> 📌 Wave3 は本作業計画では番号スキップ済 (Wave2+4 と統合)。Wave3 を別途実施する予定はありません。

## 完了済み（参考）

| Wave | 内容 | コミット |
|---|---|---|
| 23.0 | order_items / license_contracts → contract_capabilities 統一 + マイグレ + v2 API + UnifiedContractPicker | `9cc528c` |
| 23.0.1 | 検収書PDF「成果物・業務内容」列の Backlog 本文混入修正 (対症療法版) | `a478901` |
| 23.0.2 | Excel 出力の空欄問題 + 検収情報セクション重複整理 | `889a403` |
| 23.0.3 | UnifiedContractPicker をフルモーダル化 | `a652452` |
| Wave1 | 採番ステータスバッジ・親契約フィードバック・必須/読取専用 視覚化 | `735326d` |
| Wave2+4 | テーブルレスポンシブ化・バルク取込サマリ・必須エラー自動スクロール | `04fe3f7` |
| **23.0.4** | **Phase A-F 修正バンドル (本セッションで実施)** | (このコミット) |

### 23.0.4 で対応した内容

**Phase A — データ安全性 (Critical)**

- `upsertContract` を `pool.connect()` + BEGIN/COMMIT/ROLLBACK でトランザクション化。子テーブルの「半分消えた」状態を防止 ([services/worker/src/routes/importsV2.ts](../services/worker/src/routes/importsV2.ts))
- `expense_name` / `fee_name` (NOT NULL) を事前バリデーション (`importsV2.ts`)
- `excelService.ts:244` の `inspected_amount_ex_tax || amount_ex_tax` を `??` に置換 (0 円検収が発注額に化けるバグ)
- `phase23_migrate --drop` を `--really-drop` 必須に変更。依存オブジェクト一覧を表示してから物理削除する 2 段階確認に ([scripts/phase23_migrate_to_capabilities.ts](../scripts/phase23_migrate_to_capabilities.ts))

**Phase B — 検収書整合性 (Critical)**

- 検収書PDFテンプレを `{{#each delivery_line_items}}` ループ化。複数明細に正しく対応 (両 [templates/](../templates/inspection_certificate.html) と [services/worker/templates/](../services/worker/templates/inspection_certificate.html) 同期)
- `extractCustomFields` に `__backlog_description` キーを追加し、Backlog 本文の流出経路を明示化 ([backlogService.ts:179](../services/api/src/services/backlogService.ts))
- form-context `/api/documents/form-context` の `order_lines_for_inspection` に `delivery_date` / `payment_date` を追加 ([server.ts:1374](../services/api/server.ts))
- 既存 `documents.form_data.description` の修復スクリプト追加 ([scripts/fix_inspection_description_from_backlog.ts](../scripts/fix_inspection_description_from_backlog.ts)) — 本番では `--apply` で実行

**Phase C — セキュリティ (Major)**

- `/api/contracts/search` と `/:id` に `requirePortalSecret` ミドルウェア適用 ([contractsV2.ts](../services/api/src/routes/contractsV2.ts))

**Phase D — race condition / UX (Major)**

- UnifiedContractPicker の検索 / loadDetail / loadByDocNumber に `AbortController`。古いレスポンスが新しい state を上書きする race を解消 ([UnifiedContractPicker.tsx](../src/components/document/UnifiedContractPicker.tsx))
- royalty_statement の `selectedContract` を `pickedDetail` ベースで fallback。allContracts に未掲載の契約 (新規 import 直後 等) でも反映される ([DocumentForm.tsx](../src/components/document/DocumentForm.tsx))
- auto-scroll: 祖先 `<details>` を自動展開 / `prefers-reduced-motion` 尊重 / `[readonly]`/`[disabled]` 除外 / setTimeout の競合解消 ([DocumentEditorPage.tsx](../src/pages/DocumentEditorPage.tsx))
- BulkImportDialog の空 CSV (`totalGroups === 0`) 専用表示 + `successPct` を `[0, 100]` に clamp ([BulkImportDialog.tsx](../src/components/document/BulkImportDialog.tsx))

**Phase E — todo.md 残課題**

- E-L: FormField に `aria-required` / `aria-invalid` / `aria-readonly` / `aria-describedby` を付与。select の readonly 表現を input と統一 ([FormField.tsx](../src/components/document/FormField.tsx))。toast error を `role="alert"` / `aria-live="assertive"` に分離 ([toast.tsx](../components/ui/toast.tsx))
- E-M: `EmptyState` 共通コンポーネント追加 ([src/components/EmptyState.tsx](../src/components/EmptyState.tsx))
- E-E2: LineItemTable をカード型レスポンシブ (`lg:hidden` / `hidden lg:block`) に。EmptyState を採用 ([LineItemTable.tsx](../src/components/document/LineItemTable.tsx))
- E-N: UnifiedContractPicker のテーブル行に `role="button"` + Enter/Space 対応
- E-K: `text-[8px]` / `text-[9px]` を `text-[10px]` / `text-[11px]` に一括置換 (約 136 箇所 / 25 ファイル)
- E-G+H: `TemplateVar.helpText` を `string | { brief, full }` に拡張。FormField で details/summary 展開対応 (基盤のみ。テンプレ設定の実分割は次フェーズ)

## 残課題一覧

| # | 優先度 | キー | 課題 | 想定工数 |
|---|---|---|---|---|
| 1 | 🟡 | G | templates_config.json の見出し正規化 (I. 基本情報 / II. 当事者 / ...) | 1 日 |
| 2 | 🟡 | H | 100 字超の helpText を `{brief, full}` に実分割 (型基盤は 23.0.4 で導入済) | 4〜6 時間 |
| 3 | 🟢 | L+ | icon-only ボタンに aria-label 追加 (Sidebar / Topbar 等の残存箇所) | 2〜3 時間 |
| 4 | 🟢 | KK | LineItemTable のテーブル `<tbody>` 側を `rows` / `statusBadge` ベースに統一 (Wave2+4 でカード側だけ共通化されたが、テーブル側は古い行内計算が残存) | 1〜2 時間 |
| 5 | 🟢 | DD | UnifiedContractPicker の `currentContractId` がリスト圏外のとき、ヘッダに pin 表示 | 1〜2 時間 |

---

## 1. G + H: テンプレ設定ファイルの正規化

### 問題
`templates_config.json` の全約 200 フィールドで以下が混在：
- セクション見出しが `"I. ヘッダ"` / `"ステップ 1"` / `"_DYNAMIC"` など複数フォーマット
- `helpText` が 100 文字超の長文と空が混在し、UI 表示で切れる

### 該当ファイル
- `templates_config.json` (約 1300 行)
- `src/components/document/FormField.tsx`（helpText の表示 L220-224）
- `src/components/document/types.ts`（`TemplateVar` 型）

### 実装方針

**Step 1: 見出し統一**
ドメイン分類 × ローマ数字で統一：

```json
// Before
"group": "ステップ 1" / "I. ヘッダ" / "_DYNAMIC"

// After
"group": "I. 基本情報" / "II. 当事者" / "III. 期間・条件" / ...
```

参考マッピング：

| 旧パターン | 新ドメイン名 |
|---|---|
| ヘッダ / 基本情報 / 検収情報 | `I. 基本情報` |
| 当事者 / 受託者 / 自社 / 発注先 | `II. 当事者` |
| 期間 / 契約期間 / 効力 | `III. 期間・条件` |
| 金銭 / 単価 / 料率 / MG / AG | `IV. 金銭条件` |
| 明細 / 業務 / 製造 | `V. 明細・業務内容` |
| 振込先 / 銀行 | `VI. 振込先` |
| 特約 / 備考 / 任意 | `VII. その他・備考 (任意)` |

**Step 2: helpText 分割**

型定義を拡張：
```ts
// src/components/document/types.ts
export interface TemplateVar {
  // ...
  helpText?: string | { brief: string; full?: string };
}
```

FormField で対応：
```tsx
// FormField.tsx L220 付近
{meta.helpText && (
  typeof meta.helpText === 'string' ? (
    <p className="text-[10px] text-muted-foreground mt-0.5">{meta.helpText}</p>
  ) : (
    <details className="text-[10px] text-muted-foreground mt-0.5">
      <summary className="cursor-pointer">{meta.helpText.brief}</summary>
      {meta.helpText.full && <p className="mt-1 pl-3 border-l border-muted">{meta.helpText.full}</p>}
    </details>
  )
)}
```

100 文字を超える既存 helpText を grep で抽出し、brief（30〜50 字）/ full に分割：
```bash
# Cloud Shell で抽出
grep -oE '"helpText": "[^"]{100,}"' templates_config.json | head -20
```

### テスト
- DocumentForm を開き、各テンプレで見出しが新フォーマットになっていること
- helpText が長い項目は `▶ ブリーフ` 表示で展開できること

---

## 2. E2: LineItemTable のレスポンシブ化

### 問題
発注書フォームの明細表 `LineItemTable.tsx` も DeliveryLineItemTable と同じ過密問題がある。
Wave2 で DeliveryLineItemTable は対応済みだが LineItemTable は未対応。

### 該当ファイル
- `src/components/document/LineItemTable.tsx`

### 実装方針
`DeliveryLineItemTable.tsx` のカード型レスポンシブ実装をテンプレとしてコピー。

差分ポイント：
- 列構成: `品目名 / 仕様 / 数量 / 単価 / 金額 / 納期 / 支払日`
- カード型では `品目名` を見出しに、その他はグリッドで縦並び
- 合計行（grandTotal）も同様にカード下にフッタブロック

参考実装：[DeliveryLineItemTable.tsx](../src/components/document/DeliveryLineItemTable.tsx) の L138-300 を参照。

```tsx
// ファイル末尾の return を以下のパターンに置き換える:
return (
  <div className="col-span-full">
    {/* カード型 (lg:hidden) */}
    <div className="space-y-3 lg:hidden">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-border bg-card p-3 shadow-sm">
          <div className="font-bold text-sm">{item.item_name}</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono mt-2">
            {/* 数量、単価、金額、納期、支払日 を縦並び */}
          </div>
        </div>
      ))}
    </div>
    {/* テーブル型 (hidden lg:block) */}
    <div className="hidden lg:block overflow-x-auto">
      <table>...</table>
    </div>
  </div>
);
```

---

## 3. K: 極小フォントの一掃

### 問題
`text-[8px]` / `text-[9px]` が約 60 箇所で使用されている。WCAG AA は最小 14px 推奨で、老眼ユーザー・モバイル閲覧では読めない。

### 該当ファイル
grep で抽出：
```bash
grep -rn 'text-\[8px\]\|text-\[9px\]' src/ --include='*.tsx' | wc -l
# 60+ 箇所
```

主な使用ファイル：
- `src/pages/DocumentEditorPage.tsx` (L774, 791, 823, 976, 982, 1011, 1027, 1146, 1276, 1322 など)
- `src/components/document/DocumentForm.tsx`
- `src/components/document/FormField.tsx`

### 実装方針

サイズ階層を定義し直す：

| 旧 | 新 | 用途 |
|---|---|---|
| `text-[8px]` | `text-[10px]` または `text-xs` | バッジ・チップ |
| `text-[9px]` | `text-[11px]` または `text-xs` | キャプション |
| `text-[10px]` | `text-xs` (12px) | 補助ラベル |
| `text-[11px]` | `text-xs` (12px) | 標準ラベル |
| `text-xs` | `text-sm` (14px) | 本文 |

一括置換コマンド（要確認）：
```bash
# DRY-RUN
grep -rln 'text-\[8px\]' src/ --include='*.tsx'
# 置換 (PowerShell)
Get-ChildItem -Recurse -Filter *.tsx src/ |
  ForEach-Object { (Get-Content $_.FullName) -replace 'text-\[8px\]', 'text-[10px]' | Set-Content $_.FullName }
```

⚠️ 一括置換後は必ず目視でレイアウト崩れチェック（特にタグ/バッジ系）。

---

## 4. L: アクセシビリティ整備

### 問題
- `aria-label` がほぼないボタン（icon-only ボタン多数）
- `aria-describedby` で helpText を input に紐付けていない
- スクリーンリーダーで「これは何のボタン？」が分からない

### 該当ファイル
- 全 `src/components/`、`src/pages/` の icon-only `<button>` / `<Button>`
- `src/components/document/FormField.tsx`（input への aria-describedby 追加）

### 実装方針

**Step 1: icon-only ボタンに aria-label**
```bash
grep -rn '<Button[^>]*size="icon' src/ --include='*.tsx'
```
各箇所に意味を表す aria-label を追加：
```tsx
<Button size="icon-sm" aria-label="Reset form">
  <RotateCcw />
</Button>
```

**Step 2: input に aria-describedby**
FormField.tsx で helpText を `id` 付き要素に：
```tsx
<input
  id={id}
  aria-describedby={meta.helpText ? `help-${id}` : undefined}
  aria-required={isRequired || undefined}
  aria-invalid={!!error || undefined}
  // ...
/>
{meta.helpText && (
  <p id={`help-${id}`} className="...">{meta.helpText}</p>
)}
```

**Step 3: フォーカス可視化**
全フォーム要素に `focus-visible:ring-2 focus-visible:ring-ring/40` を強制。

---

## 5. M: 空状態 (empty state) 統一

### 問題
- 「明細なし」のメッセージスタイルがファイルごとに異なる
- アイコン無し / グレー横線だけ / 一部はカード化 など

### 該当ファイル
- `src/components/document/LineItemTable.tsx` (明細なし)
- `src/components/document/DeliveryLineItemTable.tsx` L129 (親PO なし) ✓ 統一済
- `src/pages/DocumentEditorPage.tsx` L1339 (preview なし) ✓ 良いデザイン
- `src/pages/ImportPage.tsx` 各タブの「取込履歴なし」
- `src/components/document/UnifiedContractPicker.tsx` L255 (該当契約なし) ✓ 統一済

### 実装方針

共通コンポーネント `<EmptyState>` を作る：
```tsx
// src/components/EmptyState.tsx
import { PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<Props> = ({
  icon = <PackageOpen size={32} />,
  title,
  description,
  action,
  className,
}) => (
  <div className={cn(
    "flex flex-col items-center justify-center p-8 text-center text-slate-400 gap-2 rounded-md border border-dashed border-input bg-muted/20",
    className
  )}>
    {icon}
    <p className="text-sm font-medium text-slate-600">{title}</p>
    {description && <p className="text-xs">{description}</p>}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
```

各テーブル/リストの「データなし」描画を `<EmptyState>` に置換。

---

## 6. N: キーボード操作

### 問題
- Dialog 内の Tab 順が予測不可能（特にフッタとボディが入れ替わる）
- 複数階層の Dialog を Esc で閉じると最上層しか反応しない
- form 内 input → Enter で submit してしまうケースあり（意図しない生成）

### 該当ファイル
- `src/components/document/UnifiedContractPicker.tsx`
- `src/pages/DocumentEditorPage.tsx`（form 全体）

### 実装方針

**Step 1: フォーム全体の Enter submit 抑止**
```tsx
<form onKeyDown={(e) => {
  if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
    // textarea 以外で Enter は submit しない (誤動作防止)
    if ((e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  }
}}>
```

**Step 2: Dialog の initialFocus 制御**
base-ui の `<Dialog>` には `initialFocus` prop あり。検索 input を最初にフォーカスする。

**Step 3: Tab 順を視覚順に揃える**
`tabIndex` を意図的にセット。デフォルトの自然順序が崩れている場合のみ。

---

## 進め方の推奨

1. **まず 2 (E2: LineItemTable)** から着手（最も効果が早く分かる）
2. 次に **3 (K: フォント一括置換)** で見やすさを底上げ
3. **5 (M: empty state)** で UI 統一感を上げる
4. **1 (G+H: テンプレ正規化)** は手間が大きいので集中時間を確保
5. **4 (L: アクセシビリティ)** と **6 (N: キーボード)** は最後の磨き込み

## 検証方法

各タスク完了後、以下を確認：

- [ ] `npx tsc --noEmit` で型エラーなし
- [ ] admin-ui のローカル起動 (`npm run dev`) で UI 確認
- [ ] 検収書・利用許諾料計算書・発注書 の 3 フォームで動作確認
- [ ] 画面幅 768px / 1024px / 1440px で表示確認
- [ ] Chrome DevTools Lighthouse でアクセシビリティスコア計測

---

## 関連リソース

- `TEST_RESULTS.md` — Phase 23 のテスト計画
- `services/worker/src/lib/db.ts` — DB スキーマ
- `services/api/src/routes/contractsV2.ts` — 統一検索 API
- `services/worker/src/routes/importsV2.ts` — 統一インポート API
- `src/components/document/UnifiedContractPicker.tsx` — 親契約 picker
- `src/components/document/FormField.tsx` — 全フィールド共通レンダラ
- `templates_config.json` — テンプレ定義

## 引き継ぎメモ

- Cloud Build は `main` push で admin-ui のみ、`release/worker` push で worker、`release/api` push で search-api がデプロイされます
- フロントエンドのみの変更なら `git push origin main` だけで完結
- worker/api を触ったら `git push origin main:release/worker`, `git push origin main:release/api` を追加実行
- 旧 `order_items` / `license_contracts` テーブルは **データ移行済みだが物理削除は未実施**。Phase 23.1 で `scripts/phase23_migrate_to_capabilities.ts --apply --drop` 実行予定
