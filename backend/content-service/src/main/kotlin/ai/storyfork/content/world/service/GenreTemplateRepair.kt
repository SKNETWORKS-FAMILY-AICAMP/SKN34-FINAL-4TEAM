package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.dto.*
import org.slf4j.LoggerFactory

/** v1과 정확히 같은 초기 샘플만 v2로 저장한다. 사용자 편집과 과거 저장 버전은 보존한다. 카드는 Seeder와 같이 공개로 넣는다(DEC-46). */
internal class GenreTemplateRepair(private val service: WorldStudioService) {
    private val log = LoggerFactory.getLogger(javaClass)

    fun repairSoul(legacy: GenreTemplate?, baseline: GenreTemplate, target: GenreTemplate) {
        require(target.copy(cards = target.cards.map { it.copy(soul = null) }) == baseline) { "SOUL 외 템플릿 변경: ${baseline.genre}" }
        require(legacy == null || legacy.worldId == baseline.worldId)
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        val cards = soulPayloads(target)
        val original = payloads(baseline)
        val removed = legacy?.cards.orEmpty().filter { old -> original.none { it.id == old.id } }.map {
            CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public", lifecycle = "removed")
        }
        val before = original + removed
        val after = cards + removed
        val revision = if (legacy == null) 2L else 4L
        val graphVersion = if (legacy == null) 1L else 2L
        val draft = try { service.draft(baseline.worldId, owner) }
            catch (e: WorldStudioFailure) { if (e.reason == WorldStudioFailure.Reason.INCOMPLETE) null else throw e }
        if (draft != null) {
            fun sameCards(expected: List<CardPayload>) = draft.cards.size == expected.size && draft.cards.toSet() == expected.toSet()
            val sameWorld = draft.currentRevisionId != null && draft.baseWorldRevisionId == draft.currentRevisionId &&
                draft.name == baseline.name && draft.description == baseline.description && draft.relationships.isEmpty() &&
                draft.relationshipStatus == "current"
            val pristine = draft.draftRevision == revision && draft.relationshipVersion == graphVersion && sameCards(before)
            val edited = draft.draftRevision == revision + 1 && draft.relationshipVersion == graphVersion + 1 && sameCards(after)
            if (!sameWorld || (!pristine && !edited)) {
                if (!(sameWorld && draft.draftRevision == revision + 2 && draft.relationshipVersion == graphVersion + 1 && sameCards(after)))
                    log.warn("SOUL 보완 건너뜀 genre={}: 초기 샘플과 다름; 사용자 편집 보존", baseline.genre)
                return
            }
            val legacyCards = legacy?.cards.orEmpty().map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }
            val oldIds = legacyCards.map { it.id }.toSet()
            fun matchesSaved(saved: WorldRevisionResponse, expected: List<CardPayload>, number: Long): Boolean =
                saved.worldId == baseline.worldId && saved.revisionNo == number && saved.restoredFromRevisionId == null &&
                    saved.cards.size == expected.size && saved.cards.map { it.card }.toSet() == expected.toSet() &&
                    saved.cards.all { it.restoredFromVersionId == null && it.versionNo == if (number == 2L && it.card.id in oldIds) 2L else 1L }
            val saved = service.revision(baseline.worldId, owner, draft.currentRevisionId)
            val savedMatches = saved.revisionId == draft.currentRevisionId && saved.name == baseline.name && saved.description == baseline.description &&
                matchesSaved(saved, before, if (legacy == null) 1 else 2)
            val parentMatches = if (legacy == null) saved.parentRevisionId == null else saved.parentRevisionId?.let { id ->
                val parent = service.revision(baseline.worldId, owner, id)
                parent.revisionId == id && parent.parentRevisionId == null && parent.name == legacy.name &&
                    parent.description == legacy.description && matchesSaved(parent, legacyCards, 1)
            } ?: false
            if (!savedMatches || !parentMatches) {
                log.warn("SOUL 보완 건너뜀 genre={}: 저장 이력이 초기 샘플과 다름", baseline.genre)
                return
            }
        }
        // INCOMPLETE는 같은 key/hash/expected revision만 서비스가 재개한다. 다른 미완료 요청은 오류로 남는다.
        val key = "genre-template-${baseline.genre}-soul-v1"
        val edited = service.edit(baseline.worldId, owner, EditWorldDraftRequest(revision, target.name, target.description, cards, key = key, replace = true))
        service.save(baseline.worldId, owner, SaveWorldRequest(edited.draftRevision, key))
    }

    fun repair(legacy: GenreTemplate, updated: GenreTemplate) {
        require(legacy.worldId == updated.worldId)
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        val target = payloads(updated)
        val draft = try { service.draft(legacy.worldId, owner) }
            catch (e: WorldStudioFailure) { if (e.reason == WorldStudioFailure.Reason.INCOMPLETE) null else throw e }
        val original = legacy.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic", visibility = "public") }
        if (draft != null) {
            val sameWorld = draft.currentRevisionId != null && draft.baseWorldRevisionId == draft.currentRevisionId &&
                draft.name == legacy.name && draft.description == legacy.description && draft.relationships.isEmpty()
            val pristine = draft.draftRevision == 2L && draft.cards.toSet() == original.toSet()
            val edited = draft.draftRevision == 3L && draft.cards.filter { it.lifecycle == "active" }.toSet() == target.toSet()
            if (!sameWorld || (!pristine && !edited)) {
                if (draft.draftRevision != 4L || draft.cards.filter { it.lifecycle == "active" }.toSet() != target.toSet())
                    log.warn("템플릿 보완 건너뜀 genre={}: 초기 샘플과 다름; 사용자 편집 보존", legacy.genre)
                return
            }
        }
        // 미완료 재시도도 고정 expected revision/key/hash를 사용한다. 다른 요청이면 서비스가 거절한다.
        val key = "genre-template-${legacy.genre}-repair-v2"
        val edited = service.edit(legacy.worldId, owner, EditWorldDraftRequest(2, updated.name, updated.description, target, key = key, replace = true))
        service.save(legacy.worldId, owner, SaveWorldRequest(edited.draftRevision, key))
    }

    companion object {
        fun soulPayloads(template: GenreTemplate): List<CardPayload> = payloads(template).mapIndexed { index, payload ->
            val card = template.cards[index]
            if (card.cardType == "character") {
                val soul = card.soul
                require(!soul.isNullOrBlank() && soul.length <= 3000) { "인물 SOUL 누락 또는 길이 초과: ${card.title}" }
                payload.copy(semanticMetadata = payload.semanticMetadata + ("characterDocs" to mapOf("soul" to soul, "goal" to "", "episodes" to emptyMap<String, String>())))
            } else {
                require(card.soul == null) { "인물이 아닌 카드에 SOUL: ${card.title}" }
                payload
            }
        }

        fun payloads(template: GenreTemplate): List<CardPayload> = template.cards.mapIndexed { index, c ->
            val entity = c.cardType !in setOf("rule", "event")
            val area = if (c.cardType == "event") "history" else "basic"
            val item = mapOf(
                "id" to c.id.toString(), "kind" to if (entity) "entity" else c.cardType,
                "title" to c.title, "text" to c.body, "category" to area, "topics" to emptyList<String>(),
                "entityType" to if (entity) c.cardType else null, "subjectId" to null, "targetId" to null,
                "predicate" to null, "polarity" to "asserted", "relatedIds" to emptyList<String>(),
                "condition" to "", "timeText" to "", "afterId" to null, "orderEvidence" to emptyList<String>(),
                "evidence" to emptyList<String>(), "origin" to "author_input", "authorText" to c.body, "decision" to "approved",
            )
            CardPayload(c.id, c.title, c.body, c.cardType, area, semanticMetadata = mapOf("studio" to mapOf(
                "userCategory" to "", "tags" to emptyList<String>(), "aliases" to emptyList<String>(),
                "templateOrder" to index, "item" to item,
            )), visibility = "public")
        }
    }
}
