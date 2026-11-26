package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.controller.InternalWorldStudioController
import ai.storyfork.content.world.service.InternalWorldStudioService
import ai.storyfork.content.world.service.dto.OperationsWorldResponse
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.entity.WorldDraft
import ai.storyfork.content.world.studio.entity.WorldRevision
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.WorldDraftRepository
import ai.storyfork.content.world.studio.repository.WorldRevisionRepository
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.core.annotation.AnnotatedElementUtils
import org.springframework.data.jpa.repository.Query
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestMethod

/**
 * 운영자의 공개 세계관 제한(DEC-45)을 DB 없이 검증한다. 공개 경로 404는 PublicWorldServiceTest가, 실제 쿼리·마이그레이션은 CI 통합 테스트가 확인한다.
 * 제한은 공개 세계관 경로(목록·상세·카드 검색·이미지·가져오기)만 막고 소유자 열람, 연결된 소설 위키와 Fork 이어받기는 건드리지 않는다.
 */
class WorldRestrictionTest {
    private val worlds = mock(StudioWorldRepository::class.java)
    private val revisions = mock(WorldRevisionRepository::class.java)
    private val drafts = mock(WorldDraftRepository::class.java)
    private val links = mock(WorkWorldService::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val outbox = mock(ContentEventOutboxRepository::class.java)
    private val service = InternalWorldStudioService(worlds, revisions, drafts, links, outbox, manager)
    private val t0 = Instant.parse("2026-11-01T00:00:00Z")

    private fun world(visibility: String = "public", genre: String? = "genre-01", saved: UUID? = null, at: Instant = t0, restricted: Boolean = false) =
        StudioWorld(UUID.randomUUID(), UUID.randomUUID(), saved, createdAt = at, visibility = visibility, genre = genre, restricted = restricted)
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    @Test fun `the operator list shows every live world newest first with the saved name, else the draft name, and the linked work`() {
        val revisionId = UUID.randomUUID()
        val saved = world(saved = revisionId, at = t0.plusSeconds(60), restricted = true)
        val draftOnly = world(visibility = "private", genre = null)
        `when`(worlds.listForOperations()).thenReturn(listOf(saved, draftOnly))
        `when`(revisions.findAllById(listOf(revisionId))).thenReturn(listOf(WorldRevision(revisionId, saved.id, 2, "저장된 이름", "설명", sealed = true)))
        `when`(drafts.findAllById(listOf(saved.id, draftOnly.id))).thenReturn(listOf(WorldDraft(saved.id, "초안 이름 A"), WorldDraft(draftOnly.id, "초안 이름 B")))
        `when`(links.linkedWorkIds(listOf(saved.id, draftOnly.id))).thenReturn(mapOf(saved.id to "work-1"))

        assertEquals(listOf(
            OperationsWorldResponse(saved.id, saved.ownerSubject, "저장된 이름", "public", true, true, "genre-01", "work-1", t0.plusSeconds(60)),
            OperationsWorldResponse(draftOnly.id, draftOnly.ownerSubject, "초안 이름 B", "private", false, false, null, null, t0),
        ), service.list())
        verify(links, times(1)).linkedWorkIds(listOf(saved.id, draftOnly.id))
    }

    @Test fun `restrict and unrestrict flip the flag on the locked live world and answer with the list element`() {
        val row = world()
        `when`(worlds.lockLive(row.id)).thenReturn(row)
        `when`(drafts.findAllById(listOf(row.id))).thenReturn(listOf(WorldDraft(row.id, "세계")))
        `when`(links.linkedWorkIds(listOf(row.id))).thenReturn(mapOf(row.id to "work-1"))

        assertEquals(OperationsWorldResponse(row.id, row.ownerSubject, "세계", "public", false, true, "genre-01", "work-1", t0), service.restrict(row.id, true))
        assertTrue(row.restricted)
        assertTrue(service.restrict(row.id, true).restricted) // 멱등
        assertFalse(service.restrict(row.id, false).restricted)
        assertFalse(row.restricted)
    }

    @Test fun `a missing or deleted world is 404 because the live lookup skips deleted worlds`() {
        val id = UUID.randomUUID()
        `when`(worlds.lockLive(id)).thenReturn(null)

        assertEquals(404, failure { service.restrict(id, true) }.status)
        verifyNoInteractions(links, outbox)
    }

    /** 저장소에 건넨 outbox 행이다(세계관 제한이 커밋된 뒤 쓰는 운영자 조치 알림 사건). */
    private fun saved() = mockingDetails(outbox).invocations.filter { it.method.name == "save" }.map { it.arguments[0] as ContentEventOutboxEntity }

    @Test fun `restrict and unrestrict record one operator event for the world owner only when the flag really changes`() {
        val row = world()
        `when`(worlds.lockLive(row.id)).thenReturn(row)
        `when`(drafts.findAllById(listOf(row.id))).thenReturn(listOf(WorldDraft(row.id, "용의 땅")))

        service.restrict(row.id, false) // 이미 해제 상태
        service.restrict(row.id, true)
        service.restrict(row.id, true) // 멱등 재요청
        service.restrict(row.id, false)

        val events = saved()
        assertEquals(listOf("content.operator.world-restricted", "content.operator.world-unrestricted"), events.map { it.type })
        assertEquals(listOf(row.ownerSubject.toString(), row.ownerSubject.toString()), events.map { it.recipientId })
        assertEquals(listOf("world" to row.id.toString(), "world" to row.id.toString()), events.map { it.targetType to it.targetId })
        assertEquals(listOf("용의 땅", "용의 땅"), events.map { it.detailTitle })
        assertEquals(listOf(null, null), events.map { it.detailEpisode })
    }

    @Test fun `a failed event write does not fail a restriction that is already committed`() {
        val row = world()
        `when`(worlds.lockLive(row.id)).thenReturn(row)
        `when`(drafts.findAllById(listOf(row.id))).thenReturn(listOf(WorldDraft(row.id, "용의 땅")))
        `when`(outbox.save(any(ContentEventOutboxEntity::class.java) ?: ContentEventOutboxEntity())).thenThrow(IllegalStateException("db down"))

        assertTrue(service.restrict(row.id, true).restricted)
        assertTrue(row.restricted)
    }

    @Test fun `the public list queries leave out restricted worlds and the live lookup leaves out deleted ones`() {
        for (name in listOf("listed", "listedByGenre")) {
            val query = StudioWorldRepository::class.java.methods.single { it.name == name }.getAnnotation(Query::class.java).value
            assertTrue(query.contains("w.restricted = false"), name)
        }
        for (name in listOf("lockLive", "listForOperations")) {
            val query = StudioWorldRepository::class.java.methods.single { it.name == name }.getAnnotation(Query::class.java).value
            assertTrue(query.contains("w.deletedAt is null"), name)
        }
    }

    private fun route(type: Class<*>, name: String): Pair<String, List<RequestMethod>> {
        val method = type.methods.single { it.name == name }
        val base = AnnotatedElementUtils.findMergedAnnotation(type, RequestMapping::class.java)!!.path.singleOrNull().orEmpty()
        val mapping = AnnotatedElementUtils.findMergedAnnotation(method, RequestMapping::class.java)!!
        return (base + mapping.path.singleOrNull().orEmpty()) to mapping.method.toList()
    }

    @Test fun `the internal API keeps the contract paths and methods`() {
        val internal = InternalWorldStudioController::class.java
        assertEquals("/internal/v1/world-studios" to listOf(RequestMethod.GET), route(internal, "list"))
        assertEquals("/internal/v1/world-studios/{worldId}/restriction" to listOf(RequestMethod.PUT), route(internal, "restrict"))
        assertEquals("/internal/v1/world-studios/{worldId}/restriction" to listOf(RequestMethod.DELETE), route(internal, "unrestrict"))
    }

    @Test fun `V17 adds the flag and the entity maps it`() {
        val v17 = Files.readString(Path.of("src/main/resources/db/migration/worldstudio/V17__world_restriction.sql"))
        assertTrue(v17.contains("ALTER TABLE worldstudio.world ADD COLUMN restricted boolean NOT NULL DEFAULT false;"))
        // 칼럼 이름은 속성 이름과 같아 @Column(name)을 따로 쓰지 않는다.
        assertTrue(StudioWorld::class.java.declaredFields.any { it.name == "restricted" })
    }
}
