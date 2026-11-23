package ai.storyfork.content.world.domain

import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID

/**
 * 초안 편집 요청의 카드·관계 semanticMetadata가 허용 키·형식을 어긴 입력 오류다(#541, 422 WORLD_INPUT_INVALID).
 * 다른 입력 오류와 달리 메시지를 응답에 그대로 싣는다. 그래서 카드/관계 id·키 이름(호출자가 보낸 글이라 50자로 자름)·고정 이유만 담고 값은 담지 않는다.
 */
class WorldMetadataInvalid(detail: String) : IllegalArgumentException(detail)

/** 카드 semanticMetadata의 최상위 허용 키다. 계약은 docs/design/worldstudio-independent-schema.md의 '초안 semanticMetadata 계약'이고 MCP 도구 설명이 같은 목록을 싣는다. */
val CARD_METADATA_KEYS = listOf("studio", "preprocessing", "manuscriptBuild", "characterDocs", "revealFromEpisode", "importedFrom", "imageId")

/** 관계 semanticMetadata의 최상위 허용 키다. */
val RELATION_METADATA_KEYS = listOf("studio", "preprocessing", "manuscriptBuild", "evidence")

private val EPISODE_KEY = Regex("0|[1-9][0-9]*")
private const val DOC_MAX = 3000
private val DOCS_KEYS = setOf("soul", "goal", "episodes")
private val IMPORTED_FROM_KEYS = setOf("worldId", "worldName", "authorNickname", "revisionNo", "cardId")

// 키마다 고정한 거절 이유다(값은 싣지 않는다).
private val REASONS = mapOf(
    "studio" to "객체이고 item 객체의 id가 이 항목의 id와 같아야 합니다",
    "preprocessing" to "객체여야 합니다",
    "manuscriptBuild" to "객체여야 합니다",
    "evidence" to "객체여야 합니다",
    "characterDocs" to "인물 카드의 {soul, goal, episodes} 객체여야 합니다(soul·goal은 3,000자 이하 문자열, episodes는 0 이상 정수 문자열 키와 3,000자 이하 문자열 값, 옛 memory 키는 episodes의 \"0\"으로 옮기세요)",
    "revealFromEpisode" to "1 이상의 정수여야 합니다",
    "importedFrom" to "worldId·worldName·authorNickname·cardId 문자열과 revisionNo 정수만 가진 객체여야 합니다",
    "imageId" to "이 세계관에 올린 카드 이미지의 UUID 문자열이거나 null(이미지 없음)이어야 합니다",
)

/**
 * 카드 semanticMetadata가 허용 키만 갖고 키마다 모양이 맞는지 본다. 어기면 [WorldMetadataInvalid]다. 요청을 고치지 않고 초안 편집 요청([ai.storyfork.content.world.service.WorldStudioService.validateEditRequest])에서만 부른다:
 * 확정 저장·되돌리기·이미 저장된 데이터는 이 검사를 받지 않는다(읽기는 프런트가 모르는 키를 버린다).
 * [stored]는 같은 id로 이미 저장돼 있던 값이다. 거기 있던 키가 같은 값으로 다시 오면 옛 데이터를 그대로 재전송한 것이라 건너뛰고(키 단위 비교), 이번 요청이 새로 넣거나 바꾼 값만 본다.
 */
fun requireCardMetadata(card: CardPayload, stored: Map<String, Any?> = emptyMap()) = requireMetadata("카드", card.id, card.semanticMetadata, stored, CARD_METADATA_KEYS) { key, value ->
    when (key) {
        "studio" -> studioOf(value, card.id)
        "preprocessing", "manuscriptBuild" -> value is Map<*, *>
        "characterDocs" -> card.cardType == "character" && characterDocsOf(value)
        "revealFromEpisode" -> wholeNumber(value) && (value as Number).toLong() in 1..Int.MAX_VALUE
        "importedFrom" -> importedFromOf(value)
        "imageId" -> value == null || cardImageId(card.semanticMetadata) != null
        else -> false
    }
}

/** 관계 semanticMetadata를 [requireCardMetadata]와 같은 규칙으로 본다. */
fun requireRelationshipMetadata(relation: RelationshipPayload, stored: Map<String, Any?> = emptyMap()) = requireMetadata("관계", relation.id, relation.semanticMetadata, stored, RELATION_METADATA_KEYS) { key, value ->
    if (key == "studio") studioOf(value, relation.id) else value is Map<*, *>
}

private fun requireMetadata(owner: String, id: UUID, metadata: Map<String, Any?>, stored: Map<String, Any?>, allowed: List<String>, valid: (String, Any?) -> Boolean) {
    for ((key, value) in metadata) {
        if (key in stored && stored[key] == value) continue
        if (key !in allowed) throw WorldMetadataInvalid("${owner} ${id}: semanticMetadata 키 '${key.take(50).dropLastWhile { it.isHighSurrogate() }}'는 허용되지 않습니다. 허용 키: ${allowed.joinToString(", ")}.")
        if (!valid(key, value)) throw WorldMetadataInvalid("${owner} ${id}: semanticMetadata.${key} 형식이 올바르지 않습니다(${REASONS.getValue(key)}).")
    }
}

// 정수 JSON 숫자만 받는다: 1.0·"1"·BigDecimal은 정수가 아니다(읽기 규칙 revealFromEpisode와 달리 쓰기는 엄격하다).
private fun wholeNumber(value: Any?) = value is Int || value is Long || value is Short || value is Byte

private fun studioOf(value: Any?, id: UUID): Boolean =
    ((value as? Map<*, *>)?.get("item") as? Map<*, *>)?.get("id").let { it is String && it.equals(id.toString(), ignoreCase = true) }

private fun docText(value: Any?) = value is String && value.length <= DOC_MAX

private fun characterDocsOf(value: Any?): Boolean {
    val docs = value as? Map<*, *> ?: return false
    val episodes = docs["episodes"] as? Map<*, *> ?: return false
    return docs.keys == DOCS_KEYS && docText(docs["soul"]) && docText(docs["goal"]) &&
        episodes.all { (key, text) -> key is String && EPISODE_KEY.matches(key) && key.toIntOrNull() != null && docText(text) }
}

private fun importedFromOf(value: Any?): Boolean {
    val from = value as? Map<*, *> ?: return false
    return from.keys == IMPORTED_FROM_KEYS && wholeNumber(from["revisionNo"]) &&
        listOf("worldId", "worldName", "authorNickname", "cardId").all { from[it] is String }
}
