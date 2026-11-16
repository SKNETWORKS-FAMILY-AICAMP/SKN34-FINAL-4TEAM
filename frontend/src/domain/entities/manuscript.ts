/** 원고 가져오기·내보내기 계약(docs/design/manuscript-import-export-contract.md)의 화면용 타입이다. */
export type ManuscriptPreviewEpisode = { title: string; from: number; to: number; charCount: number; excerpt: string; imageCount: number; warnings: string[] }
export type ManuscriptPreview = { format: 'txt' | 'epub'; unit: 'line' | 'chapter'; unitCount: number; existingEpisodeCount: number; episodes: ManuscriptPreviewEpisode[] }
/** 화면에서 제목을 고치거나 제외한 미리보기 회차. */
export type AdjustableEpisode = ManuscriptPreviewEpisode & { excluded: boolean }
export type ManuscriptImportItem = { number: number; title: string; from: number; to: number }
export type ManuscriptImportStatus = 'created' | 'versioned' | 'partial' | 'failed'
export type ManuscriptImportResult = { number: number; title: string; status: ManuscriptImportStatus; reason: string | null; missingImages: number }
export type ManuscriptImportSummary = { succeeded: number; failed: number; results: ManuscriptImportResult[] }
export type ManuscriptExportQuery = { format: 'txt' | 'epub'; source: 'draft' | 'published'; episode?: number }
export type ManuscriptDownload = { blob: Blob; filename: string }

export type BulkUploadRow = { file: File; number: number; title: string }
export type BulkImportBasis = { lastNumber: number; workRevision: number }
export type BulkImportResult =
  | { number: number; title: string; status: 'created' | 'versioned'; versionId: string; reason: null }
  | { number: number; title: string; status: 'failed'; versionId: null; reason: string }
export type BulkImportResponse = { workRevision: number; results: BulkImportResult[]; stopReason: string | null }
