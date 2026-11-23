package ai.storyfork.content.world.domain

import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.InheritedSource
import java.util.UUID

/**
 * Fork 독립(#583)이 새 세계관 초안에 한 번에 쓰는 요청이다. [source]가 이어받던 카드·관계를 모두 새 id로 옮기고 본문 링크와 관계 끝점을 새 id로 다시 잇는다.
 * 카드는 제목·본문·유형·영역·분류·별칭·태그와 유효 공개 회차(`revealFromEpisode`, 공개)를 옮기고 출처를 `importedFrom`으로 남긴다. 작가용 값(인물 문서·이미지·가져온 출처)은 이어받지 않았으므로 복사하지 않는다.
 * 관계는 유형·이름·방향·극성만 옮기며(본문·메모는 이어받지 않았다) 그 관계가 원작에서 보이기 시작한 회차를 관계별 회차(`relationshipEpisodes`)로 쓴다. 시작 회차를 모르는 관계는 기준 회차에서 시작한다.
 */
fun forkWorldCopy(source: InheritedSource, expectedDraftRevision: Long, name: String, key: String): EditWorldDraftRequest {
    val world = source.world
    val cardIds = world.cards.associate { it.id to UUID.randomUUID() }
    val relationIds = world.relationships.associate { it.id to UUID.randomUUID() }
    val cards = world.cards.map { card ->
        val origin = mapOf("worldId" to world.worldId.toString(), "worldName" to source.worldName, "authorNickname" to source.authorNickname,
            "revisionNo" to source.revisionNo, "cardId" to card.id.toString())
        card.copy(id = cardIds.getValue(card.id), body = remapCardLinks(card.body, cardIds),
            semanticMetadata = mapOf("revealFromEpisode" to card.semanticMetadata["revealFromEpisode"], "importedFrom" to origin))
    }
    // 보이는 카드끼리의 관계만 받았으므로 두 끝점은 모두 복사한 카드다.
    val relationships = world.relationships.map {
        it.copy(id = relationIds.getValue(it.id), sourceCardId = cardIds.getValue(requireNotNull(it.sourceCardId)), targetCardId = cardIds.getValue(requireNotNull(it.targetCardId)),
            body = "", semanticMetadata = emptyMap())
    }
    return EditWorldDraftRequest(expectedDraftRevision, name, "", cards, relationships, key,
        relationshipEpisodes = relationIds.entries.associate { (old, new) -> new to (source.relationshipEpisodes[old] ?: world.upto) })
}
