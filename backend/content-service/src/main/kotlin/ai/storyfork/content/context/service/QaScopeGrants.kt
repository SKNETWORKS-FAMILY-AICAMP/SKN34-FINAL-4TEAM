package ai.storyfork.content.context.service

import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Clock
import java.time.Duration
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.stereotype.Component

/** Content가 인증 뒤 확정한 Q&A 조회 키. 서명 토큰 안에만 담아 AI 오케스트레이션에 맡긴다. */
data class QaScopeGrant(
    val workId: String, val owner: String?, val episode: Int, val episodeVersionId: String, val target: String = "manuscript",
)

/**
 * Q&A 조회 키를 HMAC으로 서명한 토큰을 발급하고 확인한다. AI는 토큰을 되돌려 줄 뿐 내용을 바꿀 수 없으므로,
 * `INTERNAL_TOKEN`만으로 다른 작가(owner)를 지정해 비공개 설정·관계를 읽을 수 없다.
 */
@Component
internal class QaScopeGrants(private val clock: Clock) {
    @Autowired constructor() : this(Clock.systemUTC())

    // shortcut: 키가 프로세스마다 새로 생겨 Content 재시작·다중 인스턴스에서는 발급한 토큰이 403이다. 여러 대를 띄우면 공유 비밀로 바꾼다.
    private val key = SecretKeySpec(ByteArray(32).also(SecureRandom()::nextBytes), "HmacSHA256")

    fun issue(grant: QaScopeGrant, ttl: Duration = Duration.ofHours(1)): String {
        val fields = listOf(grant.workId, grant.owner.orEmpty(), grant.episode.toString(), grant.episodeVersionId,
            grant.target, clock.instant().plus(ttl).epochSecond.toString())
        require(fields.none { '\n' in it }) { "scope 값에 줄바꿈이 있어요." }
        val body = encode(fields.joinToString("\n").toByteArray())
        return "$body.${encode(mac(body))}"
    }

    /** 서명이 맞고 만료 전이면 조회 키, 아니면 null. */
    fun read(token: String): QaScopeGrant? {
        val parts = token.split('.').takeIf { it.size == 2 } ?: return null
        val signature = decode(parts[1]) ?: return null
        if (!MessageDigest.isEqual(mac(parts[0]), signature)) return null
        val f = decode(parts[0])?.let { String(it).split('\n') }?.takeIf { it.size == 6 } ?: return null
        val expires = f[5].toLongOrNull() ?: return null
        if (clock.instant().epochSecond >= expires) return null
        return QaScopeGrant(f[0], f[1].ifEmpty { null }, f[2].toIntOrNull() ?: return null, f[3], f[4])
    }

    private fun mac(body: String) = Mac.getInstance("HmacSHA256").apply { init(key) }.doFinal(body.toByteArray())
    private fun encode(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    private fun decode(text: String) = runCatching { Base64.getUrlDecoder().decode(text) }.getOrNull()
}
