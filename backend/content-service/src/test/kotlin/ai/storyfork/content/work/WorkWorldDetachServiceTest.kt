package ai.storyfork.content.work

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.fork.entity.ForkWorldReferenceEntity
import ai.storyfork.content.fork.repository.ForkWorldReferenceRepository
import ai.storyfork.content.fork.service.dto.SourceResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import ai.storyfork.content.work.service.dto.WorkWorldLinkResponse
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.service.PublicWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.CreateWorldRequest
import ai.storyfork.content.world.service.dto.EditWorldDraftRequest
import ai.storyfork.content.world.service.dto.InheritedSource
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyInt
import org.mockito.ArgumentMatchers.anyString
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.transaction.support.TransactionTemplate

/**
 * Fork 세계관 독립(#583): 저장소·WorldStudio·공개 세계관 조회는 대역이다. 실제 행 잠금·UNIQUE·HTTP는 CI의 통합 테스트가 확인한다.
 * 트랜잭션 매니저 대역이 열린 Content 트랜잭션 수를 세고, WorldStudio 대역은 호출될 때마다 그 수가 0인지(Content 트랜잭션 밖인지) 단언한다.
 */
class WorkWorldDetachServiceTest {
    private val owner = UUID.randomUUID()
    private val ownerId = owner.toString()
    private val sourceWorld = UUID.randomUUID()

    private var openTransactions = 0
    private val manager = mock(PlatformTransactionManager::class.java) { call ->
        when (call.method.name) {
            "getTransaction" -> { openTransactions++; SimpleTransactionStatus() }
            "commit", "rollback" -> { openTransactions--; null }
            else -> null
        }
    }

    private var failEdit: RuntimeException? = null
    private var failDelete: RuntimeException? = null
    /** 새 세계관 초안을 저장하는 동안(WorldStudio 쓰기 중) 다른 요청이 끼어드는 상황을 흉내 낸다. */
    private var during: () -> Unit = {}
    private val worldStudio = mock(WorldStudioService::class.java) { call ->
        assertEquals(0, openTransactions, "WorldStudio는 Content 트랜잭션 밖에서 부른다")
        when (call.method.name) {
            "create" -> call.getArgument<CreateWorldRequest>(1).let { WorldDraftResponse(it.id, 0, null, null, it.name, it.description, emptyList(), emptyList()) }
            "edit" -> {
                failEdit?.let { throw it }
                val saved = call.getArgument<EditWorldDraftRequest>(2).let { WorldDraftResponse(call.getArgument(0), it.expectedDraftRevision + 1, null, null, it.name, it.description, it.cards, it.relationships) }
                during()
                saved
            }
            "delete" -> { failDelete?.let { throw it }; null }
            else -> null
        }
    }

    private val access = mock(WorkAccessService::class.java)
    private val works = mock(WorkRepository::class.java)
    private val references = mock(ForkWorldReferenceRepository::class.java)
    private val publicWorlds = mock(PublicWorldService::class.java)
    private val service = WorkWorldService(access, works, mock(PublicationService::class.java), mock(StudioWorldRepository::class.java), publicWorlds, references, worldStudio, TransactionTemplate(manager))

    private val fork = WorkEntity(id = "fork", ownerId = ownerId, title = "분기", revision = 1)
    private val original = WorkEntity(id = "original", ownerId = UUID.randomUUID().toString(), title = "원작", revision = 1).also { it.worldStudioId = sourceWorld }
    private val following = ForkWorldReferenceEntity("fork", "legacy-world", "following")
    private val basis2 = SourceResponse("original", "원작", 2, 1, "")

    private fun card(title: String) = CardPayload(UUID.randomUUID(), title, "$title 본문", "character", "basic", "", emptyList(), emptyList(), mapOf("revealFromEpisode" to 1), "public", "active")
    private val a = card("하린")
    private val b = card("온실")
    private val friend = RelationshipPayload(UUID.randomUUID(), a.id, b.id, "structural", "", "동료", "directed", "asserted")
    private fun inherited(status: String = "current") =
        InheritedSource(InheritedWorldResponse("fork", sourceWorld, 2, listOf(a, b), listOf(friend), status, 5), "원작 세계", 3L, "원작자", mapOf(friend.id to 1))

