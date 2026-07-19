# FRM-02: 共通フォーム基盤 AppFormShell

全UIリニューアル（EPIC-UIC-01）の土台。マスタ/業務フォームがページ独自の `Field()`・
保存ボタン・生 input を新設せず（設計 §11.3 禁止事項）、共通の primitive を使うための基盤。
状態色は UIC-24 のトークン（success/warning/info/destructive/severity-*）に統一。

## 提供コンポーネント（第1弾）

`src/components/form/`（`@/src/components/form` から import）:

| コンポーネント | 責務（設計 §11.2） |
|---|---|
| `AppFormShell` | 最大幅・本体＋右パネル（aside）・レスポンシブ・**readonly は fieldset[disabled]**（true readonly, UIC-06 と同方針）・onSubmit・アクションバー配置 |
| `AppFormField` | ラベル / 必須・推奨・任意 / 状態Badge（導出・引用・確認済・要確認）/ 説明 / [コントロール] 単位 / エラー・警告・hint を §11.4 の順序で表示 |
| `ValidationSummary` | エラー・警告の集約。項目クリックで `fieldId` へフォーカス移動（toast だけに頼らない §11.3） |
| `StickyActionBar` | 保存状態 / 主操作 / 二重送信防止（saving 中は無効化）/ 破壊操作の隔離 |

**DataQualityPanel** は既存の `@/src/components/dataquality/CompletenessPanel` を `aside` に流用する。
**FormSection** は既存の `@/src/components/document/FormSection` を使う。

## 使い方（マスタ/業務フォームの標準形）

```tsx
import { AppFormShell, AppFormField, ValidationSummary, StickyActionBar } from "@/src/components/form";
import { Input } from "@/components/ui/input";
import { CompletenessPanel } from "@/src/components/dataquality/CompletenessPanel";

function VendorForm({ mode }: { mode: "create" | "edit" | "readonly" }) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const issues = validate(v); // ValidationIssue[]

  return (
    <AppFormShell
      mode={mode}
      aside={<CompletenessPanel entityType="vendor" entityId={v.id} />}
      onSubmit={save}
      actionBar={
        <StickyActionBar
          dirty={dirty}
          saving={saving}
          primary={{ label: "保存", onClick: save, disabled: issues.some(i => i.level === "error") }}
          danger={mode === "edit" ? { label: "削除", onClick: remove } : undefined}
        />
      }
    >
      <ValidationSummary issues={issues} />
      <AppFormField label="取引先名" htmlFor="vendor_name" required error={errof("vendor_name")}>
        <Input id="vendor_name" value={v.name} onChange={e => setV({ ...v, name: e.target.value })} />
      </AppFormField>
    </AppFormShell>
  );
}
```

## 設計上の担保

- **true readonly**: `mode="readonly"` は `<fieldset disabled>` で入力不可（テキスト選択・コピーは可）。
- **二重送信防止**: `StickyActionBar` は `saving` 中に主操作・副操作を無効化。
- **状態を画面に残す**: `ValidationSummary` を常設し、toast だけの通知を避ける。
- **aria**: `AppFormField` は label/htmlFor・description(`-desc`)・error(`-err`, role=alert) を紐付け。

## 次（FRM-06〜11）

実フォームを段階移行して API を実地検証・洗練する:
- FRM-06: Works / Material / Work Family / Rights Source
  - **Material 済**: `MaterialEntryPanel` の page-local `Field()`（col=データキー chip / auto=自動採番 /
    req / help）を `AppFormField` アダプタへ。`AppFormField` に `code`（データキー chip）prop を追加。
    auto → `state="derived"`。
  - ※ Works / Work Family / Rights Source は `WorkGraphPanel`（3カードエディタ）に**インラインで直書き**
    （`Field()` seam 無し）。フィールド単位の移行が必要なため後続スライスで対応。
- FRM-07: Vendor / Staff / Ringi / Routing（**完了**）
  - `StaffPanel`: page-local `Field()` を `AppFormField` へ、必須氏名を `ValidationSummary` へ。
  - `RingiPanel` / `VendorsPanel`: page-local `Field()` を `AppFormField` への薄いアダプタ化
    （末尾 " *" → `required`）。全 `<Field>` サイトが共通 primitive 経由の描画に。
  - ※ Vendor の住所/口座の **compact 反復サブフォーム**（直書き `<Label>`）は FRM-11 で対応。
  - ※ Routing 専用フォーム UI は無し（`apiRoutingRules` は設定ファイル）。
- FRM-08: Matter / Task / Delivery / Inspection（業務処理フォーム型）
  - **Matter 編集フォーム 済**: `MatterDetailPage` の案件編集（案件名/相手方/Backlog/担当/期限/
    ブロッカー/備考 の 7 フィールド）を、インライン `<Label>` 直書きから `AppFormField` へ。
    「選択中: …」は `hint` へ。各 input に id＋aria。
  - **Inspection 済**: `PendingInspectionsPage` の一括検収フォーム（検収日/検収者必須）を
    `AppFormField` へ。検収者必須は `error`、案内 notice を warning トークンへ。
  - ※ タスク追加は compact 横並びインライン＝FRM-11 で対応。Delivery/Inspection の**明細行編集**
    （`DeliverableCards`/`DeliveryLineItemTable`/`InspectionExpenseSelector`）は LineEditor パターンで
    FRM-02 の `LineEditor` 導入後に対応。統合カート/メール送信ダイアログは FRM-11。
- FRM-09: 利用許諾計算・受領・支払・分配（Finance）
- FRM-10: Import / Merge / Unlinked / Migration / Draft（管理者フォーム型）
- FRM-11: Dialog / Drawer / インライン追加（compact 版）

移行時に必要になり次第、`FormHeader` / `ContextSummary` / `EntityCombobox` / `LineEditor` /
`RelatedDataPanel` / `DangerZone` を本基盤へ追加する。
