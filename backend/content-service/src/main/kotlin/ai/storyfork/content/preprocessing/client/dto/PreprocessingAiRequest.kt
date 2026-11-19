package ai.storyfork.content.preprocessing.client.dto

/** AI `POST /internal/v1/preprocessing/jobs` 요청 본문이다(docs/design/manuscript-preprocessing-contract.md 실행 계약). 같은 jobId 재접수는 실패 회차만 담는다. */
data class PreprocessingAiRequest(val jobId: String, val workId: String, val episodes: List<Int>)
