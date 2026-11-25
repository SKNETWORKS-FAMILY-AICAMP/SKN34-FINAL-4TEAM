import { DatasetInvalid, datasetLimitError, isJsonlFile, parseDatasetJsonl } from '../entities/llmDatasets'
import { OperationsError, orNullIfForbidden } from '../entities/operations'
import type { LlmDatasetRepository } from '../repositories/LlmDatasetRepository'

const invalid = (message: string): never => { throw new OperationsError(message) }

/** 평가 데이터셋 조회·업로드(#868). 서버가 다시 검사하므로 사람이 곧바로 고칠 수 있는 입력 오류만 먼저 알립니다. */
export class LlmDatasetUseCase {
  private readonly repository: LlmDatasetRepository
  constructor(repository: LlmDatasetRepository) { this.repository = repository }

  // 조회는 권한(llm)이 없으면(403) 실패가 아니라 null이라 화면이 다시 불러오기 대신 필요한 권한을 안내합니다.
  datasets() { return orNullIfForbidden(this.repository.datasets()) }
  items(name: string, page: number) { return orNullIfForbidden(this.repository.items(name, page)) }

  /**
   * 검사를 통과한 파일만 올립니다. 서버와 같은 순서로 값싼 것부터 봅니다: 저작권 확인 → 크기 제한(500줄·2MB) → 문항 없음 → 형식이 틀린 줄(전부 아니면 무: 하나라도 틀리면 그 줄 목록과 함께 막음).
   * 저작권 있는 원문이 아니라는 확인은 데이터가 Langfuse에 저장되기 때문에 필수입니다. 서버가 만든 문항 수를 돌려줍니다.
   */
  async upload(name: string, fileName: string, text: string, copyrightConfirmed: boolean) {
    const setName = name.trim()
    if (!setName) invalid('올릴 세트를 골라 주세요.')
    if (!isJsonlFile(fileName)) invalid('.jsonl 파일만 올릴 수 있어요.')
    if (!copyrightConfirmed) invalid('저작권 있는 원문(웹소설·해리 포터 등)이 아님을 확인해 주세요.')
    const { total, errors } = parseDatasetJsonl(text)
    const tooBig = datasetLimitError(total, new TextEncoder().encode(text).length)
    if (tooBig) invalid(tooBig)
    if (!total) invalid('올릴 문항이 없어요.')
    if (errors.length) throw new DatasetInvalid(errors)
    return this.repository.upload(setName, fileName, text, true)
  }
}
