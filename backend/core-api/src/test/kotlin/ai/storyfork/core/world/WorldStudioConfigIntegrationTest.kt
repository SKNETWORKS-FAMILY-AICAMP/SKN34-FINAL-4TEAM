package ai.storyfork.core.world

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.runner.ApplicationContextRunner

class WorldStudioConfigIntegrationTest {
    @Test fun `disabled feature registers no WorldStudio persistence or service beans`() {
        ApplicationContextRunner().withUserConfiguration(WorldStudioConfig::class.java,ai.storyfork.core.world.service.WorldStudioService::class.java)
            .withPropertyValues("CORE_DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable","CONTENT_DATABASE_URL=jdbc:postgresql://127.0.0.1:1/unreachable")
            .run { context ->
                assertNull(context.startupFailure)
                assertFalse(context.containsBean("worldStudioDataSource"))
                assertFalse(context.containsBean("worldStudioEntityManagerFactory"))
                assertFalse(context.containsBean("worldStudioService"))
            }
    }
}
