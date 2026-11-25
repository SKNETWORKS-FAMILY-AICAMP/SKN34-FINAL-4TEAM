package ai.storyfork.content.world.domain

import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.InheritedSource
import ai.storyfork.content.world.service.dto.ReadingDocumentResponse
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

// 옛 작품 설정집의 분류 → WorldStudio 카드 유형(카테고리) 코드다. 맞는 유형이 없는 분류(상태·지식·관계)와 모르는 분류는 기타(other)다.
private val LEGACY_CARD_TYPES = mapOf("인물" to "character", "장소" to "location", "규칙" to "rule", "광물" to "object")
private const val CARD_BODY_MAX = 3000

/**
 * 원작에 세계관이 없는 옛 작품 설정집 방식 Fork의 독립(#737)이 새 세계관 초안에 한 번에 쓰는 요청이다. [settings]는 Fork가 따라가던 설정과 그 wiki 상세이고 모두 새 카드 id로 옮긴다.
 * 이름→제목, 분류→카드 유형(위 표, 옛 분류 이름은 `classification`에도 남긴다), 내용→본문, 시작 회차→`semanticMetadata.revealFromEpisode`(공개), 태그→태그, wiki 별칭→별칭이다.
 * 근거·끝 회차(`N화까지`)·아는 인물과 wiki 상세(속성·참여·사건 회차·지식·다른 설정으로의 연결)는 본문 뒤에 덧붙이고, 카드 본문 한도(3,000자)를 넘으면 `…`로 자른다.
 * 옛 '관계' 분류도 관계선이 아니라 카드 하나이고 관계는 만들지 않는다. 출처(`importedFrom`)는 원작 세계관이 없으므로 남기지 않는다.
 */
fun legacyWorldCopy(settings: List<Pair<Setting, ReadingDocumentResponse>>, expectedDraftRevision: Long, name: String, key: String): EditWorldDraftRequest {
    val titles = settings.associate { (setting, _) -> setting.id to setting.name }
    val cards = settings.map { (setting, wiki) ->
        val notes = listOfNotNull(
            setting.evidence.takeIf { it.isNotBlank() }?.let { "근거: $it" },
            setting.toEpisode?.let { "${it}화까지" },
            setting.knownBy.takeIf { it.isNotEmpty() }?.let { "아는 인물: ${it.joinToString(", ")}" },
        ) + wiki.properties.map { "${it.name}: ${it.value}" } + listOfNotNull(
            wiki.participants.takeIf { it.isNotEmpty() }?.let { "참여: ${it.joinToString(", ")}" },
            wiki.episode?.let { "사건: ${it}화" },
        ) + wiki.knowledge.map { "지식: ${it.text}" } + wiki.links.mapNotNull { link -> titles[link.to]?.let { "연결: $it(${link.kind})" } }
        val body = listOf(setting.content, notes.joinToString("\n")).filter { it.isNotBlank() }.joinToString("\n\n")
        // 서로게이트 쌍 가운데서 잘리면 짝 잃은 글자를 뺀다.
        val fitted = if (body.length <= CARD_BODY_MAX) body else body.take(CARD_BODY_MAX - 1).dropLastWhile(Char::isHighSurrogate) + "…"
        CardPayload(UUID.randomUUID(), setting.name, fitted, LEGACY_CARD_TYPES[setting.category] ?: "other", "basic", setting.category, wiki.aliases, setting.tags,
            mapOf("revealFromEpisode" to setting.fromEpisode), "public", "active")
    }
    return EditWorldDraftRequest(expectedDraftRevision, name, "", cards, emptyList(), key)
}
