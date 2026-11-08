package ai.storyfork.core.auth

import ai.storyfork.core.auth.controller.MemberAdminController
import ai.storyfork.core.auth.controller.ProfileController
import ai.storyfork.core.auth.controller.SessionController
import ai.storyfork.core.auth.controller.SignupController
import ai.storyfork.core.auth.service.ProfileService
import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.SignupService
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AuthLayerBoundariesTest {
    private val controllers = listOf(SignupController::class.java, SessionController::class.java, ProfileController::class.java,
        MemberAdminController::class.java)

    @Test
    fun `controllers bind explicit values instead of servlet objects or map responses`() {
        for (controller in controllers) {
            for (method in controller.declaredMethods.filter { java.lang.reflect.Modifier.isPublic(it.modifiers) }) {
                assertFalse(method.parameterTypes.any { it.name.startsWith("jakarta.servlet.") }, method.toString())
                assertFalse(Map::class.java.isAssignableFrom(method.returnType), method.toString())
            }
            assertTrue(controller.declaredClasses.isEmpty(), "DTOs belong in their own service dto files")
        }
    }

    @Test
    fun `auth services delegate persistence to repositories`() {
        for (service in listOf(SignupService::class.java, SessionService::class.java, ProfileService::class.java)) {
            assertFalse(service.declaredFields.any { it.type.name == "org.springframework.jdbc.core.JdbcTemplate" }, service.name)
        }
    }

    @Test
    fun `auth repositories use JPA entity persistence`() {
        val jpa = Class.forName("org.springframework.data.jpa.repository.JpaRepository")
        for (name in listOf("MemberRepository", "SignupChallengeRepository", "ProfileChallengeRepository", "SessionRepository", "RefreshTokenRepository")) {
            assertTrue(jpa.isAssignableFrom(Class.forName("ai.storyfork.core.auth.repository.$name")), name)
        }
    }

    @Test
    fun `public and internal contracts are explicit top level service DTOs`() {
        for (name in listOf("SignupRequest", "EmailRequest", "TokenRequest", "VerificationRequest", "LoginRequest",
            "NicknameRequest", "ResetRequest", "CsrfResponse", "MemberResponse", "LoginResponse", "LoginResult", "SessionResponse", "SessionsResponse",
            "VerifiedMemberResponse", "MemberItem", "MemberListResponse", "AdminCreateRequest")) {
            val dto = Class.forName("ai.storyfork.core.auth.service.dto.$name")
            assertNull(dto.enclosingClass, name)
            assertTrue(dto.declaredFields.none { it.type.name.startsWith("ai.storyfork.core.auth.entity.") }, name)
        }
        val response = Class.forName("ai.storyfork.core.auth.service.dto.LoginResponse")
        assertFalse(response.declaredFields.any { it.name == "refreshToken" })
        val result = Class.forName("ai.storyfork.core.auth.service.dto.LoginResult")
        assertTrue(result.declaredFields.any { it.name == "refreshToken" })
    }
}
