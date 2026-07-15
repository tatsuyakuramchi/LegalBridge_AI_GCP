/**
 * documentFiles — document_files(実ファイル台帳, migration 0127)への登録ヘルパ。
 *   Phase 3 (LB-09, 計画 §7/§9): 文書生成・案件添付・Webhook自動生成・バルク発行・
 *   会計Excel など、Drive へファイルを作る全経路をこの1関数へ集約する。
 *
 * 方針:
 *   - documents.drive_link / excel_link(URL 文字列)は互換のため各経路で従来どおり
 *     更新しつつ、file ID・役割・版・現在フラグをここで構造化して追跡する。
 *   - 同一文書×同一役割の「現在の正」は1件(uq_docfiles_current)。demoteOthers=true
 *     (既定)で旧ファイルを is_current=FALSE に倒してから登録する。
 *   - 同 fileId の再登録(内部修正の上書き等)は ON CONFLICT で UPDATE(冪等)。
 *   - 0127 未適用環境(42P01)は黙ってスキップ。その他の失敗も throw せず結果で返す
 *     (台帳登録は best-effort。本体処理を止めない)。
 */

export interface DocumentFilesDeps {
  query: (
    text: string,
    params?: any[]
  ) => Promise<{ rows: any[]; rowCount?: number | null }>;
  /** webViewLink 等から Drive fileId を抽出(GoogleDriveService.extractFileId)。 */
  extractFileId: (link: string) => string | null;
}

export interface RegisterDocumentFileOpts {
  /** 対象文書。documentId か documentNumber のどちらか必須(両方あれば id 優先)。 */
  documentId?: number | null;
  documentNumber?: string | null;
  driveLink: string;
  /** primary_pdf / signed / attachment / excel / reference 等。既定 primary_pdf。 */
  fileRole?: string;
  fileName?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  revision?: number | null;
  driveFolderId?: string | null;
  createdBy?: string | null;
  /** 同役割の他ファイルを is_current=FALSE に倒す(既定 true)。 */
  demoteOthers?: boolean;
}

export interface RegisterDocumentFileResult {
  ok: boolean;
  /** 登録しなかった理由(fileId 抽出不可 / 文書未解決 / 0127 未適用)。 */
  skipped?: string;
  error?: string;
}

export async function registerDocumentFile(
  deps: DocumentFilesDeps,
  opts: RegisterDocumentFileOpts
): Promise<RegisterDocumentFileResult> {
  const { query, extractFileId } = deps;
  const role = opts.fileRole || "primary_pdf";
  try {
    const fileId = extractFileId(opts.driveLink || "");
    if (!fileId) {
      return { ok: false, skipped: `fileId を抽出できません: ${opts.driveLink}` };
    }

    // 文書解決(id 優先、無ければ番号から)。
    let documentId = Number(opts.documentId);
    if (!Number.isFinite(documentId) || documentId <= 0) {
      const num = String(opts.documentNumber || "").trim();
      if (!num) return { ok: false, skipped: "documentId / documentNumber が未指定" };
      const r = await query(
        `SELECT id FROM documents WHERE document_number = $1 LIMIT 1`,
        [num]
      );
      if (!r.rows[0]) return { ok: false, skipped: `文書が見つかりません: ${num}` };
      documentId = Number(r.rows[0].id);
    }

    if (opts.demoteOthers !== false) {
      await query(
        `UPDATE document_files
            SET is_current = FALSE
          WHERE document_id = $1 AND file_role = $2
            AND is_current AND drive_file_id <> $3`,
        [documentId, role, fileId]
      );
    }
    await query(
      `INSERT INTO document_files
         (document_id, matter_id, drive_file_id, drive_folder_id, file_role,
          file_name, mime_type, size_bytes, revision, is_current, drive_link, created_by)
       VALUES ($1, (SELECT matter_id FROM documents WHERE id = $1), $2, $3, $4,
               $5, $6, $7, $8, TRUE, $9, $10)
       ON CONFLICT (document_id, file_role, drive_file_id) DO UPDATE SET
         is_current      = TRUE,
         revision        = EXCLUDED.revision,
         drive_link      = EXCLUDED.drive_link,
         file_name       = COALESCE(EXCLUDED.file_name, document_files.file_name),
         mime_type       = COALESCE(EXCLUDED.mime_type, document_files.mime_type),
         size_bytes      = COALESCE(EXCLUDED.size_bytes, document_files.size_bytes),
         matter_id       = EXCLUDED.matter_id,
         drive_folder_id = COALESCE(EXCLUDED.drive_folder_id, document_files.drive_folder_id)`,
      [
        documentId,
        fileId,
        opts.driveFolderId ?? null,
        role,
        opts.fileName ?? null,
        opts.mimeType ?? null,
        opts.sizeBytes ?? null,
        Number(opts.revision) || 0,
        opts.driveLink,
        opts.createdBy ?? null,
      ]
    );
    return { ok: true };
  } catch (e: any) {
    if (e?.code === "42P01") {
      return { ok: false, skipped: "document_files 未作成(migration 0127 未適用)" };
    }
    return { ok: false, error: String(e?.message || e) };
  }
}
