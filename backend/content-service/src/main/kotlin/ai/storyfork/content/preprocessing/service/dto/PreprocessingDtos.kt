package ai.storyfork.content.preprocessing.service.dto

/**
 * 전처리 작업 상태 응답이다. 소유자 화면·AI 진행 보고 응답·운영 감시 목록이 같은 모양을 쓴다.
 * [error]는 실패한 작업의 고정 사유이고, 시각은 ISO-8601 UTC 문자열이다(접수만 됐으면 [startedAt]은 null).
 */
data class PreprocessingJobResponse(
    val id: String, val workId: String, val status: String, val done: Int, val total: Int,
    val failedEpisodes: List<Int>, val error: String?, val startedAt: String?, val finishedAt: String?,
    val recovery: String? = null,
    val build: ai.storyfork.content.world.service.dto.ManuscriptBuildResponse? = null,
)

/** 운영 감시용 목록(최신 접수 순)이다. [total]은 필터에 맞는 전체 건수다. */
data class PreprocessingJobListResponse(val items: List<PreprocessingJobResponse>, val total: Long)

/**
 * AI가 보내는 진행 보고다(전처리 MCP 도구 `preprocessing_progress`의 틀 단계 대체). [stage]는 extracting·resolving·organizing·loading,
 * [failed]는 작업을 실패로 끝낼 때의 고정 사유다.
 */
data class PreprocessingProgressRequest(
    val stage: String, val done: Int, val total: Int, val failedEpisodes: List<Int>, val failed: String? = null,
)
