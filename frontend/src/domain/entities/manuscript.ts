/** 원고 가져오기·내보내기 계약(docs/design/manuscript-import-export-contract.md)의 화면용 타입이다. */
export type ManuscriptPreviewEpisode = { title: string; from: number; to: number; charCount: number; excerpt: string; imageCount: number; warnings: string[] }
export type ManuscriptPreview = { format: 'txt' | 'epub'; unit: 'line' | 'chapter'; unitCount: number; existingEpisodeCount: number; episodes: ManuscriptPreviewEpisode[] }
/** 화면에서 제목을 고치거나 제외한 미리보기 회차. */
export type AdjustableEpisode = ManuscriptPreviewEpisode & { excluded: boolean }
export type ManuscriptImportItem = { number: number; title: string; from: number; to: number }
export type ManuscriptImportStatus = 'created' | 'versioned' | 'partial' | 'failed'
export type ManuscriptImportResult = { number: number; title: string; status: ManuscriptImportStatus; reason: string | null; missingImages: number }
/** 가져오기가 회차를 저장한 뒤 서버가 같은 요청에서 시도한 세계관 추출 접수 결과다. 회차를 하나도 저장하지 않았으면 응답의 worldBuild는 null이다. */
export type ImportWorldBuild = { status: 'started' | 'rejected'; jobId: string | null; code: string | null; message: string | null }
export type ManuscriptImportSummary = { succeeded: number; failed: number; results: ManuscriptImportResult[]; worldBuild: ImportWorldBuild | null }
export type ManuscriptExportQuery = { format: 'txt' | 'epub'; source: 'draft' | 'published'; episode?: number }
export type ManuscriptDownload = { blob: Blob; filename: string }

export type BulkUploadRow = { file: File; number: number; title: string }
export type BulkImportBasis = { lastNumber: number; workRevision: number }
export type BulkImportResult =
  | { number: number; title: string; status: 'created' | 'versioned'; versionId: string; reason: null }
  | { number: number; title: string; status: 'failed'; versionId: null; reason: string }
export type BulkImportResponse = { workRevision: number; results: BulkImportResult[]; stopReason: string | null; worldBuild: ImportWorldBuild | null }
