package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

class GenreTemplateRepairTest {
    private val service = mock(WorldStudioService::class.java)
    private val repair = GenreTemplateRepair(service)
    private val owner = GenreTemplateSeeder.TEMPLATE_OWNER
    private val card = GenreTemplateCard(UUID.randomUUID(), "도입 (1/2)", "원문", "other")
    private val old = GenreTemplate("test", UUID.randomUUID(), "세계", "설명", listOf(card))
    private val updated = old.copy(cards = listOf(card.copy(cardType = "object")))
    private val saved = UUID.randomUUID()
    private fun draft(revision: Long, cards: List<CardPayload>) = WorldDraftResponse(old.worldId, revision, saved, saved, old.name, old.description, cards, emptyList())
    private fun savedRevision(t: GenreTemplate, id: UUID, number: Long, cards: List<CardPayload>, parent: UUID? = null, oldIds: Set<UUID> = emptySet()) =
        WorldRevisionResponse(t.worldId, id, number, t.name, t.description, parent, null, cards.map {
            SavedCardResponse(UUID.randomUUID(), if (number == 2L && it.id in oldIds) 2 else 1, null, it)
        }, null)
    private fun legacy() = listOf(CardPayload(card.id, card.title, card.body, card.cardType, "basic", visibility = "public"))
    private fun edit() = EditWorldDraftRequest(2, old.name, old.description, GenreTemplateRepair.payloads(updated), key = "genre-template-test-repair-v2", replace = true)
    private fun prepare() {
        `when`(service.edit(old.worldId, owner, edit())).thenReturn(draft(3, GenreTemplateRepair.payloads(updated)))
    }
    @Test fun `character soul becomes top level character documents without changing studio metadata`() {
        assertTrue(GenreTemplateCard::class.java.methods.any { it.name == "getSoul" })
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val character = mapper.readValue("""{"id":"${card.id}","title":"인물","body":"정체성","cardType":"character","soul":"차분히 말한다"}""", GenreTemplateCard::class.java)
        val result = GenreTemplateRepair.soulPayloads(old.copy(cards = listOf(character, card)))
        val docs = mapper.readTree(mapper.writeValueAsString(result[0].semanticMetadata["characterDocs"]))
        assertEquals(mapper.readTree("""{"soul":"차분히 말한다","goal":"","episodes":{}}"""), docs)
        assertFalse(docs.has("memory"))
        assertFalse(result[1].semanticMetadata.containsKey("characterDocs"))
        assertEquals("정체성", (result[0].semanticMetadata["studio"] as Map<*, *>).let { (it["item"] as Map<*, *>)["text"] })
        assertEquals(listOf(0, 1), result.map { (it.semanticMetadata["studio"] as Map<*, *>)["templateOrder"] })
    }
    @Test fun `soul repair protects baseline and resumes only the same request`() {
        val method = GenreTemplateRepair::class.java.methods.singleOrNull { it.name == "repairSoul" }
        assertNotNull(method, "SOUL 수리 경로가 필요하다")
        val base = old.copy(cards = listOf(card.copy(cardType = "character")))
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val withSoul = mapper.readValue("""{"id":"${card.id}","title":"${card.title}","body":"${card.body}","cardType":"character","soul":"차분히 말한다"}""", GenreTemplateCard::class.java)
        val target = base.copy(cards = listOf(withSoul))
        fun invoke() = method!!.invoke(repair, null, base, target)
        val baseline = GenreTemplateRepair.payloads(base)
        val enriched = GenreTemplateRepair.soulPayloads(target)
        val request = EditWorldDraftRequest(2, base.name, base.description, enriched, key = "genre-template-test-soul-v1", replace = true)
        `when`(service.revision(base.worldId, owner, saved)).thenReturn(savedRevision(base, saved, 1, baseline))
        `when`(service.edit(base.worldId, owner, request)).thenReturn(draft(3, enriched).copy(relationshipVersion = 2))
        `when`(service.draft(base.worldId, owner)).thenReturn(
            draft(2, baseline).copy(relationshipVersion = 1),
            draft(3, enriched).copy(relationshipVersion = 2),
            draft(4, enriched).copy(relationshipVersion = 2),
            draft(2, baseline.map { it.copy(body = "사용자 변경") }).copy(relationshipVersion = 1),
            draft(2, baseline.map { it.copy(semanticMetadata = it.semanticMetadata + ("characterDocs" to mapOf("memory" to "사용자"))) }).copy(relationshipVersion = 1),
        ).thenThrow(WorldStudioFailure.incomplete())
        repeat(6) { invoke() }
        verify(service, times(3)).edit(base.worldId, owner, request)
        verify(service, times(3)).save(base.worldId, owner, SaveWorldRequest(3, "genre-template-test-soul-v1"))
    }

