package ai.storyfork.content.work.service.dto

import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse

data class WorkAccessResult(val id: String, val ownerId: String, val title: String, val summary: String, val revision: Int, val worldId: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?, val restricted: Boolean = false, val deleted: Boolean = false) {
    fun publiclyVisible() = visibility=="public" && !restricted && !deleted
    /** 원작이 삭제된 Fork의 독자에게는 분기 전(상속) 회차의 본문을 숨긴다. 회차 번호·제목·버전은 그대로 둬 번호가 어긋나지 않는다. */
    fun readerEpisodes(items: List<PublishedEpisodeResponse>) =
        if(source?.deleted==true) items.map {if(it.inherited) it.copy(body="") else it} else items
}
