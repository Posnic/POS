# Optional Cash Book supporting documents

Cash Book entries can have PDF, JPG or PNG evidence without making uploads mandatory. Add files beneath the entry's notes; Preview and Download are available from the form and the saved entry's details. Removing a saved attachment in the form is staged until Save. The normal amount/category/notes workflow remains available without documents.

Limits: five files per entry, up to 5 MiB each and 10 MiB in total. The server checks file signatures, counts and aggregate size. Files remain private: listing, content retrieval, uploading and removal require Cash Book permissions and the authenticated branch/license scope. There are no public upload URLs.

## Persistence and retry

Bounded file bytes are base64 encoded in the expense document's `supporting_documents` array alongside name, detected type, size, content hash, upload time and uploader ID. The total cap keeps the document below MongoDB's 16 MiB limit, including base64 overhead. Ordinary list/detail queries exclude supporting documents; explicit attachment endpoints return metadata or one file. This is deliberately intended for small accounting evidence, not arbitrary document storage.

Keeping bytes and metadata together avoids missing filesystem references in database backup/recycle-bin records. Mutations advance `updated_date` for document-based sync. Installed desktop-to-cloud sync must be checked with its actual agent before claiming end-to-end device support; these changes do not introduce a new file-transfer daemon or public S3 objects. Large batches of attachment-bearing documents need attention to sync payload limits.

The entry is saved first. Its ID is retained immediately. Files upload serially, and a content hash makes upload retries idempotent. If a file fails, the form keeps unsuccessful files, explains that the entry already saved, and retries against that same ID. Successful files remain saved. Attachment changes do not alter the financial amount or mark tax credit eligible.

## API

- `GET /api/expenses/:id/attachments`: metadata only.
- `GET /api/expenses/:id/attachments/:attId`: authenticated JSON containing file metadata and base64 bytes; never cached.
- `POST /api/expenses/:id/attachments`: multipart `file`, one file per request.
- `DELETE /api/expenses/:id/attachments/:attId`: idempotent removal from the active entry.

The browser creates a temporary Blob for preview/download. PDF previews use the browser's PDF viewer. The API CSP permits Blob image/document previews. The UI escapes file names by using text nodes.

## Verification

Run `node --test api/tests/unit/controllers/expense-attachments.proof.cjs` for isolated MongoDB/HTTP integration coverage: permission and branch isolation, exact content round-trip, deduplication under concurrent retries, type/size/count limits, deletion and legacy empty entries. The test owns its temporary database and never uses client data.

Run `node tests/tools/expense-attachments-proof.cjs` for browser coverage of optional saving, multiple selection, partial-upload retry without duplicate expense, image preview, staged removal and light/dark layouts. This harness uses the actual Cash Book form and scripts with simulated save responses; it is not a live tenant deployment test.

## Boundaries

This change implements Cash Book supporting files. The new Tax & Compliance workspace, accountant workbook/PDF generation and an “Include supporting documents” export bundle remain governed by `TAX_COMPLIANCE_ROADMAP.md`; they are not implemented by this attachment change. Existing Cash Book CSV exports are unchanged and do not embed binary files.
