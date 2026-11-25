import type { DatasetItem, EvalDataset } from '../entities/llmDatasets'
import type { OperationsPage } from '../entities/operations'

/**
 * 평가 데이터셋 API 계약(#868, 운영 서비스 LlmopsController와 같은 접두사·권한 llm): GET /llmops/datasets · GET /llmops/datasets/{name}/items?page&size ·
 * POST /llmops/datasets/{name}/items(multipart file=.jsonl + copyrightConfirmed). Langfuse Dataset을 읽고 올린다.
 */
export interface LlmDatasetRepository {
  datasets(): Promise<EvalDataset[]>
  /** 한 세트의 문항(쪽은 0부터, 한 쪽 20개). */
  items(name: string, page: number): Promise<OperationsPage<DatasetItem>>
  /**
   * .jsonl 본문을 있는 세트에 올립니다(새 세트 만들기는 범위 밖이라 없는 세트는 404). 전부 아니면 무: 틀린 줄이 하나라도 있으면 DatasetInvalid이고 아무것도 만들지 않습니다.
   * 서버가 만든 문항 수를 돌려줍니다.
   */
  upload(name: string, fileName: string, text: string, copyrightConfirmed: boolean): Promise<number>
}
