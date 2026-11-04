package ai.storyfork.content

import java.util.Properties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ApplicationPropertiesTest {
    @Test
    fun `native defaults identify the service and bind only to its loopback port`() {
        val properties = Properties()
        checkNotNull(javaClass.getResourceAsStream("/application.properties")).use(properties::load)

        assertEquals("storyfork-content-service", properties.getProperty("spring.application.name"))
        assertEquals("127.0.0.1", properties.getProperty("server.address"))
        assertEquals("8081", properties.getProperty("server.port"))
    }
}
