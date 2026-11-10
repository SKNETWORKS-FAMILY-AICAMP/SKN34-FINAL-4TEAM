import type { ManuscriptDownload, ManuscriptExportQuery, ManuscriptImportItem, ManuscriptImportSummary, ManuscriptPreview } from '../entities/manuscript'

export interface ManuscriptRepository {
  preview(workId: string, file: File, signal?: AbortSignal): Promise<ManuscriptPreview>
  confirm(workId: string, file: File, rightsConfirmed: boolean, items: ManuscriptImportItem[], signal?: AbortSignal): Promise<ManuscriptImportSummary>
  exportManuscript(workId: string, query: ManuscriptExportQuery, signal?: AbortSignal): Promise<ManuscriptDownload>
}
