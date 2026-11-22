package ai.storyfork.content.writingai.service.dto

import jakarta.validation.Valid
import jakarta.validation.constraints.AssertTrue
import jakarta.validation.constraints.Min
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Pattern
import jakarta.validation.constraints.Size
import tools.jackson.databind.JsonNode

/**
 * 집필 AI 자유 입력 요청. 새 턴은 request, 멈춘 실행을 이어갈 때는 같은 threadId와 resume 하나만 보낸다.
 * episode·episodeVersionId는 새 턴의 근거 회차·판본이다. 이어가기에서는 무시하고 AI가 저장한 멈춘 턴의 값을 쓴다(#668).
 * targetEpisode는 AI가 승인 뒤 초안을 쓸 회차다(작가가 연 회차, 발행 전 초안이어도 된다). 없으면 episode와 같고, 있으면 episode 이상이어야
 * 하며 그 작품의 활성 회차여야 한다. 근거 회차(episode)는 그대로 지식 상한이다. 새 요청에서만 쓰고 이어가기에서는 무시한다.
 * simulation은 [시뮬레이션] 버튼의 시작 양식이며 operation이 character_simulation인 새 요청에서만 받는다.
 * attachments는 이번 새 요청에 붙인 이미지·텍스트 파일(#617, Base64)이다. 새 요청에서만 받고 이어가기와 함께 오면 422다. 개수·형식·Base64 길이만 확인해
 * AI로 그대로 넘기고 디코딩·정확한 크기·UTF-8은 AI가 확인한다.
 * page는 작가가 지금 보는 화면과 그 내용(#554)이다. 새 요청에서만 쓰고 이어가기에서는 무시한다. 길이·형식은 DTO가, 권한(회차·세계관·카드)은
 * [ai.storyfork.content.writingai.service.WritingAiService]가 사용자 기준으로 다시 확인한 뒤 AI에 그대로 싣는다.
 */
data class WritingAiRequest(
    @field:Size(min=1, max=2000) val request: String? = null,
    @field:Valid val resume: WritingAiResume? = null,
    @field:Size(max=40) val operation: String? = null,
    @field:Min(1) val episode: Int,
    @field:NotBlank @field:Size(max=100) val episodeVersionId: String,
    @field:Size(max=100) val threadId: String? = null,
    @field:Valid val simulation: WritingAiSimulation? = null,
    val targetEpisode: Int? = null,
    @field:Valid val page: WritingAiPage? = null,
    @field:Valid @field:Size(max = 3) val attachments: List<WritingAiAttachment>? = null,
)

/** 채팅 첨부 하나. data는 Base64이고 최대 길이는 5MB를 Base64로 바꾼 길이(AI의 이미지 5MB 한도)다. GIF는 받지 않는다. */
data class WritingAiAttachment(
    @field:Size(min = 1, max = 200) val name: String,
    @field:Pattern(regexp = "image/png|image/jpeg|image/webp|text/plain|text/markdown") val mediaType: String,
    @field:NotBlank @field:Size(max = 6_990_508) val data: String,
)

/**
 * 작가가 지금 보는 화면. path는 표시용이며 인가에 쓰지 않는다. studio는 episode, world는 worldId·cardId·view를 쓴다.
 * selection은 편집기에서 고른 글(부분 수정 selection 상한과 같다)이고 content는 저장하지 않은 편집 내용이다.
 */
data class WritingAiPage(
    @field:NotBlank @field:Size(max = 300) val path: String,
    @field:Pattern(regexp = "studio|world") val kind: String,
    @field:Min(1) val episode: Int? = null,
    @field:Size(max = 100) val worldId: String? = null,
    @field:Size(max = 100) val cardId: String? = null,
    @field:Size(max = 40) val view: String? = null,
    @field:Size(min = 1, max = 5000) val selection: String? = null,
    @field:Valid val content: WritingAiPageContent? = null,
)

/** 저장하지 않은 편집 내용. 카드 본문은 3,000자 이하라 통째로, 회차 원고는 화면이 10,000자까지만 보내고 넘으면 truncated를 붙인다. */
data class WritingAiPageContent(
    @field:Size(max = 300) val title: String? = null,
    @field:Size(max = 10000) val body: String,
    @field:AssertTrue val unsaved: Boolean,
    val truncated: Boolean? = null,
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

/**
 * inputs는 AI가 입력 대기로 멈췄을 때 작가가 채운 단계 입력(예: research.question)이며 AI가 계약으로 검증한다.
 * writing_editing만 Content가 먼저 확인한다: span은 patch로 바꾸고, 직접 보낸 patch와 멈춘 턴의 반영 회차가 아니거나 context가 있는 draft는 422다(#668).
 * scene은 시뮬레이션 무대의 장면 조작이다. scene이 있으면 AI는 approved를 적용하지 않고 장면을 처리한 뒤 다시 멈춘다.
 * refresh는 Content 쓰기 승인 대기에서 오래된 제안 대신 새 제안을 받는 답이며(#662) approved=false와만 함께 온다.
 */
data class WritingAiResume(
    val approved: Boolean,
    val inputs: JsonNode? = null,
    @field:Valid val scene: WritingAiScene? = null,
    val refresh: Boolean? = null,
)

/** 무대의 장면 조작(next·edit·redo·stop). 형식·길이만 확인해 AI로 그대로 넘기고, 조작별 필수 필드(edit의 turn·text 등)는 AI가 확인한다. */
data class WritingAiScene(
    @field:Pattern(regexp = "next|edit|redo|stop") val action: String,
    @field:Min(0) val turn: Int? = null,
    @field:Size(max = 2000) val text: String? = null,
    @field:Size(max = 300) val note: String? = null,
)

/** result는 AI 오케스트레이션 응답(계획·단계별 원본 결과·상태·runId)을 그대로 담는다. */
data class WritingAiResponse(val threadId: String, val result: JsonNode)

data class ChatSessionCreated(val threadId: String)

data class ChatRename(@field:NotBlank @field:Size(max=100) val title: String)
