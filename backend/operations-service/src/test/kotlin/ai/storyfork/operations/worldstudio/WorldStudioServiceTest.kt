package ai.storyfork.operations.worldstudio

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.worldstudio.service.WorldStudioService
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Content·Core 클라이언트·권한 저장소·활동 기록은 Mockito 대역이다. Spring 컨텍스트·HTTP·DB가 없다. */
class WorldStudioServiceTest {
    private val content = mock(ContentClient::class.java)
    private val core = mock(CoreClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = WorldStudioService(content, core, permissions, activities)
    private val mapper = jacksonMapperBuilder().build()
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutWorks = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val worldId = UUID.randomUUID()
    private val ownerId = UUID.randomUUID()
    private val strangerId = UUID.randomUUID()
    private val restricted = mapper.readTree("""{"worldId":"${worldId}","ownerId":"${ownerId}","name":"별빛 세계","restricted":true}""")

    private val otherWorldId = UUID.randomUUID()
    private val linkedWorkId = UUID.randomUUID()

    /** Content's rows as they come: no owner name. [list] writes into the node it got, so every use parses a fresh one. */
    private fun contentRows() = mapper.readTree("""[
        {"worldId":"${worldId}","ownerId":"${ownerId}","name":"별빛 세계","visibility":"public","published":true,"restricted":false,"genre":"genre-01","linkedWorkId":"${linkedWorkId}","createdAt":"2026-11-20T00:00:00Z"},
        {"worldId":"${otherWorldId}","ownerId":"${strangerId}","name":"비공개 세계","visibility":"private","published":false,"restricted":false,"genre":null,"linkedWorkId":null,"createdAt":"2026-11-19T00:00:00Z"}]""")

    private val rowsWithOwnerNames = mapper.readTree("""[
        {"worldId":"${worldId}","ownerId":"${ownerId}","name":"별빛 세계","visibility":"public","published":true,"restricted":false,"genre":"genre-01","linkedWorkId":"${linkedWorkId}","createdAt":"2026-11-20T00:00:00Z","ownerName":"작가"},
        {"worldId":"${otherWorldId}","ownerId":"${strangerId}","name":"비공개 세계","visibility":"private","published":false,"restricted":false,"genre":null,"linkedWorkId":null,"createdAt":"2026-11-19T00:00:00Z","ownerName":null}]""")

    private fun grantWorks(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "works")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    /** Core knows the first owner only; the lookup asks for every owner of the list rows, in their order. */
    private fun givenNicknames() {
        `when`(core.nicknames(listOf(ownerId.toString(), strangerId.toString()))).thenReturn(mapOf(ownerId.toString() to "작가"))
    }

    @Test
    fun `list adds the owner's Core nickname to every Content row and leaves an owner Core does not know null`() {
        grantWorks(admin)
        `when`(content.worldStudios()).thenReturn(contentRows())
        givenNicknames()

        assertEquals(rowsWithOwnerNames, service.list(admin))
        verify(core).nicknames(listOf(ownerId.toString(), strangerId.toString()))
        verifyNoMoreInteractions(core)
        verifyNoInteractions(activities)
    }

    @Test
    fun `restrict and unrestrict return Content's row untouched and record the world after Content succeeded`() {
        grantWorks(admin)
        `when`(content.restrictWorld(worldId)).thenReturn(restricted)
        `when`(content.unrestrictWorld(worldId)).thenReturn(restricted)

        assertSame(restricted, service.restrict(admin, worldId))
        assertSame(restricted, service.unrestrict(admin, worldId))

        val order = inOrder(content, activities)
        order.verify(content).restrictWorld(worldId)
        order.verify(activities).record(admin, "world.restrict", "world", worldId, "별빛 세계")
        order.verify(content).unrestrictWorld(worldId)
        order.verify(activities).record(admin, "world.unrestrict", "world", worldId, "별빛 세계")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an operator without works permission or a stale grant without operator is denied before Content and Core`() {
        grantWorks(staleGrant)
        for (member in listOf(operatorWithoutWorks, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.restrict(member, worldId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.unrestrict(member, worldId) })
        }
        verifyNoInteractions(content, core, activities)
    }

    @Test
    fun `a Content failure reaches the caller untouched, skips Core and leaves no activity`() {
        grantWorks(admin)
        val rejection = UpstreamRejection(HttpStatus.NOT_FOUND, "세계관을 찾을 수 없어요.", IllegalStateException("cause"))
        `when`(content.worldStudios()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.restrictWorld(worldId)).thenThrow(rejection)
        `when`(content.unrestrictWorld(worldId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.restrict(admin, worldId) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.unrestrict(admin, worldId) })
        verifyNoInteractions(core, activities)
    }

    @Test
    fun `a Core failure while reading nicknames fails the list instead of dropping the owner names`() {
        grantWorks(admin)
        `when`(content.worldStudios()).thenReturn(contentRows())
        `when`(core.nicknames(listOf(ownerId.toString(), strangerId.toString()))).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
    }
}
