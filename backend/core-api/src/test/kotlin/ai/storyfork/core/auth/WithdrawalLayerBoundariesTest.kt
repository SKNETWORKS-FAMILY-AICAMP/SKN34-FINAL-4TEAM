package ai.storyfork.core.auth

import ai.storyfork.core.auth.controller.WithdrawalController
import ai.storyfork.core.auth.entity.AuthWithdrawal
import ai.storyfork.core.auth.service.WithdrawalService
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WithdrawalLayerBoundariesTest {
    @Test
    fun `controller binds explicit values and keeps DTOs out of the controller`() {
        for (method in WithdrawalController::class.java.declaredMethods.filter { java.lang.reflect.Modifier.isPublic(it.modifiers) }) {
            assertFalse(method.parameterTypes.any { it.name.startsWith("jakarta.servlet.") }, method.toString())
            assertFalse(Map::class.java.isAssignableFrom(method.returnType), method.toString())
        }
        assertTrue(WithdrawalController::class.java.declaredClasses.isEmpty())
    }

    @Test
    fun `service delegates persistence to repositories`() {
        assertFalse(WithdrawalService::class.java.declaredFields.any { it.type.name == "org.springframework.jdbc.core.JdbcTemplate" })
        val jpa = Class.forName("org.springframework.data.jpa.repository.JpaRepository")
        assertTrue(jpa.isAssignableFrom(Class.forName("ai.storyfork.core.auth.repository.WithdrawalRepository")))
    }

    @Test
    fun `grace period is thirty days and new requests start pending`() {
        assertEquals(30L, WithdrawalService.GRACE_DAYS)
        val now = java.time.Instant.now()
        val w = AuthWithdrawal(java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), now, now.plusSeconds(1))
        assertEquals(AuthWithdrawal.PENDING, w.status)
    }
}
