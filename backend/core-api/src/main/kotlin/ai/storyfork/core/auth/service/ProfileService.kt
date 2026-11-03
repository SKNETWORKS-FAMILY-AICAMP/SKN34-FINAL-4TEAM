package ai.storyfork.core.auth.service

import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.HexFormat
import java.util.Locale
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.transaction.interceptor.TransactionAspectSupport
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.mail.MailException
import org.springframework.mail.SimpleMailMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException

@Service
class ProfileService(
    private val jdbc: JdbcTemplate,
    private val sessions: SessionService,
    private val mail: JavaMailSender,
    @param:Value("\${app.auth.public-origin}") private val origin: String,
    @param:Value("\${app.auth.mail-from}") private val from: String,
) {
    private val secrets = SignupSecrets()
    private val logger = LoggerFactory.getLogger(ProfileService::class.java)
    private fun hash(token: String) = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.toByteArray(Charsets.UTF_8)))
    private fun address(email: String) = email.trim().lowercase(Locale.ROOT)
    private fun user(id: UUID) = sessions.memberById(id) ?: throw ResponseStatusException(HttpStatus.UNAUTHORIZED)

    @Transactional
    fun nickname(id: UUID, nickname: String): SessionService.User {
        if (nickname.isBlank()) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        if (jdbc.update("update auth_member set nickname = ? where id = ?", nickname.trim(), id) != 1) throw ResponseStatusException(HttpStatus.UNAUTHORIZED)
        return user(id)
    }

    private fun challenge(id: UUID, purpose: String, email: String, token: String) {
        jdbc.update("""insert into auth_profile_challenge(member_id, purpose, target_email, token_hash, expires_at)
            values (?, ?, ?, ?, ?) on conflict (member_id, purpose) do update set
            target_email = excluded.target_email, token_hash = excluded.token_hash, expires_at = excluded.expires_at""",
            id, purpose, email, hash(token), Timestamp.from(Instant.now().plusSeconds(3600)))
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
    fun requestEmailChange(id: UUID, email: String) {
        user(id)
        val target = address(email)
        if (jdbc.queryForObject("select count(*) from auth_member where email = ?", Int::class.java, target) != 0) throw ResponseStatusException(HttpStatus.CONFLICT)
        val token = secrets.newToken()
        challenge(id, "email", target, token)
        try { send(target, "verify-email-change", token) } catch (_: MailException) { throw ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE) }
    }

    @Transactional
    fun verifyEmailChange(token: String) {
        val challenge = jdbc.query("delete from auth_profile_challenge where purpose = 'email' and token_hash = ? and expires_at > now() returning member_id, target_email",
            { rs, _ -> rs.getObject(1, UUID::class.java) to rs.getString(2) }, hash(token)).singleOrNull() ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        try {
            jdbc.update("update auth_member set email = ? where id = ?", challenge.second, challenge.first)
            jdbc.update("delete from auth_profile_challenge where member_id = ? and purpose = 'reset'", challenge.first)
        } catch (_: DataIntegrityViolationException) { throw ResponseStatusException(HttpStatus.CONFLICT) }
    }

    @Transactional
    fun forgotPassword(email: String) {
        val target = address(email)
        val id = jdbc.query("select id from auth_member where email = ?", { rs, _ -> rs.getObject(1, UUID::class.java) }, target).singleOrNull()
        if (id == null) return
        val token = secrets.newToken()
        challenge(id, "reset", target, token)
        try {
            send(target, "reset-password", token)
        } catch (_: MailException) {
            logger.warn("Password recovery email delivery failed")
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()
        }
    }

    @Transactional
    fun resetPassword(token: String, password: String) {
        if (password.toByteArray(Charsets.UTF_8).size > 72) throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        val challenge = jdbc.query("delete from auth_profile_challenge where purpose = 'reset' and token_hash = ? and expires_at > now() returning member_id, target_email",
            { rs, _ -> rs.getObject(1, UUID::class.java) to rs.getString(2) }, hash(token)).singleOrNull() ?: throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        if (jdbc.update("update auth_member set password_hash = ? where id = ? and email = ?", secrets.hashPassword(password), challenge.first, challenge.second) != 1)
            throw ResponseStatusException(HttpStatus.BAD_REQUEST)
        jdbc.update("update auth_session set revoked = true where member_id = ?", challenge.first)
    }
}
