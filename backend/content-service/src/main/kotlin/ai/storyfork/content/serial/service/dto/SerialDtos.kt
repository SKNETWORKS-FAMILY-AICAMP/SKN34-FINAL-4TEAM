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

/** 선택지 하나다: 번호(1~4)·글·득표 수. */
data class SerialChoiceView(val id: String, val position: Int, val text: String, val votes: Int)

/** 독자에게 보이는 제안 글 하나다. 작성자 표시명은 응답마다 Core 닉네임을 조회해 채운다(없으면 탈퇴한 회원). [mine]은 내가 쓴 글, [likedByMe]는 내가 추천한 글이다. */
data class SerialProposalView(
    val id: String, val authorName: String, val kind: String, val title: String, val body: String, val simulation: SerialSimulationView?,
    val likes: Int, val likedByMe: Boolean, val mine: Boolean, val createdAt: Instant,
)

/**
 * 독자용 게시판이다. [enabled]는 AI 자율 집필 여부(화면의 '다음 회차' 탭 표시)다. [board]는 투표·제안을 받는 열린 게시판이며 없으면(마감·실행 중 포함) null이고, 그때 [choices]·[proposals]는 비어 있다.
 * [choices]는 번호순이고(아직 만들지 못했으면 빈 배열), [myChoiceId]는 로그인한 회원의 투표다. [proposals]는 숨기지 않은 글의 최신순 최대 200개이고, [summary]는 마지막으로 발행된 게시판의 종합 문장이다.
 */
data class SerialBoardResponse(
    val enabled: Boolean, val board: SerialBoardRef?, val choices: List<SerialChoiceView>, val myChoiceId: String?, val proposals: List<SerialProposalView>, val summary: String?,
)

data class SerialSimulationRequest(val premise: String = "", val beats: List<String> = emptyList())

/** 제안 글 제출이다. kind는 general·simulation이고 simulation은 시뮬레이션 글에만 보낸다. 값 검증은 [ai.storyfork.content.serial.domain.cleanProposal]이 한다. */
data class SerialProposalRequest(val kind: String = "", val title: String = "", val body: String = "", val simulation: SerialSimulationRequest? = null)

data class SerialVoteRequest(val choiceId: String = "")

data class SerialProposalCreated(val id: String)
