package ai.storyfork.content.world

import ai.storyfork.content.world.domain.forkWorldCopy
import ai.storyfork.content.world.domain.requireCardMetadata
import ai.storyfork.content.world.domain.requireRelationshipMetadata
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.InheritedSource
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** Fork 독립(#583)의 복사 규칙이다: 이어받던 카드·관계를 새 id로 옮기고 본문 링크와 관계 끝점을 다시 잇는다. 순수 함수라 대역이 없다. */
class ForkWorldCopyTest {
    private val worldId = UUID.randomUUID()

    private fun card(title: String, body: String = "$title 본문", from: Int = 1) = CardPayload(UUID.randomUUID(), title, body, "character", "history", "분류",
        listOf("별칭"), listOf("태그"), mapOf("revealFromEpisode" to from), "public", "active")

    private fun relation(from: CardPayload, to: CardPayload, label: String = "동료", category: String = "structural", direction: String = "directed", polarity: String = "asserted") =
        RelationshipPayload(UUID.randomUUID(), from.id, to.id, category, "", label, direction, polarity)

    private fun source(cards: List<CardPayload>, relations: List<RelationshipPayload> = emptyList(), started: Map<UUID, Int> = emptyMap(), upto: Int = 4) =
        InheritedSource(InheritedWorldResponse("fork", worldId, upto, cards, relations, "current", 7), "원작 세계", 3L, "원작자", started)

    private fun copy(source: InheritedSource) = forkWorldCopy(source, 2, "분기 세계관", "key-1")

    @Test fun `copied cards get new ids and keep their fields, with only the reveal episode and the origin as metadata`() {
        val a = card("하린", from = 2)
        val b = card("온실", from = 4)

        val request = copy(source(listOf(a, b)))

        assertEquals(2, request.cards.size)
        assertEquals(2, request.cards.map { it.id }.toSet().size)
        request.cards.zip(listOf(a, b)).forEach { (copied, original) ->
            assertNotEquals(original.id, copied.id)
            assertEquals(listOf(original.title, original.body, original.cardType, original.areaCode, original.classification, original.aliases, original.tags, "public", "active"),
                listOf(copied.title, copied.body, copied.cardType, copied.areaCode, copied.classification, copied.aliases, copied.tags, copied.visibility, copied.lifecycle))
            // 작가용 값(studio·인물 문서·이미지)은 이어받지 않았으므로 공개 회차와 출처만 남긴다.
            assertEquals(mapOf("revealFromEpisode" to original.semanticMetadata["revealFromEpisode"],
                "importedFrom" to mapOf("worldId" to worldId.toString(), "worldName" to "원작 세계", "authorNickname" to "원작자", "revisionNo" to 3L, "cardId" to original.id.toString())),
                copied.semanticMetadata)
        }
        assertEquals(listOf(2, 4), request.cards.map { it.semanticMetadata["revealFromEpisode"] })
        // 새 세계관은 사용자 편집과 같은 저장 경로(validateEditRequest)로 쓰므로 복사한 메타데이터가 허용 키·형식 검사(#541)를 통과해야 한다.
        request.cards.forEach(::requireCardMetadata)
    }

    @Test fun `body links between copied cards are re-pointed at the new ids and any other card reference becomes plain text`() {
        val a = card("하린")
        val b = card("온실")
        val stranger = UUID.randomUUID()
        val linked = a.copy(body = "[온실](card:${b.id})과 [옛 친구](card:$stranger) 그리고 [나](card:${a.id})")

        val request = copy(source(listOf(linked, b)))

        val (newA, newB) = request.cards
        assertEquals("[온실](card:${newB.id})과 옛 친구 그리고 [나](card:${newA.id})", newA.body)
        assertEquals(b.body, newB.body)
    }

    @Test fun `relationships get new ids and ends, keep their meaning, drop the author's text and start when they began in the original`() {
        val a = card("하린")
        val b = card("온실")
        val c = card("별")
        val friend = relation(a, b, "동료")
        val enemy = relation(b, c, "원수", "emotional", "symmetric", "denied")

        val request = copy(source(listOf(a, b, c), listOf(friend, enemy), mapOf(friend.id to 1, enemy.id to 3)))

        val (na, nb, nc) = request.cards
        val (f, e) = request.relationships
        assertEquals(listOf<Any?>(na.id, nb.id, "structural", "동료", "directed", "asserted"), listOf(f.sourceCardId, f.targetCardId, f.category, f.label, f.direction, f.polarity))
        assertEquals(listOf<Any?>(nb.id, nc.id, "emotional", "원수", "symmetric", "denied"), listOf(e.sourceCardId, e.targetCardId, e.category, e.label, e.direction, e.polarity))
        request.relationships.forEach {
            assertEquals("", it.body)
            assertEquals(emptyMap<String, Any?>(), it.semanticMetadata)
            assertEquals("active", it.lifecycle)
        }
        assertTrue(request.relationships.map { it.id }.none { it == friend.id || it == enemy.id })
        assertEquals(mapOf(f.id to 1, e.id to 3), request.relationshipEpisodes)
        request.relationships.forEach(::requireRelationshipMetadata)
    }

    @Test fun `a relationship whose start episode is unknown starts at the basis episode`() {
        val a = card("하린")
        val b = card("온실")
        val known = relation(a, b, "동료")
        val unknown = relation(b, a, "스승")

        val request = copy(source(listOf(a, b), listOf(known, unknown), mapOf(known.id to 2), upto = 4))

        assertEquals(mapOf(request.relationships[0].id to 2, request.relationships[1].id to 4), request.relationshipEpisodes)
    }

    @Test fun `the request is a plain upsert at the latest episode with the given draft revision, name and key`() {
        val request = copy(source(listOf(card("하린"))))

        assertEquals(listOf<Any?>(2L, "분기 세계관", "", "key-1", false, null),
            listOf(request.expectedDraftRevision, request.name, request.description, request.key, request.replace, request.episode))
        assertTrue(request.relationships.isEmpty())
        assertTrue(request.relationshipEpisodes.isEmpty())
    }
}
