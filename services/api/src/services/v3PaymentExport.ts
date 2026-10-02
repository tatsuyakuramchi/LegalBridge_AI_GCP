/**
 * v3PaymentExport — V3（legalbridge-v3）で出した検収書・利用許諾料計算書の支払を、
 * 「支払Excel発行」（/payments/excel-export）に並べ、ZIP で落とす。
 *
 * V3 の文書と支払は v3 スキーマにあり、この画面がこれまで読んでいた V1 の
 * documents には無い。V3 の経理提出と同じ中身（件名・支払内容・源泉・PDF）を
 * 二重に組まないよう、V3 の内部の口から受け取る:
 *   GET  {V3}/internal/exports/accounting          … 一覧
 *   GET  {V3}/internal/exports/accounting/bundle   … 選んだ支払の ZIP（xlsx + PDF）
 *   POST {V3}/internal/documents/:id/account-owner … 社内の担当者を付ける
 *
 * 設定（どちらも無ければ V3 の分は出さない＝これまでどおり）:
 *   V3_INTERNAL_URL   … V3 の Cloud Run の URL（https://legalbridge-v3-xxxx.a.run.app）
 *   V3_WEBHOOK_TOKEN  … V3 の WEBHOOK_TOKEN と同じ値（Secret legalbridge-v3-webhook-token）
 * V3 は --no-allow-unauthenticated なので、Google の ID トークン（audience＝V3 の URL）も付ける。
 * このサービスのサービスアカウントに V3 の roles/run.invoker が要る。
 */
import { GoogleAuth } from "google-auth-library";

export type V3PaymentRow = {
  paymentId: number;
  paymentNo: string | null;
  documentId: number | null;
  documentNo: string | null;
  category: "検収書" | "利用許諾料計算書";
  entity: "個人" | "法人";
  title: string;
  vendorName: string;
  paymentDate: string;
  currency: string;
  subtotal: number;
  consumptionTax: number;
  withholdingTax: number;
  netTransfer: number;
  owner: string | null;
  ownerEmail: string | null;
  contents: string[];
  flags: string[];
};

export function v3Base(): string {
  return String(process.env.V3_INTERNAL_URL || "").trim().replace(/\/+$/, "");
}

export function v3Enabled(): boolean {
  return Boolean(v3Base() && String(process.env.V3_WEBHOOK_TOKEN || "").trim());
}

let auth: GoogleAuth | null = null;
/** ID トークン。Cloud Run の外（ローカル）で取れないときは付けない（V3 側がローカルなら通る）。 */
async function idTokenHeaders(audience: string): Promise<Record<string, string>> {
  if (process.env.V3_SKIP_ID_TOKEN === "1") return {};
  try {
    auth ??= new GoogleAuth();
    const client = await auth.getIdTokenClient(audience);
    const headers = await client.getRequestHeaders();
    return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, String(v)]));
  } catch (error) {
    console.warn("[v3PaymentExport] ID トークンを取れませんでした:", String((error as Error)?.message || error));
    return {};
  }
}

/** fetch の差し替え口（試験用）。 */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (url, init) => fetch(url, init);
export function setV3FetcherForTest(f: Fetcher | null) { fetcher = f ?? ((url, init) => fetch(url, init)); }

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const base = v3Base();
  const res = await fetcher(`${base}${path}`, {
    ...init,
    headers: {
      ...(await idTokenHeaders(base)),
      "x-lb-webhook-token": String(process.env.V3_WEBHOOK_TOKEN || "").trim(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    const err: any = new Error(`V3: ${body?.error || `HTTP ${res.status}`}`);
    err.status = res.status === 404 || res.status === 400 ? 400 : 502;
    throw err;
  }
  return res;
}

/**
 * 誰の分を出すか。画面の担当者の選択（staffFilter: "all" | "unset" | メール）を
 * V3 の絞り込みにする。一般担当者は自分のメールに固定（呼び出し側で決める）。
 */
export function v3OwnerQuery(staffFilter: string): Record<string, string> {
  if (staffFilter === "all") return {};
  if (staffFilter === "unset") return { unset: "1" };
  return { ownerEmail: staffFilter };
}

export async function listV3Payments(
  from: string, to: string, staffFilter: string
): Promise<V3PaymentRow[]> {
  if (!v3Enabled()) return [];
  const qs = new URLSearchParams({ from, to, ...v3OwnerQuery(staffFilter) });
  const res = await call(`/internal/exports/accounting?${qs}`);
  const body = (await res.json()) as { rows?: V3PaymentRow[] };
  return body.rows ?? [];
}

export async function fetchV3Bundle(
  paymentIds: number[], opts: { from: string; to: string; staffFilter: string }
): Promise<{ buffer: Buffer; fileName: string; pdfFailures: number; count: number }> {
  if (!v3Enabled()) throw Object.assign(new Error("V3 との接続が設定されていません（V3_INTERNAL_URL / V3_WEBHOOK_TOKEN）"), { status: 503 });
  const ids = [...new Set(paymentIds.map((n) => Math.trunc(Number(n))).filter((n) => n > 0))];
  if (!ids.length) throw Object.assign(new Error("支払が選ばれていません"), { status: 400 });
  if (ids.length > 200) throw Object.assign(new Error("一度に出せるのは 200 件までです"), { status: 400 });
  const qs = new URLSearchParams({
    from: opts.from, to: opts.to, paymentIds: ids.join(","), ...v3OwnerQuery(opts.staffFilter),
  });
  const res = await call(`/internal/exports/accounting/bundle?${qs}`);
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  let fileName = "支払申請.zip";
  if (m) { try { fileName = decodeURIComponent(m[1]); } catch { /* そのまま */ } }
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    fileName,
    pdfFailures: Number(res.headers.get("x-pdf-failures") || 0),
    count: Number(res.headers.get("x-payment-count") || ids.length),
  };
}

export async function assignV3Owner(documentId: number, staffEmail: string, by: string): Promise<void> {
  if (!v3Enabled()) throw Object.assign(new Error("V3 との接続が設定されていません"), { status: 503 });
  await call(`/internal/documents/${Math.trunc(documentId)}/account-owner`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ staffEmail: staffEmail || null, by }),
  });
}
