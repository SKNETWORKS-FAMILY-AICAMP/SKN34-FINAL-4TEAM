package ai.storyfork.operations.member.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.IdClass
import jakarta.persistence.Table
import java.io.Serializable
import java.util.UUID

/** Insert-only grant row; Core owns the member and its ADMIN (`operator`) role. */
@Entity
@Table(name = "admin_permission", schema = "operations")
@IdClass(AdminPermissionId::class)
class AdminPermissionEntity(
    @field:Id
    @field:Column(name = "member_id", nullable = false, updatable = false)
    val memberId: UUID,
    @field:Id
    @field:Column(nullable = false, updatable = false, length = 40)
    val permission: String,
)

data class AdminPermissionId(val memberId: UUID? = null, val permission: String? = null) : Serializable