    /** 2화 기준 Fork의 소유자 읽기다. [reference]가 null이면 추종 기록이 없고, [source]가 null이면 Fork가 아니다. */
    private fun forking(reference: ForkWorldReferenceEntity? = following, source: SourceResponse? = basis2) {
        `when`(access.own("fork", ownerId)).thenReturn(WorkAccessResult("fork", ownerId, fork.title, "", 1, "legacy-world", "private", false, false, source))
        `when`(works.findById("fork")).thenReturn(Optional.of(fork))
        `when`(works.findById("original")).thenReturn(Optional.of(original))
        `when`(references.findById("fork")).thenReturn(Optional.ofNullable(reference))
        `when`(references.lockById("fork")).thenReturn(reference)
    }
    private fun readable(source: InheritedSource? = inherited()) { `when`(publicWorlds.inheritedSource("fork", sourceWorld, 2)).thenReturn(source) }

    private fun calls() = mockingDetails(worldStudio).invocations.map { it.method.name }
    private fun call(name: String) = mockingDetails(worldStudio).invocations.single { it.method.name == name }
    private fun failure(block: () -> Unit) = assertThrows(ContentFailure::class.java) { block() }
    private fun notInherited() = failure { service.detachInheritedWorld("fork", ownerId) }.also {
        assertEquals(409, it.status)
        assertEquals("FORK_WORLD_NOT_INHERITED", it.code)
    }

    @Test fun `detaching copies the inherited world into a new private world of the caller, connects it and stops following`() {
        forking()
        readable()

        val result = service.detachInheritedWorld("fork", ownerId)

        val create = call("create").getArgument<CreateWorldRequest>(1)
        assertEquals(WorkWorldLinkResponse("fork", create.id), result)
        // 순서: 생성 → 초안 편집(복사, 저장 버전 1). 확정 버전(save)은 만들지 않는다. 모두 Content 트랜잭션 밖이다(대역이 호출마다 단언한다).
        assertEquals(listOf("create", "edit"), calls())
        assertEquals(listOf<Any>(owner, "분기 세계관", ""), listOf(call("create").getArgument<UUID>(0), create.name, create.description))
        val edit = call("edit").getArgument<EditWorldDraftRequest>(2)
        assertEquals(listOf<Any>(create.id, owner), listOf(call("edit").getArgument<UUID>(0), call("edit").getArgument<UUID>(1)))
        assertEquals(listOf<Any>(0L, "분기 세계관"), listOf(edit.expectedDraftRevision, edit.name))
        assertEquals(listOf("하린", "온실"), edit.cards.map { it.title })
        assertEquals(listOf(a.id, b.id), edit.cards.map { it.semanticMetadata.let { m -> (m["importedFrom"] as Map<*, *>)["cardId"] }.toString() }.map(UUID::fromString))
        assertEquals(1, edit.relationships.size)
        assertEquals(edit.cards.map { it.id }, listOf(edit.relationships[0].sourceCardId, edit.relationships[0].targetCardId))
        assertEquals(mapOf(edit.relationships[0].id to 1), edit.relationshipEpisodes)
        // 연결과 독립(④).
        assertEquals(create.id, fork.worldStudioId)
        assertEquals("independent", following.referenceStatus)
        assertNotNull(following.detachedAt)
        verify(works).saveAndFlush(fork)
        verify(references).lockById("fork")
        assertEquals(0, openTransactions)
    }

