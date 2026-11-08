package ai.storyfork.operations.member.repository

import ai.storyfork.operations.member.entity.AdminPermissionEntity
import ai.storyfork.operations.member.entity.AdminPermissionId
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

/** Same keys and order as the frontend `ADMIN_PERMISSIONS`. */
val ADMIN_PERMISSIONS = listOf(
    "works", "users", "comments", "characterChats", "feedback", "rights", "events", "notices", "llm", "jobs", "credits", "admins",
)

interface AdminPermissionRepository : JpaRepository<AdminPermissionEntity, AdminPermissionId> {
    fun existsByMemberIdAndPermission(memberId: UUID, permission: String): Boolean
    fun findAllByMemberIdIn(memberIds: Collection<UUID>): List<AdminPermissionEntity>
}

/** An admin is a Core operator holding the business permission; a stale grant alone never authorizes. */
fun AdminPermissionRepository.has(member: OperationsMember, permission: String) =
    member.operator && existsByMemberIdAndPermission(member.memberId, permission)

fun AdminPermissionRepository.requirePermission(member: OperationsMember, permission: String) {
    if (!has(member, permission)) throw ResponseStatusException(HttpStatus.FORBIDDEN)
}
