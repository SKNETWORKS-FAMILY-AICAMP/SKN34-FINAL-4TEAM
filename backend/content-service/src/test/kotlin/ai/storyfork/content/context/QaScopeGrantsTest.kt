package ai.storyfork.content.context

import ai.storyfork.content.context.service.QaScopeGrant
import ai.storyfork.content.context.service.QaScopeGrants
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class QaScopeGrantsTest {
    private val now = Instant.parse("2026-11-12T00:00:00Z")
    private val grants = QaScopeGrants(Clock.fixed(now, ZoneOffset.UTC))
    private val grant = QaScopeGrant("fork", "owner-uuid", 2, "r2", "relationship")

    @Test
    fun `issued token reads back the same scope`() {
        assertEquals(grant, grants.read(grants.issue(grant)))
    }

    @Test
    fun `tampered foreign or malformed tokens are rejected`() {
        val token = grants.issue(grant)
        val (body, signature) = token.split('.')
        val other = QaScopeGrants().issue(grant.copy(owner = "other-owner"))
        for (bad in listOf("${other.substringBefore('.')}.$signature", "$body.${other.substringAfter('.')}",
            other, "", "abc", "$body.", "a.b.c")) {
            assertNull(grants.read(bad), bad)
        }
    }

    @Test
    fun `expired token is rejected`() {
        assertNull(grants.read(grants.issue(grant, Duration.ofSeconds(-1))))
    }
}
