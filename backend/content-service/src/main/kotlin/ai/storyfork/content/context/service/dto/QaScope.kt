package ai.storyfork.content.context.service.dto

/** Q&A 원고 근거 조회 키. 값은 조회 키일 뿐이며 권한·범위는 Content가 정본으로 다시 확정한다. 설정·관계 근거는 AI가 WorldStudio로 읽는다(#490). */
data class QaScopeRequest(val episode: Int? = null, val episodeVersionId: String = "")

/** Content가 확정한 읽기 범위. AI 요청·원고 검색은 이 범위 밖 자료를 넣지 않는다. */
data class QaScope(val workId: String, val sourceWorkId: String?, val episode: Int, val episodeVersionId: String,
    val episodes: List<QaEpisodeRef>)
data class QaEpisodeRef(val number: Int, val versionId: String)
