
export interface TemplateVar {
  label: string;
  group: string;
  type?: 'date' | 'textarea' | 'number' | 'boolean' | 'select';
  formula?: string;
  options?: string[];
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
