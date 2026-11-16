package ai.storyfork.content.context.service.dto

import java.util.UUID

/** Q&A 입력. 값은 조회 키일 뿐이며 권한·범위는 Content가 정본으로 다시 확정한다. target은 manuscript 또는 relationship이다. */
data class QaScopeRequest(val episode: Int? = null, val episodeVersionId: String = "", val target: String = "", val relationshipAt: String = "current")

/** Content가 확정한 읽기 범위. AI 요청·원고 검색은 이 범위 밖 자료를 넣지 않는다. */
data class QaScope(val workId: String, val sourceWorkId: String?, val episode: Int, val episodeVersionId: String,
    val episodes: List<QaEpisodeRef>, val world: QaWorldRef?)
data class QaEpisodeRef(val number: Int, val versionId: String)
/** 연결 세계관과 확인 시점의 현재 관계 graph token. 관계를 읽을 때 같은 token인지 다시 확인한다. */
data class QaWorldRef(val worldId: UUID, val relationshipVersion: Long)
