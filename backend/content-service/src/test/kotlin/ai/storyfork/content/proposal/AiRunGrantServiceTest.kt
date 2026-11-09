package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.proposal.entity.AiRunEntity
import ai.storyfork.content.proposal.service.AiRunGrantService
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.time.Instant

class AiRunGrantServiceTest {
    private val signer=AiRunGrantService("fixture-grant-secret-at-least-32-characters")
    private fun run()=AiRunEntity(id="r",threadId="t",requesterId="owner",workId="w",operation="ask",
        requestHash="request-hash",scopeHash="scope-hash",grantExpiresAt=Instant.now().plusSeconds(300))

    @Test fun `grant binds run thread scope payload and expires without storing its secret`() {
        val row=run()
        val token=signer.token(row)
        assertEquals(64,token.length)
        assertDoesNotThrow {signer.requireValid(row,token)}
        row.scopeHash="other-scope"
        assertEquals(403,assertThrows(ContentFailure::class.java) {signer.requireValid(row,token)}.status)
        row.scopeHash="scope-hash"
        row.grantExpiresAt=Instant.now().minusSeconds(1)
        assertEquals(403,assertThrows(ContentFailure::class.java) {signer.requireValid(row,token)}.status)
    }

    @Test fun `forged token and foreign run never authorize`() {
        val row=run()
        assertEquals(403,assertThrows(ContentFailure::class.java) {signer.requireValid(row,"forged")}.status)
        val token=signer.token(row)
        row.id="other"
        assertEquals(403,assertThrows(ContentFailure::class.java) {signer.requireValid(row,token)}.status)
    }
}
