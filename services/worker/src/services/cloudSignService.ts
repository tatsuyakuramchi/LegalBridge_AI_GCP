/**
 * cloudSignService — クラウドサイン Web API クライアント。
 *
 *   base: https://api.cloudsign.jp(sandbox: api-sandbox.cloudsign.jp)
 *   認証: POST /token に client_id を渡し access_token(Bearer)を取得。短命なので
 *         expires_in を尊重してキャッシュ＆更新。401 は 1 回だけ再取得リトライ。
 *
 *   送信フロー: createDocument → attachFile → addParticipant(複数) → sendDocument。
 *   状態取得 : getDocument。
 *
 *   ⚠ CONFIRM(Swagger/実環境): 各エンドポイントの body フィールド名・送信確定の
 *     正確なメソッド/パスは、client_id 取得後に SwaggerHub と実 API で最終確認する。
 *     payload を組む箇所に CONFIRM コメントを付けてある(調整は局所で済む)。
 */
import axios, { AxiosError } from "axios";

export type CsParticipant = {
  email: string;
  name: string;
  organization?: string;
  order?: number;
};

export class CloudSignService {
  private base: string;
  private clientId: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(cfg: { baseUrl?: string; clientId?: string } = {}) {
    this.base = (cfg.baseUrl || process.env.CLOUDSIGN_BASE_URL || "https://api.cloudsign.jp")
      .replace(/\/+$/, "");
    this.clientId = cfg.clientId || process.env.CLOUDSIGN_CLIENT_ID || "";
  }

  /** client_id が設定済みか(未設定なら送信系は呼ばない)。 */
  get configured(): boolean {
    return !!this.clientId;
  }

  /** POST /token: access_token をキャッシュ(expires_in をバッファして更新)。 */
  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now) return this.token.value;
    const body = new URLSearchParams({ client_id: this.clientId });
    const res = await axios.post(`${this.base}/token`, body.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15_000,
    });
    const access = res.data?.access_token;
    const expiresIn = Number(res.data?.expires_in) || 600; // 不明時は 10 分とみなす
    if (!access) throw new Error("CloudSign: /token 応答に access_token がありません");
    // 30 秒前倒しで失効扱いにして再取得余裕を持たせる。
    this.token = { value: access, expiresAt: now + Math.max(60, expiresIn - 30) * 1000 };
    return access;
  }

  private async authHeader(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.getToken()}` };
  }

  /** 401(トークン失効)のときだけ 1 回トークンを捨てて再試行する薄いラッパ。 */
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e as AxiosError;
      if (err.response?.status === 401) {
        this.token = null;
        return await fn();
      }
      throw e;
    }
  }

  /** 書類(送信単位)を下書き作成 → CloudSign 書類ID。 */
  async createDocument(title: string): Promise<string> {
    return this.call(async () => {
      // CONFIRM: POST /documents の body 形式と返却フィールド(id)。
      const body = new URLSearchParams({ title });
      const res = await axios.post(`${this.base}/documents`, body.toString(), {
        headers: { ...(await this.authHeader()), "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20_000,
      });
      const id = res.data?.id;
      if (!id) throw new Error("CloudSign: /documents 作成の応答に id がありません");
      return String(id);
    });
  }

  /** PDF を添付 → ファイルID。 */
  async attachFile(documentId: string, pdf: Buffer, fileName: string): Promise<string> {
    return this.call(async () => {
      // CONFIRM: multipart のファイル項目名(uploadfile 等)。Node18+ の global FormData/Blob を使用。
      const form: any = new (globalThis as any).FormData();
      form.append("uploadfile", new (globalThis as any).Blob([pdf], { type: "application/pdf" }), fileName);
      const res = await axios.post(`${this.base}/documents/${documentId}/files`, form, {
        headers: { ...(await this.authHeader()) },
        timeout: 60_000,
        maxBodyLength: Infinity,
      });
      return String(res.data?.id ?? "");
    });
  }

  /** 宛先(署名者)を追加 → 参加者ID。 */
  async addParticipant(documentId: string, p: CsParticipant): Promise<string> {
    return this.call(async () => {
      // CONFIRM: participants の body フィールド名(email/name/organization/order)。
      const body = new URLSearchParams();
      body.set("email", p.email);
      body.set("name", p.name);
      if (p.organization) body.set("organization", p.organization);
      if (p.order != null) body.set("order", String(p.order));
      const res = await axios.post(`${this.base}/documents/${documentId}/participants`, body.toString(), {
        headers: { ...(await this.authHeader()), "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 20_000,
      });
      return String(res.data?.id ?? "");
    });
  }

  /** 送信確定(下書き→送信)。 */
  async sendDocument(documentId: string): Promise<void> {
    await this.call(async () => {
      // CONFIRM: 送信確定の正確なメソッド/パス。現状の理解では POST /documents/{id}(本文なし)。
      await axios.post(`${this.base}/documents/${documentId}`, null, {
        headers: { ...(await this.authHeader()) },
        timeout: 20_000,
      });
    });
  }

  /** 書類の状態取得(締結状況・参加者の同意状況)。 */
  async getDocument(documentId: string): Promise<any> {
    return this.call(async () => {
      const res = await axios.get(`${this.base}/documents/${documentId}`, {
        headers: { ...(await this.authHeader()) },
        timeout: 20_000,
      });
      return res.data;
    });
  }
}