    @Test fun `someone else's fork is 404 and no world is made`() {
        `when`(access.own("fork", ownerId)).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))

        assertEquals(404, failure { service.detachInheritedWorld("fork", ownerId) }.status)

        verifyNoInteractions(worldStudio, publicWorlds)
        verify(works, never()).saveAndFlush(any())
    }

    @Test fun `a fork that inherits nothing is 409 FORK_WORLD_NOT_INHERITED and no world is made`() {
        readable()
        forking(); fork.worldStudioId = UUID.randomUUID()  // 자기 세계관이 있다
        notInherited()
        fork.worldStudioId = null
        forking(ForkWorldReferenceEntity("fork", "legacy-world", "independent"))  // 이미 독립했다
        notInherited()
        forking(null)  // 추종 기록이 없다
        notInherited()
        forking(source = null)  // Fork가 아니다
        notInherited()
        forking(source = SourceResponse("original", "원작", 2, 1, "", deleted = true))  // 원작이 삭제됐다
        notInherited()
        forking(); original.worldStudioId = null  // 원작에 세계관이 없다
        notInherited()
        original.worldStudioId = sourceWorld
        forking(); readable(null)  // 이어받을 카드가 없다
        notInherited()

        verifyNoInteractions(worldStudio)
        verify(works, never()).saveAndFlush(any())
        assertNull(fork.worldStudioId)
        assertEquals("following", following.referenceStatus)
    }

    @Test fun `relations the store cannot vouch for are 503 and no world is made`() {
        forking()
        readable(inherited("unavailable"))

        assertEquals(503, failure { service.detachInheritedWorld("fork", ownerId) }.status)

        verifyNoInteractions(worldStudio)
        verify(access, times(1)).own("fork", ownerId)
        assertNull(fork.worldStudioId)
        assertEquals("following", following.referenceStatus)
    }

    @Test fun `when another request detached first while the world was made, the new world is soft-deleted and the answer is 409`() {
        forking()
        readable()
        // 동시에 두 번 눌렀다: 이 요청이 새 세계관을 저장하는 사이 먼저 끝난 요청이 독립으로 바꿨고, ④에서 잠근 행이 그 상태다.
        during = { following.referenceStatus = "independent" }

        notInherited()

        val created = call("create").getArgument<CreateWorldRequest>(1).id
        assertEquals(listOf("create", "edit", "delete"), calls())
        assertEquals(listOf<Any>(created, owner, false), call("delete").arguments.toList())
        assertNull(fork.worldStudioId)
        verify(works, never()).saveAndFlush(any())
        assertNull(following.detachedAt)
        assertEquals(0, openTransactions)
    }

    @Test fun `a failing cleanup does not hide why the detach failed`() {
        forking()
        readable()
        during = { following.referenceStatus = "independent" }
        failDelete = IllegalStateException("db down")

        notInherited()

        assertEquals(listOf("create", "edit", "delete"), calls())
    }

    @Test fun `a failure while writing the new world discards it, is not hidden and leaves the fork as it was`() {
        forking()
        readable()
        val boom = WorldStudioFailure.unavailable()
        failEdit = boom

        assertSame(boom, assertThrows(WorldStudioFailure::class.java) { service.detachInheritedWorld("fork", ownerId) })

        assertEquals(listOf("create", "edit", "delete"), calls())
        assertEquals(call("create").getArgument<CreateWorldRequest>(1).id, call("delete").getArgument<UUID>(0))
        assertNull(fork.worldStudioId)
        assertEquals("following", following.referenceStatus)
        verify(access, times(1)).own("fork", ownerId)
        assertEquals(0, openTransactions)
    }

    @Test fun `after detaching, the fork inherits nothing from the original and cannot be detached again`() {
        forking()
        readable()

        val world = service.detachInheritedWorld("fork", ownerId).worldId

        assertEquals(InheritedWorldResponse("fork", null, 0), service.inheritedWorld("fork", ownerId, null))
        verify(publicWorlds, never()).inheritedWorld(anyString(), any(UUID::class.java) ?: sourceWorld, anyInt())
        notInherited()
        assertEquals(listOf("create", "edit"), calls())
        assertEquals(world, fork.worldStudioId)
    }

    @Test fun `a long work title is cut so the world name fits the world service's 100 characters`() {
        readable()
        fork.title = "가".repeat(120)
        forking()
        service.detachInheritedWorld("fork", ownerId)

        // 자르는 자리가 서로게이트 쌍 가운데면 짝 잃은 글자를 남기지 않는다.
        fork.worldStudioId = null
        following.referenceStatus = "following"
        fork.title = "가".repeat(95) + "😀😀"
        forking()
        service.detachInheritedWorld("fork", ownerId)

        val names = mockingDetails(worldStudio).invocations.filter { it.method.name == "create" }.map { it.getArgument<CreateWorldRequest>(1).name }
        assertEquals(listOf("가".repeat(96) + " 세계관", "가".repeat(95) + " 세계관"), names)
        assertTrue(names.all { it.length <= 100 })
    }
}
