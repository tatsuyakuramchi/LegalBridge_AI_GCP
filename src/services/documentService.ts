import Handlebars from "handlebars";
import fs from "fs";
import path from "path";

export interface DocumentData {
  issueKey: string;
  documentNumber?: string;
  summary: string;
  requester: string;
  date: string;
  details: Record<string, any>;
}

export type DocumentType = 
  | "legal_request" 
  | "purchase_order" 
  | "contract"
  | "nda"
  | "planning_purchase_order"
  | "payment_notice"
  | "fee_statement"
  | "license_report"
  | "sales_master_buyer"
  | "sales_master_credit"
  | "sales_master_standard"
  | "service_master"
  | "service_terms"
  | "inspection_certificate"
  | "inspection_certificate_detailed"
  | "payment_notice_alt"
  | "royalty_statement"
  | "inspection_certificate_v2"
  | "intl_amendment"
  | "intl_master"
  | "individual_license_terms"
  | "license_master";

export class DocumentService {
  private templatesDir: string;

  constructor() {
    // Determine templates directory relative to project root
    this.templatesDir = path.join(process.cwd(), "templates");
    
    // Register common Handlebars helpers
    this.registerHelpers();
  }

  private registerHelpers() {
    // 1. Equality check
    Handlebars.registerHelper("eq", (a, b) => a === b);
    
    // 2. Inequality check
    Handlebars.registerHelper("ne", (a, b) => a !== b);
    
    // 3. Currency formatting (¥ 1,234,567)
    Handlebars.registerHelper("formatCurrency", (value) => {
      if (value === null || value === undefined) return "0";
      const num = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.-]+/g, ""));
      if (isNaN(num)) return "0";
      return new Intl.NumberFormat("ja-JP").format(Math.floor(num));
    });
    
    // 4. Date formatting (YYYY年MM月DD日)
    Handlebars.registerHelper("formatDate", (value) => {
      if (!value) return "";
      const date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    });

    // 5. Addition (used for indexing etc)
    Handlebars.registerHelper("add", (a, b) => {
      return Number(a) + Number(b);
    });
  }

  private loadTemplate(type: DocumentType): string {
    const filePath = path.join(this.templatesDir, `${type}.html`);
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
    } catch (error) {
      console.error(`Error loading template ${type}:`, error);
    }
    
    // Fallback or throw error
    throw new Error(`Template not found: ${type}`);
  }

  renderHtml(data: DocumentData, type: DocumentType = "legal_request"): string {
    const templateSource = this.loadTemplate(type);
    const template = Handlebars.compile(templateSource);
    
    // Merge details into the top level for easier template access
    const context = {
      ...data,
      ...data.details
    };
    
    return template(context);
  }

  async generateDocument(data: DocumentData, type: DocumentType = "legal_request"): Promise<{ html: string; fileName: string }> {
    const html = this.renderHtml(data, type);
    const prefix = type.toUpperCase();
    const fileName = data.documentNumber 
      ? `${data.documentNumber}.html`
      : `${prefix}_${data.issueKey}_${Date.now()}.html`;
    return { html, fileName };
  }

  getTemplateVariables(type: DocumentType): string[] {
    const templateSource = this.loadTemplate(type);
    const regex = /\{\{\{?([a-zA-Z0-9_.-]+)\}\}\}?/g;
    const variables = new Set<string>();
    let match;
    while ((match = regex.exec(templateSource)) !== null) {
      const varName = match[1];
      // Skip standard data fields that we usually provide
      if (!["issueKey", "summary", "requester", "date", "details"].includes(varName)) {
        variables.add(varName);
      }
    }
    return Array.from(variables);
  }
}
