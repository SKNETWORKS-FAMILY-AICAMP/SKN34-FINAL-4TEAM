package ai.storyfork.content.auth

import ai.storyfork.content.auth.client.config.CoreAuthClientConfig
import ai.storyfork.content.auth.client.config.CoreAuthClientProperties
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.client.RestClient

/** Real local HTTP transport is hosted integration only, never a local unit test. */
class CoreAuthClientConfigIntegrationTest {
    @Test fun `HTTP service separates credentials rejects redirects and never retries or caches`() {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val executor=Executors.newCachedThreadPool()
        server.executor=executor
        val calls=AtomicInteger()
        val targetCalls=AtomicInteger()
        var status=200
        // 실제 Core 응답처럼 operator도 보내 알 수 없는 필드를 무시하는지 함께 본다.
        var body="""{"memberId":"12345678-1234-4234-8234-123456789abc","operator":false,"nickname":"닉네임"}"""
        var delay=0L
        server.createContext("/internal/v1/auth/verify") { exchange ->
            calls.incrementAndGet()
            try {
                assertEquals("POST",exchange.requestMethod)
                assertEquals("Bearer user-token",exchange.requestHeaders.getFirst("Authorization"))
                assertEquals("service-credential-0123456789abcdef",exchange.requestHeaders.getFirst("X-Content-Service-Token"))
                if(delay>0) Thread.sleep(delay)
                exchange.responseHeaders.add("Content-Type","application/json")
                if(status==302) exchange.responseHeaders.add("Location","/redirect-target")
                val bytes=body.toByteArray()
                exchange.sendResponseHeaders(status,bytes.size.toLong())
                exchange.responseBody.use {it.write(bytes)}
            } finally {exchange.close()}
        }
        server.createContext("/redirect-target") { exchange ->
            targetCalls.incrementAndGet();exchange.sendResponseHeaders(500,-1);exchange.close()
        }
        server.start()
        try {
            // Normal responses use the application default; only the timeout probe gets a short deadline.
            val properties=CoreAuthClientProperties(URI.create("http://127.0.0.1:${server.address.port}"),Duration.ofSeconds(1),Duration.ofSeconds(3))
            val client=CoreAuthClientConfig().coreAuthClient(RestClient.builder(),properties,"service-credential-0123456789abcdef")
            val service=CoreAuthVerificationService(client)
            repeat(2) {
                val verified=service.verify("Bearer user-token")
                assertEquals("12345678-1234-4234-8234-123456789abc",verified.memberId.toString())
                assertEquals("닉네임",verified.nickname)
            }
            assertEquals(2,calls.get())
            status=302
            assertEquals(502,assertThrows(CoreAuthException::class.java) {service.verify("Bearer user-token")}.status)
            assertEquals(0,targetCalls.get())
            status=200;body="{}"
            assertEquals(502,assertThrows(CoreAuthException::class.java) {service.verify("Bearer user-token")}.status)
            status=503;body="{}"
            assertEquals(503,assertThrows(CoreAuthException::class.java) {service.verify("Bearer user-token")}.status)
            assertEquals(5,calls.get())
            status=200;delay=600
            val timeoutService=CoreAuthVerificationService(CoreAuthClientConfig().coreAuthClient(
                RestClient.builder(),properties.copy(readTimeout=Duration.ofMillis(150)),"service-credential-0123456789abcdef"))
            assertEquals(504,assertThrows(CoreAuthException::class.java) {timeoutService.verify("Bearer user-token")}.status)
            assertEquals(6,calls.get())
        } finally {
            server.stop(0);executor.shutdownNow();executor.awaitTermination(2,TimeUnit.SECONDS)
        }
    }
}
