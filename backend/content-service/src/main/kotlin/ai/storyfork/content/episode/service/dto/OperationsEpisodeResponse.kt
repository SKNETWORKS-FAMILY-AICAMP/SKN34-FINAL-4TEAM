package ai.storyfork.content.episode.service.dto

/**
 * 운영 작품 상세의 회차 한 줄이다(본문 없음). [title]은 독자가 보는 발행 버전 제목이고 발행본이 없으면 초안 제목이다.
 * [restricted]는 운영 제한이고(상속 회차는 원작 회차의 제한을 따른다), [inherited]면 Fork가 원작에서 물려받은 회차라 여기서 직접 바꾸지 못한다.
 */
data class OperationsEpisodeResponse(val number: Int, val title: String, val publicationStatus: String, val restricted: Boolean, val inherited: Boolean)
