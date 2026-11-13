package ai.storyfork.content.world.service

import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.security.MessageDigest
import java.util.UUID

data class InitialWorldBasis(val draftRevision: Long, val relationshipVersion: Long, val currentRevisionId: UUID?, val inputHash: String)
data class InitialWorldSource(val sourceId: String, val ownerId: UUID, val field: String, val text: String, val textHash: String)
data class InitialWorldEntity(val cardId: UUID, val entityType: String, val name: String, val aliases: List<String>)
data class InitialWorldEvidence(val sourceId: String, val start: Long, val end: Long, val quote: String, val quoteHash: String)

/** 저장된 세계관 입력. 소유자와 실제 저장소 조회는 호출 서비스가 확인한다. */
data class InitialWorldInput(
    val schemaVersion: String, val analysisId: UUID, val worldId: UUID, val basis: InitialWorldBasis,
    val sources: List<InitialWorldSource>, val entities: List<InitialWorldEntity>,
) {
    fun validateAgainst(draft: WorldDraftResponse) {
        val expected = fromDraft(draft, analysisId)
        require(copy(sources = sources.sortedBy { it.sourceId }, entities = entities.sortedBy { it.cardId.toString() }) ==
            expected.copy(sources = expected.sources.sortedBy { it.sourceId }, entities = expected.entities.sortedBy { it.cardId.toString() })) {
            "세계관 입력 스냅샷이 변경됐습니다."
        }
    }

    /** 저장 원본·소유권은 검증하지 않으므로 withInitialWorldInput 재검증 경계 안에서 사용한다. */
    fun validateEvidence(evidence: InitialWorldEvidence) {
        require(schemaVersion == SCHEMA_VERSION && sources.isNotEmpty()) { "세계관 입력 형식이 올바르지 않습니다." }
        require(sources.map { it.sourceId }.distinct().size == sources.size) { "출처 ID가 중복됐습니다." }
        sources.forEach {
            val prefix = when (it.field) { "description" -> "world"; "title", "body" -> "card"; else -> throw IllegalArgumentException("알 수 없는 출처입니다.") }
            require(it.sourceId == "$prefix:${it.ownerId}:${it.field}" && (prefix != "world" || it.ownerId == worldId)) { "출처 ID가 올바르지 않습니다." }
            require(it.textHash == sha256(it.text)) { "출처 해시가 일치하지 않습니다." }
        }
        require(basis.inputHash == calculateHash()) { "입력 해시가 일치하지 않습니다." }
        val source = sources.singleOrNull { it.sourceId == evidence.sourceId } ?: throw IllegalArgumentException("출처를 찾을 수 없습니다.")
        require(evidence.start >= 0 && evidence.start < evidence.end && evidence.end <= source.text.length.toLong()) { "인용 범위가 올바르지 않습니다." }
        val start = evidence.start.toInt(); val end = evidence.end.toInt()
        require(!insidePair(source.text, start) && !insidePair(source.text, end)) { "인용이 서로게이트 경계를 나눕니다." }
        requireUnicode(evidence.quote)
        require(evidence.quote.isNotEmpty() && evidence.quote.codePointCount(0, evidence.quote.length) <= 3000 && source.text.substring(start, end) == evidence.quote) { "인용 원문이 일치하지 않습니다." }
        require(evidence.quoteHash == sha256(evidence.quote)) { "인용 해시가 일치하지 않습니다." }
    }

    private fun calculateHash(): String {
        val sortedSources = sources.sortedBy { it.sourceId }
        val sortedEntities = entities.sortedBy { it.cardId.toString() }
        val json = buildString {
            append("{\"basis\":{\"currentRevisionId\":")
            append(basis.currentRevisionId?.toString()?.let(::jsonString) ?: "null")
            append(",\"draftRevision\":").append(basis.draftRevision)
            append(",\"relationshipVersion\":").append(basis.relationshipVersion).append("},\"entities\":[")
            sortedEntities.forEachIndexed { index, entity ->
                if (index > 0) append(',')
                append("{\"aliases\":[")
                entity.aliases.forEachIndexed { i, alias -> if (i > 0) append(','); append(jsonString(alias)) }
                append("],\"cardId\":").append(jsonString(entity.cardId.toString()))
                append(",\"entityType\":").append(jsonString(entity.entityType))
                append(",\"name\":").append(jsonString(entity.name)).append('}')
            }
            append("],\"schemaVersion\":").append(jsonString(schemaVersion)).append(",\"sources\":[")
            sortedSources.forEachIndexed { index, source ->
                if (index > 0) append(',')
                append("{\"field\":").append(jsonString(source.field))
                append(",\"ownerId\":").append(jsonString(source.ownerId.toString()))
                append(",\"sourceId\":").append(jsonString(source.sourceId))
                append(",\"text\":").append(jsonString(source.text))
                append(",\"textHash\":").append(jsonString(source.textHash)).append('}')
            }
            append("],\"worldId\":").append(jsonString(worldId.toString())).append('}')
        }
        return sha256(json)
    }

    companion object {
        fun fromDraft(draft: WorldDraftResponse, analysisId: UUID): InitialWorldInput {
            require(draft.relationshipStatus == "current") { "관계 저장이 완료되지 않았습니다." }
            require(draft.draftRevision in 0..MAX_REVISION && draft.relationshipVersion in 0..MAX_REVISION) { "기준 버전이 올바르지 않습니다." }
            require(draft.cards.map { it.id }.distinct().size == draft.cards.size) { "카드 ID가 중복됐습니다." }
            require(draft.description.length <= 20000) { "세계관 설명이 너무 깁니다." }
            val sources = mutableListOf(source(draft.worldId, "description", draft.description))
            val entities = mutableListOf<InitialWorldEntity>()
            draft.cards.filter { it.lifecycle == "active" }.forEach { card ->
                require(card.title.length <= 200 && card.body.length <= 3000) { "카드 원문이 너무 깁니다." }
                sources += source(card.id, "title", card.title)
                sources += source(card.id, "body", card.body)
                if (card.cardType in ENTITY_TYPES) {
                    require(card.title.isNotEmpty() && card.aliases.size <= 100 && card.aliases.all { it.length <= 200 }) { "엔터티 이름이나 별칭이 올바르지 않습니다." }
                    card.aliases.forEach(::requireUnicode)
                    entities += InitialWorldEntity(card.id, card.cardType, card.title, card.aliases.toList())
                }
            }
            val basis = InitialWorldBasis(draft.draftRevision, draft.relationshipVersion, draft.currentRevisionId, "")
            val input = InitialWorldInput(SCHEMA_VERSION, analysisId, draft.worldId, basis, sources.toList(), entities.toList())
            return input.copy(basis = basis.copy(inputHash = input.calculateHash()))
        }
    }
}

