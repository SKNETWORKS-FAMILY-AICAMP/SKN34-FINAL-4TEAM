package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 목록은 관계 조회가 아니며 미완료·미전환 상태도 숨기지 않는다. */
data class WorldStudioSummaryResponse(val worldId:UUID,val name:String,val description:String,val draftRevision:Long,val relationshipStatus:String)
