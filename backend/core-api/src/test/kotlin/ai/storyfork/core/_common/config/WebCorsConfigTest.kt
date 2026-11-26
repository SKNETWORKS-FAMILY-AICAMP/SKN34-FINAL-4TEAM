package ai.storyfork.core._common.config

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.servlet.config.annotation.CorsRegistry

class WebCorsConfigTest {
    private class Registry : CorsRegistry() {
        fun configuration() = getCorsConfigurations().getValue("/api/**")
    }

    @Test fun `configured browser origin can mark a notice read and delete it`() {
        val registry = Registry()
        WebCorsConfig("http://localhost:5173").addCorsMappings(registry)
        val cors = registry.configuration()
        assertNotNull(cors.checkHttpMethod(HttpMethod.PATCH))
        assertNotNull(cors.checkHttpMethod(HttpMethod.DELETE))
        assertEquals("http://localhost:5173", cors.checkOrigin("http://localhost:5173"))
        assertNull(cors.checkOrigin("https://evil.example"))
    }
}
