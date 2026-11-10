package ai.storyfork.content.proposal

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content.proposal.client.*
import ai.storyfork.content.proposal.config.GenerationClientConfig
import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient
import tools.jackson.module.kotlin.jacksonMapperBuilder
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration

/** 실제 JDK HTTP 전송과 TASK 09 JSON 계약만 검증한다. 상대 서버는 합성 대역이다. */
class AiRunClientIntegrationTest {
    @Test fun `dispatch and status carry scoped references and distinguish unavailable executor`() {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val token="fixture-service-token-at-least-32-characters"
        var posts=0
        var gets=0
        server.createContext("/internal/v1/ai/runs") { exchange ->
            assertEquals(token,exchange.requestHeaders.getFirst("X-Internal-Token"))
            if(exchange.requestMethod=="POST") {
                posts++
                val body=jacksonMapperBuilder().build().readTree(exchange.requestBody.readAllBytes())
                assertEquals("grant",body.path("grantRef").stringValue())
                assertTrue(body.path("targetRefs").path(0).has("work_id"))
                assertFalse(body.has("prompt"));assertFalse(body.has("context"))
            } else {
                gets++
                assertEquals("grant",exchange.requestHeaders.getFirst("X-Grant-Ref"))
                assertEquals("t",exchange.requestHeaders.getFirst("X-Thread-Ref"))
            }
            val bytes="""{"runId":"r","threadRef":"t","status":"failed","isMock":false,"tasks":[],"error":{"code":"dependency_unavailable","retryable":false}}""".toByteArray()
            exchange.responseHeaders.set("Content-Type","application/json")
            exchange.sendResponseHeaders(if(exchange.requestMethod=="POST") 202 else 200,bytes.size.toLong())
            exchange.responseBody.use {it.write(bytes)};exchange.close()
        }
        server.start()
        try {
            val properties=AiServiceClientProperties(URI("http://127.0.0.1:${server.address.port}"),Duration.ofSeconds(1),Duration.ofSeconds(3))
            val builder=RestClient.builder().messageConverters(listOf(
                org.springframework.http.converter.json.JacksonJsonHttpMessageConverter(jacksonMapperBuilder().build())))
            val client=GenerationClientConfig().aiRunClient(builder,properties,token)
            assertEquals("dependency_unavailable",client.dispatch(dispatchFixture()).error?.code)
            assertEquals("failed",client.status(dispatchFixture()).status)
            assertEquals(1,posts);assertEquals(1,gets)
        } finally {server.stop(0)}
    }
}
