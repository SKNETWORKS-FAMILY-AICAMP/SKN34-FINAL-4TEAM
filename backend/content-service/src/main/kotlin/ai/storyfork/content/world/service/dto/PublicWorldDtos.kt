package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 소유자가 세계관의 공개 범위(private|public)와 장르(코드, 선택)를 바꾸는 요청이다. 값 오류는 422다. */
data class PublicationRequest(val visibility: String? = null, val genre: String? = null)

/** [listed]는 지금 공개 목록·상세에 실제로 나오는지다. 저장 버전이 없으면 공개로 설정돼도 false다. [publishedAt]은 비공개이면 null이다. */
data class PublicationResponse(val worldId: UUID, val visibility: String, val genre: String?, val publishedAt: String?, val listed: Boolean)

/** 공개 목록 한 줄. 이름·설명은 마지막 저장 버전, 카드·관계 수는 그 버전의 공개 카드와 그 카드끼리의 현재 관계 기준이고, [hasCover]면 `/{id}/cover`로 표지를 읽는다. */
data class PublicWorldSummaryResponse(
    val id: UUID, val name: String, val description: String, val genre: String?, val authorNickname: String,
    val cardCount: Int, val relationshipCount: Int, val publishedAt: String, val hasCover: Boolean = false,
)

data class PublicWorldPageResponse(val items: List<PublicWorldSummaryResponse>, val page: Int, val size: Int, val total: Long)

/** 공개 설정 카드. [id]는 카드 논리 ID이며 관계의 양 끝이 가리킨다. */
data class PublicWorldCardResponse(val id: UUID, val title: String, val text: String, val cardType: String, val aliases: List<String>, val tags: List<String>)

data class PublicWorldRelationshipResponse(val id: UUID, val sourceCardId: UUID, val targetCardId: UUID, val label: String)

/** 공개 세계관 상세. [relationshipStatus]가 unavailable이면 관계 저장소가 현재 상태를 보증하지 못해 [relationships]를 비운 것이다. [hasCover]면 `/{id}/cover`로 표지를 읽는다. */
data class PublicWorldResponse(
    val id: UUID, val name: String, val description: String, val genre: String?, val authorNickname: String,
    val publishedAt: String, val revisionNo: Long, val cards: List<PublicWorldCardResponse>,
    val relationships: List<PublicWorldRelationshipResponse>, val relationshipStatus: String, val hasCover: Boolean = false,
)

/** 독자 설정 위키의 카드. [revealFromEpisode]화부터 연결된 소설의 독자에게 보인다. */
data class ReaderWorldCardResponse(val id: UUID, val title: String, val text: String, val cardType: String, val aliases: List<String>, val tags: List<String>, val revealFromEpisode: Int)

/**
 * 소설 [workId]의 독자에게 [upto]화 기준으로 보이는 설정 카드와 그 카드끼리의 현재 관계다(DEC-46). 연결된 세계관이 없으면 [worldId]는 null이다.
 * [relationshipStatus]가 unavailable이면 관계 저장소가 현재 상태를 보증하지 못해 [relationships]를 비운 것이다.
 */
data class ReaderWorldCardsResponse(
    val workId: String, val worldId: UUID?, val upto: Int, val cards: List<ReaderWorldCardResponse> = emptyList(),
    val relationships: List<PublicWorldRelationshipResponse> = emptyList(), val relationshipStatus: String = "current",
)
