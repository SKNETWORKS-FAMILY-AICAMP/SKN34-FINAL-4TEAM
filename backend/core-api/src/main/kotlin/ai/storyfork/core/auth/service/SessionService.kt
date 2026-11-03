package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthRefreshToken
import ai.storyfork.core.auth.entity.AuthSession
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.RefreshTokenRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.dto.LoginRequest
import ai.storyfork.core.auth.service.dto.LoginResult
import ai.storyfork.core.auth.service.dto.MemberResponse
import ai.storyfork.core.auth.service.dto.SessionResponse
import ai.storyfork.core.auth.service.dto.SessionsResponse
import java.time.Instant
import java.util.Locale
import java.util.UUID
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class SessionService(
    private val members: MemberRepository,
    private val sessions: SessionRepository,
    private val tokens: RefreshTokenRepository,
    private val passwords: PasswordEncoder,
    private val secrets: AuthTokenHelper,
    private val jwt: JwtEncoder,
) {
    private val dummyHash = requireNotNull(passwords.encode("not-a-real-password"))

    private fun user(member: AuthMember) = MemberResponse(member.id.toString(), member.email, member.nickname, member.operator)
    private fun access(user: MemberResponse): String {
        val now = Instant.now()
        val claims = JwtClaimsSet.builder().subject(user.id).issuedAt(now).expiresAt(now.plusSeconds(1800)).build()
        return jwt.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).tokenValue
    }

    @Transactional
    fun login(request: LoginRequest, device: String): LoginResult? {
        val email = request.email.trim().lowercase(Locale.ROOT)
        val credentials = members.findCredentialsByEmail(email)
        val passwordHash = credentials?.get("passwordHash", String::class.java)
        if (!passwords.matches(request.password, passwordHash ?: dummyHash) || credentials == null) return null
        // Load the managed entity only after BCrypt; reset/email changes may have committed meanwhile.
        val member = members.lockByEmail(email) ?: return null
        if (member.id != credentials.get("id", UUID::class.java) || member.email != email || member.passwordHash != passwordHash) return null
        val now = Instant.now()
        val session = sessions.save(AuthSession(UUID.randomUUID(), member.id, device.take(200).ifBlank { "Unknown device" }, now, now.plusSeconds(1209600)))
        val token = secrets.newToken()
        tokens.save(AuthRefreshToken(secrets.hash(token), session.id))
        val user = user(member)
        return LoginResult(access(user), user, token)
    }

    private fun owner(token: String?): UUID? = token?.takeIf { it.isNotBlank() && it.length <= 128 }?.let { tokens.findMemberId(secrets.hash(it)) }

    @Transactional
    fun refresh(token: String?, expectedMemberId: UUID? = null): LoginResult? {
        val memberId = owner(token) ?: return null
        if (expectedMemberId != null && expectedMemberId != memberId) return null
        val member = members.lockById(memberId) ?: return null
        val previous = tokens.findById(secrets.hash(requireNotNull(token))).orElse(null) ?: return null
        val session = sessions.findById(previous.sessionId).orElse(null) ?: return null
        if (session.revoked || !session.expiresAt.isAfter(Instant.now())) return null
        if (previous.used) {
            sessions.revokeAll(memberId)
            // Return normally: replay revocation must commit before the Controller returns 401.
            return null
        }
        previous.used = true
        val next = secrets.newToken()
        tokens.save(AuthRefreshToken(secrets.hash(next), session.id))
        val user = user(member)
        return LoginResult(access(user), user, next)
    }

    @Transactional
    fun logout(token: String?, expectedMemberId: UUID? = null): Boolean {
        val memberId = owner(token) ?: return true
        if (expectedMemberId != null && expectedMemberId != memberId) return false
        if (members.lockById(memberId) == null) return true
        val previous = tokens.findById(secrets.hash(requireNotNull(token))).orElse(null) ?: return true
        sessions.findById(previous.sessionId).orElse(null)?.revoked = true
        return true
    }

    @Transactional(readOnly = true)
    fun sessions(memberId: UUID, token: String?): SessionsResponse {
        val current = token?.takeIf { it.length <= 128 }?.let { tokens.findById(secrets.hash(it)).orElse(null) }?.takeUnless { it.used }?.sessionId
        return SessionsResponse(sessions.findAllByMemberIdAndRevokedFalseAndExpiresAtAfterOrderByCreatedAt(memberId, Instant.now()).map {
            SessionResponse(it.id.toString(), it.deviceLabel, it.createdAt, it.id == current)
        })
    }

    @Transactional
    fun revoke(memberId: UUID, sessionId: UUID): Boolean {
        if (members.lockById(memberId) == null) return false
        val session = sessions.findByIdAndMemberIdAndRevokedFalse(sessionId, memberId) ?: return false
        session.revoked = true
        return true
    }

    @Transactional
    fun logoutAll(memberId: UUID, token: String?): Boolean {
        if (members.lockById(memberId) == null) return false
        sessions.revokeAll(memberId)
        return owner(token) == memberId
    }
}
