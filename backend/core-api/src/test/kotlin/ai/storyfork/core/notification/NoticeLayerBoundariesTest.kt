package ai.storyfork.core.notification

import ai.storyfork.core.notification.controller.NoticeController
import ai.storyfork.core.notification.controller.NoticePreferenceController
import ai.storyfork.core.notification.service.NoticeService
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NoticeLayerBoundariesTest {
    @Test
    fun `controllers bind explicit values instead of servlet objects or map responses`() {
        for (controller in listOf(NoticeController::class.java, NoticePreferenceController::class.java)) {
            for (method in controller.declaredMethods.filter { java.lang.reflect.Modifier.isPublic(it.modifiers) }) {
                assertFalse(method.parameterTypes.any { it.name.startsWith("jakarta.servlet.") }, method.toString())
                assertFalse(Map::class.java.isAssignableFrom(method.returnType), method.toString())
            }
            assertTrue(controller.declaredClasses.isEmpty(), "DTOs belong in their own service dto files")
        }
    }

    @Test
    fun `service delegates persistence to repositories`() {
        assertFalse(NoticeService::class.java.declaredFields.any { it.type.name == "org.springframework.jdbc.core.JdbcTemplate" })
        val jpa = Class.forName("org.springframework.data.jpa.repository.JpaRepository")
        for (name in listOf("NoticeRepository", "NoticePreferenceRepository")) {
            assertTrue(jpa.isAssignableFrom(Class.forName("ai.storyfork.core.notification.repository.$name")), name)
        }
    }
}
