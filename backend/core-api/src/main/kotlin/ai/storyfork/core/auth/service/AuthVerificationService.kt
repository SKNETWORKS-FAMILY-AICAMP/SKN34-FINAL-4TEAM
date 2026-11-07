package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.service.dto.VerifiedMemberResponse
import java.security.MessageDigest
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service

/** JWT 서명·만료는 기존 resource server가 확인하고 이 서비스는 호출 서비스와 UUID 계약을 확인한다. */
@Service
class AuthVerificationService(@Value("\${CONTENT_CORE_AUTH_TOKEN:}") private val serviceToken: String) {
    fun isTrusted(candidate: String?): Boolean = serviceToken.length >= 32 && candidate != null &&
        MessageDigest.isEqual(serviceToken.toByteArray(Charsets.UTF_8), candidate.toByteArray(Charsets.UTF_8))

    fun verify(subject: String?): VerifiedMemberResponse {
        val id = try { UUID.fromString(subject.orEmpty()) } catch (_: IllegalArgumentException) {
            throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        }
        if (id.toString() != subject) throw AuthException(AuthException.Reason.UNAUTHENTICATED)
        return VerifiedMemberResponse(id)
    }
}
