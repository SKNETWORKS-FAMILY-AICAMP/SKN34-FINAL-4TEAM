package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthProfileChallenge
import ai.storyfork.core.auth.entity.ProfileChallengeId
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.ProfileChallengeRepository
import ai.storyfork.core.auth.repository.SessionRepository
import ai.storyfork.core.auth.service.dto.EmailRequest
import ai.storyfork.core.auth.service.dto.MemberResponse
import ai.storyfork.core.auth.service.dto.NicknameRequest
import ai.storyfork.core.auth.service.dto.ResetRequest
import ai.storyfork.core.auth.service.dto.TokenRequest
import java.time.Instant
import java.util.Locale
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.mail.MailException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.interceptor.TransactionAspectSupport

@Service
class ProfileService(
    private val members: MemberRepository,
    private val challenges: ProfileChallengeRepository,
    private val sessions: SessionRepository,
    private val passwords: PasswordEncoder,
    private val secrets: AuthTokenHelper,
    private val mail: JavaMailSender,
    @param:Value("\${app.auth.public-origin}") private val origin: String,
    @param:Value("\${app.auth.mail-from}") private val from: String,
) {
    private val logger = LoggerFactory.getLogger(ProfileService::class.java)
    private fun address(email: String) = email.trim().lowercase(Locale.ROOT)
    private fun user(member: AuthMember) = MemberResponse(member.id.toString(), member.email, member.nickname, member.operator)
    // 이용 제한(탈퇴 완료 포함) 회원은 이미 발급된 토큰이 남아 있어도 프로필을 바꿀 수 없다. 세션 갱신(SessionService)과 같은 기준이다.
    private fun lock(id: UUID) = members.lockById(id)?.takeUnless { it.restricted } ?: throw AuthException(AuthException.Reason.UNAUTHENTICATED)

    @Transactional(readOnly = true)
    fun profile(id: UUID): MemberResponse = user(members.findById(id).orElse(null) ?: throw AuthException(AuthException.Reason.UNAUTHENTICATED))

    @Transactional
    fun nickname(id: UUID, request: NicknameRequest): MemberResponse {
        if (request.nickname.isBlank()) throw AuthException(AuthException.Reason.INVALID)
        val member = lock(id)
        member.nickname = request.nickname.trim()
        return user(member)
    }

    private fun challenge(id: UUID, purpose: String, email: String, token: String) {
        val key = ProfileChallengeId(id, purpose)
        val expires = Instant.now().plusSeconds(3600)
        val challenge = challenges.findById(key).orElse(null)
        if (challenge == null) challenges.save(AuthProfileChallenge(key, email, secrets.hash(token), expires))
        else {
            challenge.targetEmail = email
            challenge.tokenHash = secrets.hash(token)
            challenge.expiresAt = expires
        }
    }

    private fun send(email: String, path: String, token: String) {
        val message = SimpleMailMessage().apply {
            from = this@ProfileService.from
            setTo(email)
            subject = "STORYFORK account verification"
            text = "$origin/auth/$path#token=$token"
        }
        mail.send(message)
    }

    @Transactional
    fun requestEmailChange(id: UUID, request: EmailRequest) {
        lock(id)
        val target = address(request.email)
        if (members.existsByEmail(target)) throw AuthException(AuthException.Reason.CONFLICT)
        val token = secrets.newToken()
        challenge(id, "email", target, token)
        try { send(target, "verify-email-change", token) } catch (_: MailException) { throw AuthException(AuthException.Reason.UNAVAILABLE) }
    }

    @Transactional
    fun verifyEmailChange(request: TokenRequest) {
        val hash = secrets.hash(request.token)
        val id = challenges.findMemberId("email", hash) ?: throw AuthException(AuthException.Reason.INVALID)
        val member = lock(id)
        val challenge = validChallenge(id, "email", hash)
        member.email = requireNotNull(challenge.targetEmail)
        challenges.delete(challenge)
        challenges.findById(ProfileChallengeId(id, "reset")).ifPresent(challenges::delete)
        try {
            members.flush()
        } catch (_: DataIntegrityViolationException) { throw AuthException(AuthException.Reason.CONFLICT) }
    }

    @Transactional
    fun forgotPassword(request: EmailRequest) {
        val target = address(request.email)
        val member = members.lockByEmail(target) ?: return
        val token = secrets.newToken()
        challenge(member.id, "reset", target, token)
        try {
            send(target, "reset-password", token)
        } catch (_: MailException) {
            logger.warn("Password recovery email delivery failed")
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()
        }
    }

    @Transactional
    fun resetPassword(request: ResetRequest) {
        if (request.newPassword.toByteArray(Charsets.UTF_8).size > 72) throw AuthException(AuthException.Reason.INVALID)
        val hash = secrets.hash(request.token)
        val id = challenges.findMemberId("reset", hash) ?: throw AuthException(AuthException.Reason.INVALID)
        val member = lock(id)
        val challenge = validChallenge(id, "reset", hash)
        if (member.email != challenge.targetEmail) throw AuthException(AuthException.Reason.INVALID)
        member.passwordHash = requireNotNull(passwords.encode(request.newPassword))
        challenges.delete(challenge)
        challenges.findById(ProfileChallengeId(id, "email")).ifPresent(challenges::delete)
        sessions.revokeAll(id)
    }

    // Only read the entity after acquiring its member lock; another request may have replaced it.
    private fun validChallenge(id: UUID, purpose: String, hash: String): AuthProfileChallenge {
        val challenge = challenges.findById(ProfileChallengeId(id, purpose)).orElse(null)
        if (challenge == null || challenge.tokenHash != hash || !challenge.expiresAt.isAfter(Instant.now()))
            throw AuthException(AuthException.Reason.INVALID)
        return challenge
    }
}
