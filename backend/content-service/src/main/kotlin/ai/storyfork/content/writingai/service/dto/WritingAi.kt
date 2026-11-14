package ai.storyfork.content.writingai.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import tools.jackson.databind.JsonNode

/**
 * 집필 AI 자유 입력 요청. 새 턴은 request, 멈춘 실행을 이어갈 때는 같은 threadId와 resume 하나만 보낸다.
 * episode·episodeVersionId·target은 Q&A 근거 조회 범위이며 Content가 서명 토큰으로만 AI에 넘긴다.
 * simulation은 [시뮬레이션] 버튼의 시작 양식이며 operation이 character_simulation인 새 요청에서만 받는다.
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
    @field:Valid val simulation: WritingAiSimulation? = null,
)

/**
 * [시뮬레이션] 버튼의 시작 양식. 형식·길이·개수만 확인해 AI로 그대로 넘긴다. 인물이 연결 세계관의 활성 인물 카드인지와
 * 모드별 필수값(IF 전제·흐름 비트)은 AI가 세계관으로 확인한다. 비트·인물 id 하나하나의 길이는 [WritingAiService]가 확인한다.
 */
data class WritingAiSimulation(
    @field:Pattern(regexp = "if|flow") val mode: String,
    @field:Size(max = 500) val premise: String? = null,
    @field:Size(max = 8) val beats: List<String>? = null,
    @field:Size(min = 1, max = 6) val characterIds: List<String>,
)

/** inputs는 AI가 입력 대기로 멈췄을 때 작가가 채운 단계 입력(예: web_research.question)이며 AI가 계약으로 검증한다. */
data class WritingAiResume(val approved: Boolean, val inputs: JsonNode? = null)

/** result는 AI 오케스트레이션 응답(계획·단계별 원본 결과·상태·runId)을 그대로 담는다. */
data class WritingAiResponse(val threadId: String, val result: JsonNode)

data class ChatSessionCreated(val threadId: String)

data class ChatRename(@field:NotBlank @field:Size(max=100) val title: String)
