package ai.storyfork.operations.feedbackreport.service

import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val FEEDBACK = "feedback"

/**
 * Reader feedback reports are for the operator to read only: the author handles them in Content, so there is no reply, status change or hide here and nothing is stored.
 * The `feedback` permission of the same admin tab (support inquiries) is checked before any Content call. Content owns every field, the status filter, the order and the
 * deleted works left out, so its JSON is returned as it is. A read leaves no admin activity record, like the other lists. No service transaction, so a slow Content
 * call never holds a DB connection.
 */
@Service
class FeedbackReportService(private val content: ContentClient, private val permissions: AdminPermissionRepository) {
    fun list(member: OperationsMember, status: String?, page: Int?, size: Int?): JsonNode {
        permissions.requirePermission(member, FEEDBACK)
        return content.feedbackReports(status, page, size)
    }
}
