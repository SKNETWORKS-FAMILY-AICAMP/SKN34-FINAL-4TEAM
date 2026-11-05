package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.entity.AuthMember
import ai.storyfork.core.auth.entity.AuthSignupChallenge
import ai.storyfork.core.auth.helper.AuthTokenHelper
import ai.storyfork.core.auth.repository.MemberRepository
import ai.storyfork.core.auth.repository.SignupChallengeRepository
import ai.storyfork.core.auth.service.dto.EmailRequest
import ai.storyfork.core.auth.service.dto.SignupRequest
import ai.storyfork.core.auth.service.dto.VerificationRequest
import java.net.URI
import java.time.Instant
import java.util.Locale
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.mail.MailException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.interceptor.TransactionAspectSupport
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException

@Service
class SignupService(
    private val members: MemberRepository,
    private val challenges: SignupChallengeRepository,
    private val passwords: PasswordEncoder,
    private val secrets: AuthTokenHelper,
    private val transactions: TransactionTemplate,
    private val mail: JavaMailSender,
    @param:Value("\${app.auth.public-origin}") private val publicOrigin: String,
    @param:Value("\${app.auth.mail-from}") private val mailFrom: String,
) {
    private val logger = LoggerFactory.getLogger(SignupService::class.java)

    init {
        val origin = URI.create(publicOrigin)
        require(origin.host != null && origin.userInfo == null && origin.rawPath.isNullOrEmpty() &&
            origin.query == null && origin.fragment == null && (origin.port == -1 || origin.port in 1..65535) &&
            (origin.scheme == "https" || (origin.scheme == "http" && origin.host in setOf("localhost", "127.0.0.1", "[::1]"))))
        require(mailFrom.isNotBlank())
    }

    fun signup(request: SignupRequest) {
        val address = request.email.trim().lowercase(Locale.ROOT)
        if (request.password.toByteArray(Charsets.UTF_8).size > 72) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        val token = secrets.newToken()
        val passwordHash = requireNotNull(passwords.encode(request.password))
        // An absent email has no row to lock. Retry its first-insert collision in a fresh transaction.
        repeat(2) { attempt ->
            try {
                transactions.executeWithoutResult {
                    if (members.existsByEmail(address)) throw ResponseStatusException(HttpStatus.CONFLICT)
                    val challenge = challenges.lockByEmail(address)
                    val expires = Instant.now().plusSeconds(86400)
                    if (challenge == null) {
                        challenges.saveAndFlush(AuthSignupChallenge(address, passwordHash, request.nickname.trim(), secrets.hash(token), expires))
                    } else {
                        challenge.passwordHash = passwordHash
                        challenge.nickname = request.nickname.trim()
                        challenge.tokenHash = secrets.hash(token)
                        challenge.expiresAt = expires
                        challenges.flush()
                    }
                    send(address, token)
                }
                return
            } catch (_: DataIntegrityViolationException) {
                if (attempt == 1) throw ResponseStatusException(HttpStatus.CONFLICT)
            }
        }
    }

    @Transactional
    fun resend(request: EmailRequest) {
        val address = request.email.trim().lowercase(Locale.ROOT)
        val challenge = challenges.lockByEmail(address) ?: return
        val token = secrets.newToken()
        challenge.tokenHash = secrets.hash(token)
        challenge.expiresAt = Instant.now().plusSeconds(86400)
        try { send(address, token) } catch (_: ResponseStatusException) {
            logger.warn("Verification email delivery failed")
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()
        }
    }

    @Transactional
    fun verify(request: VerificationRequest) {
        if (request.password.isBlank() || request.password.toByteArray(Charsets.UTF_8).size > 72) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        val challenge = challenges.findByTokenHashAndExpiresAtAfter(secrets.hash(request.token), Instant.now())
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        if (!passwords.matches(request.password, challenge.passwordHash)) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        challenges.delete(challenge)
        try {
            members.saveAndFlush(AuthMember(UUID.randomUUID(), challenge.email, challenge.passwordHash, challenge.nickname))
        } catch (_: DataIntegrityViolationException) {
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
    }

    private fun send(address: String, token: String) {
        val message = SimpleMailMessage().apply {
            from = mailFrom
            setTo(address)
            subject = "STORYFORK email verification"
            text = "$publicOrigin/auth/verify-email#token=$token"
        }
        try {
            mail.send(message)
        } catch (_: MailException) {
            throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE)
        }
    }
}
