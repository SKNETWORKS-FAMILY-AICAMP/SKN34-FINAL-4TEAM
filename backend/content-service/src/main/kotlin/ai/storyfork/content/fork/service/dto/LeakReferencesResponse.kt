package ai.storyfork.content.fork.service.dto

/**
 * 운영 정보 누설 비교 기준(DEC-55)이다. Fork가 아니면 [originWorkId]가 null이고 목록은 비어 있다.
 * [privateCardTitles]는 원작 세계관 카드 중 Fork 기준 회차에 독자에게 안 보이는 것(작가 전용·기준 회차 뒤)의 제목, [unpublishedEpisodeTitles]는 Fork 기준 회차 뒤 원작 회차의 제목이다.
 */
data class LeakReferencesResponse(
    val originWorkId: String?,
    val privateCardTitles: List<String>,
    val unpublishedEpisodeTitles: List<String>,
)
