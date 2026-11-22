package ai.storyfork.content.serial.service.dto

import java.time.Instant

/** 소유자의 자율 연재 설정 요청이다. days는 MON~SUN(대문자, 1~7개), time은 KST의 HH:mm, direction은 2,000자 이내다. enabled는 받지 않고 무시한다(켜기·끄기는 운영 설정의 집필 방식 autonomous). 값 검증은 [ai.storyfork.content.serial.domain.cleanSettings]가 한다. */
data class SerialSettingsRequest(val enabled: Boolean = false, val days: List<String> = emptyList(), val time: String = "21:00", val direction: String = "")

data class SerialSettingsResponse(val enabled: Boolean, val days: List<String>, val time: String, val direction: String)

/** 소유자 기록 한 줄이다. 시각은 UTC ISO-8601이고 없는 값은 null이다. */
data class SerialBoardRecord(
    val id: String, val episodeNumber: Int, val status: String, val publishedEpisodeNumber: Int?, val failureReason: String?, val closedAt: Instant?,
)

data class SerialBoardRef(val id: String, val episodeNumber: Int)

data class SerialSimulationView(val premise: String, val beats: List<String>, val scene: String?)

/** 독자에게 보이는 의견 하나다. 작성자 표시명은 응답마다 Core 닉네임을 조회해 채운다(없으면 탈퇴한 회원). */
data class SerialOpinionView(
    val id: String, val authorName: String, val kind: String, val body: String, val simulation: SerialSimulationView?, val votes: Int, val createdAt: Instant,
)

/**
 * 독자용 게시판이다. [board]는 의견을 받는 열린 게시판이며 없으면(마감·실행 중 포함) null이다. [opinions]는 득표순(동률은 먼저 쓴 순)이고 숨긴 의견은 없다.
 * [myOpinionId]·[myVoteOpinionId]는 로그인한 회원의 의견과 투표이고(숨겨진 의견의 투표는 null), [summary]는 마지막으로 발행된 게시판의 종합 문장이다.
 */
data class SerialBoardResponse(val board: SerialBoardRef?, val opinions: List<SerialOpinionView>, val myOpinionId: String?, val myVoteOpinionId: String?, val summary: String?)

data class SerialSimulationRequest(val premise: String = "", val beats: List<String> = emptyList())

/** 의견 제출이다. kind는 general·simulation이고 simulation은 시뮬레이션 의견에만 보낸다. 값 검증은 [ai.storyfork.content.serial.domain.cleanOpinion]이 한다. */
data class SerialOpinionRequest(val kind: String = "", val body: String = "", val simulation: SerialSimulationRequest? = null)

data class SerialVoteRequest(val opinionId: String = "")

data class SerialOpinionCreated(val id: String)
