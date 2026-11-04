package ai.storyfork.core.world

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner

class WorldStudioConfigIntegrationTest {
    @Test fun `disabled feature never creates persistence beans or falls back to Core and Content URLs`() {
        ApplicationContextRunner().withUserConfiguration(WorldStudioConfig::class.java)
            .withPropertyValues("CORE_DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable","CONTENT_DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable")
            .run { context ->
                assertNull(context.startupFailure)
                assertFalse(context.containsBean("worldStudioDataSource"))
                assertFalse(context.containsBean("worldStudioEntityManagerFactory"))
                assertFalse(context.containsBean("worldStudioService"))
            }
    }
}
