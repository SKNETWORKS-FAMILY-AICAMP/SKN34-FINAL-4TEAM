package ai.storyfork.operations.work

import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.work.controller.WorkController
import ai.storyfork.operations.work.service.WorkService
import ai.storyfork.operations.work.service.dto.OperationsWorkList
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

/** Spring context나 HTTP 서버 없이 인증 회원 전달과 제한·해제가 서로 바뀌지 않는지 확인한다. */
class WorkControllerTest {
    private val service = mock(WorkService::class.java)
    private val controller = WorkController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val id = UUID.randomUUID()
    private val restricted = ContentWork(id, UUID.randomUUID(), "작품", true)

    @Test
    fun `list restrict and unrestrict pass the authenticated member and return the service DTOs`() {
        val list = OperationsWorkList(emptyList())
        `when`(service.list(member)).thenReturn(list)
        `when`(service.restrict(member, id)).thenReturn(restricted)
        `when`(service.unrestrict(member, id)).thenReturn(restricted.copy(restricted = false))

        assertSame(list, controller.list(member))
        assertEquals(restricted, controller.restrict(member, id))
        assertEquals(restricted.copy(restricted = false), controller.unrestrict(member, id))
    }
}
