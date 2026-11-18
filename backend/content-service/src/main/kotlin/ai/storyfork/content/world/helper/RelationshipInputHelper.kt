package ai.storyfork.content.world.helper

import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID

/** 한 회차 시점의 관계 목록을 병합한다. removed는 이 목록에서 빠지며(저장소가 종료 연결로 기록) 연결은 두 카드 사이에만 있어 끝이 빈 활성 관계는 카드 확인에서 거절된다(DEC-51). */
object RelationshipInputHelper {
    /** 관계 유형: 구조·감정과, 같은 사람의 다른 이름 카드에서 본체 카드로 잇는 「동일 인물」(#485)이다. */
    private const val IDENTITY="identity"
    private val RELATION_CATEGORIES=setOf("structural","emotional",IDENTITY)

    fun merge(current:List<RelationshipPayload>,updates:List<RelationshipPayload>,replace:Boolean,cards:Set<UUID>):List<RelationshipPayload> {
        require(updates.size<=1000 && updates.map { it.id }.distinct().size==updates.size) { "관계 개수 또는 중복 ID를 확인하세요." }
        val result=if(replace) updates else (current.associateBy { it.id }+updates.associateBy { it.id }).values.toList()
        require(result.count { it.lifecycle=="active" }<=10000) { "관계는 10,000개까지 저장할 수 있습니다." }
        result.forEach {
            require(it.lifecycle=="removed" || it.sourceCardId in cards) { "관계의 시작 카드가 이 세계관에 없습니다." }
            require(it.lifecycle=="removed" || it.targetCardId in cards) { "관계의 대상 카드가 이 세계관에 없습니다." }
            require(it.sourceCardId==null || it.sourceCardId!=it.targetCardId) { "서로 다른 설정 카드를 선택하세요." }
            require(it.category==null || it.category in RELATION_CATEGORIES) { "관계 유형을 확인하세요." }
            require(it.direction==null || it.direction in setOf("directed","symmetric")) { "관계 방향을 확인하세요." }
            require(it.polarity==null || it.polarity in setOf("asserted","denied")) { "관계 극성을 확인하세요." }
            require(it.lifecycle in setOf("active","removed") && it.body.length<=3000 && it.label.length<=200) { "관계 내용의 길이와 상태를 확인하세요." }
        }
        return result.filter { it.lifecycle=="active" }
    }

    /**
     * 「동일 인물」(identity, 다른 이름 카드 → 본체 카드)의 저장 규칙 중 이번 저장이 하는 일을 본다(#485). [relations]는 저장 회차 시점의 관계 전체, [written]은 이번 저장이
     * 새로 쓰거나 바꾸거나 끝내는 관계(바뀌기 전 값과 끝내는 관계 포함), [cardTypes]는 이 세계관 카드의 유형이다.
     * identity를 새로 쓰거나 바꾸거나 끝내는 저장은 저장 회차를 정해야 한다: 생략하면 마지막 관계 회차가 대입돼 이미 공개된 이중 신분이 그 순간 드러날 수 있다.
     * 모든 identity는 방향이 있고(directed) 양 끝이 인물 카드여야 한다(부정 관계도 같다). 사슬·순환은 [validateIdentityLinks]가 저장 결과의 최신 시점으로 본다.
     */
    fun validateIdentity(relations:List<RelationshipPayload>,written:List<RelationshipPayload>,cardTypes:Map<UUID,String>,episode:Int?) {
        require(episode!=null || written.none { it.category==IDENTITY }) { "「동일 인물」 관계를 새로 쓰거나 바꾸거나 끝내려면 저장 회차를 정해야 합니다." }
        requireIdentityShape(relations,cardTypes)
    }

    private fun requireIdentityShape(relations:List<RelationshipPayload>,cardTypes:Map<UUID,String>) = relations.filter { it.category==IDENTITY }.forEach {
        require(it.direction=="directed") { "「동일 인물」은 다른 이름 카드에서 본체 카드로 잇는 방향 관계여야 합니다." }
        require(cardTypes[it.sourceCardId]=="character" && cardTypes[it.targetCardId]=="character") { "「동일 인물」은 인물 카드끼리만 이을 수 있습니다." }
    }

    /**
     * [latest]는 저장 결과의 최신 회차 시점 관계 전체다(중간 회차 시점의 사슬은 보지 않는다). 그 시점의 identity도 모양(방향·인물 끝점)을 같이 본다: 카드를 인물이 아닌 유형으로
     * 바꾸는 저장은 저장 회차에 보이지 않는 뒤 회차 identity의 끝점일 수 있다. 부정(denied) identity는 한 사람으로 묶는 데 쓰지 않으니 사슬 검사에서 빼고,
     * 한 카드는 다른 이름이거나 본체다(둘 다일 수 없다). 한 다른 이름 카드의 본체는 하나이고 본체 하나에 다른 이름 여럿은 허용한다.
     */
    fun validateIdentityLinks(latest:List<RelationshipPayload>,cardTypes:Map<UUID,String>) {
        requireIdentityShape(latest,cardTypes)
        val links=latest.filter { it.category==IDENTITY && it.polarity!="denied" }
        val others=links.map { it.sourceCardId }
        require(others.distinct().size==others.size) { "다른 이름 카드의 본체는 하나여야 합니다." }
        require(links.none { it.targetCardId in others }) { "본체가 다시 다른 카드의 다른 이름일 수 없습니다." }
    }

    fun validateSnapshot(relations:List<RelationshipPayload>,cards:Set<UUID>) {
        require(relations.map { it.id }.distinct().size==relations.size) { "중복된 관계입니다." }
        merge(relations,emptyList(),false,cards)
    }
}
