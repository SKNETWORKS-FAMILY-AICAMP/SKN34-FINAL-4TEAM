package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 소유자가 세계관의 공개 범위(private|public)와 장르(코드, 선택)를 바꾸는 요청이다. 값 오류는 422다. */
data class PublicationRequest(val visibility: String? = null, val genre: String? = null)

/** [listed]는 지금 공개 목록·상세에 실제로 나오는지다. 저장 버전이 없으면 공개로 설정돼도 false다. [publishedAt]은 비공개이면 null이다. */
data class PublicationResponse(val worldId: UUID, val visibility: String, val genre: String?, val publishedAt: String?, val listed: Boolean)

/** 공개 목록 한 줄. 이름·설명은 마지막 저장 버전, 카드·관계 수는 그 버전의 공개 카드와 그 카드끼리의 현재 관계 기준이고, [hasCover]면 `/{id}/cover`로 표지를 읽는다. */
data class PublicWorldSummaryResponse(
    val id: UUID, val name: String, val description: String, val genre: String?, val authorNickname: String,
    val cardCount: Int, val relationshipCount: Int?, val publishedAt: String, val hasCover: Boolean = false,
)

data class PublicWorldPageResponse(val items: List<PublicWorldSummaryResponse>, val page: Int, val size: Int, val total: Long)

/** 공개 설정 카드. [id]는 카드 논리 ID이며 관계의 양 끝이 가리킨다. [imageId]가 있으면 `/{세계관}/card-images/{imageId}`로 대표 이미지를 읽는다(#401, 없으면 null). */
data class PublicWorldCardResponse(val id: UUID, val title: String, val text: String, val cardType: String, val aliases: List<String>, val tags: List<String>, val imageId: UUID? = null)

data class PublicWorldRelationshipResponse(val id: UUID, val sourceCardId: UUID, val targetCardId: UUID, val label: String,
    val category: String? = null, val body: String = "", val direction: String? = null, val polarity: String? = null)

/** 세계관에 연결된 공개 소설의 최소 정보(#329)다. [id]는 작품 ID이고 [hasCover]면 `/api/v1/public/works/{id}/cover/content`로 표지를 읽는다. */
data class PublicWorldLinkedWorkResponse(val id: String, val title: String, val authorNickname: String, val hasCover: Boolean)

/**
 * 공개 세계관 상세. [relationshipStatus]가 unavailable이면 관계 저장소가 현재 상태를 보증하지 못해 [relationships]를 비운 것이다. [hasCover]면 `/{id}/cover`로 표지를 읽는다.
 * [linkedWork]는 이 세계관에 연결된 소설(1:1, DEC-46)이 **공개 작품일 때만** 채우고, 비공개·제한·삭제 작품이거나 연결이 없으면 null이다(존재를 드러내지 않는다, #329).
 */
data class PublicWorldResponse(
    val id: UUID, val name: String, val description: String, val genre: String?, val authorNickname: String,
    val publishedAt: String, val revisionNo: Long, val cards: List<PublicWorldCardResponse>,
    val relationships: List<PublicWorldRelationshipResponse>, val relationshipStatus: String, val hasCover: Boolean = false,
    val linkedWork: PublicWorldLinkedWorkResponse? = null,
)

/** 독자 설정 위키의 카드. [revealFromEpisode]화부터 연결된 소설의 독자에게 보인다. [imageId]가 있으면 `/public/works/{작품}/world-card-images/{imageId}?upto=N`로 대표 이미지를 읽는다(#401, 없으면 null). */
data class ReaderWorldCardResponse(val id: UUID, val title: String, val text: String, val cardType: String, val aliases: List<String>, val tags: List<String>, val revealFromEpisode: Int, val imageId: UUID? = null)

/**
 * Fork [workId]가 자기 세계관 없이 이어받는 원작 세계관이다(읽기 전용, DEC-32·37, #365). [upto]화까지 독자 공개된 공개 카드와 그 카드끼리의 [upto]화 시점 관계만 담는다.
 * 모양은 `world_studio_read`의 카드·관계와 같지만 작가용 값(인물 문서·가져온 출처·이미지·카드 메타데이터, 관계 본문·메모)은 비운다.
 * 이어받는 세계관이 없으면 [worldId]는 null이다. [relationshipStatus]가 unavailable이면 관계 저장소가 그 시점 상태를 보증하지 못해 [relationships]를 비운 것이다.
 * [relationshipVersion]은 그때 관계 graph token이다.
 */
data class InheritedWorldResponse(
    val workId: String, val worldId: UUID?, val upto: Int, val cards: List<CardPayload> = emptyList(),
    val relationships: List<RelationshipPayload> = emptyList(), val relationshipStatus: String = "current", val relationshipVersion: Long = 0,
)

/**
 * 소설 [workId]의 독자에게 [upto]화 기준으로 보이는 설정 카드와 그 카드끼리의 현재 관계다(DEC-46). 연결된 세계관이 없으면 [worldId]는 null이다.
 * [relationshipStatus]가 unavailable이면 관계 저장소가 현재 상태를 보증하지 못해 [relationships]를 비운 것이다.
 */
data class ReaderWorldCardsResponse(
    val workId: String, val worldId: UUID?, val upto: Int, val cards: List<ReaderWorldCardResponse> = emptyList(),
    val relationships: List<PublicWorldRelationshipResponse> = emptyList(), val relationshipStatus: String = "current",
)
