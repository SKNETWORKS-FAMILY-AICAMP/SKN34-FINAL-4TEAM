package ai.storyfork.core._common.config

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.servlet.config.annotation.CorsRegistry

class WebCorsConfigTest {
    private class Registry : CorsRegistry() {
        fun configuration() = getCorsConfigurations().getValue("/api/**")
    }

    @Test fun `configured browser origin can delete but foreign origins remain rejected`() {
        val registry = Registry()
        WebCorsConfig("http://localhost:5173").addCorsMappings(registry)
        val cors = registry.configuration()
        assertNotNull(cors.checkHttpMethod(org.springframework.http.HttpMethod.DELETE))
        assertEquals("http://localhost:5173", cors.checkOrigin("http://localhost:5173"))
        assertNull(cors.checkOrigin("https://evil.example"))
    }
}
