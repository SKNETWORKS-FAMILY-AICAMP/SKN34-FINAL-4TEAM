package ai.storyfork.content.world

import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.*
import ai.storyfork.content.world.service.dto.*
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class GenreTemplateRepairTest {
    private val service = mock(WorldStudioService::class.java)
    private val repair = GenreTemplateRepair(service)
    private val owner = GenreTemplateSeeder.TEMPLATE_OWNER
    private val card = GenreTemplateCard(UUID.randomUUID(), "도입 (1/2)", "원문", "other")
    private val old = GenreTemplate("test", UUID.randomUUID(), "세계", "설명", listOf(card))
    private val updated = old.copy(cards = listOf(card.copy(cardType = "object")))
    private val saved = UUID.randomUUID()
    private fun draft(revision: Long, cards: List<CardPayload>) = WorldDraftResponse(old.worldId, revision, saved, saved, old.name, old.description, cards, emptyList())
    private fun legacy() = listOf(CardPayload(card.id, card.title, card.body, card.cardType, "basic"))
    private fun edit() = EditWorldDraftRequest(2, old.name, old.description, GenreTemplateRepair.payloads(updated), key = "genre-template-test-repair-v2")
    private fun prepare() {
        `when`(service.edit(old.worldId, owner, edit())).thenReturn(draft(3, GenreTemplateRepair.payloads(updated)))
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
        for (d in listOf(draft(2, legacy().map { it.copy(body = "사용자 원고") }), draft(4, GenreTemplateRepair.payloads(updated)), draft(5, legacy()))) {
            `when`(service.draft(old.worldId, owner)).thenReturn(d)
            repair.repair(old, updated)
        }
        verify(service, times(3)).draft(old.worldId, owner)
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
        assertEquals(c.body, item["text"])
        assertEquals("object", item["entityType"])
        assertEquals("approved", item["decision"])
    }
}
