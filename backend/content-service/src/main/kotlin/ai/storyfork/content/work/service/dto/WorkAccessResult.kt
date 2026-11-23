package ai.storyfork.content.work.service.dto

import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse

data class WorkAccessResult(val id: String, val ownerId: String, val title: String, val summary: String, val revision: Int, val worldId: String, val visibility: String, val allowFork: Boolean, val allowForkPublication: Boolean, val source: SourceResponse?, val restricted: Boolean = false, val deleted: Boolean = false) {
    fun publiclyVisible() = visibility=="public" && !restricted && !deleted
    /**
     * 독자에게 보이는 회차다(독자 쪽 목록·이미지·맥락의 한 곳). 운영이 제한한 회차(원작 회차의 제한을 물려받은 Fork 회차 포함)는 뺀다.
     * 원작이 삭제된 Fork의 독자에게는 분기 전(상속) 회차의 본문을 숨긴다. 회차 번호·제목·버전은 그대로 둬 번호가 어긋나지 않는다.
     */
    fun readerEpisodes(items: List<PublishedEpisodeResponse>) =
        items.filterNot {it.restricted}.let {shown -> if(source?.deleted==true) shown.map {if(it.inherited) it.copy(body="") else it} else shown}
}
