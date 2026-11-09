package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.AdminCreateRequest
import ai.storyfork.core.auth.service.dto.MemberItem
import ai.storyfork.core.auth.service.dto.MemberListResponse
import java.util.Locale
import java.util.UUID
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 운영 서비스 전용 회원 조회·이용 제한·관리자 생성. 호출 회원은 제한되지 않은 operator여야 한다. */
@Service
class MemberAdminService(
    private val members: MemberRepository,
    private val verification: AuthVerificationService,
    private val passwords: PasswordEncoder,
) {
    private fun requireOperator(subject: String?): UUID {
        val actor = verification.verify(subject)
        if (!actor.operator) throw AuthException(AuthException.Reason.FORBIDDEN)
        return actor.memberId
    }

    private fun item(member: AuthMember) = MemberItem(member.id, member.email, member.nickname,
        if (member.operator) "ADMIN" else "MEMBER", member.restricted, member.createdAt)

    @Transactional(readOnly = true)
    fun list(subject: String?, role: String, q: String, sort: String): MemberListResponse {
        requireOperator(subject)
        val operators = when (role) {
            "ALL" -> listOf(true, false)
            "MEMBER" -> listOf(false)
            "ADMIN" -> listOf(true)
            else -> throw AuthException(AuthException.Reason.INVALID)
        }
        val direction = when (sort) {
            "newest" -> Sort.Direction.DESC
            "oldest" -> Sort.Direction.ASC
            else -> throw AuthException(AuthException.Reason.INVALID)
        }
        val escaped = q.trim().lowercase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_")
        val page = PageRequest.of(0, 200, Sort.by(Sort.Order(direction, "createdAt"), Sort.Order.asc("id")))
        return MemberListResponse(members.search(operators, "%$escaped%", page).map(::item))
    }

    @Transactional
    fun restrict(subject: String?, id: UUID): MemberItem = setRestricted(subject, id, true)

    @Transactional
    fun unrestrict(subject: String?, id: UUID): MemberItem = setRestricted(subject, id, false)

    private fun setRestricted(subject: String?, id: UUID, restricted: Boolean): MemberItem {
        if (requireOperator(subject) == id) throw AuthException(AuthException.Reason.INVALID)
        val member = members.lockById(id) ?: throw AuthException(AuthException.Reason.NOT_FOUND)
        member.restricted = restricted
        return item(member)
    }

    @Transactional
    fun createAdmin(subject: String?, request: AdminCreateRequest): MemberItem {
        requireOperator(subject)
        if (request.password.toByteArray(Charsets.UTF_8).size > 72) throw AuthException(AuthException.Reason.INVALID)
        val email = request.email.trim().lowercase(Locale.ROOT)
        if (members.existsByEmail(email)) throw AuthException(AuthException.Reason.CONFLICT)
        val member = AuthMember(UUID.randomUUID(), email, requireNotNull(passwords.encode(request.password)),
            request.nickname.trim(), operator = true)
        try {
            return item(members.saveAndFlush(member))
        } catch (_: DataIntegrityViolationException) {
            throw AuthException(AuthException.Reason.CONFLICT)
        }
    }
}
