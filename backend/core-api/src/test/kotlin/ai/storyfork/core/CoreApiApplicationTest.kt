package ai.storyfork.core

import org.junit.jupiter.api.Test
import org.springframework.boot.test.context.SpringBootTest

@SpringBootTest(
    properties = [
        "spring.datasource.url=jdbc:h2:mem:context-test",
        "spring.datasource.username=sa",
        "spring.datasource.password=",
        "spring.flyway.enabled=false",
        // Startup-only smoke test; Auth persistence and schema validation run against PostgreSQL.
        "spring.jpa.hibernate.ddl-auto=none",
        "spring.mail.host=127.0.0.1",
        "spring.mail.port=1025",
        "app.auth.public-origin=http://localhost:5173",
        "app.auth.mail-from=dev@example.invalid",
        "AUTH_JWT_SECRET=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        "app.ai-service.base-url=http://127.0.0.1:1",
        "app.ai-service.connect-timeout=10ms",
        "app.ai-service.read-timeout=10ms",
    ],
)
class CoreApiApplicationTest {

    @Test
    fun contextLoadsWithoutRunningFastApi() {
    }
}
