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

    @Test
    fun `persistence owns only the operations schema and dedicated migration history`() {
        val properties = Properties()
        checkNotNull(javaClass.getResourceAsStream("/application.properties")).use(properties::load)

        assertEquals("validate", properties.getProperty("spring.jpa.hibernate.ddl-auto"))
        assertEquals("false", properties.getProperty("spring.jpa.open-in-view"))
        assertEquals("operations", properties.getProperty("spring.jpa.properties.hibernate.default_schema"))
        assertEquals("UTC", properties.getProperty("spring.jpa.properties.hibernate.jdbc.time_zone"))
        assertEquals("classpath:db/migration/operations", properties.getProperty("spring.flyway.locations"))
        assertEquals("operations", properties.getProperty("spring.flyway.schemas"))
        assertEquals("operations", properties.getProperty("spring.flyway.default-schema"))
        assertEquals("operations_flyway_schema_history", properties.getProperty("spring.flyway.table"))
        assertEquals("\${OPERATIONS_SERVICE_TOKEN:}", properties.getProperty("app.operations.service-token"))
        assertEquals("20", properties.getProperty("spring.data.web.pageable.default-page-size"))
        assertEquals("100", properties.getProperty("spring.data.web.pageable.max-page-size"))
        assertEquals("\${OPERATIONS_DATABASE_URL:jdbc:postgresql://127.0.0.1:5432/storyfork}", properties.getProperty("spring.datasource.url"))
        assertEquals("\${OPERATIONS_DATABASE_USER:storyfork}", properties.getProperty("spring.datasource.username"))
        assertEquals("\${OPERATIONS_DATABASE_PASSWORD:}", properties.getProperty("spring.datasource.password"))
    }
}
