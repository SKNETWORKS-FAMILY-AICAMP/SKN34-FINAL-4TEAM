package ai.storyfork.operations.feedbackreport

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.feedbackreport.service.FeedbackReportService
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException
import tools.jackson.module.kotlin.jacksonMapperBuilder

/** Mocked Content client and repository: no Spring context, HTTP or database. */
class FeedbackReportServiceTest {
    private val content = mock(ContentClient::class.java)
    private val permissions = mock(AdminPermissionRepository::class.java)
    private val service = FeedbackReportService(content, permissions)
    private val admin = OperationsMember(UUID.randomUUID(), true)
    private val operatorWithoutFeedback = OperationsMember(UUID.randomUUID(), true)
    private val staleGrant = OperationsMember(UUID.randomUUID(), false)
    private val page = jacksonMapperBuilder().build().readTree(
        """{"items":[{"id":"r1","workTitle":"작품","status":"unchecked"}],"page":0,"size":20,"totalElements":1,"totalPages":1}""",
    )

    private fun grantFeedback(vararg members: OperationsMember) = members.forEach {
        `when`(permissions.existsByMemberIdAndPermission(it.memberId, "feedback")).thenReturn(true)
    }

    private fun status(call: () -> Unit) = assertThrows(ResponseStatusException::class.java) { call() }.statusCode

    @Test
    fun `list returns the Content page as is for an operator with feedback permission and passes the filter on`() {
        grantFeedback(admin)
        `when`(content.feedbackReports("checked", 2, 5)).thenReturn(page)
        `when`(content.feedbackReports(null, null, null)).thenReturn(page)

        assertSame(page, service.list(admin, "checked", 2, 5))
        assertSame(page, service.list(admin, null, null, null))
    }

    @Test
    fun `an operator without feedback permission or a stale grant without operator is denied before Content`() {
        grantFeedback(staleGrant)
        // another business permission is not enough: the reader reports sit on the feedback tab.
        `when`(permissions.existsByMemberIdAndPermission(operatorWithoutFeedback.memberId, "comments")).thenReturn(true)

        for (member in listOf(operatorWithoutFeedback, staleGrant)) assertEquals(HttpStatus.FORBIDDEN, status { service.list(member, null, null, null) })
        verifyNoInteractions(content)
    }

    @Test
    fun `Content failures reach the caller instead of an empty or successful result`() {
        grantFeedback(admin)
        `when`(content.feedbackReports("checked", null, null)).thenThrow(ResponseStatusException(HttpStatus.BAD_GATEWAY))
        `when`(content.feedbackReports("held", null, null)).thenThrow(ResponseStatusException(HttpStatus.UNPROCESSABLE_CONTENT))

        assertEquals(HttpStatus.BAD_GATEWAY, status { service.list(admin, "checked", null, null) })
        assertEquals(HttpStatus.UNPROCESSABLE_CONTENT, status { service.list(admin, "held", null, null) })
    }
}
