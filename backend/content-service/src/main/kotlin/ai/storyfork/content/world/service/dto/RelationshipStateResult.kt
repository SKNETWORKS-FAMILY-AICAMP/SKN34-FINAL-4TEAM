package ai.storyfork.content.world.service.dto

import java.util.UUID

/** 관계 한 건의 한 회차 값이다(DEC-54): [episode]화부터 [label]·[body]로 바뀌었다. */
data class RelationshipChange(val episode:Int,val label:String,val body:String)

/**
 * 저장소 내부 응답. 요청 hash는 HTTP 응답에 노출하지 않는다. version은 현재 상태 CAS 토큰이며 과거 조회 키가 아니다.
 * [episodes]는 관계 id → 그 시점 관계가 시작된 회차(가장 최근 연결의 fromEpisode)이고, [history]는 관계 id → 시점까지의 변화(회차 오름차순, 바뀐 적 없는 관계는 없음)다.
 */
data class RelationshipStateResult(val worldId:UUID,val version:Long,val key:String,val hash:String,val relationships:List<RelationshipPayload>,
    val episodes:Map<UUID,Int> = emptyMap(),val history:Map<UUID,List<RelationshipChange>> = emptyMap())
