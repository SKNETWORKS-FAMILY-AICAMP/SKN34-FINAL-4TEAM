package ai.storyfork.content.world

import ai.storyfork.content.world.client.dto.WorldReviewAiCard
import ai.storyfork.content.world.client.dto.WorldReviewAiCharacterDocs
import ai.storyfork.content.world.client.dto.WorldReviewAiRelationship
import ai.storyfork.content.world.service.WorldReviewInput
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/** 설정집 AI 검토 요청 만들기(world-review-contract.md): 저장된 현재 초안에서 보낼 카드·인물 문서·관계만 고른다. 순수 함수라 DB·Spring이 없다. */
class WorldReviewInputTest {
    private val world = UUID.randomUUID()
    private fun draft(cards: List<CardPayload>, relationships: List<RelationshipPayload> = emptyList()) =
        WorldDraftResponse(world, 12, null, null, "세계 이름", "세계 설명", cards, relationships)
    private fun card(title: String, body: String = "본문", type: String = "rule", meta: Map<String, Any?> = emptyMap(), lifecycle: String = "active") =
        CardPayload(UUID.randomUUID(), title, body, type, "basic", semanticMetadata = meta, lifecycle = lifecycle)
    private fun docs(soul: Any? = "말투", goal: Any? = "목표", episodes: Any? = mapOf("0" to "비밀")) =
        mapOf("characterDocs" to mapOf("soul" to soul, "goal" to goal, "episodes" to episodes))
    private fun request(vararg cards: CardPayload) = WorldReviewInput.fromDraft(draft(cards.toList()))

    @Test fun `sends the world name and only the active cards`() {
        val alive = card("살아 있는 카드")
        val removed = card("지운 카드", lifecycle = "removed")
        val sent = request(alive, removed)
        assertEquals("세계 이름", sent.worldName)
        assertEquals("세계 설명", sent.worldDescription)
        assertEquals(listOf(WorldReviewAiCard(alive.id.toString(), "rule", "basic", "살아 있는 카드", "본문")), sent.cards)
    }

    @Test fun `a card whose body and documents total over 4000 characters is not sent`() {
        val exact = card("딱 4000자", "가".repeat(4000))
        val over = card("4001자", "가".repeat(4001))
        val hero = card("문서 합계 4000자", "가".repeat(2000), "character",
            docs(soul = "나".repeat(1000), goal = "다".repeat(500), episodes = mapOf("0" to "라".repeat(300), "1" to "마".repeat(200))))
        val bloated = card("문서 때문에 4001자", "가".repeat(2000), "character", docs(soul = "나".repeat(2001)))
        assertEquals(listOf("딱 4000자", "문서 합계 4000자"), request(exact, over, hero, bloated).cards.map { it.title })
    }

    @Test fun `sends at most 300 cards in draft order and oversize cards do not take a slot`() {
        val huge = card("너무 큼", "가".repeat(4001))
        val titles = request(huge, *(1..305).map { card("카드 $it") }.toTypedArray()).cards.map { it.title }
        assertEquals(300, titles.size)
        assertEquals("카드 1", titles.first())
        assertEquals("카드 300", titles.last())
    }

    @Test fun `a character card carries soul goal and episodes and never the old memory`() {
        val meta = mapOf("characterDocs" to mapOf("soul" to "말투", "goal" to "목표", "memory" to "옛 기억", "episodes" to mapOf("0" to "비밀", "3" to "셋째")))
        assertEquals(WorldReviewAiCharacterDocs("말투", "목표", mapOf("0" to "비밀", "3" to "셋째")),
            request(card("길동", type = "character", meta = meta)).cards.single().characterDocs)
        // DEC-47 이전 모양은 goal이 없고 memory 글은 보내지 않는다.
        val legacy = mapOf("characterDocs" to mapOf("soul" to "말투", "memory" to "옛 기억", "episodes" to emptyMap<String, String>()))
        assertEquals(WorldReviewAiCharacterDocs("말투", "", emptyMap()), request(card("옛 인물", type = "character", meta = legacy)).cards.single().characterDocs)
    }

