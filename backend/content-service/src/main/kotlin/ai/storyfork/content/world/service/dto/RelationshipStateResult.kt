package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 저장소 내부 응답. 요청 hash는 HTTP 응답에 노출하지 않는다. version은 현재 상태 CAS 토큰이며 과거 조회 키가 아니다. */
data class RelationshipStateResult(val worldId:UUID,val version:Long,val key:String,val hash:String,val relationships:List<RelationshipPayload>)
