package ai.storyfork.operations.credit.service

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode

private const val CREDITS = "credits"

/**
 * Credits are operated with the `credits` permission, checked before any Core call (DEC-57). Core owns the balance, the history and every rule,
 * so its JSON is returned untouched and its 404, 409 `CREDIT_INSUFFICIENT` and 422 reach the browser as they are. No service transaction,
 * so a slow Core call never holds a DB connection. A grant or revocation is recorded in the admin activity log only after Core succeeded:
 * the target is the member and the detail the amount and the reason.
 */
@Service
class CreditService(
    private val core: CoreClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun read(member: OperationsMember, authorization: String, memberId: UUID): JsonNode {
        permissions.requirePermission(member, CREDITS)
        return core.credits(authorization, memberId)
    }

    fun grant(member: OperationsMember, authorization: String, memberId: UUID, request: CreditAdjustRequest): JsonNode {
        permissions.requirePermission(member, CREDITS)
        return core.grantCredits(authorization, memberId, request).also { activities.record(member, "CREDIT_GRANT", "MEMBER", memberId, request.detail()) }
    }

    fun revoke(member: OperationsMember, authorization: String, memberId: UUID, request: CreditAdjustRequest): JsonNode {
        permissions.requirePermission(member, CREDITS)
        return core.revokeCredits(authorization, memberId, request).also { activities.record(member, "CREDIT_REVOKE", "MEMBER", memberId, request.detail()) }
    }

    // Core trims the reason before it stores it, so the record carries the same text.
    private fun CreditAdjustRequest.detail() = "$amount · ${reason.trim()}"
}