private const val SCHEMA_VERSION = "initial-world.v1"
private const val MAX_REVISION = 9007199254740991L
private val ENTITY_TYPES = setOf("character", "location", "organization", "ability", "object")

private fun source(ownerId: UUID, field: String, text: String): InitialWorldSource {
    val prefix = if (field == "description") "world" else "card"
    return InitialWorldSource("$prefix:$ownerId:$field", ownerId, field, text, sha256(text))
}
private fun insidePair(text: String, offset: Int) = offset > 0 && offset < text.length &&
    Character.isHighSurrogate(text[offset - 1]) && Character.isLowSurrogate(text[offset])
private fun requireUnicode(value: String) {
    var i = 0
    while (i < value.length) {
        val char = value[i]
        if (Character.isHighSurrogate(char)) {
            require(i + 1 < value.length && Character.isLowSurrogate(value[i + 1])) { "올바르지 않은 유니코드입니다." }
            i += 2
        } else {
            require(!Character.isLowSurrogate(char)) { "올바르지 않은 유니코드입니다." }
            i++
        }
    }
}
private fun sha256(value: String): String {
    requireUnicode(value)
    return MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it.toInt() and 0xff) }
}

// Python json.dumps(ensure_ascii=False, sort_keys=True, separators=(',', ':'))와 동일한 이스케이프.
private fun jsonString(value: String): String {
    requireUnicode(value)
    return buildString {
        append('"')
        value.forEach { char ->
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000C' -> append("\\f")
                '\r' -> append("\\r")
                else -> if (char.code < 0x20) append("\\u").append(char.code.toString(16).padStart(4, '0')) else append(char)
            }
        }
        append('"')
    }
}
