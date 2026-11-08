package ai.storyfork.content.world

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner

class WorldStudioConfigIntegrationTest {
    @Test fun `disabled feature registers no WorldStudio persistence or service beans`() {
        ApplicationContextRunner().withUserConfiguration(WorldStudioConfig::class.java,ai.storyfork.content.world.service.WorldStudioService::class.java)
            .withPropertyValues("DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable","DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable")
            .run { context ->
                assertNull(context.startupFailure)
                assertFalse(context.containsBean("worldStudioDataSource"))
                assertFalse(context.containsBean("worldStudioEntityManagerFactory"))
                assertFalse(context.containsBean("worldStudioService"))
            }
    }
}
