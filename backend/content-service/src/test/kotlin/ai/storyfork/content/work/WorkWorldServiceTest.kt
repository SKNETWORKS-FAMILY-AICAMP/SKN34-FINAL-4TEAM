package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fork.entity.ForkWorldReferenceEntity
import ai.storyfork.content.fork.repository.ForkWorldReferenceRepository
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldCoverImage
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyCollection
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * 세계관-소설 1:1 연결과 독자 설정 위키 조립(DEC-46): 저장소·공개 세계관 조회는 대역이다.
 * 실제 UNIQUE 제약·HTTP·보안은 CI의 WorkWorldHttpIntegrationTest가 확인한다.
 */
class WorkWorldServiceTest {
    private val owner = UUID.randomUUID().toString()
    private val world = UUID.randomUUID()
    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val publication = mock(PublicationService::class.java)
    private val studios = mock(StudioWorldRepository::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val references = mock(ForkWorldReferenceRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val service = WorkWorldService(access, works, publication, studios, publicWorlds, references, TransactionTemplate(manager))
    private val row = WorkEntity(id = "work", ownerId = owner, title = "작품", revision = 4)

    /** 요청자가 가진 세계관과 작품 행이다. */
    private fun owned() {
        `when`(studios.findById(world)).thenReturn(Optional.of(StudioWorld(world, UUID.fromString(owner))))
        `when`(works.findById("work")).thenReturn(Optional.of(row))
    }
    private fun work(visibility: String = "public", restricted: Boolean = false, deleted: Boolean = false) =
        WorkAccessResult("work", owner, "작품", "", 4, "legacy-world", visibility, false, false, null, restricted, deleted)
    private fun published(vararg numbers: Int) {
        `when`(publication.publishedEpisodes("work")).thenReturn(PublishedEpisodeListResponse(numbers.map { PublishedEpisodeResponse(it, 1, "v$it", "${it}화", "본문") }))
    }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }

    @Test fun `links a world the caller owns to a work the caller owns and leaves the work revision alone`() {
        owned()

        assertEquals(WorkWorldLinkResponse("work", world), service.link("work", owner, world))

        assertEquals(world, row.worldStudioId)
        assertEquals(4, row.revision)
        val order = inOrder(access, works)
        order.verify(access).own("work", owner)
        order.verify(works).saveAndFlush(row)
    }

    @Test fun `linking the same world again is the same answer and null unlinks without reading any world`() {
        owned()
        row.worldStudioId = world

        assertEquals(WorkWorldLinkResponse("work", world), service.link("work", owner, world))
        assertEquals(WorkWorldLinkResponse("work", null), service.link("work", owner, null))

        assertNull(row.worldStudioId)
        verify(studios, times(1)).findById(world)
    }

    @Test fun `a missing world or one owned by someone else is 404 before the work is touched`() {
        `when`(studios.findById(world)).thenReturn(Optional.of(StudioWorld(world, UUID.randomUUID())))

        listOf(world, UUID.randomUUID()).forEach { assertEquals(404, failure { service.link("work", owner, it) }.status) }

        verifyNoInteractions(access, works)
    }

    @Test fun `a deleted world cannot be linked and is 404 before the work is touched`() {
        `when`(studios.findById(world)).thenReturn(Optional.of(StudioWorld(world, UUID.fromString(owner), deletedAt = java.time.Instant.now())))

        assertEquals(404, failure { service.link("work", owner, world) }.status)

        verifyNoInteractions(access, works)
    }

    @Test fun `a work that is not the caller's is 404 and nothing is saved`() {
        owned()
        `when`(access.own("work", owner)).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.link("work", owner, world) }.status)

