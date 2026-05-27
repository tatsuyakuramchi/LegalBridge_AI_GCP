
export interface TemplateVar {
  label: string;
  group: string;
  type?: 'date' | 'textarea' | 'number' | 'boolean' | 'select' | 'hidden';
  /** UI 表示しない (formData にだけ保持) */
  hidden?: boolean;
  /** 自動計算/補完結果。入力不可で🔒アイコン + グレー背景表示 */
  readonly?: boolean;
  formula?: string;
  options?: string[];

  /**
   * If true, the document cannot be generated until this field is
   * filled. Rendered with an asterisk in the form UI.
   */
  required?: boolean;

  /**
   * Canonical source of this value, e.g. "vendor.vendor_name",
   * "company.address", "staff.staff_name", "backlog.summary",
   * "auto.docNumber". Used by the Self/Partner/Staff buttons to know
   * which DB column populates this field, and surfaced in the UI as
   * a hint so users understand where data comes from. An empty value
   * means "free input — no DB autofill".
   */
  dbField?: string;

  /** Short placeholder shown inside empty inputs. */
  placeholder?: string;

  /**
   * One-line guidance shown beneath the field.
   *
   * Phase 23.0.4: 長文 helpText (条文番号や根拠などの詳細解説) は
   *   `{ brief, full }` 形式に分割可能。FormField は brief を summary 行に出し、
   *   full を <details> 展開で表示する。
   *   既存の `string` 形式は後方互換でそのまま 1 行表示。
   */
  helpText?: string | { brief: string; full?: string };
}

export interface TemplateMetadata {
  label: string;
  category: string;
  vars: Record<string, TemplateVar>;
}

export interface Vendor {
  vendor_code: string;
  vendor_name: string;
  trade_name?: string;
  address?: string;
  contact_name?: string;
  vendor_rep?: string;
  bank_name?: string;
  branch_name?: string;
  account_type?: string;
  account_number?: string;
  account_holder_kana?: string;
  entity_type?: string;
  invoice_registration_number?: string;
  email?: string;
}

export interface Staff {
  slack_user_id: string;
  staff_name: string;
  department?: string;
  email?: string;
}

export interface Issue {
  issueKey: string;
  summary: string;
  description: string;
}
