package ai.storyfork.content.world

import ai.storyfork.content.world.domain.DEFAULT_CARD_TYPES
import ai.storyfork.content.world.domain.Setting
import ai.storyfork.content.world.domain.forkWorldCopy
import ai.storyfork.content.world.domain.legacyWorldCopy
import ai.storyfork.content.world.domain.requireCardMetadata
import ai.storyfork.content.world.domain.requireRelationshipMetadata
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.InheritedSource
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReadingDocumentResponse
import ai.storyfork.content.world.service.dto.ReadingKnowledgeResponse
import ai.storyfork.content.world.service.dto.ReadingLinkResponse
import ai.storyfork.content.world.service.dto.ReadingPropertyResponse
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

    // ---- 옛 작품 설정집 방식 Fork의 독립(#737): 따라가던 설정을 카드로 복사한다 ----

    private fun setting(name: String, content: String = "$name 내용", category: String = "규칙", from: Int = 1, to: Int? = null, evidence: String = "",
        knownBy: List<String> = emptyList(), tags: List<String> = emptyList()) =
        Setting("id-$name", "v-$name", name, content, category, tags, "public", from, to, knownBy, evidence)

    private fun wiki(setting: Setting, aliases: List<String> = emptyList(), properties: List<ReadingPropertyResponse> = emptyList(), episode: Int? = null,
        participants: List<String> = emptyList(), knowledge: List<ReadingKnowledgeResponse> = emptyList(), links: List<ReadingLinkResponse> = emptyList()) =
        ReadingDocumentResponse(setting.id, setting.versionId, "world", setting.name, setting.content, aliases, setting.tags, properties, "#7C8A9E", null, episode, null, participants, knowledge, links)

    private fun legacy(vararg settings: Setting) = settings.map { it to wiki(it) }
    private fun legacyCopy(settings: List<Pair<Setting, ReadingDocumentResponse>>) = legacyWorldCopy(settings, 2, "분기 세계관", "key-1")

    @Test fun `legacy settings become public cards with new ids, tags, aliases and the first episode as the reveal episode, and no relationships`() {
        val hari = setting("하린", "열일곱 살 배달부.", "인물", from = 2, tags = listOf("주인공"))
        val rule = setting("전자 통신 불가", "도시 안에서는 전자 통신이 작동하지 않는다.")

        val request = legacyCopy(listOf(hari to wiki(hari, aliases = listOf("린")), rule to wiki(rule)))

        assertEquals(listOf<Any?>(2L, "분기 세계관", "", "key-1", false, null), listOf(request.expectedDraftRevision, request.name, request.description, request.key, request.replace, request.episode))
        assertEquals(listOf("하린", "전자 통신 불가"), request.cards.map { it.title })
        assertEquals(2, request.cards.map { it.id }.toSet().size)
        val (copied, ruled) = request.cards
        assertEquals(listOf<Any?>("열일곱 살 배달부.", "basic", "인물", listOf("린"), listOf("주인공"), "public", "active"),
            listOf(copied.body, copied.areaCode, copied.classification, copied.aliases, copied.tags, copied.visibility, copied.lifecycle))
        assertEquals(mapOf("revealFromEpisode" to 2), copied.semanticMetadata)
        assertEquals(mapOf("revealFromEpisode" to 1), ruled.semanticMetadata)
        assertTrue(request.relationships.isEmpty())
        assertTrue(request.relationshipEpisodes.isEmpty())
        // 새 세계관은 사용자 편집과 같은 저장 경로(validateEditRequest)로 쓰므로 허용 키·형식 검사(#541)와 카드 한도를 통과해야 한다.
        request.cards.forEach(::requireCardMetadata)
        assertTrue(request.cards.all { it.title.length <= 200 && it.body.length <= 3000 && it.classification.length <= 50 })
    }

    @Test fun `each old category maps to a card type, one with no match even an unknown one is other, and the old name stays as the classification`() {
        val categories = listOf("인물", "장소", "규칙", "광물", "상태", "지식", "관계", "그 밖")

        val request = legacyCopy(categories.map { setting("설정 $it", category = it) }.map { it to wiki(it) })

        assertEquals(listOf("character", "location", "rule", "object", "other", "other", "other", "other"), request.cards.map { it.cardType })
        assertEquals(categories, request.cards.map { it.classification })
        assertTrue(request.cards.all { it.cardType in DEFAULT_CARD_TYPES })
    }

    @Test fun `the evidence, the end episode and who knows it are appended after the content, and a setting with nothing to add keeps its content as is`() {
        val full = setting("봉인", "탑의 문은 해가 지면 열리지 않는다.", "규칙", to = 3, evidence = "1화 도입부", knownBy = listOf("하린", "카엘"))
        val plain = setting("단순", "그대로.")
        val onlyNotes = setting("빈 내용", "", evidence = "근거만 있음")

        val bodies = legacyCopy(legacy(full, plain, onlyNotes)).cards.map { it.body }

        assertEquals("탑의 문은 해가 지면 열리지 않는다.\n\n근거: 1화 도입부\n3화까지\n아는 인물: 하린, 카엘", bodies[0])
        assertEquals("그대로.", bodies[1])
        assertEquals("근거: 근거만 있음", bodies[2])
    }

    @Test fun `wiki details follow the notes in this order, properties, participants, the event episode, knowledge and links to other copied settings by title`() {
        val event = setting("돌다리에서 만나다", "성진이 팔선녀를 만난다.", "지식", from = 2)
        val cause = setting("스승의 가르침", "가르침.")
        val outside = setting("복사하지 않는 설정")
        val details = wiki(event,
            properties = listOf(ReadingPropertyResponse("나이", "20"), ReadingPropertyResponse("소속", "연화봉 도량")),
            episode = 2, participants = listOf("성진", "팔선녀"), knowledge = listOf(ReadingKnowledgeResponse("구슬의 정체", 2, 3)),
            links = listOf(ReadingLinkResponse(cause.id, "계기"), ReadingLinkResponse(outside.id, "복선")))

        val body = legacyCopy(listOf(event to details, cause to wiki(cause))).cards.first().body

        // 복사하지 않는 설정으로 가는 연결은 제목을 알 수 없어 싣지 않는다.
        assertEquals("성진이 팔선녀를 만난다.\n\n나이: 20\n소속: 연화봉 도량\n참여: 성진, 팔선녀\n사건: 2화\n지식: 구슬의 정체\n연결: 스승의 가르침(계기)", body)
    }

    @Test fun `a body longer than the card limit is cut to 3000 characters ending with an ellipsis, never leaving half of a surrogate pair`() {
        val long = setting("긴 설정", "가".repeat(5000))
        val paired = setting("이모지", "가".repeat(2998) + "😀😀")  // 2999번째 글자가 서로게이트 쌍의 앞 절반이다

        val (cut, kept) = legacyCopy(legacy(long, paired)).cards.map { it.body }

        assertEquals("가".repeat(2999) + "…", cut)
        assertEquals("가".repeat(2998) + "…", kept)
    }
}
