package ai.storyfork.content.proposal

import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import ai.storyfork.content.context.service.dto.StoryContextResponse
import ai.storyfork.content.context.service.dto.SelectionResponse
import ai.storyfork.content.proposal.config.GenerationClientConfig
import ai.storyfork.content.proposal.client.dto.GenerationPayload
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

/** 기존 Core의 생성 전용 transport 회귀를 실제 소유 서비스로 이동. CI 전용이다. */
class GenerationClientConfigIntegrationTest {
    @Test fun generationCanWaitBeyondHealthDeadline() {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val executor=Executors.newCachedThreadPool()
        server.executor=executor
        try {
            server.createContext("/internal/v1/proposals") { exchange ->
                Thread.sleep(250)
                val body="""{"text":"제안","model":"test","providerResponseId":"test","usage":null}""".toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.set("Content-Type","application/json")
                exchange.sendResponseHeaders(200,body.size.toLong())
                exchange.responseBody.use { it.write(body) };exchange.close()
            }
            server.start()
            val properties=AiServiceClientProperties(URI.create("http://127.0.0.1:${server.address.port}"),Duration.ofSeconds(1),Duration.ofMillis(50))
            val client=GenerationClientConfig().generationClient(RestClient.builder(),properties,Duration.ofSeconds(2),"test")
            val context=StoryContextResponse("test","",1,"",emptyList(),"",emptyList(),SelectionResponse(0,0))
            assertEquals("제안",client.generate(GenerationPayload(context,"test")).text)
            assertThrows(IllegalArgumentException::class.java) { GenerationClientConfig().generationClient(RestClient.builder(),properties,Duration.ZERO,"test") }
        } finally {
            server.stop(0);executor.shutdownNow()
            assertTrue(executor.awaitTermination(2,TimeUnit.SECONDS))
        }
    }
}
