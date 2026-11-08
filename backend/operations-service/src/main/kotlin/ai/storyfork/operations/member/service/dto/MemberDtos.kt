package ai.storyfork.operations.member.service.dto

import java.time.Instant
import java.util.UUID

/** Core `MemberItem`; Core remains the member source of truth. */
data class MemberItem(
    val id: UUID,
    val email: String,
    val nickname: String,
    val role: String,
    val restricted: Boolean,
    val createdAt: Instant,
)

data class MemberListResponse(val items: List<MemberItem>)

data class CreateAdminRequest(val email: String, val nickname: String, val password: String, val permissions: List<String>) {
    override fun toString() = "CreateAdminRequest(email=$email, nickname=$nickname, permissions=$permissions)"
}

data class AdminItem(
    val id: UUID,
    val email: String,
    val nickname: String,
    val role: String,
    val restricted: Boolean,
    val createdAt: Instant,
    val permissions: List<String>,
)

data class AdminListResponse(val items: List<AdminItem>)
