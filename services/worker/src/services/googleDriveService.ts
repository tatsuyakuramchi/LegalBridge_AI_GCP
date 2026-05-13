import { google } from "googleapis";
import { Readable } from "stream";
import * as fs from "node:fs";
import { renderHtmlToPdf, type RenderPdfOptions } from "./pdfRenderer.ts";

export class GoogleDriveService {
  private drive;

  constructor() {
    // Authentication priority:
    //   1. GOOGLE_SERVICE_ACCOUNT_KEY_PATH — explicit path to a JSON key
    //      file (typically mounted from Secret Manager at
    //      /secrets/gws-service-account.json). Used when the Cloud Run
    //      runtime SA does not have Drive access and a dedicated
    //      Workspace-bound SA is provisioned for Drive operations.
    //   2. GOOGLE_APPLICATION_CREDENTIALS — standard ADC variable,
    //      respected automatically by GoogleAuth.
    //   3. Cloud Run / GCE metadata server — the runtime SA.
    //
    // We only fall through to (2)/(3) when the path in (1) actually
    // exists on disk. Otherwise googleapis tries to open the missing
    // file and raises ENOENT on every Drive call, masking the real
    // upload failure. ADC is always a usable fallback (with whatever
    // permissions the runtime SA has).
    const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const keyFileUsable = !!keyFile && fs.existsSync(keyFile);
    if (keyFile && !keyFileUsable) {
      console.warn(
        `[GoogleDriveService] GOOGLE_SERVICE_ACCOUNT_KEY_PATH=${keyFile} ` +
          `is set but the file is missing on disk. Falling back to ADC.`
      );
    }
    this.drive = google.drive({
      version: "v3",
      auth: new google.auth.GoogleAuth({
        ...(keyFileUsable ? { keyFile } : {}),
        scopes: ["https://www.googleapis.com/auth/drive.file"],
      })
    });
  }

  async uploadHtml(html: string, fileName: string, folderId?: string): Promise<string> {
    // Cloud Run環境（ADC）または環境変数を自動認識します
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName,
      parents: folder ? [folder] : [],
      mimeType: "application/vnd.google-apps.document", // Automatically convert to Google Doc
    };

    const media = {
      mimeType: "text/html",
      body: Readable.from([html]),
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        // Required when GOOGLE_DRIVE_FOLDER_ID points at a folder inside a
        // Shared Drive. Service accounts have zero personal-Drive quota,
        // so writing to "My Drive" always 403s with
        // `The user's Drive storage quota has been exceeded.` Setting
        // supportsAllDrives + a Shared-Drive folder id sidesteps that.
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading to Google Drive:", error);
      throw error;
    }
  }

  /**
   * HTML を Puppeteer で PDF レンダリングして Drive に upload。
   * Drive 側では PDF として保存され (Google Docs への変換なし)、
   * Web View でも開けるし、ダウンロードしてもそのまま .pdf として降りる。
   *
   * Phase 9: 従来は uploadHtml が Google Docs 変換していたためレイアウトが
   * 大幅に崩れ、ダウンロード時 .docx が降ってくる挙動だったが、PDF レンダ
   * リング後はテンプレ HTML の CSS そのままで出力される。
   */
  async uploadPdf(
    html: string,
    fileName: string,
    folderId?: string,
    renderOptions?: RenderPdfOptions
  ): Promise<string> {
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const pdfBuffer = await renderHtmlToPdf(html, renderOptions);
    const pdfName = fileName.replace(/\.(html?|docx?)$/i, "") + ".pdf";

    const fileMetadata = {
      name: pdfName,
      parents: folder ? [folder] : [],
      mimeType: "application/pdf",
    };
    const media = {
      mimeType: "application/pdf",
      body: Readable.from(pdfBuffer),
    };
    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });
      // Phase 9e: PDF (バイナリ) のアップロードでは Google Docs と違い
      // webViewLink が空で返ってくることがある (Shared Drive 内の
      // 非ネイティブ形式 + サービスアカウント特有の挙動)。
      // その場合は file id から /file/d/<id>/view を組み立てる。
      const link =
        response.data.webViewLink ||
        (response.data.id
          ? `https://drive.google.com/file/d/${response.data.id}/view`
          : "");
      console.log(
        `[uploadPdf] id=${response.data.id} webViewLink=${response.data.webViewLink} → ${link}`
      );
      return link;
    } catch (error) {
      console.error("Error uploading PDF to Google Drive:", error);
      throw error;
    }
  }

  async uploadMarkdown(markdown: string, fileName: string, folderId?: string): Promise<string> {
    // Cloud Run環境（ADC）または環境変数を自動認識します
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName.replace(/\.html$/, ""),
      parents: folder ? [folder] : [],
      mimeType: "application/vnd.google-apps.document", // Automatically convert to Google Doc
    };

    const media = {
      mimeType: "text/markdown",
      body: Readable.from([markdown]),
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading Markdown to Google Drive:", error);
      throw error;
    }
  }

  async uploadFile(stream: Readable, fileName: string, mimeType: string, folderId?: string): Promise<string> {
    const folder = folderId || process.env.GOOGLE_DRIVE_FOLDER_ID;

    const fileMetadata = {
      name: fileName,
      parents: folder ? [folder] : [],
    };

    const media = {
      mimeType: mimeType,
      body: stream,
    };

    try {
      const response = await this.drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });

      return response.data.webViewLink || "";
    } catch (error) {
      console.error("Error uploading file to Google Drive:", error);
      throw error;
    }
  }
}