    @Test fun `legacy soul repair requires exact active and removed cards relations and revisions`() {
        val character = GenreTemplateCard(UUID.randomUUID(), "인물", "정체성", "character")
        val base = old.copy(cards = listOf(character, card.copy(id = UUID.randomUUID())))
        val target = base.copy(cards = listOf(character.copy(soul = "말투"), base.cards[1]))
        val active = GenreTemplateRepair.payloads(base)
        val removed = legacy().single().copy(lifecycle = "removed")
        val before = active + removed
        val start = draft(4, before.reversed()).copy(relationshipVersion = 2)
        val parentId = UUID.randomUUID()
        `when`(service.revision(base.worldId, owner, saved)).thenReturn(savedRevision(base, saved, 2, before, parentId, legacy().map { it.id }.toSet()))
        `when`(service.revision(base.worldId, owner, parentId)).thenReturn(savedRevision(old, parentId, 1, legacy()))
        val relationship = RelationshipPayload(UUID.randomUUID(), character.id, character.id, "structural", "사용자 관계")
        val variants = listOf(
            start.copy(name = "사용자 세계"), start.copy(description = "사용자 설명"),
            start.copy(relationships = listOf(relationship)), start.copy(relationshipVersion = 3),
            start.copy(draftRevision = 6), start.copy(baseWorldRevisionId = UUID.randomUUID()),
            start.copy(cards = before.dropLast(1)),
            start.copy(cards = before.dropLast(1) + removed.copy(body = "변조")),
            start.copy(cards = before.map { if (it.id == character.id) it.copy(visibility = "private") else it }),
            start.copy(cards = before.map { if (it.id == character.id) it.copy(semanticMetadata = emptyMap()) else it }),
        )
        variants.forEach { changed ->
            `when`(service.draft(base.worldId, owner)).thenReturn(changed)
            repair.repairSoul(old, base, target)
        }
        val payload = GenreTemplateRepair.soulPayloads(target)
        val request = EditWorldDraftRequest(4, base.name, base.description, payload, key = "genre-template-test-soul-v1", replace = true)
        verify(service, never()).edit(base.worldId, owner, request)
        `when`(service.draft(base.worldId, owner)).thenReturn(start)
        `when`(service.edit(base.worldId, owner, request)).thenReturn(draft(5, payload + removed).copy(relationshipVersion = 3))
        repair.repairSoul(old, base, target)
        verify(service).edit(base.worldId, owner, request)
        verify(service).save(base.worldId, owner, SaveWorldRequest(5, "genre-template-test-soul-v1"))
        assertEquals(listOf(0, 1), payload.map { (it.semanticMetadata["studio"] as Map<*, *>)["templateOrder"] })
    }

    @Test fun `pending soul retry fails closed on a different request and graph failure`() {
        val character = card.copy(cardType = "character")
        val base = old.copy(cards = listOf(character))
        val target = base.copy(cards = listOf(character.copy(soul = "말투")))
        val request = EditWorldDraftRequest(2, base.name, base.description, GenreTemplateRepair.soulPayloads(target), key = "genre-template-test-soul-v1", replace = true)
        `when`(service.draft(base.worldId, owner)).thenThrow(WorldStudioFailure.incomplete()).thenThrow(WorldStudioFailure.unavailable())
        `when`(service.edit(base.worldId, owner, request)).thenThrow(IllegalStateException("hash conflict"))
        assertThrows(IllegalStateException::class.java) { repair.repairSoul(null, base, target) }
        assertThrows(WorldStudioFailure::class.java) { repair.repairSoul(null, base, target) }
        verify(service, never()).save(base.worldId, owner, SaveWorldRequest(3, request.key))
    }

