package ai.storyfork.operations.activity.service

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.entity.AdminActivityEntity
import ai.storyfork.operations.activity.repository.AdminActivityRepository
import ai.storyfork.operations.activity.service.dto.AdminActivityListResponse
import ai.storyfork.operations.activity.service.dto.AdminActivityResponse
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.security.OperationsMember
import org.springframework.stereotype.Service

private const val ADMINS = "admins"
private const val DETAIL_MAX = 500

/**
 * Admin change actions are recorded by their own services after the action succeeded, so a denied, invalid or failed action leaves no row.
 * No service transaction: `record` joins the caller's transaction when one is open, and `list` never holds a DB connection during the Core call.
 */
@Service
class AdminActivityService(
    private val activities: AdminActivityRepository,
    private val permissions: AdminPermissionRepository,
    private val core: CoreClient,
) {
    fun record(actor: OperationsMember, action: String, targetType: String, targetId: Any, detail: String?) {
        activities.saveAndFlush(AdminActivityEntity(
            actorId = actor.memberId, action = action, targetType = targetType, targetId = targetId.toString(), detail = detail?.take(DETAIL_MAX),
        ))
    }

    /** The `admins` permission is checked before the database or Core; an empty log skips the Core call. */
    fun list(member: OperationsMember, authorization: String): AdminActivityListResponse {
        permissions.requirePermission(member, ADMINS)
        val rows = activities.findTop100ByOrderByCreatedAtDescIdDesc()
        if (rows.isEmpty()) return AdminActivityListResponse(emptyList())
        // One Core admin list for the latest nicknames; an actor no longer in it (demoted or withdrawn) is null.
        val nicknames = core.members(authorization, "ADMIN", null, null).items.associate { it.id to it.nickname }
        return AdminActivityListResponse(rows.map {
            AdminActivityResponse(it.id, it.actorId, nicknames[it.actorId], it.action, it.targetType, it.targetId, it.detail, it.createdAt)
        })
    }
}
