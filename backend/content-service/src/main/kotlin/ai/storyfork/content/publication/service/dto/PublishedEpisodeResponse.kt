package ai.storyfork.content.publication.service.dto


data class PublishedEpisodeResponse(val number: Int, val version: Int, val versionId: String, val title: String, val body: String, val inherited: Boolean = false, val authorNote: String = "",
    /** 운영이 제한한 회차다(상속 회차는 원작 회차의 제한을 따른다). 독자 경로는 [ai.storyfork.content.work.service.dto.WorkAccessResult.readerEpisodes]로 뺀다. */
    val restricted: Boolean = false)
