package ai.storyfork.content.world

import ai.storyfork.content.world.service.InitialWorldEvidence
import ai.storyfork.content.world.service.InitialWorldInput
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class InitialWorldInputTest {
    private val world = UUID.fromString("00000000-0000-0000-0000-000000000001")
    private val card = UUID.fromString("00000000-0000-0000-0000-000000000002")
    private val analysis = UUID.fromString("00000000-0000-0000-0000-000000000099")
    private val description = "홍😀\r\n길동"
    private fun draft() = WorldDraftResponse(world, 3, null, null, "세계", description,
        listOf(CardPayload(card, "길동", "  원문\r\n", "character", "basic", aliases = listOf("도적😀"))),
        emptyList(), 4, "current")

    @Test fun `preserves exact source and Python canonical hash`() {
        val saved = draft()
        val before = saved.copy(cards = saved.cards.toList(), relationships = saved.relationships.toList())
        val input = InitialWorldInput.fromDraft(saved, analysis)
        assertEquals("32511e09ca95d4475536a8b2a5dd4021013cdd0139624b5a2240c3c3a000598a", input.basis.inputHash)
        assertEquals(description, input.sources.single { it.field == "description" }.text)
        assertEquals("a22e46cc90695ec9664281e943c39884f6fccfa2c5778024abd2f3a5945ba65a", input.sources.single { it.field == "description" }.textHash)
        assertEquals(card, input.entities.single().cardId)
        assertEquals(listOf("도적😀"), input.entities.single().aliases)
        assertEquals(before, saved)
        input.validateAgainst(saved)
    }

    @Test fun `includes only active cards and only allowed entity types without mutating originals`() {
        val rule = CardPayload(UUID.randomUUID(), "규칙", "내용", "rule", "basic")
        val deleted = CardPayload(UUID.randomUUID(), "삭제", "내용", "character", "basic", lifecycle = "removed")
        val saved = draft().copy(cards = draft().cards + rule + deleted)
        val input = InitialWorldInput.fromDraft(saved, analysis)
        assertEquals(5, input.sources.size)
        assertEquals(listOf(card), input.entities.map { it.cardId })
        assertTrue(input.sources.any { it.ownerId == rule.id && it.field == "body" })
        assertTrue(input.sources.none { it.ownerId == deleted.id })
        assertEquals(3, saved.cards.size)
    }

    @Test fun `removed cards do not count toward active input limit`() {
        val removed = (1..1001).map { CardPayload(UUID.randomUUID(), "옛 카드", "", "character", "basic", lifecycle = "removed") }
        val saved = draft().copy(cards = draft().cards + removed)
        val input = InitialWorldInput.fromDraft(saved, analysis)
        assertEquals(3, input.sources.size)
        assertEquals(listOf(card), input.entities.map { it.cardId })
    }

    @Test fun `input contract does not impose a new active card count limit`() {
        val cards = (1..1001).map { CardPayload(UUID.randomUUID(), "규칙", "본문", "rule", "basic") }
        assertEquals(2005, InitialWorldInput.fromDraft(draft().copy(cards = draft().cards + cards), analysis).sources.size)
    }

    @Test fun `Python canonical hash preserves control characters unicode separators and escaping`() {
        val saved = draft().copy(description = "A\u001a\u2028\u2029\\\"\t😀\r\n")
        val input = InitialWorldInput.fromDraft(saved, analysis)
        assertEquals("aaa59328314e0ec53008a270188806afe74fffc2e144e064a0d4218de1524ecc", input.basis.inputHash)
        assertEquals("163bcdb32b6ae556157e5fce58b81124b614e4f0dcf22466e1a1c118b1dfee8f", input.sources.single { it.field == "description" }.textHash)
    }

    @Test fun `accepts reordered sources and entities while keeping aliases in original order`() {
        val second = CardPayload(UUID.fromString("00000000-0000-0000-0000-000000000003"), "한양", "도시", "location", "space", aliases = listOf("옛 도읍", "서울"))
        val saved = draft().copy(cards = draft().cards + second)
        val input = InitialWorldInput.fromDraft(saved, analysis)
        input.copy(sources = input.sources.reversed(), entities = input.entities.reversed()).validateAgainst(saved)
        val changed = input.entities.map { if (it.cardId == second.id) it.copy(aliases = it.aliases.reversed()) else it }
        assertThrows<IllegalArgumentException> { input.copy(entities = changed).validateAgainst(saved) }
    }

    @Test fun `rejects tampered source binding text hash input hash and changed basis`() {
        val saved = draft(); val input = InitialWorldInput.fromDraft(saved, analysis)
        val first = input.sources.first()
        assertThrows<IllegalArgumentException> { input.copy(sources = listOf(first.copy(ownerId = UUID.randomUUID())) + input.sources.drop(1)).validateAgainst(saved) }
        assertThrows<IllegalArgumentException> { input.copy(sources = listOf(first.copy(sourceId = "card:${UUID.randomUUID()}:body")) + input.sources.drop(1)).validateAgainst(saved) }
        assertThrows<IllegalArgumentException> { input.copy(sources = listOf(first.copy(text = first.text + " ")) + input.sources.drop(1)).validateAgainst(saved) }
        assertThrows<IllegalArgumentException> { input.copy(sources = input.sources + first).validateAgainst(saved) }
        assertThrows<IllegalArgumentException> { input.copy(basis = input.basis.copy(inputHash = "0".repeat(64))).validateAgainst(saved) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(draftRevision = 4)) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(relationshipVersion = 5)) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(currentRevisionId = UUID.randomUUID())) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(relationshipStatus = "incomplete")) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(cards = saved.cards.map { it.copy(lifecycle = "removed") })) }
        assertThrows<IllegalArgumentException> { input.validateAgainst(saved.copy(cards = saved.cards.map { it.copy(aliases = listOf("다른 별칭")) })) }
    }

    @Test fun `checks UTF16 quote boundaries source and hash`() {
        val input = InitialWorldInput.fromDraft(draft(), analysis)
        val sourceId = "world:$world:description"
        val valid = InitialWorldEvidence(sourceId, 1, 3, "😀", "f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9")
        input.validateEvidence(valid)
        input.validateEvidence(InitialWorldEvidence(sourceId, 3, 5, "\r\n", "7eb70257593da06f682a3ddda54a9d260d4fc514f645237f5ca74b08f8da61a6"))
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(start = 2)) }
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(end = 2)) }
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(end = Long.MAX_VALUE)) }
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(quote = "홍")) }
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(quoteHash = "0".repeat(64))) }
        assertThrows<IllegalArgumentException> { input.validateEvidence(valid.copy(sourceId = "world:${UUID.randomUUID()}:description")) }
    }

    @Test fun `quote limit counts Unicode code points rather than UTF16 units`() {
        fun hash(value: String) = java.security.MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
        val emoji = "😀".repeat(2000)
        val input = InitialWorldInput.fromDraft(draft().copy(description = emoji), analysis)
        input.validateEvidence(InitialWorldEvidence("world:$world:description", 0, emoji.length.toLong(), emoji, hash(emoji)))
        val oversized = "가".repeat(3001)
        val other = InitialWorldInput.fromDraft(draft().copy(description = oversized), analysis)
        assertThrows<IllegalArgumentException> {
            other.validateEvidence(InitialWorldEvidence("world:$world:description", 0, oversized.length.toLong(), oversized, hash(oversized)))
        }
    }

    @Test fun `rejects malformed Unicode duplicate IDs and invalid revision`() {
        assertThrows<IllegalArgumentException> { InitialWorldInput.fromDraft(draft().copy(description = "x\uD800"), analysis) }
        assertThrows<IllegalArgumentException> { InitialWorldInput.fromDraft(draft().copy(cards = draft().cards + draft().cards), analysis) }
        assertThrows<IllegalArgumentException> { InitialWorldInput.fromDraft(draft().copy(draftRevision = -1), analysis) }
        assertThrows<IllegalArgumentException> { InitialWorldInput.fromDraft(draft().copy(relationshipVersion = 9007199254740992L), analysis) }
        assertThrows<IllegalArgumentException> { InitialWorldInput.fromDraft(draft().copy(cards = draft().cards.map { it.copy(title = "") }), analysis) }
        assertDoesNotThrow { InitialWorldInput.fromDraft(draft().copy(cards = draft().cards.map { it.copy(title = " ") }), analysis) }
    }
}
