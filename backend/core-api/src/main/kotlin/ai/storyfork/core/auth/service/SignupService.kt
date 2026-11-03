package ai.storyfork.core.auth.service

import ai.storyfork.core.auth.repository.SignupRepository
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.HexFormat
import java.util.Locale
import org.slf4j.LoggerFactory
import org.springframework.transaction.interceptor.TransactionAspectSupport
import org.springframework.beans.factory.annotation.Value
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.mail.MailException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

@Service
class SignupService(
    private val repository: SignupRepository,
    private val mail: JavaMailSender,
    @param:Value("\${app.auth.public-origin}") private val publicOrigin: String,
    @param:Value("\${app.auth.mail-from}") private val mailFrom: String,
) {
    private val secrets = SignupSecrets()
    private val logger = LoggerFactory.getLogger(SignupService::class.java)

    init {
        val origin = URI.create(publicOrigin)
        require(origin.host != null && origin.userInfo == null && origin.rawPath.isNullOrEmpty() &&
            origin.query == null && origin.fragment == null && (origin.port == -1 || origin.port in 1..65535) &&
            (origin.scheme == "https" || (origin.scheme == "http" && origin.host in setOf("localhost", "127.0.0.1", "[::1]"))))
        require(mailFrom.isNotBlank())
    }

    @Transactional
    fun signup(email: String, password: String, nickname: String) {
        val address = email.trim().lowercase(Locale.ROOT)
        if (password.toByteArray(Charsets.UTF_8).size > 72) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        if (repository.memberExists(address)) {
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
        val token = secrets.newToken()
        try {
            repository.createChallenge(address, secrets.hashPassword(password), nickname.trim(), digest(token), Instant.now().plusSeconds(86400))
        } catch (_: DataIntegrityViolationException) {
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
        send(address, token)
    }

    @Transactional
    fun resend(email: String) {
        val address = email.trim().lowercase(Locale.ROOT)
        val token = secrets.newToken()
        val updated = repository.replaceChallenge(address, digest(token), Instant.now().plusSeconds(86400))
        if (updated == 1) {
            try { send(address, token) } catch (_: ResponseStatusException) {
                logger.warn("Verification email delivery failed")
                TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()
            }
        }
    }

    @Transactional
    fun verify(token: String) {
        val (email, password, nickname) = repository.consumeChallenge(digest(token))
            ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        try {
            repository.createMember(email, password, nickname)
        } catch (_: DataIntegrityViolationException) {
            throw ResponseStatusException(HttpStatus.CONFLICT)
        }
    }

    private fun digest(token: String): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)))

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
