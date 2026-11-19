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
    fun `no default browser user account is created because the user details auto-configuration is excluded`() {
        val properties = Properties()
        checkNotNull(javaClass.getResourceAsStream("/application.properties")).use(properties::load)

        val excluded = properties.getProperty("spring.autoconfigure.exclude")

        assertEquals("org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration", excluded)
        // Boot silently ignores an excluded name that is not on the classpath, so a typo would still log a default password.
        Class.forName(excluded, false, javaClass.classLoader)
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
        assertEquals("\${DATABASE_URL:jdbc:postgresql://127.0.0.1:5432/storyfork}", properties.getProperty("spring.datasource.url"))
        assertEquals("\${DATABASE_USER:storyfork}", properties.getProperty("spring.datasource.username"))
        assertEquals("\${DATABASE_PASSWORD:}", properties.getProperty("spring.datasource.password"))
        assertEquals("\${OPERATIONS_CORE_BASE_URL:http://127.0.0.1:8080}", properties.getProperty("app.operations.core-base-url"))
        assertEquals("\${OPERATIONS_CONTENT_BASE_URL:http://127.0.0.1:8081}", properties.getProperty("app.operations.content-base-url"))
    }

    @Test
    fun `LLMOps clients and the alert broker read their documented environment variables`() {
        val properties = Properties()
        checkNotNull(javaClass.getResourceAsStream("/application.properties")).use(properties::load)

        assertEquals("\${OPERATIONS_LANGFUSE_BASE_URL:http://127.0.0.1:3000}", properties.getProperty("app.operations.langfuse-base-url"))
        assertEquals("\${LANGFUSE_PUBLIC_KEY:}", properties.getProperty("app.operations.langfuse-public-key"))
        assertEquals("\${LANGFUSE_SECRET_KEY:}", properties.getProperty("app.operations.langfuse-secret-key"))
        assertEquals("\${LANGFUSE_UI_URL:http://localhost:3000}", properties.getProperty("app.operations.langfuse-ui-url"))
        assertEquals("\${OPERATIONS_AI_BASE_URL:http://127.0.0.1:8000}", properties.getProperty("app.operations.ai-base-url"))
        assertEquals("\${INTERNAL_TOKEN:}", properties.getProperty("app.operations.internal-token"))
        assertEquals("\${OPERATIONS_RABBITMQ_HOST:localhost}", properties.getProperty("spring.rabbitmq.host"))
        assertEquals("\${OPERATIONS_RABBITMQ_PORT:5672}", properties.getProperty("spring.rabbitmq.port"))
        assertEquals("\${OPERATIONS_RABBITMQ_USER:}", properties.getProperty("spring.rabbitmq.username"))
        assertEquals("\${OPERATIONS_RABBITMQ_PASSWORD:}", properties.getProperty("spring.rabbitmq.password"))
        // A broker outage must not hold a scheduled check for the 60 second default.
        assertEquals("5s", properties.getProperty("spring.rabbitmq.connection-timeout"))
    }
}
