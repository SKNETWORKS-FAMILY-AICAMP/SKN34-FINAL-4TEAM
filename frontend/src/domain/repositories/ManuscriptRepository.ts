import type { BulkImportBasis, BulkImportResponse, BulkUploadRow, ManuscriptDownload, ManuscriptExportQuery, ManuscriptImportItem, ManuscriptImportSummary, ManuscriptPreview } from '../entities/manuscript'

export interface ManuscriptRepository {
  preview(workId: string, file: File, signal?: AbortSignal): Promise<ManuscriptPreview>
  confirm(workId: string, file: File, rightsConfirmed: boolean, items: ManuscriptImportItem[], signal?: AbortSignal): Promise<ManuscriptImportSummary>
  bulkBasis(workId: string, signal?: AbortSignal): Promise<BulkImportBasis>
  /** startWorldBuild가 true인 요청만 서버가 저장 뒤 세계관 추출 접수를 시도한다(false면 worldBuild는 null). */
  importBulkBatch(workId: string, rows: readonly BulkUploadRow[], expectedWorkRevision: number, startWorldBuild: boolean, signal?: AbortSignal): Promise<BulkImportResponse>
  exportManuscript(workId: string, query: ManuscriptExportQuery, signal?: AbortSignal): Promise<ManuscriptDownload>
}
