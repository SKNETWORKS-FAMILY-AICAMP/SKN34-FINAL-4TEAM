package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.relationship.Neo4jRelationshipRepository
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.*
import ai.storyfork.content.world.studio.entity.*
import ai.storyfork.content.world.studio.repository.*
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.data.domain.PageImpl
import org.springframework.data.domain.PageRequest
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus

/** 공개 세계관 조회 서비스: 저장소·Core·Neo4j는 대역이다. 실제 쿼리·HTTP는 CI의 PublicWorldHttpIntegrationTest가 확인한다. */
class PublicWorldServiceTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val revisions = mock(WorldRevisionRepository::class.java)
    private val revisionCards = mock(WorldRevisionCardRepository::class.java)
    private val cardVersions = mock(SettingCardVersionRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val graph = mock(Neo4jRelationshipRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = PublicWorldService(worlds, revisions, revisionCards, cardVersions, states, graph, nicknames, storage, manager)
    private val published = Instant.parse("2026-11-11T01:02:03Z")

    /**
     * 공개 세계관 하나와 그 저장소 대역이다. 마지막 저장 버전의 카드는 활성 둘과 삭제 하나이고,
     * 현재 관계는 활성 카드끼리 하나와 삭제 카드·저장 버전에 없는 카드를 가리키는 둘이다.
     */
    private inner class Seed(
        val owner: UUID = UUID.randomUUID(), visibility: String = "public", genre: String? = "fantasy",
        saved: Boolean = true, name: String = "저장된 세계", cover: Boolean = false,
    ) {
        val id: UUID = UUID.randomUUID()
        val coverBytes = byteArrayOf(1, 2, 3)
        val revisionId: UUID = UUID.randomUUID()
        val first = card("첫 인물")
        val second = card("둘째 인물")
        val removed = card("지운 인물", "removed")
        val versions = listOf(first, second, removed)
        val relations = listOf(
            RelationshipPayload(UUID.randomUUID(), first.cardId, second.cardId, "structural", label = "동료"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, removed.cardId, "structural", label = "삭제된 쪽"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, UUID.randomUUID(), "emotional", label = "초안에만 있는 쪽"),
        )
        val world = StudioWorld(id, owner, if (saved) revisionId else null, visibility = visibility, genre = genre, publishedAt = published,
            coverObjectKey = if (cover) "world-covers/$id" else null, coverContentType = if (cover) "image/png" else null)
        val revision = WorldRevision(id = revisionId, worldId = id, revisionNo = 3, name = name, description = "$name 설명", sealed = true)
        val state = WorldRelationshipState(id, 3, "creation", "key", "hash", 1, true)

        init {
            `when`(worlds.findById(id)).thenReturn(Optional.of(world))
            `when`(revisions.findByIdAndWorldId(revisionId, id)).thenReturn(revision)
            `when`(revisionCards.findAllByIdRevisionId(revisionId)).thenReturn(versions.map { WorldRevisionCard(RevisionCardKey(revisionId, it.cardId), id, it.id) })
            `when`(cardVersions.findAllById(versions.map { it.id })).thenReturn(versions)
            `when`(states.findById(id)).thenReturn(Optional.of(state))
            `when`(graph.read(id)).thenReturn(RelationshipStateResult(id, 3, "key", "hash", relations))
            if (cover) `when`(storage.read("world-covers/$id")).thenReturn(AttachmentObjectResult(coverBytes))
        }

        private fun card(title: String, lifecycle: String = "active") = SettingCardVersion(
            cardId = UUID.randomUUID(), worldId = id, versionNo = 1,
            fields = CardFields(title = title, body = "$title 본문", cardType = "character", aliases = listOf("별칭"), tags = listOf("태그"), lifecycle = lifecycle),
        )

        /** 목록 쿼리가 돌려줄 행(활성 카드 ID 쌍)이다. */
        val activeCardRows get() = listOf(first, second).map { arrayOf<Any>(revisionId, it.cardId) }
    }

    private fun stubPage(seeds: List<Seed>, page: PageRequest, total: Long, genre: String? = null) {
        val result = PageImpl(seeds.map { it.world }, page, total)
        if (genre == null) `when`(worlds.listed(page)).thenReturn(result) else `when`(worlds.listedByGenre(genre, page)).thenReturn(result)
        `when`(revisions.findAllById(seeds.map { it.revisionId })).thenReturn(seeds.map { it.revision })
        `when`(revisionCards.activeCardIds(seeds.map { it.revisionId })).thenReturn(seeds.flatMap { it.activeCardRows })
        `when`(states.findAllById(seeds.map { it.id })).thenReturn(seeds.map { it.state })
    }

    @Test fun `detail returns the last saved revision, active cards only, and current relations between those cards`() {
        val s = Seed()
        `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenReturn(mapOf(s.owner.toString() to "작가"))
        val result = service.detail(s.id)
        assertEquals(s.id, result.id)
        assertEquals("저장된 세계", result.name)
        assertEquals("저장된 세계 설명", result.description)
        assertEquals("fantasy", result.genre)
        assertEquals("작가", result.authorNickname)
        assertEquals("2026-11-11T01:02:03Z", result.publishedAt)
        assertEquals(3L, result.revisionNo)
        assertEquals(listOf(s.first.cardId, s.second.cardId).sortedBy { it.toString() }, result.cards.map { it.id })
        assertEquals(PublicWorldCardResponse(s.first.cardId, "첫 인물", "첫 인물 본문", "character", listOf("별칭"), listOf("태그")), result.cards.single { it.id == s.first.cardId })
        assertEquals(listOf(PublicWorldRelationshipResponse(s.relations[0].id, s.first.cardId, s.second.cardId, "동료")), result.relationships)
        assertEquals("current", result.relationshipStatus)
    }

    @Test fun `detail is 404 for private, never-saved and unknown worlds without touching Core or Neo4j`() {
        val hidden = Seed(visibility = "private")
        val draftOnly = Seed(saved = false)
        listOf(hidden.id, draftOnly.id, UUID.randomUUID()).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.detail(it) }.status)
        }
        verifyNoInteractions(graph, nicknames, cardVersions)
    }

    private fun assertCardsWithoutRelations(s: Seed) {
        val result = service.detail(s.id)
        assertEquals("unavailable", result.relationshipStatus)
        assertTrue(result.relationships.isEmpty())
        assertEquals(2, result.cards.size)
    }

    @Test fun `unmigrated and pending worlds keep their cards, say unavailable and never read Neo4j`() {
        val unmigrated = Seed()
        `when`(states.findById(unmigrated.id)).thenReturn(Optional.empty())
        assertCardsWithoutRelations(unmigrated)
        val pending = Seed()
        pending.state.completed = false
        assertCardsWithoutRelations(pending)
        verify(graph, never()).read(unmigrated.id)
        verify(graph, never()).read(pending.id)
    }

    @Test fun `a failed or mismatched Neo4j read keeps the cards and says unavailable instead of a 500`() {
        val failing = Seed()
        `when`(graph.read(failing.id)).thenThrow(WorldStudioFailure.unavailable())
        assertCardsWithoutRelations(failing)
        val stale = Seed()
        `when`(graph.read(stale.id)).thenReturn(RelationshipStateResult(stale.id, 4, "key", "hash", stale.relations))
        assertCardsWithoutRelations(stale)
        val foreign = Seed()
        `when`(graph.read(foreign.id)).thenReturn(RelationshipStateResult(UUID.randomUUID(), 3, "key", "hash", foreign.relations))
        assertCardsWithoutRelations(foreign)
    }

    @Test fun `author is withdrawn when Core has no nickname and a Core failure is never replaced by a name`() {
        val s = Seed()
        assertEquals("탈퇴한 회원", service.detail(s.id).authorNickname)
        `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenThrow(CoreAuthException(503, "CORE_MEMBER_UNAVAILABLE", "회원 정보 서비스를 사용할 수 없습니다."))
        assertEquals(503, assertThrows(CoreAuthException::class.java) { service.detail(s.id) }.status)
    }

    @Test fun `list pairs each world with its saved name, active card count, relation count and one Core lookup`() {
        val x = Seed(name = "하나")
        val y = Seed(name = "둘", genre = null)
        `when`(graph.read(y.id)).thenThrow(WorldStudioFailure.unavailable())
        stubPage(listOf(x, y), PageRequest.of(0, 24), 30)
        `when`(nicknames.nicknames(listOf(x.owner.toString(), y.owner.toString()))).thenReturn(mapOf(x.owner.toString() to "작가 하나"))
        val page = service.list(null, null, null)
        assertEquals(PublicWorldPageResponse(listOf(
            PublicWorldSummaryResponse(x.id, "하나", "하나 설명", "fantasy", "작가 하나", 2, 1, "2026-11-11T01:02:03Z"),
            PublicWorldSummaryResponse(y.id, "둘", "둘 설명", null, "탈퇴한 회원", 2, 0, "2026-11-11T01:02:03Z"),
        ), 0, 24, 30), page)
        verify(nicknames, times(1)).nicknames(listOf(x.owner.toString(), y.owner.toString()))
    }

    @Test fun `list hides a world whose current revision is not sealed like detail does and asks Core only for the shown authors`() {
        val shown = Seed(name = "확정된 세계")
        val unsealed = Seed(name = "확정 전 세계").also { it.revision.sealed = false }
        stubPage(listOf(shown, unsealed), PageRequest.of(0, 24), 2)
        `when`(nicknames.nicknames(listOf(shown.owner.toString()))).thenReturn(mapOf(shown.owner.toString() to "작가"))
        assertEquals(listOf(shown.id), service.list(null, null, null).items.map { it.id })
        verify(nicknames).nicknames(listOf(shown.owner.toString()))
        verifyNoMoreInteractions(nicknames)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.detail(unsealed.id) }.status)
    }

    @Test fun `list filters by genre and window, and a blank genre means all`() {
        val s = Seed(genre = "sf")
        stubPage(listOf(s), PageRequest.of(1, 10), 11, genre = "sf")
        val page = service.list("sf", "1", "10")
        assertEquals(listOf(s.id), page.items.map { it.id })
        assertEquals(1, page.page)
        assertEquals(10, page.size)
        assertEquals(11L, page.total)
        verify(worlds).listedByGenre("sf", PageRequest.of(1, 10))
        verifyNoMoreInteractions(worlds)

        val all = Seed()
        stubPage(listOf(all), PageRequest.of(0, 24), 1)
        assertEquals(listOf(all.id), service.list("", null, null).items.map { it.id })
        verify(worlds).listed(PageRequest.of(0, 24))
    }

    @Test fun `an empty page skips every follow-up lookup`() {
        `when`(worlds.listed(PageRequest.of(2, 24))).thenReturn(PageImpl(emptyList(), PageRequest.of(2, 24), 5))
        assertEquals(PublicWorldPageResponse(emptyList(), 2, 24, 5), service.list(null, "2", null))
        verifyNoInteractions(revisions, revisionCards, states, graph)
    }

    @Test fun `list rejects an unknown genre and bad paging with 422 before any query`() {
        listOf(Triple("romcom", null, null), Triple(null, "-1", null), Triple(null, null, "101")).forEach { (genre, page, size) ->
            assertEquals(422, assertThrows(ContentFailure::class.java) { service.list(genre, page, size) }.status)
        }
        verifyNoInteractions(worlds, nicknames, graph)
    }

    @Test fun `hasCover tells the list and the detail whether a cover is stored`() {
        val withCover = Seed(name = "표지 있음", cover = true)
        val without = Seed(name = "표지 없음")
        stubPage(listOf(withCover, without), PageRequest.of(0, 24), 2)
        assertEquals(listOf(true, false), service.list(null, null, null).items.map { it.hasCover })
        assertTrue(service.detail(withCover.id).hasCover)
        assertFalse(service.detail(without.id).hasCover)
    }

    @Test fun `cover returns the stored image of a listed world with its type`() {
        val s = Seed(cover = true)
        val image = service.cover(s.id)
        assertEquals("image/png", image.contentType)
        assertArrayEquals(s.coverBytes, image.bytes)
    }

    @Test fun `cover is a 404 for private, never-saved, unsealed, cover-less and unknown worlds without reading storage`() {
        val hidden = Seed(visibility = "private", cover = true)
        val draftOnly = Seed(saved = false, cover = true)
        val unsealed = Seed(cover = true).also { it.revision.sealed = false }
        val none = Seed()
        listOf(hidden.id, draftOnly.id, unsealed.id, none.id, UUID.randomUUID()).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.cover(it) }.status)
        }
        verifyNoInteractions(storage)
    }

    @Test fun `a storage failure on a public cover keeps its status and is never turned into a 404`() {
        val s = Seed(cover = true)
        `when`(storage.read("world-covers/${s.id}")).thenThrow(AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요."))
        assertEquals(503, assertThrows(ContentFailure::class.java) { service.cover(s.id) }.status)
    }
}
