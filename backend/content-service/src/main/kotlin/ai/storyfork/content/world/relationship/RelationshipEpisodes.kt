package ai.storyfork.content.world.relationship

import ai.storyfork.content.world.domain.WorldStudioFailure
import java.util.UUID

/**
 * 관계가 바뀐 회차마다 두 카드 사이에 하나씩 쌓이는 연결이다(DEC-51). 같은 [relationId]의 연결들이 한 관계의 회차별 값이다.
 * 종료 연결([ended])은 그 회차부터 관계가 없음을 뜻하며 [payload]가 없다. [payload]는 `RelationshipPayload`의 JSON이다.
 */
internal data class RelationEdge(val relationId:UUID,val fromEpisode:Int,val ended:Boolean,val source:UUID,val target:UUID,val payload:String?)

/**
 * [upto]화 시점의 관계다: 관계마다 [upto] 이하의 가장 최근 연결 하나를 고르고 종료 연결이면 뺀다. [upto]가 null이면 회차 제한이 없다(최신).
 * 같은 관계·같은 회차의 가장 최근 연결이 둘이면 손상이므로 불일치로 알린다.
 */
internal fun relationsAsOf(edges:List<RelationEdge>,upto:Int?):List<RelationEdge> =
    edges.filter { upto==null || it.fromEpisode<=upto }.groupBy { it.relationId }.values.mapNotNull { history ->
        val latest=history.maxOf { it.fromEpisode }
        val tip=history.filter { it.fromEpisode==latest }.singleOrNull() ?: throw WorldStudioFailure.mismatch()
        tip.takeUnless { it.ended }
    }

/** 저장 회차다: 요청한 회차, 없으면 이 세계관의 마지막 연결 회차(종료 연결 포함), 연결이 하나도 없으면 1화다. */
internal fun saveEpisode(edges:List<RelationEdge>,episode:Int?):Int = episode ?: edges.maxOfOrNull { it.fromEpisode } ?: 1

/**
 * [current](저장 회차 시점의 관계)와 [rows](그 시점이어야 할 관계 전체)를 비교해 [episode]화에 새로 쓸 연결만 돌려준다.
 * 새로 생겼거나 끝점·내용이 바뀐 관계는 활성 연결로, rows에서 빠진 관계는 옛 끝점을 가진 종료 연결로 쓰며 그대로인 관계는 쓰지 않는다.
 */
internal fun episodeEdges(current:List<RelationEdge>,rows:List<RelationEdge>,episode:Int):List<RelationEdge> {
    val now=current.associateBy { it.relationId }
    val changed=rows.filter { row -> now[row.relationId]?.let { it.source==row.source && it.target==row.target && it.payload==row.payload } != true }
    val wanted=rows.map { it.relationId }.toSet()
    val ended=current.filter { it.relationId !in wanted }.map { it.copy(ended=true,payload=null) }
    return (changed+ended).map { it.copy(fromEpisode=episode) }
}
