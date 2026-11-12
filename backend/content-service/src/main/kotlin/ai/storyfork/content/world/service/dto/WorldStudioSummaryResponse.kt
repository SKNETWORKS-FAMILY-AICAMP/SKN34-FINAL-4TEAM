package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 목록은 관계 조회가 아니며 미완료·미전환 상태도 숨기지 않는다. [visibility]·[genre]는 세계관 단위 공개 설정(DEC-45), [hasCover]는 소유자가 올린 표지가 있는지다. */
data class WorldStudioSummaryResponse(
    val worldId:UUID,val name:String,val description:String,val draftRevision:Long,val relationshipStatus:String,
    val visibility:String="private",val genre:String?=null,val hasCover:Boolean=false,
)
