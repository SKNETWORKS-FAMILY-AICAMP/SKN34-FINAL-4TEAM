package ai.storyfork.operations

import java.util.Properties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ApplicationPropertiesTest {
    @Test
    fun `native defaults identify the service and bind only to its loopback port`() {
        val properties = Properties()
        checkNotNull(javaClass.getResourceAsStream("/application.properties")).use(properties::load)

        assertEquals("storyfork-operations-service", properties.getProperty("spring.application.name"))
        assertEquals("127.0.0.1", properties.getProperty("server.address"))
        assertEquals("8082", properties.getProperty("server.port"))
    }
}
