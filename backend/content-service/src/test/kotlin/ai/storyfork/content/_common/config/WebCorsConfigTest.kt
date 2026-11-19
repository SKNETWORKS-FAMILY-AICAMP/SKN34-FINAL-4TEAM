package ai.storyfork.content._common.config

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.web.servlet.config.annotation.CorsRegistry

class WebCorsConfigTest {
    private class Registry : CorsRegistry() {
        fun configuration() = getCorsConfigurations().getValue("/api/**")
    }

    @Test
    fun `the configured browser origin can send PATCH`() {
        val origin = "http://localhost:5173"
        val registry = Registry()
        WebCorsConfig(origin).addCorsMappings(registry)
        val cors = registry.configuration()

        assertEquals(origin, cors.checkOrigin(origin))
        assertNotNull(cors.checkHttpMethod(HttpMethod.PATCH))
        assertNull(cors.checkOrigin("https://other.example"))
    }
}
