import { isJsonlFile, parseDatasetJsonl } from '../entities/llmDatasets'
import { OperationsError, orNullIfForbidden } from '../entities/operations'
import type { LlmDatasetRepository } from '../repositories/LlmDatasetRepository'

const invalid = (message: string): never => { throw new OperationsError(message) }

/** 평가 데이터셋 조회·업로드(#857, 서버 API 예정). 서버가 다시 검사하므로 사람이 곧바로 고칠 수 있는 입력 오류만 먼저 알립니다. */
export class LlmDatasetUseCase {
  private readonly repository: LlmDatasetRepository
  constructor(repository: LlmDatasetRepository) { this.repository = repository }

  // 조회는 권한(llm)이 없으면(403) 실패가 아니라 null이라 화면이 다시 불러오기 대신 필요한 권한을 안내합니다.
  datasets() { return orNullIfForbidden(this.repository.datasets()) }
  items(name: string) { return orNullIfForbidden(this.repository.items(name)) }

  /** 검사를 통과한 파일만 올립니다: 형식이 틀린 줄이 하나라도 있으면 일부만 올리지 않습니다. 저작권 있는 원문이 아니라는 확인은 데이터가 Langfuse에 저장되기 때문에 필수입니다. */
  async upload(name: string, fileName: string, text: string, notCopyrighted: boolean) {
    const setName = name.trim()
    if (!setName) invalid('세트 이름을 입력해 주세요.')
    if (!isJsonlFile(fileName)) invalid('.jsonl 파일만 올릴 수 있어요.')
    if (!notCopyrighted) invalid('저작권 있는 원문(웹소설·해리 포터 등)이 아님을 확인해 주세요.')
    const { items, errors } = parseDatasetJsonl(text)
    if (errors.length) invalid(`형식이 맞지 않는 줄이 ${errors.length}개 있어요. 고친 뒤 다시 올려 주세요.`)
    if (!items.length) invalid('올릴 문항이 없어요.')
    return this.repository.upload(setName, fileName, items)
  }
}
