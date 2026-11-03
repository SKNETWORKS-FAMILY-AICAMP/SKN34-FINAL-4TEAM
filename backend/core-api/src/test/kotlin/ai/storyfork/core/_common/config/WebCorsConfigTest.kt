package ai.storyfork.core._common.config
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.assertEquals
import org.springframework.web.servlet.config.annotation.CorsRegistry
import org.springframework.web.cors.DefaultCorsProcessor
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse

class WebCorsConfigTest {
 private class Registry:CorsRegistry(){fun entries()=getCorsConfigurations()}
 @Test fun directWorldSavePutPassesDevelopmentOrigin() {
  val registry=Registry();WebCorsConfig("http://localhost:5173").addCorsMappings(registry)
  val request=MockHttpServletRequest("PUT","/api/v1/studio/worlds/example")
  request.addHeader("Origin","http://localhost:5173")
  val response=MockHttpServletResponse()
  DefaultCorsProcessor().processRequest(registry.entries().getValue("/api/**"),request,response)
  assertEquals(200,response.status)
 }
}
