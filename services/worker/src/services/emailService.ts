/**
 * emailService — Gmail API 経由のメール送信クライアント。
 *
 *   送信は Google Workspace のサービスアカウント(ドメイン全体委任)で、
 *   EMAIL_SENDER のメールボックスを「代理(impersonate)」して送る。
 *   前提(運用設定):
 *     - gws サービスアカウントに gmail.send のドメイン全体委任を付与
 *     - EMAIL_SENDER = 送信元(差出人)となる Workspace ユーザーのメール
 *   認証は googleapis の GoogleAuth(clientOptions.subject で委任)を使う。
 *   添付ありは multipart/mixed、無しは text/html 単体で MIME を組む。
 */
import { google } from "googleapis";
import fs from "fs";
import axios from "axios";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  mimeType: string;
};

export class EmailService {
  private sender: string;

  constructor(cfg: { sender?: string } = {}) {
    this.sender = (cfg.sender || process.env.EMAIL_SENDER || "").trim();
  }

  /** 送信元が設定済みか(未設定なら送信系は呼ばない)。 */
  get configured(): boolean {
    return !!this.sender;
  }

  /**
   * EMAIL_SENDER を代理(ドメイン全体委任)して gmail.send のアクセストークンを得る。
   *   - 鍵ファイル(GOOGLE_SERVICE_ACCOUNT_KEY_PATH)が実在すれば GoogleAuth(subject)。
   *   - 無ければ「鍵レス」: ランタイム SA(Compute SA, metadata)で IAM signJwt を行い、
   *     JWT-bearer で token 交換する。Cloud Run で鍵を持たない構成でも代理送信できる。
   *   前提(鍵レス時): ランタイム SA に roles/iam.serviceAccountTokenCreator(自分自身)、
   *     その SA の client_id を Workspace で gmail.send にドメイン全体委任。
   */
  private async getDelegatedAccessToken(): Promise<string> {
    if (!this.sender) throw new Error("EMAIL_SENDER(送信元メール)が未設定です");

    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    if (keyFile && fs.existsSync(keyFile)) {
      // 鍵あり経路: GoogleAuth が subject 代理で署名できる。
      const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: [GMAIL_SEND_SCOPE],
        clientOptions: { subject: this.sender },
      });
      const client = await auth.getClient();
      const t = await (client as any).getAccessToken();
      if (!t || !t.token) throw new Error("アクセストークンを取得できません(鍵あり経路)");
      return t.token as string;
    }

    // 鍵レス経路: Compute SA の signJwt → JWT-bearer 交換。
    const baseAuth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const saEmail = await this.resolveRuntimeSaEmail(baseAuth);
    const iam = google.iamcredentials({ version: "v1", auth: baseAuth as any });
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: saEmail,
      sub: this.sender, // 代理する送信元メールボックス
      scope: GMAIL_SEND_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const signed = await iam.projects.serviceAccounts.signJwt({
      name: `projects/-/serviceAccounts/${saEmail}`,
      requestBody: { payload: JSON.stringify(claims) },
    });
    const assertion = signed.data.signedJwt;
    if (!assertion) throw new Error("signJwt が空応答(tokenCreator 権限を確認)");
    const tok = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
    );
    const at = tok.data?.access_token;
    if (!at)
      throw new Error(
        "JWT-bearer のトークン交換に失敗(ドメイン全体委任 / gmail.send スコープ / 送信元メールを確認): " +
          JSON.stringify(tok.data || {})
      );
    return at as string;
  }

  /** ランタイム SA のメールを特定(EMAIL_DELEGATION_SA → metadata → ADC)。 */
  private async resolveRuntimeSaEmail(baseAuth: any): Promise<string> {
    const override = (process.env.EMAIL_DELEGATION_SA || "").trim();
    if (override) return override;
    try {
      const r = await axios.get(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
        { headers: { "Metadata-Flavor": "Google" }, timeout: 3000 }
      );
      if (r.data) return String(r.data).trim();
    } catch {
      /* metadata 不可(ローカル等)→ ADC へ */
    }
    const creds = await baseAuth.getCredentials();
    if (creds?.client_email) return String(creds.client_email);
    throw new Error("ランタイム SA のメールを特定できません(EMAIL_DELEGATION_SA を設定してください)");
  }

  /** 接続確認: 代理トークンを取得できるか試す(送信はしない)。 */
  async verifyConnection(): Promise<{ ok: true; sender: string }> {
    await this.getDelegatedAccessToken();
    return { ok: true, sender: this.sender };
  }

  async sendEmail(opts: {
    to: string[];
    cc?: string[];
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  }): Promise<{ messageId: string }> {
    if (!this.sender) throw new Error("EMAIL_SENDER(送信元メール)が未設定です");
    const to = (opts.to || []).filter(Boolean);
    if (!to.length) throw new Error("宛先がありません");
    const accessToken = await this.getDelegatedAccessToken();
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials({ access_token: accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2 });
    const raw = buildRawMessage({
      from: this.sender,
      to,
      cc: (opts.cc || []).filter(Boolean),
      subject: opts.subject || "",
      html: opts.html || "",
      attachments: opts.attachments || [],
    });
    const res = await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
    return { messageId: res.data.id || "" };
  }
}

/** ヘッダ用 encoded-word(UTF-8 / Base64)。日本語の件名・氏名向け。 */
function encodeHeader(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** 本文/添付を 76 桁折返しの base64 にする(MIME 準拠)。 */
function base64Wrapped(buf: Buffer): string {
  return buf.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

/** RFC2822 メッセージを組み、Gmail API 用の base64url にする。 */
function buildRawMessage(o: {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}): string {
  const lines: string[] = [];
  lines.push(`From: ${o.from}`);
  lines.push(`To: ${o.to.join(", ")}`);
  if (o.cc.length) lines.push(`Cc: ${o.cc.join(", ")}`);
  lines.push(`Subject: ${encodeHeader(o.subject)}`);
  lines.push("MIME-Version: 1.0");

  if (!o.attachments.length) {
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(base64Wrapped(Buffer.from(o.html, "utf8")));
  } else {
    const boundary = "lb_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    lines.push("");
    // 本文パート
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(base64Wrapped(Buffer.from(o.html, "utf8")));
    // 添付パート
    for (const a of o.attachments) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${a.mimeType}; name="${encodeHeader(a.filename)}"`);
      lines.push("Content-Transfer-Encoding: base64");
      lines.push(`Content-Disposition: attachment; filename="${encodeHeader(a.filename)}"`);
      lines.push("");
      lines.push(base64Wrapped(a.content));
    }
    lines.push(`--${boundary}--`);
  }

  const message = lines.join("\r\n");
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
