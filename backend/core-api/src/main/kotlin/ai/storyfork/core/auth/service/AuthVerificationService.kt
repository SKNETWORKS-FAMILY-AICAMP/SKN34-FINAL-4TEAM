package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.service.dto.VerifiedMemberResponse
import java.security.MessageDigest
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

/** JWT 서명·만료는 기존 resource server가 확인하고 이 서비스는 호출 서비스 자격과 회원 상태를 확인한다. */
@Service
class AuthVerificationService(
    private val members: MemberRepository,
    @Value("\${CONTENT_CORE_AUTH_TOKEN:}") private val contentToken: String,
    @Value("\${OPERATIONS_SERVICE_TOKEN:}") private val operationsToken: String,
) {
    /** verify 호출 자격: Content 또는 운영 서비스 토큰 중 하나. */
    fun isTrusted(content: String?, operations: String?): Boolean = matches(contentToken, content) || isOperations(operations)

    /** 운영 전용 API 호출 자격: 운영 서비스 토큰만. */
    fun isOperations(candidate: String?): Boolean = matches(operationsToken, candidate)

    private fun matches(expected: String, candidate: String?): Boolean = expected.length >= 32 && candidate != null &&
        MessageDigest.isEqual(expected.toByteArray(Charsets.UTF_8), candidate.toByteArray(Charsets.UTF_8))

    fun verify(subject: String?): VerifiedMemberResponse {
        val id = try { UUID.fromString(subject.orEmpty()) } catch (_: IllegalArgumentException) {
            throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        }
        if (id.toString() != subject) throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        val member = members.findById(id).orElseThrow { AuthException(AuthException.Reason.UNAUTHENTICATED) }
        if (member.restricted) throw AuthException(AuthException.Reason.RESTRICTED)
        return VerifiedMemberResponse(id, member.operator)
    }
}
