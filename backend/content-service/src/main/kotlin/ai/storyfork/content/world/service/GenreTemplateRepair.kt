package ai.storyfork.content.world.service

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.dto.*
import org.slf4j.LoggerFactory

/** v1과 정확히 같은 초기 샘플만 v2로 저장한다. 사용자 편집과 과거 저장 버전은 보존한다. */
internal class GenreTemplateRepair(private val service: WorldStudioService) {
    private val log = LoggerFactory.getLogger(javaClass)
    fun repair(legacy: GenreTemplate, updated: GenreTemplate) {
        require(legacy.worldId == updated.worldId)
        val owner = GenreTemplateSeeder.TEMPLATE_OWNER
        val target = payloads(updated)
        val draft = try { service.draft(legacy.worldId, owner) }
            catch (e: WorldStudioFailure) { if (e.reason == WorldStudioFailure.Reason.INCOMPLETE) null else throw e }
        val original = legacy.cards.map { CardPayload(it.id, it.title, it.body, it.cardType, "basic") }
        if (draft != null) {
            val sameWorld = draft.currentRevisionId != null && draft.baseWorldRevisionId == draft.currentRevisionId &&
                draft.name == legacy.name && draft.description == legacy.description && draft.relationships.isEmpty()
            val pristine = draft.draftRevision == 2L && draft.cards.toSet() == original.toSet()
            val edited = draft.draftRevision == 3L && draft.cards.toSet() == target.toSet()
            if (!sameWorld || (!pristine && !edited)) {
                if (draft.draftRevision != 4L || draft.cards.toSet() != target.toSet())
                    log.warn("템플릿 보완 건너뜀 genre={}: 초기 샘플과 다름; 사용자 편집 보존", legacy.genre)
                return
            }
        }
        // 미완료 재시도도 고정 expected revision/key/hash를 사용한다. 다른 요청이면 서비스가 거절한다.
        val key = "genre-template-${legacy.genre}-repair-v2"
        val edited = service.edit(legacy.worldId, owner, EditWorldDraftRequest(2, updated.name, updated.description, target, key = key))
        service.save(legacy.worldId, owner, SaveWorldRequest(edited.draftRevision, key))
    }

    companion object {
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
            )))
        }
    }
}
