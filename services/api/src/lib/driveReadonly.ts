/**
 * driveReadonly — Google Drive 上の既存ファイル(検収書PDF等)の読み取り専用取得。
 *
 * worker の GoogleDriveService と同じ認証優先順位:
 *   1. GOOGLE_SERVICE_ACCOUNT_KEY_PATH (Secret Manager からマウントした SA キー)
 *   2. GOOGLE_APPLICATION_CREDENTIALS (標準 ADC)
 *   3. Cloud Run / GCE メタデータサーバー (ランタイム SA)
 *
 * googleapis は入れず google-auth-library の authorized client で
 * Drive REST (files.get?alt=media) を直接叩く。scope は readonly のみ。
 *
 * 前提: この SA に検収書 PDF が置かれた Drive フォルダ(共有ドライブ)の
 * 閲覧権限が付与されていること。権限が無い場合は 403/404 で throw する。
 */
import { GoogleAuth } from "google-auth-library";
import * as fs from "node:fs";

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (cachedAuth) return cachedAuth;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  const keyFileUsable = !!keyFile && fs.existsSync(keyFile);
  if (keyFile && !keyFileUsable) {
    console.warn(
      `[driveReadonly] GOOGLE_SERVICE_ACCOUNT_KEY_PATH=${keyFile} ` +
        `is set but the file is missing on disk. Falling back to ADC.`
    );
  }
  cachedAuth = new GoogleAuth({
    ...(keyFileUsable ? { keyFile } : {}),
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  return cachedAuth;
}

/**
 * webViewLink から fileId を抽出。worker GoogleDriveService.fileIdFromLink と同一規約。
 *   /file/d/<id>/... , /d/<id>, open?id=<id>, uc?id=<id>, fileId 素の値
 */
export function fileIdFromDriveLink(driveLink: string): string | null {
  const s = driveLink || "";
  const m =
    s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/\/d\/([a-zA-Z0-9_-]+)/) ||
    s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

/** Drive 上のファイル本体を Buffer で取得する。 */
export async function downloadDriveFile(driveLink: string): Promise<Buffer> {
  const fileId = fileIdFromDriveLink(driveLink);
  if (!fileId) {
    throw new Error(`Drive リンクから fileId を抽出できません: ${driveLink}`);
  }
  const client = await getAuth().getClient();
  const res = await client.request<ArrayBuffer>({
    url:
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
      `?alt=media&supportsAllDrives=true`,
    responseType: "arraybuffer",
  });
  return Buffer.from(res.data as ArrayBuffer);
}
