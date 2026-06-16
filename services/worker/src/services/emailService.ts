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

  private gmail() {
    return google.gmail({ version: "v1", auth: this.buildAuth() as any });
  }

  /**
   * ドメイン全体委任で EMAIL_SENDER を代理する GoogleAuth を組む。
   *   代理送信(subject)には SA の秘密鍵が必要なので、Drive と同じ
   *   GOOGLE_SERVICE_ACCOUNT_KEY_PATH(例: /secrets/gws-service-account.json)を
   *   優先的に使う。無ければ ADC(GOOGLE_APPLICATION_CREDENTIALS)へフォールバック。
   */
  private buildAuth() {
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const keyFileUsable = !!keyFile && fs.existsSync(keyFile);
    return new google.auth.GoogleAuth({
      ...(keyFileUsable ? { keyFile } : {}),
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      // ドメイン全体委任: EMAIL_SENDER を代理して送る。
      clientOptions: this.sender ? { subject: this.sender } : undefined,
    });
  }

  /**
   * 接続確認: 代理ユーザーのアクセストークンを取得できるか試す(送信はしない)。
   *   委任/スコープが未設定なら token 取得で失敗する(unauthorized_client 等)ので、
   *   gmail.send だけで権限不足になる getProfile より確実に検証できる。
   */
  async verifyConnection(): Promise<{ ok: true; sender: string }> {
    if (!this.sender) throw new Error("EMAIL_SENDER(送信元メール)が未設定です");
    const client = await this.buildAuth().getClient();
    const token = await (client as any).getAccessToken();
    if (!token || !token.token)
      throw new Error(
        "アクセストークンを取得できません(ドメイン全体委任 / gmail.send スコープ / 送信元メールを確認してください)"
      );
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
    const gmail = this.gmail();
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
