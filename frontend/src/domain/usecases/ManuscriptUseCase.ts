import type { AdjustableEpisode, BulkImportResponse, BulkImportResult, BulkUploadRow, ManuscriptExportQuery, ManuscriptImportItem, ManuscriptPreview } from '../entities/manuscript'
import type { ManuscriptRepository } from '../repositories/ManuscriptRepository'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MB = 1024 * 1024
const BODY_LIMIT = 40000
export const BULK_SELECTION_LIMIT = 1000
const BULK_BATCH_FILES = 20
const BULK_BATCH_BYTES = 50 * MB
const OVER_LIMIT = '본문이 40,000자를 넘어 등록할 수 없어요.'

function validateWork(workId: string) {
  if (!uuid.test(workId)) throw new Error('서버에 저장된 작품을 선택해 주세요.')
}
function validateManuscriptFile(file: File) {
  const kind = /\.(txt|epub)$/i.exec(file.name)?.[1].toLowerCase()
  if (!kind) throw new Error('.txt 또는 .epub 파일을 선택해 주세요.')
  if (!file.size) throw new Error('빈 파일은 올릴 수 없어요.')
  if (file.size > (kind === 'txt' ? 10 : 50) * MB) throw new Error(kind === 'txt' ? 'TXT는 10MB 이하만 올릴 수 있어요.' : 'EPUB은 50MB 이하만 올릴 수 있어요.')
}

export const adjustableEpisodes = (preview: ManuscriptPreview): AdjustableEpisode[] => preview.episodes.map((episode) => ({ ...episode, excluded: false }))

/** 인접한 두 회차를 하나로 합친다. 합친 본문의 정확한 글자 수는 서버만 알아서 합계로 어림한다. */
export function mergeWithNext(list: AdjustableEpisode[], index: number): AdjustableEpisode[] {
  const first = list[index], second = list[index + 1]
  if (!first || !second || first.excluded || second.excluded) return list
  const charCount = first.charCount + second.charCount
  const warnings = [...new Set([...first.warnings, ...second.warnings])]
  if (charCount > BODY_LIMIT && !warnings.includes(OVER_LIMIT)) warnings.push(OVER_LIMIT)
  const merged = { ...first, to: second.to, charCount, imageCount: first.imageCount + second.imageCount, warnings }
  return [...list.slice(0, index), merged, ...list.slice(index + 2)]
}

/** 회차 번호는 조정 목록의 순서(1부터)다. 제외한 회차는 보내지 않지만 번호는 차지한다. */
export const toImportItems = (list: AdjustableEpisode[]): ManuscriptImportItem[] =>
  list.flatMap((episode, index) => episode.excluded ? [] : [{ number: index + 1, title: episode.title.trim(), from: episode.from, to: episode.to }])

function splitIntoBatches(rows: readonly BulkUploadRow[]): BulkUploadRow[][] {
  const batches: BulkUploadRow[][] = []
  let batch: BulkUploadRow[] = []
  let bytes = 0
  for (const row of rows) {
    if (batch.length === BULK_BATCH_FILES || bytes + row.file.size > BULK_BATCH_BYTES) {
      batches.push(batch)
      batch = []
      bytes = 0
    }
    batch.push(row)
    bytes += row.file.size
  }
  if (batch.length) batches.push(batch)
  return batches
}

export class ManuscriptUseCase {
  private readonly repository: ManuscriptRepository
  constructor(repository: ManuscriptRepository) { this.repository = repository }
  async preview(workId: string, file: File, signal?: AbortSignal) {
    validateWork(workId)
    validateManuscriptFile(file)
    return this.repository.preview(workId, file, signal)
  }
  async confirm(workId: string, file: File, rightsConfirmed: boolean, episodes: AdjustableEpisode[], signal?: AbortSignal) {
    validateWork(workId)
    if (!rightsConfirmed) throw new Error('권리 확인 3가지에 모두 체크해 주세요.')
    const items = toImportItems(episodes)
    if (!items.length) throw new Error('등록할 회차를 하나 이상 남겨 주세요.')
    if (items.length > 300) throw new Error('한 번에 300회차까지 등록할 수 있어요.')
    if (items.some((item) => !item.title || item.title.length > 120)) throw new Error('회차 제목은 1~120자로 입력해 주세요.')
    return this.repository.confirm(workId, file, true, items, signal)
  }
  async bulkBasis(workId: string, signal?: AbortSignal) {
    validateWork(workId)
    return this.repository.bulkBasis(workId, signal)
  }
  async importBulk(
    workId: string, rows: readonly BulkUploadRow[], rightsConfirmed: boolean, previewRevision: number,
    onProgress: (results: readonly BulkImportResult[]) => void, signal?: AbortSignal,
  ): Promise<BulkImportResponse> {
    validateWork(workId)
    if (!rightsConfirmed) throw new Error('원고 등록 권리를 확인해 주세요.')
    if (rows.length < 1 || rows.length > BULK_SELECTION_LIMIT) {
      throw new Error('회차 파일은 한 번에 1~1,000개를 선택해 주세요.')
    }
    for (const [index, row] of rows.entries()) {
      validateManuscriptFile(row.file)
      if (!row.title.trim() || row.title.trim().length > 120) {
        throw new Error('회차 제목은 1~120자로 입력해 주세요.')
      }
      if (!Number.isInteger(row.number) || row.number < 1 || row.number > 2_147_483_647 ||
        (index > 0 && row.number <= rows[index - 1].number)) {
        throw new Error('회차 번호는 1 이상이고 중복 없이 오름차순이어야 해요.')
      }
    }

    let revision = previewRevision
    const results: BulkImportResult[] = []
    for (const batch of splitIntoBatches(rows)) {
      let response: BulkImportResponse
      try {
        signal?.throwIfAborted()
        response = await this.repository.importBulkBatch(workId, batch, revision, signal)
        if ((!response.stopReason && response.results.length !== batch.length) ||
          response.results.some((row, index) => row.number !== batch[index]?.number)) {
          throw new Error('파일별 처리 결과를 확인할 수 없어요.')
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : '응답을 받지 못했어요.'
        return {
          workRevision: revision, results,
          stopReason: `${batch[0].number}화부터 저장 결과를 확인해 주세요. ${detail}`,
        }
      }
      results.push(...response.results)
      revision = response.workRevision
      onProgress([...results])
      if (response.stopReason) return { workRevision: revision, results, stopReason: response.stopReason }
    }
    return { workRevision: revision, results, stopReason: null }
  }
  async exportManuscript(workId: string, query: ManuscriptExportQuery, signal?: AbortSignal) {
    validateWork(workId)
    if (query.episode !== undefined && (!Number.isSafeInteger(query.episode) || query.episode < 1)) throw new Error('내보낼 회차를 확인해 주세요.')
    return this.repository.exportManuscript(workId, query, signal)
  }
}
