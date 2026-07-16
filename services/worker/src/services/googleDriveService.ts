import { google } from "googleapis";
import { Readable } from "stream";
import * as fs from "node:fs";
import { renderHtmlToPdf, type RenderPdfOptions } from "./pdfRenderer.ts";

export class GoogleDriveService {
  private drive;
  private auth: InstanceType<typeof google.auth.GoogleAuth>;

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
    // スコープは drive.file でなく drive (フル) を使う。
    //   drive.file は「このアプリが作成/オープンしたファイル」しか見えず、
    //   *共有されただけ* の既存フォルダを files.create の parents に指定すると
    //   権限があっても 404 (File not found) になる。資料アップロードの格納先
    //   (法務共有ドライブのフォルダ) は人間が作ったフォルダなのでこれに該当
    //   した (2026-07-16)。drive スコープでも実際に触れる範囲は SA に共有
    //   されたアイテムに限られる (Drive の権限モデルはそのまま効く)。
    this.auth = new google.auth.GoogleAuth({
      ...(keyFileUsable ? { keyFile } : {}),
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    this.drive = google.drive({
      version: "v3",
      auth: this.auth,
    });
  }

  /**
   * Drive API を実際に呼んでいるサービスアカウントのメールアドレス。
   * 鍵ファイル (GOOGLE_SERVICE_ACCOUNT_KEY_PATH) 利用時はその SA、
   * ADC フォールバック時は Cloud Run のランタイム SA になる。
   * 「フォルダに権限を付けたのにアップロードが失敗する」系の切り分け用。
   */
  async getServiceAccountEmail(): Promise<string> {
    try {
      const creds = await this.auth.getCredentials();
      return String((creds as any)?.client_email || "");
    } catch {
      return "";
    }
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

      // 共有ドライブ等では webViewLink が返らないことがある (uploadPdf でも既知)。
      // その場合は fileId から /file/d/<id>/view を合成し、リンク欠落で
      // 後続の fileId 抽出 (downloadFile/本文抽出) が壊れないようにする。
      const id = response.data.id;
      return (
        response.data.webViewLink ||
        (id ? `https://drive.google.com/file/d/${id}/view` : "")
      );
    } catch (error) {
      console.error("Error uploading file to Google Drive:", error);
      throw error;
    }
  }

  /**
   * Phase 22.21.66: Drive 上のファイル名を変更する。
   *
   * documents.drive_link は Drive の webViewLink (例:
   *   https://drive.google.com/file/d/<fileId>/view) 形式。
   * URL から fileId を抽出して drive.files.update を呼ぶ。
   *
   * 失敗は throw せず、null を返して呼び出し側が best-effort で処理できる
   * ようにする (DB rename は既に確定しているので、Drive 側だけ失敗しても
   * 警告ログだけで継続したい)。
   */
  /** webViewLink から fileId を抽出(公開版)。document_files 登録などで使用。 */
  extractFileId(driveLink: string): string | null {
    return this.fileIdFromLink(driveLink);
  }

  /** webViewLink から fileId を抽出。複数 URL 形式に対応。 */
  private fileIdFromLink(driveLink: string): string | null {
    const s = driveLink || "";
    //   /file/d/<id>/... , /d/<id>(docs/sheets), open?id=<id>, uc?id=<id>
    const m =
      s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      s.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
      s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
    // URL でなく fileId そのものが保存されているケース。
    if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
    return null;
  }

