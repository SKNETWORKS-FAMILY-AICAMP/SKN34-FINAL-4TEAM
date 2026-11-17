package ai.storyfork.content.world

import ai.storyfork.content.world.client.*
import ai.storyfork.content.world.service.ManuscriptBuildSource
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

class ManuscriptBuildClientIntegrationTest {
    @Test fun `provider timeout invalid output and rejected input remain distinct without retry`() {
        for((status,code) in listOf(504 to "AI_TIMEOUT",502 to "AI_OUTPUT_INVALID",422 to "AI_REQUEST_REJECTED")) {
            var calls=0
            val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
            server.createContext("/") { exchange ->
                calls++
                assertEquals("qa-token",exchange.requestHeaders.getFirst("X-Internal-Token"))
                exchange.sendResponseHeaders(status,0)
                exchange.responseBody.use { it.write("{}".toByteArray()) }
            }
            server.start()
            try {
                val client=ManuscriptBuildClient(RestClient.builder().baseUrl("http://127.0.0.1:${server.address.port}").build(),"qa-token")
                val failure=assertThrows(InitialWorldCallFailure::class.java) { client.extract(ManuscriptBuildSource(1,"e","v","제목","원문")) }
                assertEquals(code,failure.code);assertEquals(1,calls)
            } finally { server.stop(0) }
        }
    }
}