        assertNull(row.worldStudioId)
        verify(works, never()).saveAndFlush(any())
    }

    @Test fun `a world already linked to another work is 409 WORLD_ALREADY_LINKED from the unique constraint and the write is rolled back`() {
        owned()
        `when`(works.saveAndFlush(row)).thenThrow(DataIntegrityViolationException("work_world_studio_id_key"))

        val conflict = failure { service.link("work", owner, world) }

        assertEquals(409, conflict.status)
        assertEquals("WORLD_ALREADY_LINKED", conflict.code)
        verify(manager).rollback(any())
        verify(manager, never()).commit(any())
    }

    @Test fun `linked work ids map each linked world to its work and skip the query when there is no world`() {
        val unlinked = UUID.randomUUID()
        row.worldStudioId = world
        `when`(works.findAllByWorldStudioIdIn(listOf(world, unlinked))).thenReturn(listOf(row))

        assertEquals(mapOf(world to "work"), service.linkedWorkIds(listOf(world, unlinked)))
        assertEquals(emptyMap<UUID, String>(), service.linkedWorkIds(emptyList()))

        verify(works, times(1)).findAllByWorldStudioIdIn(anyCollection())
    }

    @Test fun `reader cards ask the linked world for the requested episode capped at the last published one`() {
        row.worldStudioId = world
        `when`(access.get("work")).thenReturn(work())
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        published(1, 2, 3)
        val second = ReaderWorldCardsResponse("work", world, 2)
        val latest = ReaderWorldCardsResponse("work", world, 3)
        `when`(publicWorlds.readerCards("work", world, 2)).thenReturn(second)
        `when`(publicWorlds.readerCards("work", world, 3)).thenReturn(latest)

        assertSame(second, service.readerCards("work", "2"))
        // 발행된 마지막 회차(3화)를 넘는 요청과 upto 생략은 3화 기준이다. 아직 발행하지 않은 회차의 설정은 보이지 않는다.
        assertSame(latest, service.readerCards("work", "9"))
        assertSame(latest, service.readerCards("work", null))
    }

    @Test fun `a linked public work with no published episode asks for episode zero so nothing is revealed`() {
        row.worldStudioId = world
        `when`(access.get("work")).thenReturn(work())
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        published()
        val nothing = ReaderWorldCardsResponse("work", world, 0)
        `when`(publicWorlds.readerCards("work", world, 0)).thenReturn(nothing)

        assertSame(nothing, service.readerCards("work", "5"))
    }

    @Test fun `a private, restricted or unlinked work answers an empty wiki without reading any world`() {
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        published(1, 2)
        row.worldStudioId = world
        // 공개가 아닌 작품은 연결이 있어도 연결 여부조차 알리지 않는다.
        `when`(access.get("work")).thenReturn(work(visibility = "private"), work(restricted = true))
        assertEquals(ReaderWorldCardsResponse("work", null, 0), service.readerCards("work", "2"))
        assertEquals(ReaderWorldCardsResponse("work", null, 0), service.readerCards("work", "2"))
        // 공개 작품이지만 연결한 세계관이 없다.
        row.worldStudioId = null
        `when`(access.get("work")).thenReturn(work())
        assertEquals(ReaderWorldCardsResponse("work", null, 2), service.readerCards("work", "2"))

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `an unknown or deleted work is 404`() {
        `when`(access.get("missing")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        `when`(access.get("work")).thenReturn(work(deleted = true))

        listOf("missing", "work").forEach { assertEquals(404, failure { service.readerCards(it, null) }.status) }

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `a bad upto is 422 before any lookup`() {
        listOf("0", "-1", "x", "1.5").forEach { assertEquals(422, failure { service.readerCards("work", it) }.status) }

        verifyNoInteractions(access, works, publication, publicWorlds)
    }

    @Test fun `a reader card image asks the linked world for the same capped basis as the wiki`() {
        row.worldStudioId = world
        `when`(access.get("work")).thenReturn(work())
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        published(1, 2, 3)
        val image = UUID.randomUUID()
        val second = WorldCoverImage(byteArrayOf(2), "image/png")
        val latest = WorldCoverImage(byteArrayOf(3), "image/png")
        `when`(publicWorlds.readerCardImage(world, 2, image)).thenReturn(second)
        `when`(publicWorlds.readerCardImage(world, 3, image)).thenReturn(latest)

        assertSame(second, service.readerCardImage("work", image, "2"))
        // 발행된 마지막 회차(3화)를 넘는 요청과 upto 생략은 3화 기준이다.
        assertSame(latest, service.readerCardImage("work", image, "9"))
        assertSame(latest, service.readerCardImage("work", image, null))
    }

    @Test fun `a reader card image of a private, restricted or unlinked work is a 404 without reading any world`() {
        `when`(works.findById("work")).thenReturn(Optional.of(row))
        published(1, 2)
        row.worldStudioId = world
        `when`(access.get("work")).thenReturn(work(visibility = "private"), work(restricted = true))
        repeat(2) { assertEquals(404, failure { service.readerCardImage("work", UUID.randomUUID(), "2") }.status) }
        row.worldStudioId = null
        `when`(access.get("work")).thenReturn(work())
        assertEquals(404, failure { service.readerCardImage("work", UUID.randomUUID(), "2") }.status)

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `a reader card image of an unknown or deleted work is a 404`() {
        `when`(access.get("missing")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        `when`(access.get("work")).thenReturn(work(deleted = true))

        listOf("missing", "work").forEach { assertEquals(404, failure { service.readerCardImage(it, UUID.randomUUID(), null) }.status) }

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `a bad upto on a reader card image is 422 before any lookup`() {
        listOf("0", "-1", "x", "1.5").forEach { assertEquals(422, failure { service.readerCardImage("work", UUID.randomUUID(), it) }.status) }

        verifyNoInteractions(access, works, publication, publicWorlds)
    }

    // ---- Fork가 원작 세계관을 읽기 전용으로 이어받는다(DEC-32·37, #365) ----

    private val author = UUID.randomUUID().toString()
    private val sourceWorld = UUID.randomUUID()
    private val fork = WorkEntity(id = "fork", ownerId = owner, title = "분기", revision = 1)
    private val original = WorkEntity(id = "original", ownerId = author, title = "원작", revision = 1).also { it.worldStudioId = sourceWorld }
    private val basis2 = SourceResponse("original", "원작", 2, 1, "")

    /** 2화 기준 Fork의 소유자 읽기다. [status]가 null이면 추종 기록이 없고, [source]가 null이면 Fork가 아니다. */
    private fun forking(status: String? = "following", source: SourceResponse? = basis2) {
        `when`(access.own("fork", owner)).thenReturn(WorkAccessResult("fork", owner, "분기", "", 1, "legacy-world", "private", false, false, source))
        `when`(works.findById("fork")).thenReturn(Optional.of(fork))
        `when`(works.findById("original")).thenReturn(Optional.of(original))
        `when`(references.findById("fork")).thenReturn(Optional.ofNullable(status?.let { ForkWorldReferenceEntity("fork", "legacy-world", it) }))
    }
    private fun nothing() = InheritedWorldResponse("fork", null, 0)

    @Test fun `a following fork without a world of its own inherits the original's world capped at its basis episode`() {
        forking()
        val atBasis = InheritedWorldResponse("fork", sourceWorld, 2)
        val atFirst = InheritedWorldResponse("fork", sourceWorld, 1)
        `when`(publicWorlds.inheritedWorld("fork", sourceWorld, 2)).thenReturn(atBasis)
        `when`(publicWorlds.inheritedWorld("fork", sourceWorld, 1)).thenReturn(atFirst)

        assertSame(atBasis, service.inheritedWorld("fork", owner, null))
        // 요청한 상한이 기준 회차(2화)보다 크면 기준 회차까지만, 작으면 그 회차까지만 읽는다. Fork의 자기 회차 설정은 원작 세계관에 없다.
        assertSame(atBasis, service.inheritedWorld("fork", owner, "9"))
        assertSame(atFirst, service.inheritedWorld("fork", owner, "1"))
    }

    @Test fun `a fork with its own world, one that is no longer following, a work that is no fork or an original without a world inherits nothing`() {
        forking()
        fork.worldStudioId = UUID.randomUUID()  // 자기 세계관이 있으면 그것이 우선이다
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))
        fork.worldStudioId = null
        forking("independent")  // 독립한 Fork
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))
        forking(null)  // 추종 기록이 없는 Fork
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))
        forking(source = null)  // Fork가 아닌 작품
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))
        forking(source = SourceResponse("original", "원작", 2, 1, "", deleted = true))  // 삭제된 원작
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))
        forking()
        original.worldStudioId = null  // 세계관이 연결되지 않은 원작
        assertEquals(nothing(), service.inheritedWorld("fork", owner, null))

        verifyNoInteractions(publicWorlds)
    }

    @Test fun `someone else's fork is a 404 and nothing is read, and a bad upto is a 422 before any lookup`() {
        `when`(access.own("fork", owner)).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))
        assertEquals(404, failure { service.inheritedWorld("fork", owner, null) }.status)
        verifyNoInteractions(works, references, publicWorlds)

        reset(access)
        listOf("0", "-1", "x", "1.5").forEach { assertEquals(422, failure { service.inheritedWorld("fork", owner, it) }.status) }
        verifyNoInteractions(access, works, references, publicWorlds)
    }
}
