import type { DatasetItem, EvalDataset } from '../entities/llmDatasets'

/**
 * 평가 데이터셋 API 계약(#857, 예정 — 서버 API는 아직 없고 메모리 구현만 있다).
 * 예정 경로: GET /llmops/datasets · GET /llmops/datasets/{name}/items · POST /llmops/datasets/{name}/items(JSONL 파일 업로드, Langfuse Dataset 연동).
 * 계약 문서: docs/design/operations-llmops-contract.md '평가 데이터셋(예정)'.
 */
export interface LlmDatasetRepository {
  datasets(): Promise<EvalDataset[]>
  /** 한 세트의 문항(저장 순서). */
  items(name: string): Promise<DatasetItem[]>
  /** 검사를 통과한 문항을 그 이름의 세트에 올립니다(없으면 만들고, 같은 id는 덮어씁니다). */
  upload(name: string, fileName: string, items: DatasetItem[]): Promise<void>
}
