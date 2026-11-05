package ai.storyfork.content.world.helper

import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID

/** 현재 관계만 병합한다. removed는 현재 상태에서 제거하며 과거 관계를 만들지 않는다. */
object RelationshipInputHelper {
    fun merge(current:List<RelationshipPayload>,updates:List<RelationshipPayload>,replace:Boolean,cards:Set<UUID>):List<RelationshipPayload> {
        require(updates.size<=1000 && updates.map { it.id }.distinct().size==updates.size) { "관계 개수 또는 중복 ID를 확인하세요." }
        val result=if(replace) updates else (current.associateBy { it.id }+updates.associateBy { it.id }).values.toList()
        require(result.size<=1000) { "관계는 1,000개까지 저장할 수 있습니다." }
        result.forEach {
            require(it.lifecycle=="removed" || it.sourceCardId==null || it.sourceCardId in cards) { "관계의 시작 카드가 이 세계관에 없습니다." }
            require(it.lifecycle=="removed" || it.targetCardId==null || it.targetCardId in cards) { "관계의 대상 카드가 이 세계관에 없습니다." }
            require(it.sourceCardId==null || it.sourceCardId!=it.targetCardId) { "서로 다른 설정 카드를 선택하세요." }
            require(it.category==null || it.category in setOf("structural","emotional")) { "관계 유형을 확인하세요." }
            require(it.direction==null || it.direction in setOf("directed","symmetric")) { "관계 방향을 확인하세요." }
            require(it.polarity==null || it.polarity in setOf("asserted","denied")) { "관계 극성을 확인하세요." }
            require(it.lifecycle in setOf("active","removed") && it.body.length<=3000 && it.label.length<=200) { "관계 내용의 길이와 상태를 확인하세요." }
        }
        return result.filter { it.lifecycle=="active" }
    }
}
