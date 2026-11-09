package ai.storyfork.operations.work

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.service.WorkService
import ai.storyfork.operations.work.service.dto.OperationsWork
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Mocked Content client and repository: no Spring context, HTTP or database. */
class WorkServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = WorkService(content, permissions)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutWorks = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val workId = UUID.randomUUID()
    private val work = ContentWork(workId, UUID.randomUUID().toString(), "작품", false)

    private fun grantWorks(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "works")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `list returns the Content list as is for an operator with works permission`() {
        grantWorks(admin)
        val list = OperationsWorkList(listOf(
            OperationsWork(workId, "ops-list-owner", "작품", "작가", "fork", "external_derivative", true, "public", false),
        ))
        `when`(content.works()).thenReturn(list)

        assertSame(list, service.list(admin))
    }

    @Test
    fun `restrict and unrestrict delegate to Content and return its work`() {
        grantWorks(admin)
        `when`(content.restrict(workId)).thenReturn(work.copy(restricted = true))
        `when`(content.unrestrict(workId)).thenReturn(work)

        assertTrue(service.restrict(admin, workId).restricted)
        assertFalse(service.unrestrict(admin, workId).restricted)
    }

    @Test
    fun `an operator without works permission or a stale grant without operator is denied before Content`() {
        grantWorks(staleGrant)
        for (member in listOf(operatorWithoutWorks, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.restrict(member, workId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.unrestrict(member, workId) })
        }
        verifyNoInteractions(content)
    }

    @Test
    fun `Content failures reach the caller instead of an empty or successful result`() {
        grantWorks(admin)
        `when`(content.works()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.restrict(workId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.restrict(admin, workId) })
    }
}
