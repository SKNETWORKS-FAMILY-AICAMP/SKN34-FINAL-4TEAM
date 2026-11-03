package ai.storyfork.core.auth.repository

import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Repository

@Repository
class SignupRepository(private val jdbc: JdbcTemplate) {
    fun memberExists(email: String): Boolean =
        jdbc.queryForObject("select count(*) from auth_member where email = ?", Int::class.java, email) != 0

    fun createChallenge(email: String, passwordHash: String, nickname: String, tokenHash: String, expires: Instant) {
        jdbc.update("""insert into auth_signup_challenge(email, password_hash, nickname, token_hash, expires_at) values (?, ?, ?, ?, ?)
            on conflict (email) do update set password_hash = excluded.password_hash, nickname = excluded.nickname,
            token_hash = excluded.token_hash, expires_at = excluded.expires_at""",
            email, passwordHash, nickname, tokenHash, Timestamp.from(expires))
    }

    fun replaceChallenge(email: String, tokenHash: String, expires: Instant): Int =
        jdbc.update("update auth_signup_challenge set token_hash = ?, expires_at = ? where email = ?",
            tokenHash, Timestamp.from(expires), email)

    fun consumeChallenge(tokenHash: String): Triple<String, String, String>? =
        jdbc.query("delete from auth_signup_challenge where token_hash = ? and expires_at > now() returning email, password_hash, nickname", { rs, _ ->
            Triple(rs.getString("email"), rs.getString("password_hash"), rs.getString("nickname"))
        }, tokenHash).singleOrNull()

    fun createMember(email: String, passwordHash: String, nickname: String) {
        jdbc.update("insert into auth_member(id, email, password_hash, nickname) values (?, ?, ?, ?)", UUID.randomUUID(), email, passwordHash, nickname)
    }
}