    @Test fun `soul repair refuses a corrupted saved revision even if the draft matches`() {
        val character = card.copy(cardType = "character")
        val base = old.copy(cards = listOf(character))
        val target = base.copy(cards = listOf(character.copy(soul = "말투")))
        val current = draft(2, GenreTemplateRepair.payloads(base)).copy(relationshipVersion = 1)
        val request = EditWorldDraftRequest(2, base.name, base.description, GenreTemplateRepair.soulPayloads(target), key = "genre-template-test-soul-v1", replace = true)
        `when`(service.draft(base.worldId, owner)).thenReturn(current)
        `when`(service.revision(base.worldId, owner, saved)).thenReturn(WorldRevisionResponse(base.worldId, saved, 1, "변조", base.description, null, null, emptyList(), null))
        `when`(service.edit(base.worldId, owner, request)).thenReturn(draft(3, request.cards))
        repair.repairSoul(null, base, target)
        verify(service, never()).edit(base.worldId, owner, request)
    }
    @Test fun `repairs a pristine saved template without replacing its identity`() {
        `when`(service.draft(old.worldId, owner)).thenReturn(draft(2, legacy()))
        prepare(); repair.repair(old, updated)
        val order = inOrder(service)
        order.verify(service).draft(old.worldId, owner)
        order.verify(service).edit(old.worldId, owner, edit())
        order.verify(service).save(old.worldId, owner, SaveWorldRequest(3, "genre-template-test-repair-v2"))
    }
    @Test fun `does not overwrite user changes or an already repaired world`() {
        val relationship = RelationshipPayload(UUID.randomUUID(), card.id, card.id, "structural", "사용자 관계")
        val removed = legacy().map { it.copy(lifecycle = "removed") }
        for (d in listOf(draft(2, legacy().map { it.copy(body = "사용자 원고") }),
            draft(2, legacy()).copy(relationships = listOf(relationship)),
            draft(4, GenreTemplateRepair.payloads(updated) + removed), draft(5, legacy()))) {
            `when`(service.draft(old.worldId, owner)).thenReturn(d)
            repair.repair(old, updated)
        }
        verify(service, times(4)).draft(old.worldId, owner)
        verifyNoMoreInteractions(service)
    }
    @Test fun `resumes the identical edit after graph prepare or before save`() {
        prepare()
        `when`(service.draft(old.worldId, owner)).thenThrow(WorldStudioFailure.incomplete()).thenReturn(draft(3, GenreTemplateRepair.payloads(updated)))
        repair.repair(old, updated); repair.repair(old, updated)
        verify(service, times(2)).edit(old.worldId, owner, edit())
        verify(service, times(2)).save(old.worldId, owner, SaveWorldRequest(3, "genre-template-test-repair-v2"))
    }
    @Test fun `does not save when a concurrent write rejects the repair`() {
        `when`(service.draft(old.worldId, owner)).thenReturn(draft(2, legacy()))
        `when`(service.edit(old.worldId, owner, edit())).thenThrow(IllegalStateException("conflict"))
        assertThrows(IllegalStateException::class.java) { repair.repair(old, updated) }
        verify(service).draft(old.worldId, owner)
        verify(service).edit(old.worldId, owner, edit())
        verifyNoMoreInteractions(service)
    }
    @Test fun `metadata mirrors canonical fields and retains reading order`() {
        val c = GenreTemplateRepair.payloads(updated).single()
        val studio = c.semanticMetadata["studio"] as Map<*, *>
        val item = studio["item"] as Map<*, *>
        assertEquals(0, studio["templateOrder"])
        assertEquals("public", c.visibility)
        assertEquals(c.body, item["text"])
        assertEquals("object", item["entityType"])
        assertEquals("approved", item["decision"])
    }
}
