package ai.storyfork.content.episode.service.dto

/** 회차 체크포인트(DEC-43)는 발행본이다. versionId는 저장 버전의 contentVersionId, active는 현재 독자에게 공개 중인 항목이다. */
data class EpisodeCheckpointResponse(val versionId: String, val publishedAt: String, val active: Boolean)
