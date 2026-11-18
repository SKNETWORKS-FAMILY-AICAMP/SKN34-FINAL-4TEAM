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
 * [rows](그 시점이어야 할 관계 전체)를 [edges](이 세계관의 모든 연결)와 비교해 새로 쓸 연결만 돌려준다. [episode]는 저장 회차다.
 * 관계마다 그 행의 회차([RelationEdge.fromEpisode], 자기 회차가 없으면 저장 회차)의 시점 값과 비교한다: 새로 생겼거나 끝점·내용이 바뀐 관계는 그 회차의 활성 연결로 쓰고
 * (같은 관계·같은 회차는 덮어쓴다) 그대로인 관계는 쓰지 않는다. rows에서 빠진 관계는 저장 회차에 옛 끝점을 가진 종료 연결로 쓴다(DEC-54: 종료는 관계별 회차를 따로 두지 않는다).
 */
internal fun episodeEdges(edges:List<RelationEdge>,rows:List<RelationEdge>,episode:Int):List<RelationEdge> {
    val asOf=mutableMapOf<Int,Map<UUID,RelationEdge>>()
    fun at(e:Int)=asOf.getOrPut(e) { relationsAsOf(edges,e).associateBy { it.relationId } }
    val changed=rows.filter { row -> at(row.fromEpisode)[row.relationId]?.let { it.source==row.source && it.target==row.target && it.payload==row.payload } != true }
    val wanted=rows.map { it.relationId }.toSet()
    val ended=at(episode).values.filter { it.relationId !in wanted }.map { it.copy(ended=true,payload=null,fromEpisode=episode) }
    return changed+ended
}

/**
 * [rows](저장 회차 시점이어야 할 관계 전체)를 [episode]화(없으면 마지막 연결 회차)에 저장한 뒤의 연결 전체다. 쓰지 않고 저장과 같은 규칙으로 계산만 한다:
 * 바뀐 관계만 자기 회차의 연결로 쓰고 빠진 관계는 종료 연결을 쓰며 같은 관계·같은 회차의 옛 연결은 덮어쓴다. 저장 회차보다 뒤 회차의 연결은 그대로라
 * 최신 시점([relationsAsOf]에 null)은 그것이 정한다. 저장하기 전에 저장 결과의 최신 시점을 검사하는 데 쓴다(「동일 인물」의 사슬·순환, #485).
 */
internal fun edgesAfterSave(edges:List<RelationEdge>,rows:List<RelationEdge>,episode:Int?):List<RelationEdge> {
    val changes=episodeEdges(edges,rows,saveEpisode(edges,episode))
    val rewritten=changes.map { it.relationId to it.fromEpisode }.toSet()
    return edges.filterNot { (it.relationId to it.fromEpisode) in rewritten }+changes
}

/**
 * [upto]화 시점(null이면 최신)에 있는 관계마다의 변화다(DEC-54): 그 시점의 연결과 보내는 카드·받는 카드가 같은 연속한 활성 연결을 회차 오름차순으로 담는다.
 * 마지막 종료 연결 앞이나 끝점이 달랐던 연결(같은 관계 id가 다른 카드로 옮겨지기 전의 옛 관계, 지금은 보이지 않는 카드일 수 있다)은 담지 않으므로
 * 이력의 모든 항목이 지금 보이는 두 카드 사이의 것이다. [upto] 뒤의 연결도 담지 않는다(공개 응답이 뒤 회차를 알리지 않게 서버가 거른다).
 * 그 시점에 끝나 있는 관계와 연결이 하나뿐(바뀐 적 없는) 관계는 없다. 같은 회차에 연결이 둘이면 뒤의 것만 남긴다.
 */
internal fun relationHistory(edges:List<RelationEdge>,upto:Int?):Map<UUID,List<RelationEdge>> =
    edges.filter { upto==null || it.fromEpisode<=upto }.groupBy { it.relationId }.mapNotNull { (id,all) ->
        val sorted=all.sortedBy { it.fromEpisode }
        val tip=sorted.last()
        if(tip.ended) return@mapNotNull null
        val run=sorted.takeLastWhile { !it.ended && it.source==tip.source && it.target==tip.target }.groupBy { it.fromEpisode }.map { it.value.last() }
        if(run.size>=2) id to run else null
    }.toMap()
