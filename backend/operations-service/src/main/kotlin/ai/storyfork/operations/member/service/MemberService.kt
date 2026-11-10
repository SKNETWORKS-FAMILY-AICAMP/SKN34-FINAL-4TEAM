package ai.storyfork.operations.member.service

import ai.storyfork.operations._common.client.CoreAdminRequest
import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.member.entity.AdminPermissionEntity
import ai.storyfork.operations.member.repository.ADMIN_PERMISSIONS
import ai.storyfork.operations.member.repository.AdminPermissionRepository
import ai.storyfork.operations.member.repository.requirePermission
import ai.storyfork.operations.member.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.stereotype.Service

/** Permission checks happen before any Core call; Core also re-checks the forwarded admin Bearer.
 *  No service transaction: repository calls use their own, so a slow Core call never holds a DB connection.
 *  The admin activity is recorded only after the Core call (and the grants) succeeded. */
@Service
class MemberService(
    private val core: CoreClient,
    private val permissions: AdminPermissionRepository,
    private val activities: AdminActivityService,
) {
    fun list(member: OperationsMember, authorization: String, role: String?, q: String?, sort: String?): MemberListResponse {
        permissions.requirePermission(member, "users")
        return core.members(authorization, role, q, sort)
    }

    fun restrict(member: OperationsMember, authorization: String, id: UUID): MemberItem {
        permissions.requirePermission(member, "users")
        return core.restrict(authorization, id).also { activities.record(member, "MEMBER_RESTRICT", "MEMBER", id, it.nickname) }
    }

    fun unrestrict(member: OperationsMember, authorization: String, id: UUID): MemberItem {
        permissions.requirePermission(member, "users")
        return core.unrestrict(authorization, id).also { activities.record(member, "MEMBER_UNRESTRICT", "MEMBER", id, it.nickname) }
    }

    fun admins(member: OperationsMember, authorization: String): AdminListResponse {
        permissions.requirePermission(member, "admins")
        val items = core.members(authorization, "ADMIN", null, null).items
        val granted = permissions.findAllByMemberIdIn(items.map { it.id }).groupBy({ it.memberId }, { it.permission })
        return AdminListResponse(items.map { item -> item.admin(ADMIN_PERMISSIONS.filter { it in granted[item.id].orEmpty() }) })
    }

    /** ponytail: no distributed transaction; if saving grants fails after Core creation, the admin exists without permissions. */
    fun createAdmin(member: OperationsMember, authorization: String, request: CreateAdminRequest): AdminItem {
        permissions.requirePermission(member, "admins")
        val keys = request.permissions.distinct()
        require(keys.isNotEmpty() && keys.all { it in ADMIN_PERMISSIONS }) { "Unknown or empty permissions." }
        val created = core.createAdmin(authorization, CoreAdminRequest(request.email, request.nickname, request.password))
        permissions.saveAllAndFlush(keys.map { AdminPermissionEntity(created.id, it) })
        activities.record(member, "ADMIN_CREATE", "MEMBER", created.id, "${created.email} · ${keys.joinToString(",")}")
        return created.admin(keys)
    }

    private fun MemberItem.admin(permissions: List<String>) = AdminItem(id, email, nickname, role, restricted, createdAt, permissions)
}
