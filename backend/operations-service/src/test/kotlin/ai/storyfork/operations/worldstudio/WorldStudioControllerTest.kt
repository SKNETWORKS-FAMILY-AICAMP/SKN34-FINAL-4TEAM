package ai.storyfork.operations.worldstudio

import ai.storyfork.operations.security.OperationsMember
import ai.storyfork.operations.worldstudio.controller.WorldStudioController
import ai.storyfork.operations.worldstudio.service.WorldStudioService
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Spring context나 HTTP 서버 없이 인증 회원·Bearer·경로 값이 서비스에 그대로 가고 서비스 결과가 그대로 나오는지, 제한과 해제가 바뀌지 않는지 확인한다. */
class WorldStudioControllerTest {
    private val service = mock(WorldStudioService::class.java)
    private val controller = WorldStudioController(service)
    private val member = OperationsMember(UUID.randomUUID(), true)
    private val bearer = "Bearer admin-access"
    private val worldId = UUID.randomUUID()
    private val mapper = jacksonMapperBuilder().build()
    private val rows = mapper.readTree("""[{"worldId":"${worldId}","name":"별빛 세계","ownerName":"작가"}]""")
    private val released = mapper.readTree("""{"worldId":"${worldId}","restricted":false}""")
    private val restricted = mapper.readTree("""{"worldId":"${worldId}","restricted":true}""")

    @Test
    fun `list restrict and unrestrict pass the member, the bearer and the path world on and return the service JSON as is`() {
        `when`(service.list(member, bearer)).thenReturn(rows)
        `when`(service.restrict(member, worldId)).thenReturn(restricted)
        `when`(service.unrestrict(member, worldId)).thenReturn(released)

        assertSame(rows, controller.list(member, bearer))
        assertSame(restricted, controller.restrict(member, worldId))
        assertSame(released, controller.unrestrict(member, worldId))
    }
}
