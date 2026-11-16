import type { BulkImportBasis, BulkImportResponse, BulkUploadRow, ManuscriptDownload, ManuscriptExportQuery, ManuscriptImportItem, ManuscriptImportSummary, ManuscriptPreview } from '../entities/manuscript'

export interface ManuscriptRepository {
  preview(workId: string, file: File, signal?: AbortSignal): Promise<ManuscriptPreview>
  confirm(workId: string, file: File, rightsConfirmed: boolean, items: ManuscriptImportItem[], signal?: AbortSignal): Promise<ManuscriptImportSummary>
  bulkBasis(workId: string, signal?: AbortSignal): Promise<BulkImportBasis>
  importBulkBatch(workId: string, rows: readonly BulkUploadRow[], expectedWorkRevision: number, signal?: AbortSignal): Promise<BulkImportResponse>
  exportManuscript(workId: string, query: ManuscriptExportQuery, signal?: AbortSignal): Promise<ManuscriptDownload>
}
