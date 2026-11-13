package ai.storyfork.content.writingai.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import tools.jackson.databind.JsonNode

/**
 * 집필 AI 자유 입력 요청. 새 턴은 request, 멈춘 실행을 이어갈 때는 같은 threadId와 resume 하나만 보낸다.
 * episode·episodeVersionId·target은 Q&A 근거 조회 범위이며 Content가 서명 토큰으로만 AI에 넘긴다.
 */
data class WritingAiRequest(
    @field:Size(min=1, max=2000) val request: String? = null,
    @field:Valid val resume: WritingAiResume? = null,
    @field:Size(max=40) val operation: String? = null,
    @field:Min(1) val episode: Int,
    @field:NotBlank @field:Size(max=100) val episodeVersionId: String,
    val target: String = "manuscript",
    @field:Size(max=100) val threadId: String? = null,
    val consent: Boolean = false,
)

data class WritingAiResume(val approved: Boolean)

/** result는 AI 오케스트레이션 응답(계획·단계별 원본 결과·상태·runId)을 그대로 담는다. */
data class WritingAiResponse(val threadId: String, val result: JsonNode)