    @Test fun `character documents with a broken shape are left out and the card is still sent`() {
        val broken = listOf(
            "문자열" to mapOf("characterDocs" to "soul"),
            "soul이 숫자" to docs(soul = 1),
            "soul 없음" to mapOf("characterDocs" to mapOf("goal" to "목표", "episodes" to emptyMap<String, String>())),
            "goal이 숫자" to docs(goal = 1),
            "episodes가 목록" to docs(episodes = listOf("글")),
            "episodes 없음" to mapOf("characterDocs" to mapOf("soul" to "말투")),
            "회차 키가 03" to docs(episodes = mapOf("03" to "글")),
            "회차 키가 음수" to docs(episodes = mapOf("-1" to "글")),
            "회차 글이 숫자" to docs(episodes = mapOf("0" to 7)),
        )
        for ((why, meta) in broken) assertNull(request(card("깨진 문서: $why", type = "character", meta = meta)).cards.single().characterDocs, why)
    }

    @Test fun `only character cards carry documents`() {
        assertNull(request(card("규칙", type = "rule", meta = docs())).cards.single().characterDocs)
    }

    @Test fun `card links in the body and in character documents are sent as plain text whether or not the target exists`() {
        val link = "[승상](card:${UUID.randomUUID()})"
        val sent = request(card("길동", "앞 $link 뒤 [없는](card:${UUID.randomUUID()})", "character",
            docs(soul = "말투 $link", goal = "목표 $link", episodes = mapOf("0" to "기억 $link")))).cards.single()
        assertEquals("앞 승상 뒤 없는", sent.body)
        assertEquals(WorldReviewAiCharacterDocs("말투 승상", "목표 승상", mapOf("0" to "기억 승상")), sent.characterDocs)
        // 링크의 id는 4,000자 한도에 들지 않는다: 글자로 벗긴 길이로 센다.
        val long = card("링크로 길어진 카드", "가".repeat(3990) + "[가](card:${UUID.randomUUID()})")
        assertEquals(listOf("링크로 길어진 카드"), request(long).cards.map { it.title })
    }

    @Test fun `relationships keep only active ones between sent cards and read a missing polarity as asserted`() {
        val a = card("갑", type = "character")
        val b = card("을", type = "character")
        val huge = card("너무 큼", "가".repeat(4001))
        val removed = card("지운 카드", lifecycle = "removed")
        fun relation(source: UUID?, target: UUID?, polarity: String? = null, lifecycle: String = "active") =
            RelationshipPayload(UUID.randomUUID(), source, target, "structural", label = "동료", polarity = polarity, lifecycle = lifecycle)
        val denied = relation(a.id, b.id, "denied")
        val plain = relation(b.id, a.id)
        val relations = listOf(denied, plain, relation(a.id, huge.id), relation(a.id, removed.id), relation(a.id, b.id, lifecycle = "removed"), relation(a.id, null))
        val sent = WorldReviewInput.fromDraft(draft(listOf(a, b, huge, removed), relations))
        assertEquals(listOf(
            WorldReviewAiRelationship(denied.id.toString(), a.id.toString(), b.id.toString(), "동료", "denied"),
            WorldReviewAiRelationship(plain.id.toString(), b.id.toString(), a.id.toString(), "동료", "asserted")), sent.relationships)
    }

    @Test fun `the JSON body has exactly the contract fields and no characterDocs key on other cards`() {
        val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
        val hero = card("길동", type = "character", meta = docs())
        val rule = card("규칙")
        val relation = RelationshipPayload(UUID.randomUUID(), hero.id, rule.id, "structural", label = "소속", polarity = "denied")
        val actual: JsonNode = mapper.valueToTree(WorldReviewInput.fromDraft(draft(listOf(hero, rule), listOf(relation))))
        val expected = mapper.readTree("""
            {"worldName":"세계 이름","worldDescription":"세계 설명",
             "cards":[{"id":"${hero.id}","cardType":"character","areaCode":"basic","title":"길동","body":"본문","characterDocs":{"soul":"말투","goal":"목표","episodes":{"0":"비밀"}}},
                      {"id":"${rule.id}","cardType":"rule","areaCode":"basic","title":"규칙","body":"본문"}],
             "relationships":[{"id":"${relation.id}","sourceCardId":"${hero.id}","targetCardId":"${rule.id}","label":"소속","polarity":"denied"}]}""")
        assertEquals(expected, actual)
    }

    @Test fun `the card image id is not part of what the AI is sent`() {
        val image = UUID.randomUUID().toString()
        val sent = request(card("초상 있는 인물", type = "character", meta = mapOf("imageId" to image) + docs()), card("그림 있는 규칙", meta = mapOf("imageId" to image)))
        val json = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build().writeValueAsString(sent)
        assertEquals(2, sent.cards.size)
        assertFalse(image in json || "imageId" in json, json)
    }
}
