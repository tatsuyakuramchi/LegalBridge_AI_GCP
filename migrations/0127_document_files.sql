-- 0127_document_files.sql
-- Phase 3「Drive管理」の DB スライス (LB-09)。
--   修正計画書 docs/plans/legalbridge-remediation-plan-20260714.md §6.3 / §7 / §9 Phase 3
--     ① document_files を新設: 実ファイル(Drive)を file ID で追跡する台帳。
--        documents.drive_link(URL文字列)への依存を、file ID + 役割 + 版 + 検査状態の
--        構造化データへ段階移行する(URL 列は互換のため当面残す)。
--     ② 既存 documents.drive_link から file ID をバックフィル(冪等・再実行安全)。
--   非破壊・追加のみ。
--
--   file_role の語彙(§7):
--     primary_pdf … 発行した書面の正本PDF(文書生成/PDF未作成キュー発行)
--     signed      … 締結済み(CloudSign完了等)
--     draft / review / attachment / excel / reference … ドラフト/レビュー版/添付/会計Excel/参考
--   is_current: 同一文書×同一役割の「現在の正」は 1 件のみ(部分ユニーク索引で保証)。
--   verify_*  : Drive 実在・権限の定期検査(POST /api/drive/verify-files)の記録。

BEGIN;

CREATE TABLE IF NOT EXISTS document_files (
  id               SERIAL PRIMARY KEY,
  document_id      INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  matter_id        INTEGER REFERENCES matters(id) ON DELETE SET NULL,
  drive_file_id    TEXT NOT NULL,
  drive_folder_id  TEXT,
  file_role        VARCHAR(30) NOT NULL DEFAULT 'primary_pdf',
  file_name        TEXT,
  mime_type        VARCHAR(120),
  size_bytes       BIGINT,
  checksum_sha256  VARCHAR(64),
  revision         INTEGER NOT NULL DEFAULT 0,
  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  drive_link       TEXT,                 -- webViewLink(互換・表示用。正本は drive_file_id)
  verified_at      TIMESTAMPTZ,          -- 最後に Drive 実在確認した時刻
  verify_status    VARCHAR(20),          -- ok / missing / forbidden / error
  created_by       VARCHAR(120),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_docfiles_document ON document_files(document_id);
CREATE INDEX IF NOT EXISTS idx_docfiles_matter   ON document_files(matter_id)
  WHERE matter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docfiles_fileid   ON document_files(drive_file_id);
-- 同一文書×同一役割×同一ファイルの重複登録を防ぐ(生成の上書き再実行を冪等に)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_docfiles_doc_role_file
  ON document_files(document_id, file_role, drive_file_id);
-- 「現在の正」は文書×役割につき 1 件(§11.3 締結済み正本は原則1件、の一般化)。
CREATE UNIQUE INDEX IF NOT EXISTS uq_docfiles_current
  ON document_files(document_id, file_role) WHERE is_current;
-- 欠損検査の巡回対象の取り出し(未検査 → 古い順)。
CREATE INDEX IF NOT EXISTS idx_docfiles_verify
  ON document_files(verified_at NULLS FIRST) WHERE is_current;

-- ───────────────────────────────────────────────────────────────────────────
-- バックフィル: documents.drive_link から file ID を抽出して登録する。
--   対応 URL 形式: /file/d/<id> , /d/<id>(docs/sheets), ?id=<id>
--   is_current は documents.is_primary(無ければ TRUE)。既登録はスキップ(冪等)。
-- ───────────────────────────────────────────────────────────────────────────
INSERT INTO document_files
  (document_id, matter_id, drive_file_id, file_role, file_name,
   revision, is_current, drive_link, created_by)
SELECT
  d.id,
  d.matter_id,
  COALESCE(
    substring(d.drive_link from '/d/([a-zA-Z0-9_-]+)'),
    substring(d.drive_link from '[?&]id=([a-zA-Z0-9_-]+)')
  ),
  'primary_pdf',
  d.document_number,
  COALESCE(d.revision, 0),
  COALESCE(d.is_primary, TRUE),
  d.drive_link,
  'backfill-0127'
FROM documents d
WHERE COALESCE(
        substring(d.drive_link from '/d/([a-zA-Z0-9_-]+)'),
        substring(d.drive_link from '[?&]id=([a-zA-Z0-9_-]+)')
      ) IS NOT NULL
  AND NOT EXISTS (
        SELECT 1 FROM document_files f
         WHERE f.document_id = d.id AND f.file_role = 'primary_pdf'
      )
ON CONFLICT (document_id, file_role, drive_file_id) DO NOTHING;
-- ※ バックフィルは NOT EXISTS により文書×役割につき1行しか入れないため、
--   部分ユニーク索引(uq_docfiles_current)と衝突しない。

COMMIT;
