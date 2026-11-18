package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.attachment.client.AttachmentStorageClient
import ai.storyfork.content.attachment.client.dto.AttachmentObjectResult
import ai.storyfork.content.attachment.domain.AttachmentFailure
import ai.storyfork.content.attachment.repository.ContentImageRepository
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
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
import org.mockito.ArgumentMatchers.anyCollection
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import org.mockito.stubbing.OngoingStubbing
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
    private val images = mock(SettingCardImageRepository::class.java)
    private val states = mock(WorldRelationshipStateRepository::class.java)
    private val expandedSeeds = mock(ExpandedSeedProgressRepository::class.java)
    private val graph = mock(Neo4jRelationshipRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val storage = mock(AttachmentStorageClient::class.java)
    private val works = mock(WorkRepository::class.java)
    private val access = mock(WorkAccessService::class.java)
    private val workImages = mock(ContentImageRepository::class.java)
    private val publication = mock(PublicationService::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = PublicWorldService(worlds, revisions, revisionCards, cardVersions, images, states, expandedSeeds, graph, nicknames, storage, works, access, workImages, publication, manager)
    private val published = Instant.parse("2026-11-11T01:02:03Z")

    /**
     * 공개 세계관 하나와 그 저장소 대역이다. 마지막 저장 버전의 카드는 공개 둘([cards]로 바꿀 수 있다)·삭제 하나·비공개 둘이고,
     * 현재 관계는 공개 카드끼리 하나와 삭제 카드·저장 버전에 없는 카드·비공개 카드·작가 전용 카드를 가리키는 넷이다.
     * 공개 회차(DEC-53)는 첫 인물 1화, 비공개 인물 2화, 지운 인물 1화이고 둘째 인물은 회차가 없는 공개 카드라 1화부터 보인다(옛 공개 카드).
     * 작가 전용 인물은 비공개이고 회차도 없어 어느 기준 회차에서도 비작가에게 숨는다. [revealed]가 false이면 공개 회차 값을 모두 뺀다.
     */
    private inner class Seed(
        val owner: UUID = UUID.randomUUID(), visibility: String = "public", genre: String? = "fantasy",
        saved: Boolean = true, name: String = "저장된 세계", cover: Boolean = false, cards: String = "public", pictures: Boolean = false, revealed: Boolean = true,
    ) {
        val id: UUID = UUID.randomUUID()
        val coverBytes = byteArrayOf(1, 2, 3)
        val revisionId: UUID = UUID.randomUUID()
        /** [pictures]가 true이면 카드마다 대표 이미지가 있다(#401). 모두 이 세계관이 올린 이미지이고, [draftOnlyImage]는 어떤 확정 버전 카드도 가리키지 않는다(초안만 가리켰던 이미지). */
        val firstImage: UUID = UUID.randomUUID()
        val secondImage: UUID = UUID.randomUUID()
        val removedImage: UUID = UUID.randomUUID()
        val hiddenImage: UUID = UUID.randomUUID()
        val authorOnlyImage: UUID = UUID.randomUUID()
        val draftOnlyImage: UUID = UUID.randomUUID()
        val imageBytes = byteArrayOf(4, 5, 6)
        val first = card("첫 인물", visibility = cards, reveal = 1.takeIf { revealed }, image = firstImage.takeIf { pictures })
        val second = card("둘째 인물", visibility = cards, image = secondImage.takeIf { pictures })
        val removed = card("지운 인물", "removed", reveal = 1, image = removedImage.takeIf { pictures })
        /** 소유자가 공개로 바꾸지 않았지만 공개 회차(2화)가 있는 카드다(DEC-53): 기준 회차가 2화에 닿으면 공개 세계관·독자 위키·Fork 모두에 보인다. */
        val hidden = card("비공개 인물", visibility = "private", reveal = 2.takeIf { revealed }, image = hiddenImage.takeIf { pictures })
        /** 비공개이고 공개 회차도 없는 작가 전용 카드다. */
        val authorOnly = card("작가 전용 인물", visibility = "private", image = authorOnlyImage.takeIf { pictures })
        val versions = listOf(first, second, removed, hidden, authorOnly)
        val relations = listOf(
            RelationshipPayload(UUID.randomUUID(), first.cardId, second.cardId, "structural", label = "동료"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, removed.cardId, "structural", label = "삭제된 쪽"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, UUID.randomUUID(), "emotional", label = "초안에만 있는 쪽"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, hidden.cardId, "structural", label = "비공개 쪽"),
            RelationshipPayload(UUID.randomUUID(), first.cardId, authorOnly.cardId, "structural", label = "작가 전용 쪽"),
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
            graphReads(id) { it.thenReturn(RelationshipStateResult(id, 3, "key", "hash", relations)) }
            if (cover) `when`(storage.read("world-covers/$id")).thenReturn(AttachmentObjectResult(coverBytes))
            if (pictures) listOf(firstImage, secondImage, removedImage, hiddenImage, authorOnlyImage, draftOnlyImage).forEach {
                `when`(images.findById(it)).thenReturn(Optional.of(SettingCardImage(it, id, "world-card-images/${it}", "image/png")))
                `when`(storage.read("world-card-images/${it}")).thenReturn(AttachmentObjectResult(imageBytes))
            }
        }

        private fun card(title: String, lifecycle: String = "active", visibility: String = "public", reveal: Any? = null, image: UUID? = null) = SettingCardVersion(
            cardId = UUID.randomUUID(), worldId = id, versionNo = 1,
            fields = CardFields(title = title, body = "$title 본문", cardType = "character", aliases = listOf("별칭"), tags = listOf("태그"),
                semanticMetadata = mapOf("studio" to mapOf("item" to title)) + (reveal?.let { mapOf("revealFromEpisode" to it) } ?: emptyMap()) +
                    (image?.let { mapOf("imageId" to it.toString()) } ?: emptyMap()), visibility = visibility, lifecycle = lifecycle),
        )

        /** 목록 쿼리가 돌려줄 행(저장 버전의 모든 카드 버전)이다. 보일 카드는 서비스가 공개 회차 규칙으로 거른다. */
        val cardRows get() = versions.map { arrayOf<Any>(revisionId, it) }
    }

    /** 관계는 최신(null, 공개 목록·상세)이나 독자 기준 회차(upto, 독자 설정 위키)로 읽는다. 어느 쪽이든 같은 대답을 하도록 둘 다 스텁한다. */
    private fun graphReads(id: UUID, answer: (OngoingStubbing<RelationshipStateResult>) -> Unit) =
        listOf<Int?>(null, 0, 1, 2, 3, 5).forEach { answer(`when`(graph.read(id, it))) }

    private fun stubPage(seeds: List<Seed>, page: PageRequest, total: Long, genre: String? = null) {
        val result = PageImpl(seeds.map { it.world }, page, total)
        if (genre == null) `when`(worlds.listed(page)).thenReturn(result) else `when`(worlds.listedByGenre(genre, page)).thenReturn(result)
        `when`(revisions.findAllById(seeds.map { it.revisionId })).thenReturn(seeds.map { it.revision })
        `when`(revisionCards.cardVersionsOf(seeds.map { it.revisionId })).thenReturn(seeds.flatMap { it.cardRows })
        `when`(states.findAllById(seeds.map { it.id })).thenReturn(seeds.map { it.state })
    }

    @Test fun `a deleted world is not found for detail cover and card image even though it is public and saved`() {
        val s = Seed(cover = true, pictures = true)
        s.world.deletedAt = Instant.now()
        listOf({ service.detail(s.id) }, { service.cover(s.id) }, { service.cardImage(s.id, s.firstImage) }).forEach { read ->
            assertEquals(404, assertThrows(ContentFailure::class.java) { read() }.status)
        }
        verifyNoInteractions(graph, storage)
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
        assertEquals(listOf(PublicWorldRelationshipResponse(s.relations[0].id, s.first.cardId, s.second.cardId, "동료",category="structural")), result.relationships)
        assertEquals("current", result.relationshipStatus)
    }

    @Test fun `a public world whose cards are all author-only is still listed and readable, with no card and no relation`() {
        val s = Seed(cards = "private", revealed = false)
        stubPage(listOf(s), PageRequest.of(0, 24), 1)
        val item = service.list(null, null, null).items.single()
        assertEquals(s.id, item.id)
        assertEquals(0, item.cardCount)
        assertEquals(0, item.relationshipCount)
        val detail = service.detail(s.id)
        assertTrue(detail.cards.isEmpty())
        assertTrue(detail.relationships.isEmpty())
        assertEquals("current", detail.relationshipStatus)
    }

    private fun readerCard(card: SettingCardVersion, from: Int) =
        ReaderWorldCardResponse(card.cardId, card.fields.title, card.fields.body, "character", listOf("별칭"), listOf("태그"), from)

    @Test fun `reader cards are the active cards revealed up to the episode whatever the world and card visibility, with only the relations between them`() {
        // 세계관도 비공개다: 독자 위키는 세계관 공개와 별개로 카드의 유효 공개 회차(DEC-53)만 본다.
        val s = Seed(visibility = "private")
        assertEquals(ReaderWorldCardsResponse("work", s.id, 2,
            listOf(readerCard(s.first, 1), readerCard(s.second, 1), readerCard(s.hidden, 2)).sortedBy { it.id.toString() },
            listOf(PublicWorldRelationshipResponse(s.relations[0].id, s.first.cardId, s.second.cardId, "동료", category = "structural"),
                PublicWorldRelationshipResponse(s.relations[3].id, s.first.cardId, s.hidden.cardId, "비공개 쪽", category = "structural")), "current"),
            service.readerCards("work", s.id, 2))
        // 1화 기준이면 2화부터 공개되는 카드와 그 카드에 닿는 관계가 아직 없다. 회차가 없는 공개 카드(둘째 인물)는 1화부터 보인다.
        val early = service.readerCards("work", s.id, 1)
        assertEquals(listOf(s.first.cardId, s.second.cardId).sortedBy { it.toString() }, early.cards.map { it.id })
        assertEquals(listOf(s.relations[0].id), early.relationships.map { it.id })
        assertEquals("current", early.relationshipStatus)
        verifyNoInteractions(nicknames)
    }

    @Test fun `every exit reads the relations as of its own basis episode and never the latest`() {
        val s = Seed(visibility = "private")
        service.readerCards("work", s.id, 2)
        verify(graph).read(s.id, 2)
        service.readerCards("work", s.id, 1)
        verify(graph).read(s.id, 1)
        verify(graph, never()).read(s.id, null)
        // 공개 세계관: 연결이 없으면 기준 회차 1, 연결된 공개 소설이 있으면 그 소설의 발행된 마지막 회차 시점이다(최신이 아니다, DEC-53).
        val open = Seed()
        service.detail(open.id)
        verify(graph).read(open.id, 1)
        val linked = Seed()
        linkWork(linked, published = listOf(1, 2, 3))
        service.detail(linked.id)
        verify(graph).read(linked.id, 3)
        verify(graph, never()).read(open.id, null)
        verify(graph, never()).read(linked.id, null)
    }

    @Test fun `reader cards are empty without reading Neo4j when the world has no sealed revision, is unknown or reveals nothing yet`() {
        val draftOnly = Seed(saved = false)
        val unsealed = Seed().also { it.revision.sealed = false }
        val nothingYet = Seed()
        listOf(draftOnly.id to 5, unsealed.id to 5, UUID.randomUUID() to 5, nothingYet.id to 0).forEach { (world, upto) ->
            assertEquals(ReaderWorldCardsResponse("work", world, upto), service.readerCards("work", world, upto))
        }
        verifyNoInteractions(graph)
    }

    @Test fun `reader cards of a deleted world are empty like a missing one and its card images are 404 without reading Neo4j or storage`() {
        val s = Seed(pictures = true)
        s.world.deletedAt = Instant.now()
        assertEquals(ReaderWorldCardsResponse("work", s.id, 2), service.readerCards("work", s.id, 2))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.readerCardImage(s.id, 2, s.firstImage) }.status)
        verifyNoInteractions(graph, storage)
    }

    @Test fun `reader cards stay and the relations say unavailable when the relation store cannot vouch for the current state`() {
        val pending = Seed()
        pending.state.completed = false
        val failing = Seed()
        graphReads(failing.id) { it.thenThrow(WorldStudioFailure.unavailable()) }
        listOf(pending, failing).forEach { s ->
            val result = service.readerCards("work", s.id, 2)
            assertEquals(listOf(s.first.cardId, s.second.cardId, s.hidden.cardId).sortedBy { it.toString() }, result.cards.map { it.id })
            assertTrue(result.relationships.isEmpty())
            assertEquals("unavailable", result.relationshipStatus)
        }
    }

    /** Fork가 이어받는 카드: 작가용 메타데이터(`studio`·인물 문서·이미지)는 없고 독자 공개 회차만 남는다. */
    private fun inheritedCard(card: SettingCardVersion, from: Int) = CardPayload(card.cardId, card.fields.title, card.fields.body, "character", "basic",
        aliases = listOf("별칭"), tags = listOf("태그"), semanticMetadata = mapOf("revealFromEpisode" to from), visibility = "public")

    @Test fun `an inherited world is the same cards as the reader wiki up to the basis episode, without author-only values`() {
        val s = Seed(visibility = "private")
        // 독자 위키와 같은 카드 집합이고 상한만 Fork 기준 회차다(DEC-53). 공개 여부와 무관하게 비공개 카드(hidden)도 공개 회차(2화)에 닿으면 이어받고,
        // 회차가 없는 공개 카드(second)는 1화부터다. 작가 전용 카드(authorOnly)는 빠진다.
        assertEquals(InheritedWorldResponse("fork", s.id, 2,
            listOf(inheritedCard(s.first, 1), inheritedCard(s.second, 1), inheritedCard(s.hidden, 2)).sortedBy { it.id.toString() },
            listOf(s.relations[0], s.relations[3]), "current", 3), service.inheritedWorld("fork", s.id, 2))
        assertEquals(listOf(s.first.cardId, s.second.cardId).sortedBy { it.toString() }, service.inheritedWorld("fork", s.id, 1).cards.map { it.id })
        verifyNoInteractions(nicknames)
    }

    @Test fun `inherited relations are the ones between inherited cards as of the basis episode, without the author's relation text`() {
        val s = Seed()
        val ally = SettingCardVersion(cardId = UUID.randomUUID(), worldId = s.id, versionNo = 1, fields = CardFields(title = "동료", body = "동료 본문",
            cardType = "character", visibility = "public", semanticMetadata = mapOf("studio" to "작가용", "revealFromEpisode" to 1)))
        val all = s.versions + ally
        `when`(revisionCards.findAllByIdRevisionId(s.revisionId)).thenReturn(all.map { WorldRevisionCard(RevisionCardKey(s.revisionId, it.cardId), s.id, it.id) })
        `when`(cardVersions.findAllById(all.map { it.id })).thenReturn(all)
        val denied = RelationshipPayload(UUID.randomUUID(), s.first.cardId, ally.cardId, "emotional", body = "작가만 아는 사정", label = "스승",
            direction = "directed", polarity = "denied", semanticMetadata = mapOf("memo" to "작가용"))
        graphReads(s.id) { it.thenReturn(RelationshipStateResult(s.id, 3, "key", "hash", s.relations + denied)) }

        val inherited = service.inheritedWorld("fork", s.id, 2)

        // 이어받은 카드끼리의 관계만 남는다: 삭제·작가 전용 카드나 저장 버전에 없는 카드에 닿는 관계는 빠진다.
        // 방향·부정 여부는 관계의 뜻을 바꾸므로 남기고, 작가가 관계에 적은 본문·메모는 싣지 않는다.
        assertEquals(listOf(s.relations[0], s.relations[3], denied).map { it.copy(body = "", semanticMetadata = emptyMap()) }, inherited.relationships)
        assertEquals("current", inherited.relationshipStatus)
        verify(graph).read(s.id, 2)
        verify(graph, never()).read(s.id, null)
    }

    @Test fun `inherited cards stay and the relations say unavailable when the relation store cannot vouch for the basis episode`() {
        val pending = Seed().also { it.state.completed = false }
        val failing = Seed().also { s -> graphReads(s.id) { it.thenThrow(WorldStudioFailure.unavailable()) } }
        listOf(pending, failing).forEach { s ->
            val result = service.inheritedWorld("fork", s.id, 2)
            assertEquals(listOf(s.first.cardId, s.second.cardId, s.hidden.cardId).sortedBy { it.toString() }, result.cards.map { it.id })
            assertTrue(result.relationships.isEmpty())
            assertEquals("unavailable", result.relationshipStatus)
        }
    }

    @Test fun `an inherited world is empty without reading Neo4j when the world has no sealed revision, is unknown or reveals no card`() {
        val draftOnly = Seed(saved = false)
        val unsealed = Seed().also { it.revision.sealed = false }
        val allPrivate = Seed(cards = "private", revealed = false)
        listOf(draftOnly.id, unsealed.id, UUID.randomUUID(), allPrivate.id).forEach { world ->
            assertEquals(InheritedWorldResponse("fork", world, 2), service.inheritedWorld("fork", world, 2))
        }
        verifyNoInteractions(graph)
    }

    @Test fun `detail is 404 for private, never-saved and unknown worlds without touching Core or Neo4j`() {
        val hidden = Seed(visibility = "private")
        val draftOnly = Seed(saved = false)
        listOf(hidden.id, draftOnly.id, UUID.randomUUID()).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.detail(it) }.status)
        }
        verifyNoInteractions(graph, nicknames, cardVersions, works, access, workImages, publication)
    }

    private fun assertCardsWithoutRelations(s: Seed) {
        val result = service.detail(s.id)
        assertEquals("unavailable", result.relationshipStatus)
        assertTrue(result.relationships.isEmpty())
        assertEquals(2, result.cards.size)
    }

    @Test fun `incomplete expansion hides relations while keeping confirmed cards in detail list and wiki`() {
        val s=Seed()
        `when`(expandedSeeds.findById(s.id)).thenReturn(Optional.of(ExpandedSeedProgress(s.id,"hash")))
        assertCardsWithoutRelations(s)
        assertEquals("unavailable",service.readerCards("work",s.id,2).relationshipStatus)
        stubPage(listOf(s),PageRequest.of(0,24),1)
        assertNull(service.list(null,null,null).items.single().relationshipCount)
        verify(graph,never()).read(s.id,null)
        verify(graph,never()).read(s.id,2)
    }

    @Test fun `expansion beginning during graph read makes the result unavailable`() {
        val s=Seed()
        `when`(expandedSeeds.findById(s.id)).thenReturn(Optional.empty(),Optional.of(ExpandedSeedProgress(s.id,"hash")))
        assertCardsWithoutRelations(s)
    }
    @Test fun `new confirmed revision during graph read makes the old snapshot unavailable`() {
        val s=Seed()
        `when`(graph.read(s.id,1)).thenAnswer {
            s.world.currentRevisionId=UUID.randomUUID()
            RelationshipStateResult(s.id,3,"key","hash",s.relations)
        }
        assertCardsWithoutRelations(s)
    }
    @Test fun `changed graph token during read makes the old snapshot unavailable`() {
        val s=Seed()
        `when`(graph.read(s.id,1)).thenAnswer {
            s.state.graphVersion=4
            RelationshipStateResult(s.id,3,"key","hash",s.relations)
        }
        assertCardsWithoutRelations(s)
    }

    @Test fun `public detail and reader wiki retain relation direction polarity and evidence`() {
        val s=Seed()
        val edge=s.relations.first().copy(targetCardId=s.hidden.cardId,body="원전 근거",direction="directed",polarity="denied")
        graphReads(s.id) { it.thenReturn(RelationshipStateResult(s.id,3,"key","hash",listOf(edge))) }
        val publicEdge=edge.copy(targetCardId=s.second.cardId)
        `when`(graph.read(s.id,1)).thenReturn(RelationshipStateResult(s.id,3,"key","hash",listOf(publicEdge)))
        val detail=service.detail(s.id).relationships.single()
        val wiki=service.readerCards("work",s.id,2).relationships.single()
        assertEquals("directed",detail.direction);assertEquals("denied",detail.polarity);assertEquals("원전 근거",detail.body)
        assertEquals("directed",wiki.direction);assertEquals("denied",wiki.polarity);assertEquals("원전 근거",wiki.body)
    }

    @Test fun `unmigrated and pending worlds keep their cards, say unavailable and never read Neo4j`() {
        val unmigrated = Seed()
        `when`(states.findById(unmigrated.id)).thenReturn(Optional.empty())
        assertCardsWithoutRelations(unmigrated)
        val pending = Seed()
        pending.state.completed = false
        assertCardsWithoutRelations(pending)
        verify(graph, never()).read(unmigrated.id, 1)
        verify(graph, never()).read(pending.id, 1)
    }

    @Test fun `a failed or mismatched Neo4j read keeps the cards and says unavailable instead of a 500`() {
        val failing = Seed()
        `when`(graph.read(failing.id, 1)).thenThrow(WorldStudioFailure.unavailable())
        assertCardsWithoutRelations(failing)
        val stale = Seed()
        `when`(graph.read(stale.id, 1)).thenReturn(RelationshipStateResult(stale.id, 4, "key", "hash", stale.relations))
        assertCardsWithoutRelations(stale)
        val foreign = Seed()
        `when`(graph.read(foreign.id, 1)).thenReturn(RelationshipStateResult(UUID.randomUUID(), 3, "key", "hash", foreign.relations))
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
        `when`(graph.read(y.id, 1)).thenThrow(WorldStudioFailure.unavailable())
        stubPage(listOf(x, y), PageRequest.of(0, 24), 30)
        `when`(nicknames.nicknames(listOf(x.owner.toString(), y.owner.toString()))).thenReturn(mapOf(x.owner.toString() to "작가 하나"))
        val page = service.list(null, null, null)
        assertEquals(PublicWorldPageResponse(listOf(
            PublicWorldSummaryResponse(x.id, "하나", "하나 설명", "fantasy", "작가 하나", 2, 1, "2026-11-11T01:02:03Z"),
            PublicWorldSummaryResponse(y.id, "둘", "둘 설명", null, "탈퇴한 회원", 2, null, "2026-11-11T01:02:03Z"),
        ), 0, 24, 30), page)
        verify(nicknames, times(1)).nicknames(listOf(x.owner.toString(), y.owner.toString()))
        verifyNoInteractions(access, workImages, publication) // 연결이 없으면 소설은 읽지 않는다. 연결된 소설의 정보(linkedWork)는 상세에만 싣는다(#329)
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
        verify(worlds).findById(s.id)
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

    /** [seed]의 세계관에 연결된 소설 하나(`work.world_studio_id`)와 그 접근 결과다. 공개 판정은 [WorkAccessResult.publiclyVisible]이 하므로 공개 범위·제한·삭제 값으로 만든다. */
    private fun linkWork(
        seed: Seed, owner: String = UUID.randomUUID().toString(), visibility: String = "public", restricted: Boolean = false, deleted: Boolean = false, cover: Boolean = false,
        published: List<Int> = listOf(1, 2, 3),
    ): String {
        val workId = UUID.randomUUID().toString()
        `when`(works.findAllByWorldStudioIdIn(listOf(seed.id))).thenReturn(listOf(WorkEntity(id = workId, ownerId = owner, title = "연결된 소설", worldStudioId = seed.id)))
        `when`(access.get(workId)).thenReturn(WorkAccessResult(workId, owner, "연결된 소설", "", 1, "legacy-world", visibility, false, false, null, restricted, deleted))
        `when`(workImages.countByWorkIdAndEpisodeNo(workId, 0)).thenReturn(if (cover) 1L else 0L)
        `when`(publication.publishedEpisodes(workId)).thenReturn(PublishedEpisodeListResponse(published.map { PublishedEpisodeResponse(it, 1, "v${it}", "${it}화", "본문") }))
        return workId
    }

    @Test fun `detail carries the minimal info of the public work linked to the world, with its author from the same single Core lookup`() {
        val s = Seed()
        val workOwner = UUID.randomUUID().toString()
        val workId = linkWork(s, workOwner, cover = true)
        `when`(nicknames.nicknames(listOf(s.owner.toString(), workOwner))).thenReturn(mapOf(s.owner.toString() to "세계관 작가", workOwner to "소설 작가"))
        val result = service.detail(s.id)
        assertEquals(PublicWorldLinkedWorkResponse(workId, "연결된 소설", "소설 작가", true), result.linkedWork)
        assertEquals("세계관 작가", result.authorNickname)
        verify(nicknames, times(1)).nicknames(listOf(s.owner.toString(), workOwner))
        verifyNoMoreInteractions(nicknames)
    }

    @Test fun `the owner who wrote the linked work is asked of Core once, and a work without a stored cover says so`() {
        val s = Seed()
        val workId = linkWork(s, s.owner.toString())
        `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenReturn(mapOf(s.owner.toString() to "작가"))
        assertEquals(PublicWorldLinkedWorkResponse(workId, "연결된 소설", "작가", false), service.detail(s.id).linkedWork)
        verify(nicknames, times(1)).nicknames(listOf(s.owner.toString()))
        verifyNoMoreInteractions(nicknames)
    }

    @Test fun `a linked work whose author Core no longer knows is shown with the withdrawn member name`() {
        val s = Seed()
        val workOwner = UUID.randomUUID().toString()
        linkWork(s, workOwner)
        `when`(nicknames.nicknames(listOf(s.owner.toString(), workOwner))).thenReturn(mapOf(s.owner.toString() to "세계관 작가"))
        assertEquals("탈퇴한 회원", service.detail(s.id).linkedWork!!.authorNickname)
    }

    @Test fun `a private, restricted or deleted linked work is not revealed and its author is not looked up`() {
        listOf(Triple("private", false, false), Triple("public", true, false), Triple("public", false, true)).forEach { (visibility, restricted, deleted) ->
            val s = Seed()
            linkWork(s, visibility = visibility, restricted = restricted, deleted = deleted, cover = true)
            `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenReturn(mapOf(s.owner.toString() to "작가"))
            val result = service.detail(s.id)
            assertNull(result.linkedWork, "${visibility}/${restricted}/${deleted}")
            assertEquals("작가", result.authorNickname)
            verify(nicknames).nicknames(listOf(s.owner.toString()))
        }
        verifyNoMoreInteractions(nicknames)
        verifyNoInteractions(workImages)
    }

    @Test fun `a world with no linked work has none and Core is asked only for the world's author`() {
        val s = Seed()
        `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenReturn(mapOf(s.owner.toString() to "작가"))
        assertNull(service.detail(s.id).linkedWork)
        verify(nicknames, times(1)).nicknames(listOf(s.owner.toString()))
        verifyNoMoreInteractions(nicknames)
        verifyNoInteractions(access, workImages)
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

    // --- 공개 세계관의 기준 회차(DEC-53): 연결된 공개 소설의 발행된 마지막 회차, 연결이 없으면 1 ---

    @Test fun `the public list reads the page's linked works and their last published episodes in two queries and counts each world at its own basis episode`() {
        val seeds = listOf(Seed(name = "미연결"), Seed(name = "공개 소설 3화"), Seed(name = "비공개 소설"), Seed(name = "공개 소설 발행 전"), Seed(name = "미연결 둘째"))
        val (unlinked, published, private, nothingYet, unlinkedToo) = seeds
        // 연결된 소설 셋: 3화까지 발행한 공개 작품·공개 작품이 아닌 것·발행한 회차가 없는 공개 작품. 공개 작품만 마지막 발행 회차 쿼리에 행이 있다(발행이 없으면 0).
        val workOf = listOf(published, private, nothingYet).associateWith { WorkEntity(id = "work-${it.id}", ownerId = "owner", title = "소설", worldStudioId = it.id) }
        `when`(works.findAllByWorldStudioIdIn(seeds.map { it.id })).thenReturn(workOf.values.toList())
        `when`(works.lastPublishedOfPublicWorks(workOf.values.map { it.id })).thenReturn(listOf(arrayOf<Any>(workOf.getValue(published).id, 3), arrayOf<Any>(workOf.getValue(nothingYet).id, 0)))
        stubPage(seeds, PageRequest.of(0, 24), 5)
        val items = service.list(null, null, null).items
        // 미연결은 1화 기준(첫 인물·둘째 인물, 관계 1), 3화까지 발행한 공개 작품은 공개 회차 2화인 비공개 인물과 그 관계까지, 공개 작품이 아니거나 발행 전이면 기준 0이라 카드·관계가 없다.
        assertEquals(listOf(2, 3, 0, 0, 2), items.map { it.cardCount })
        assertEquals(listOf(1, 2, 0, 0, 1), items.map { it.relationshipCount })
        verify(graph).read(unlinked.id, 1)
        verify(graph).read(published.id, 3)
        verify(graph).read(private.id, 0)
        verify(graph).read(unlinkedToo.id, 1)
        // 세계관이 몇 개든 연결 작품 조회 한 번과 공개 작품의 발행 회차 조회 한 번뿐이다. 작품 접근·발행 회차(본문 포함)를 세계관마다 읽지 않는다.
        verify(works, times(1)).findAllByWorldStudioIdIn(anyCollection())
        verify(works, times(1)).lastPublishedOfPublicWorks(anyCollection())
        verifyNoInteractions(access, publication, workImages)
    }

    // --- 설정 카드 대표 이미지(#401) ---
    @Test fun `public and reader cards carry the image id of their card, or null`() {
        val s = Seed(pictures = true)
        `when`(nicknames.nicknames(listOf(s.owner.toString()))).thenReturn(mapOf(s.owner.toString() to "작가"))
        assertEquals(mapOf(s.first.cardId to s.firstImage, s.second.cardId to s.secondImage), service.detail(s.id).cards.associate { it.id to it.imageId })
        // 독자 설정 위키는 독자 공개 회차까지 열린 카드의 이미지이며 비공개 카드(2화부터)도 포함한다.
        assertEquals(mapOf(s.first.cardId to s.firstImage, s.second.cardId to s.secondImage, s.hidden.cardId to s.hiddenImage), service.readerCards("work", s.id, 2).cards.associate { it.id to it.imageId })
        val plain = Seed()
        assertTrue(service.detail(plain.id).cards.all { it.imageId == null })
        assertTrue(service.readerCards("work", plain.id, 2).cards.all { it.imageId == null })
    }

    @Test fun `a card whose imageId is not a UUID shows no image`() {
        val s = Seed()
        val broken = SettingCardVersion(cardId = UUID.randomUUID(), worldId = s.id, versionNo = 1,
            fields = CardFields(title = "깨진 이미지", body = "본문", cardType = "character", semanticMetadata = mapOf("imageId" to "1-1-1-1-1", "revealFromEpisode" to 1), visibility = "public"))
        `when`(revisionCards.findAllByIdRevisionId(s.revisionId)).thenReturn(listOf(WorldRevisionCard(RevisionCardKey(s.revisionId, broken.cardId), s.id, broken.id)))
        `when`(cardVersions.findAllById(listOf(broken.id))).thenReturn(listOf(broken))
        assertNull(service.detail(s.id).cards.single().imageId)
        assertNull(service.readerCards("work", s.id, 1).cards.single().imageId)
    }

    @Test fun `a public card image is the stored image of an active public card of the confirmed version`() {
        val s = Seed(pictures = true)
        listOf(s.firstImage, s.secondImage).forEach {
            val image = service.cardImage(s.id, it)
            assertEquals("image/png", image.contentType)
            assertArrayEquals(s.imageBytes, image.bytes)
        }
    }

    @Test fun `a public card image is a 404 unless a shown card of the confirmed version points at it, and storage is not read`() {
        val s = Seed(pictures = true)
        // 비공개 카드·삭제 카드의 이미지, 확정 버전의 어떤 카드도 가리키지 않는 이미지(초안만 가리켰던 것), 없는 ID.
        listOf(s.hiddenImage, s.authorOnlyImage, s.removedImage, s.draftOnlyImage, UUID.randomUUID()).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.cardImage(s.id, it) }.status)
        }
        verify(storage, never()).read(anyString())
    }

    @Test fun `a card pointing at an image row of another world shows no image`() {
        val s = Seed(pictures = true)
        `when`(images.findById(s.firstImage)).thenReturn(Optional.of(SettingCardImage(s.firstImage, UUID.randomUUID(), "world-card-images/${s.firstImage}", "image/png")))
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.cardImage(s.id, s.firstImage) }.status)
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.readerCardImage(s.id, 1, s.firstImage) }.status)
        verify(storage, never()).read(anyString())
    }

    @Test fun `a public card image is a 404 for private, never-saved, unsealed and unknown worlds`() {
        val hidden = Seed(visibility = "private", pictures = true)
        val draftOnly = Seed(saved = false, pictures = true)
        val unsealed = Seed(pictures = true).also { it.revision.sealed = false }
        listOf(hidden, draftOnly, unsealed).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.cardImage(it.id, it.firstImage) }.status)
        }
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.cardImage(UUID.randomUUID(), UUID.randomUUID()) }.status)
        verify(storage, never()).read(anyString())
    }

    @Test fun `a storage failure on a public card image keeps its status`() {
        val s = Seed(pictures = true)
        `when`(storage.read("world-card-images/${s.firstImage}")).thenThrow(AttachmentFailure(503, "ATTACHMENT_STORAGE_FAILURE", "첨부 저장소 요청을 완료하지 못했어요. 다시 시도해 주세요."))
        assertEquals(503, assertThrows(ContentFailure::class.java) { service.cardImage(s.id, s.firstImage) }.status)
        assertEquals(503, assertThrows(ContentFailure::class.java) { service.readerCardImage(s.id, 1, s.firstImage) }.status)
    }

    @Test fun `a reader card image is the image of a card revealed up to the episode whatever the world and card visibility`() {
        // 세계관도 비공개다: 독자 공개는 세계관 공개·카드 공개와 별개로 카드의 독자 공개 회차만 본다.
        val s = Seed(visibility = "private", pictures = true)
        assertArrayEquals(s.imageBytes, service.readerCardImage(s.id, 1, s.firstImage).bytes)
        assertEquals("image/png", service.readerCardImage(s.id, 2, s.hiddenImage).contentType)
        // 회차가 없는 공개 카드(둘째 인물)는 1화부터 보인다.
        assertArrayEquals(s.imageBytes, service.readerCardImage(s.id, 1, s.secondImage).bytes)
        assertArrayEquals(s.imageBytes, service.readerCardImage(s.id, 9, s.firstImage).bytes)
    }

    @Test fun `a reader card image is a 404 for a card not revealed yet, never revealed, removed or only in the draft, and storage is not read`() {
        val s = Seed(pictures = true)
        listOf(
            1 to s.hiddenImage,     // 2화부터 공개
            9 to s.authorOnlyImage, // 비공개이고 공개 회차도 없는 작가 전용 카드다
            9 to s.removedImage,    // 삭제된 카드
            9 to s.draftOnlyImage,  // 확정 버전의 카드가 가리키지 않는다
            9 to UUID.randomUUID(),
        ).forEach { (upto, image) ->
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.readerCardImage(s.id, upto, image) }.status)
        }
        verify(storage, never()).read(anyString())
    }

    @Test fun `a reader card image is a 404 for a world without a sealed revision or an unknown world`() {
        val draftOnly = Seed(saved = false, pictures = true)
        val unsealed = Seed(pictures = true).also { it.revision.sealed = false }
        listOf(draftOnly, unsealed).forEach {
            assertEquals(404, assertThrows(ContentFailure::class.java) { service.readerCardImage(it.id, 9, it.firstImage) }.status)
        }
        assertEquals(404, assertThrows(ContentFailure::class.java) { service.readerCardImage(UUID.randomUUID(), 9, UUID.randomUUID()) }.status)
        verify(storage, never()).read(anyString())
        verifyNoInteractions(graph)
    }
}
