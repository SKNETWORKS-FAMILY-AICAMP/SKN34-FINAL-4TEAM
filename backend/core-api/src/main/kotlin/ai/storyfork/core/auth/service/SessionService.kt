package ai.storyfork.core.auth.service

import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.Locale
import java.util.UUID
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwsHeader
import org.springframework.security.oauth2.jwt.JwtClaimsSet
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.JwtEncoderParameters
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
class SessionService(private val jdbc: JdbcTemplate, private val jwt: JwtEncoder) {
    data class User(val id: String, val email: String, val nickname: String, val operator: Boolean)
    data class Login(val accessToken: String, val user: User, val refreshToken: String)
    data class Session(val id: String, val deviceLabel: String, val createdAt: Instant, val current: Boolean)
    private data class Member(val user: User, val passwordHash: String)
    private val passwords = BCryptPasswordEncoder()
    private val dummyHash = passwords.encode("not-a-real-password")
    private val secrets = SignupSecrets()

    private fun memberByEmail(email: String): Member? = jdbc.query(
        "select id, email, nickname, operator, password_hash from auth_member where email = ?",
        { rs, _ -> Member(User(rs.getString("id"), rs.getString("email"), rs.getString("nickname"), rs.getBoolean("operator")), rs.getString("password_hash")) }, email
    ).singleOrNull()

    fun memberById(id: UUID): User? = jdbc.query(
        "select id, email, nickname, operator from auth_member where id = ?",
        { rs, _ -> User(rs.getString("id"), rs.getString("email"), rs.getString("nickname"), rs.getBoolean("operator")) }, id
    ).singleOrNull()

    private fun hash(token: String): String = MessageDigest.getInstance("SHA-256").digest(token.toByteArray()).joinToString("") { "%02x".format(it) }
    private fun access(user: User): String {
        val now = Instant.now()
        val claims = JwtClaimsSet.builder().subject(user.id).issuedAt(now).expiresAt(now.plusSeconds(1800)).build()
        return jwt.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).tokenValue
    }

    @Transactional
    fun login(email: String, password: String, device: String): Login? {
        val member = memberByEmail(email.trim().lowercase(Locale.ROOT))
        if (!passwords.matches(password, member?.passwordHash ?: dummyHash) || member == null) return null
        lock(UUID.fromString(member.user.id))
        val current = memberByEmail(email.trim().lowercase(Locale.ROOT))
        if (current?.user?.id != member.user.id || !passwords.matches(password, current.passwordHash)) return null
        val id = UUID.randomUUID()
        val now = Instant.now()
        jdbc.update("insert into auth_session(id, member_id, device_label, created_at, expires_at) values (?, ?, ?, ?, ?)", id,
            UUID.fromString(member.user.id), device.take(200).ifBlank { "Unknown device" }, Timestamp.from(now), Timestamp.from(now.plusSeconds(1209600)))
        val token = secrets.newToken()
        jdbc.update("insert into auth_refresh_token(token_hash, session_id) values (?, ?)", hash(token), id)
        return Login(access(current.user), current.user, token)
    }

    private fun owner(token: String): UUID? = jdbc.query(
        "select s.member_id from auth_refresh_token t join auth_session s on s.id = t.session_id where t.token_hash = ?",
        { rs, _ -> rs.getObject(1, UUID::class.java) }, hash(token)
    ).singleOrNull()
    private fun lock(memberId: UUID) { jdbc.queryForObject("select id from auth_member where id = ? for update", UUID::class.java, memberId) }

    @Transactional
    fun refresh(token: String?, expectedMemberId: UUID? = null): Login? {
        if (token.isNullOrBlank() || token.length > 128) return null
        val memberId = owner(token) ?: return null
        if (expectedMemberId != null && expectedMemberId != memberId) return null
        lock(memberId)
        val row = jdbc.query("select s.id, s.revoked, s.expires_at, t.used from auth_refresh_token t join auth_session s on s.id = t.session_id where t.token_hash = ?",
            { rs, _ -> listOf(rs.getObject(1, UUID::class.java), rs.getBoolean(2), rs.getTimestamp(3).toInstant(), rs.getBoolean(4)) }, hash(token)).singleOrNull() ?: return null
        if (row[1] as Boolean || !(row[2] as Instant).isAfter(Instant.now())) return null
        if (row[3] as Boolean) {
            jdbc.update("update auth_session set revoked = true where member_id = ?", memberId)
            return null
        }
        val user = memberById(memberId) ?: return null
        jdbc.update("update auth_refresh_token set used = true where token_hash = ?", hash(token))
        val next = secrets.newToken()
        jdbc.update("insert into auth_refresh_token(token_hash, session_id) values (?, ?)", hash(next), row[0])
        return Login(access(user), user, next)
    }

    @Transactional
    fun logout(token: String?, expectedMemberId: UUID? = null): Boolean {
        if (token.isNullOrBlank() || token.length > 128) return true
        val memberId = owner(token) ?: return true
        if (expectedMemberId != null && expectedMemberId != memberId) return false
        lock(memberId)
        jdbc.update("""update auth_session set revoked = true where member_id = ?
            and id in (select session_id from auth_refresh_token where token_hash = ?)""", memberId, hash(token))
        return true
    }

    fun sessions(memberId: UUID, token: String?): List<Session> {
        val currentHash = token?.takeIf { it.length <= 128 }?.let(::hash)
        return jdbc.query("""select s.id, s.device_label, s.created_at, exists
            (select 1 from auth_refresh_token t where t.session_id = s.id and t.token_hash = ? and t.used = false)
            from auth_session s where s.member_id = ? and s.revoked = false and s.expires_at > now() order by s.created_at""",
            { rs, _ -> Session(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant(), rs.getBoolean(4)) }, currentHash, memberId)
    }

    @Transactional
    fun revoke(memberId: UUID, sessionId: UUID): Boolean {
        lock(memberId)
        return jdbc.update("update auth_session set revoked = true where id = ? and member_id = ? and revoked = false", sessionId, memberId) > 0
    }

    @Transactional
    fun logoutAll(memberId: UUID, token: String?): Boolean {
        lock(memberId)
        jdbc.update("update auth_session set revoked = true where member_id = ?", memberId)
        return token?.takeIf { it.length <= 128 }?.let(::owner) == memberId
    }
}
