package ai.storyfork.operations.work

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.ContentWork
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations.activity.service.AdminActivityService
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
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Mocked Content client and repository: no Spring context, HTTP or database. */
class WorkServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = WorkService(content, permissions, activities)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutWorks = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val workId = UUID.randomUUID()
    private val work = ContentWork(workId, UUID.randomUUID().toString(), "작품", false)
    private val mapper = jacksonMapperBuilder().build()
    private val episodes = mapper.readTree("""[{"number":1,"title":"1화","publicationStatus":"published","restricted":false,"inherited":false}]""")
    private val episode = mapper.readTree("""{"number":2,"title":"2화","publicationStatus":"published","restricted":true,"inherited":false}""")

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
        verifyNoInteractions(activities)
    }

    @Test
    fun `integrity is read through Content with the works permission`() {
        grantWorks(admin)
        val report = ai.storyfork.operations.work.service.dto.ForkIntegrity(1,"fork","source",false,"unavailable")
        `when`(content.forkIntegrity(workId)).thenReturn(report)
        assertSame(report,service.forkIntegrity(admin,workId))
    }

    @Test
    fun `a Content rejection with its own message reaches the caller untouched`() {
        grantWorks(admin)
        val rejection = UpstreamRejection(HttpStatus.CONFLICT, "원작의 고정 기준 기록을 확인할 수 없어요.", IllegalStateException("cause"))
        `when`(content.forkIntegrity(workId)).thenThrow(rejection)

        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.forkIntegrity(admin, workId) })
        verifyNoInteractions(activities)
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
    fun `restrict and unrestrict record the admin activity with the work title after Content succeeds`() {
        grantWorks(admin)
        `when`(content.restrict(workId)).thenReturn(work.copy(restricted = true))
        `when`(content.unrestrict(workId)).thenReturn(work)

        service.restrict(admin, workId)
        service.unrestrict(admin, workId)

        val order = inOrder(content, activities)
        order.verify(content).restrict(workId)
        order.verify(activities).record(admin, "WORK_RESTRICT", "WORK", workId, "작품")
        order.verify(content).unrestrict(workId)
        order.verify(activities).record(admin, "WORK_UNRESTRICT", "WORK", workId, "작품")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an operator without works permission or a stale grant without operator is denied before Content`() {
        grantWorks(staleGrant)
        for (member in listOf(operatorWithoutWorks, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.forkIntegrity(member, workId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.restrict(member, workId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.unrestrict(member, workId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.episodes(member, workId) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.restrictEpisode(member, workId, 2) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.unrestrictEpisode(member, workId, 2) })
        }
        verifyNoInteractions(content, activities)
    }

    @Test
    fun `Content failures reach the caller instead of an empty or successful result`() {
        grantWorks(admin)
        `when`(content.works()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.restrict(workId)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.restrict(admin, workId) })
        verifyNoInteractions(activities)
    }

    @Test
    fun `episodes returns the Content list untouched for an operator with works permission and records nothing`() {
        grantWorks(admin)
        `when`(content.episodes(workId)).thenReturn(episodes)

        assertSame(episodes, service.episodes(admin, workId))
        verifyNoInteractions(activities)
    }

    @Test
    fun `restricting and releasing an episode return Content's element and record the work and number with the episode title after Content succeeds`() {
        grantWorks(admin)
        `when`(content.restrictEpisode(workId, 2)).thenReturn(episode)
        `when`(content.unrestrictEpisode(workId, 2)).thenReturn(episode)

        assertSame(episode, service.restrictEpisode(admin, workId, 2))
        assertSame(episode, service.unrestrictEpisode(admin, workId, 2))

        val order = inOrder(content, activities)
        order.verify(content).restrictEpisode(workId, 2)
        order.verify(activities).record(admin, "episode.restrict", "episode", "${workId}:2", "2화")
        order.verify(content).unrestrictEpisode(workId, 2)
        order.verify(activities).record(admin, "episode.unrestrict", "episode", "${workId}:2", "2화")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an episode failure or rejection reaches the caller untouched and leaves no activity`() {
        grantWorks(admin)
        val rejection = UpstreamRejection(HttpStatus.CONFLICT, "원작 회차를 제한해야 해요.", IllegalStateException("cause"), "EPISODE_INHERITED")
        `when`(content.restrictEpisode(workId, 3)).thenThrow(rejection)
        `when`(content.unrestrictEpisode(workId, 9)).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(content.episodes(workId)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.restrictEpisode(admin, workId, 3) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.unrestrictEpisode(admin, workId, 9) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.episodes(admin, workId) })
        verifyNoInteractions(activities)
    }
}
