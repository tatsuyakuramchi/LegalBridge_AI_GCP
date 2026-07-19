# UI Design Tokens（UIC-24）

`src/index.css` の `@theme inline` ＋ `:root` / `.dark`（＋ skin）で定義する意味論的トークン。
コンポーネントは **生の Tailwind パレット（`text-rose-700` / `bg-amber-50` 等）を直書きせず**、
下記トークンを使うことで light / dark / skin をまたいで一貫した見た目にする。

## 状態色（status）

| 用途 | トークン | 使い方（例） |
|---|---|---|
| 成功 / 正常 | `--success` / `--success-foreground` | `text-success` / `bg-success` |
| 注意 / 警告 | `--warning` / `--warning-foreground` | `text-warning` / `bg-warning` |
| 情報 | `--info` / `--info-foreground` | `text-info` / `bg-info` |
| 危険 / 破壊的 | `--destructive`（既存） | `text-destructive` / `bg-destructive` |

## Data Quality 重大度（severity）

| 重大度 | トークン | 意味 |
|---|---|---|
| BLOCKER | `--severity-blocker` | 公開・利用開始・計算開始を止める |
| ERROR | `--severity-error` | 是正すべき欠落 |
| WARNING | `--severity-warning` | 望ましくないが停止はしない |

バッジ等での使用例（`hsl(var(--...))` 形式で alpha も可。既存の `bg-[hsl(var(--card))]` と同流儀）:

```tsx
// 例: DataQualityCenter / CompletenessPanel の SEV_CLS
BLOCKER: "border-[hsl(var(--severity-blocker)_/_0.45)] text-[hsl(var(--severity-blocker))] bg-[hsl(var(--severity-blocker)_/_0.1)]",
```

## 既存の基盤トークン（参考）

- 面: `--background` / `--card` / `--popover` / `--muted` / `--accent`
- 文字: `--foreground` / `--muted-foreground` / `--card-foreground`
- 骨格: `--border` / `--input` / `--ring` / `--radius`（`rounded-sm/md/lg`）
- レトロ: `--phosphor` / `--amber` / `--cyan` / `--grid`
- フォント: `--font-sans`（Geist）/ `--font-mono` / `--font-heading`
- skin: `.dark`（CRT）/ `[data-skin="eva"]`（NERV）/ `[data-skin="macos"]`（Big Sur）が上書き。
  新トークンは `:root` / `.dark` に定義済みで、skin が個別上書きしなければ `:root` 値を継承する。

## 移行方針（FRM-06〜11 と並行）

- 新規・改修コンポーネントは status/severity を**必ずトークン経由**にする。
- 既存の `rose/amber/yellow/emerald/slate` 直書きは、触るタイミングでトークンへ置換（一括置換は非破壊確認が必要なため段階的に）。
- 済: `DataQualityCenter` / `CompletenessPanel` の `SEV_CLS`。
