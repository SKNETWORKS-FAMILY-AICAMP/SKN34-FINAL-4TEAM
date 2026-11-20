package ai.storyfork.operations.genre

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.genre.service.GenreService
import ai.storyfork.operations.genre.service.dto.GenreCreateRequest
import ai.storyfork.operations.genre.service.dto.GenreOrderRequest
import ai.storyfork.operations.genre.service.dto.GenreUpdateRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Content 클라이언트·권한 저장소·활동 기록은 Mockito 대역이다. Spring 컨텍스트·HTTP·DB가 없다. */
class GenreServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val activities = mock(AdminActivityService::class.java)
    private val service = GenreService(content, permissions, activities)
    private val mapper = jacksonMapperBuilder().build()
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutWorks = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val rows = mapper.readTree("""[{"code":"genre-02","name":"로맨스"},{"code":"genre-01","name":"판타지"}]""")
    private val row = mapper.readTree("""{"code":"genre-31","name":"사이버펑크","emoji":"🤖","active":true,"featured":false,"position":31}""")

    private fun grantWorks(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "works")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `list returns the Content list untouched and records nothing`() {
        grantWorks(admin)
        `when`(content.genres()).thenReturn(rows)

        assertSame(rows, service.list(admin))
        verifyNoInteractions(activities)
    }

    @Test
    fun `create returns the new genre untouched and records its code and name after Content succeeded`() {
        grantWorks(admin)
        val request = GenreCreateRequest("사이버펑크", "🤖")
        `when`(content.createGenre(request)).thenReturn(row)

        assertSame(row, service.create(admin, request))

        val order = inOrder(content, activities)
        order.verify(content).createGenre(request)
        order.verify(activities).record(admin, "GENRE_CREATE", "GENRE", "genre-31", "사이버펑크")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `update records the path code with the name Content answered`() {
        grantWorks(admin)
        val request = GenreUpdateRequest(active = false)
        `when`(content.updateGenre("genre-31", request)).thenReturn(row)

        assertSame(row, service.update(admin, "genre-31", request))

        val order = inOrder(content, activities)
        order.verify(content).updateGenre("genre-31", request)
        order.verify(activities).record(admin, "GENRE_UPDATE", "GENRE", "genre-31", "사이버펑크")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `reorder records the new order of codes and returns Content's answer untouched`() {
        grantWorks(admin)
        val request = GenreOrderRequest(listOf("genre-02", "genre-01"))
        `when`(content.reorderGenres(request.codes)).thenReturn(rows)

        assertSame(rows, service.reorder(admin, request))

        val order = inOrder(content, activities)
        order.verify(content).reorderGenres(request.codes)
        order.verify(activities).record(admin, "GENRE_REORDER", "GENRE", "order", "genre-02,genre-01")
        verifyNoMoreInteractions(activities)
    }

    @Test
    fun `an operator without works permission or a stale grant without operator is denied before Content`() {
        grantWorks(staleGrant)
        for (member in listOf(operatorWithoutWorks, staleGrant)) {
            assertEquals(HttpStatus.FORBIDDEN, status { service.list(member) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.create(member, GenreCreateRequest("가")) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.update(member, "genre-01", GenreUpdateRequest(active = true)) })
            assertEquals(HttpStatus.FORBIDDEN, status { service.reorder(member, GenreOrderRequest(listOf("genre-01"))) })
        }
        verifyNoInteractions(content, activities)
    }

    @Test
    fun `a Content failure or rejection reaches the caller untouched and leaves no activity`() {
        grantWorks(admin)
        val rejection = UpstreamRejection(HttpStatus.CONFLICT, "같은 이름의 장르가 이미 있어요.", IllegalStateException("cause"), "GENRE_NAME_TAKEN")
        `when`(content.createGenre(GenreCreateRequest("판타지"))).thenThrow(rejection)
        `when`(content.updateGenre("genre-99", GenreUpdateRequest(active = true))).thenThrow(ResponseStatusException(HttpStatus.NOT_FOUND))
        `when`(content.reorderGenres(listOf("genre-01"))).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.genres()).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))

        assertSame(rejection, assertThrows(UpstreamRejection::class.java) { service.create(admin, GenreCreateRequest("판타지")) })
        assertEquals(HttpStatus.NOT_FOUND, status { service.update(admin, "genre-99", GenreUpdateRequest(active = true)) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.reorder(admin, GenreOrderRequest(listOf("genre-01"))) })
        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin) })
        verifyNoInteractions(activities)
    }
}