  /**
   * 指定メールアドレスに閲覧 (reader) 権限を付与する。
   *
   * Slack へ Drive リンクを送る際、受信者が共有ドライブのメンバーで
   * なくてもリンクを開けるようにするために呼ぶ。Drive 側の共有通知
   * メールは送らない (通知は Slack が担うため)。
   *
   * 失敗は throw せず { ok:false, error } を返す (通知処理を止めない)。
   */
  async grantViewPermission(
    driveLink: string,
    email: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!driveLink || !email) {
      return { ok: false, error: "empty driveLink/email" };
    }
    const fileId = this.fileIdFromLink(driveLink);
    if (!fileId) {
      return { ok: false, error: `cannot extract fileId from: ${driveLink}` };
    }
    try {
      await this.drive.permissions.create({
        fileId,
        requestBody: { type: "user", role: "reader", emailAddress: email },
        supportsAllDrives: true,
        sendNotificationEmail: false,
      });
      return { ok: true };
    } catch (error: any) {
      return {
        ok: false,
        error: `fileId=${fileId} email=${email}: ${error?.message || String(error)}`,
      };
    }
  }

  /**
   * Phase 3 (LB-08, §7): 親フォルダ配下に指定名のフォルダを冪等に用意する。
   *   既存(自SAが作成したもの)があれば再利用し、無ければ作成する。
   *   ※ スコープは drive.file のため、検索は自SAが作成/共有されたフォルダに限る。
   *     案件フォルダは常に本サービスが作るため運用上は一致する。
   */
  async ensureFolder(name: string, parentId?: string): Promise<{ id: string; link: string }> {
    const parent = parentId || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const esc = name.replace(/'/g, "\\'");
    const q =
      `name = '${esc}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` +
      (parent ? ` and '${parent}' in parents` : "");
    const found = await this.drive.files.list({
      q,
      fields: "files(id, webViewLink)",
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const hit = found.data.files?.[0];
    if (hit?.id) {
      return {
        id: hit.id,
        link: hit.webViewLink || `https://drive.google.com/drive/folders/${hit.id}`,
      };
    }
    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parent ? [parent] : [],
      },
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    const id = created.data.id || "";
    return {
      id,
      link: created.data.webViewLink || `https://drive.google.com/drive/folders/${id}`,
    };
  }

  /**
   * Phase 3 (LB-08, §7): Matter の案件フォルダ一式を作成する。
   *   <root>/<YYYY>/<MTR-code>_<相手方>_<案件名> + 標準サブフォルダ8個。
   *   root は GOOGLE_DRIVE_MATTERS_ROOT_ID(未設定なら GOOGLE_DRIVE_FOLDER_ID)。
   *   冪等(既存フォルダは再利用)。失敗は throw(呼び出し側で best-effort 処理)。
   */
  static readonly MATTER_SUBFOLDERS = [
    "01_Request",
    "02_Draft",
    "03_Review",
    "04_Final",
    "05_Signed",
    "06_Deliverables_Inspection",
    "07_Invoice_Payment",
    "90_Reference",
  ] as const;

  async createMatterFolder(m: {
    matter_code?: string | null;
    counterparty?: string | null;
    title?: string | null;
  }): Promise<{ folderId: string; folderUrl: string }> {
    const root =
      process.env.GOOGLE_DRIVE_MATTERS_ROOT_ID || process.env.GOOGLE_DRIVE_FOLDER_ID;
    const year = String(new Date().getFullYear());
    // フォルダ名: MTR-YYYY-NNNNN_相手方_案件名(Drive 禁則文字を除去し全体を短めに)。
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    const nameParts = [
      clean(String(m.matter_code || "MTR")),
      clean(String(m.counterparty || "")).slice(0, 30),
      clean(String(m.title || "")).slice(0, 40),
    ].filter(Boolean);
    const folderName = nameParts.join("_");

    const yearFolder = await this.ensureFolder(year, root);
    const matterFolder = await this.ensureFolder(folderName, yearFolder.id);
    // 標準サブフォルダ(§7)。1つ失敗しても残りは作る。
    for (const sub of GoogleDriveService.MATTER_SUBFOLDERS) {
      try {
        await this.ensureFolder(sub, matterFolder.id);
      } catch (e: any) {
        console.warn(
          `[createMatterFolder] subfolder ${sub} failed (non-fatal):`,
          e?.message || e
        );
      }
    }
    return { folderId: matterFolder.id, folderUrl: matterFolder.link };
  }

  /**
   * Phase 3 (欠損検査): ファイルの実在・状態を確認する。
   *   ok / missing(404 or ゴミ箱) / forbidden(403) / error を返す(throw しない)。
   */
  async statFile(
    fileId: string
  ): Promise<{ status: "ok" | "missing" | "forbidden" | "error"; name?: string; size?: number; error?: string }> {
    try {
      const r = await this.drive.files.get({
        fileId,
        fields: "id, name, trashed, size",
        supportsAllDrives: true,
      });
      if (r.data.trashed) return { status: "missing", name: r.data.name || undefined };
      return {
        status: "ok",
        name: r.data.name || undefined,
        size: r.data.size ? Number(r.data.size) : undefined,
      };
    } catch (e: any) {
      const code = Number(e?.code || e?.response?.status);
      if (code === 404) return { status: "missing", error: e?.message };
      if (code === 403) return { status: "forbidden", error: e?.message };
      return { status: "error", error: e?.message || String(e) };
    }
  }

  /** CloudSign 送信用に、既存 Drive ファイル(PDF)の中身を取得する。 */
  async downloadPdf(driveLink: string): Promise<Buffer> {
    const fileId = this.fileIdFromLink(driveLink);
    if (!fileId) throw new Error(`Drive リンクから fileId を抽出できません: ${driveLink}`);
    const res = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    return Buffer.from(res.data as any);
  }

  async renameFile(driveLink: string, newName: string): Promise<string | null> {
    const r = await this.renameFileVerbose(driveLink, newName);
    if (!r.ok && r.error) {
      console.warn(`[GoogleDriveService.renameFile] ${r.error}`);
    }
    return r.ok ? r.name || newName : null;
  }

  /**
   * renameFile の詳細版。失敗理由を呼び出し側に返す (backfill 診断用)。
   * 失敗は throw せず { ok:false, error } を返す。
   */
  async renameFileVerbose(
    driveLink: string,
    newName: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> {
    if (!driveLink || !newName) return { ok: false, error: "empty driveLink/newName" };
    const fileId = this.fileIdFromLink(driveLink);
    if (!fileId) return { ok: false, error: `cannot extract fileId from: ${driveLink}` };
    try {
      const response = await this.drive.files.update({
        fileId,
        requestBody: { name: newName },
        fields: "id, name",
        supportsAllDrives: true,
      });
      return { ok: !!response.data.name, name: response.data.name || undefined };
    } catch (error: any) {
      return {
        ok: false,
        error: `fileId=${fileId}: ${error?.message || String(error)}`,
      };
    }
  }

  /**
   * Phase 23.1: 既存 Drive ファイルの PDF コンテンツを上書きする (fileId 維持)。
   *
   * 内部修正 (= getDocumentNumberForGenerate の overwrite=true 経路) で使用。
   * 参照リンク (webViewLink) は同じ fileId を指すので、Drive 上の URL は不変。
   *
   * 動作:
   *   1. driveLink から fileId を抽出
   *   2. HTML を PDF に再レンダー
   *   3. drive.files.update で media を差し替え + ファイル名も同時に更新可
   *
   * 失敗時は throw (caller 側で再アップロードにフォールバックさせる)。
   *
   * @param driveLink  既存の webViewLink (https://drive.google.com/file/d/.../view)
   * @param html       新しい HTML コンテンツ
   * @param fileName   新しいファイル名 (拡張子は .pdf に整形される)
   * @param renderOptions  PDF レンダーオプション
   * @returns 上書き後の webViewLink (基本的に同じ URL)
   */
  async overwritePdf(
    driveLink: string,
    html: string,
    fileName: string,
    renderOptions?: RenderPdfOptions
  ): Promise<string> {
    if (!driveLink) {
      throw new Error("driveLink is required for overwritePdf");
    }
    const m = driveLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const fileId = m?.[1];
    if (!fileId) {
      throw new Error(
        `[GoogleDriveService.overwritePdf] cannot extract fileId from: ${driveLink}`
      );
    }

    const pdfBuffer = await renderHtmlToPdf(html, renderOptions);
    const pdfName = fileName.replace(/\.(html?|docx?)$/i, "") + ".pdf";
    const media = {
      mimeType: "application/pdf",
      body: Readable.from(pdfBuffer),
    };

    const response = await this.drive.files.update({
      fileId,
      requestBody: { name: pdfName, mimeType: "application/pdf" },
      media,
      fields: "id, webViewLink",
      supportsAllDrives: true,
    });
    const link =
      response.data.webViewLink ||
      (response.data.id
        ? `https://drive.google.com/file/d/${response.data.id}/view`
        : driveLink);
    console.log(
      `[overwritePdf] id=${response.data.id} webViewLink=${response.data.webViewLink} → ${link}`
    );
    return link;
  }
}

