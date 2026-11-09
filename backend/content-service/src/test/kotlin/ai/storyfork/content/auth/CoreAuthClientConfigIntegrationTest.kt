package ai.storyfork.content.auth

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.config.CoreAuthClientConfig
import ai.storyfork.content.auth.client.config.CoreAuthClientProperties
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.service.MemberNicknameService
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URI
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
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
        var body="""{"memberId":"12345678-1234-4234-8234-123456789abc"}"""
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
            repeat(2) {assertEquals("12345678-1234-4234-8234-123456789abc",service.verify("Bearer user-token").toString())}
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

    @Test fun `nickname lookup sends only the id list with the service credential and every failure is a 503`() {
        val server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        val executor=Executors.newCachedThreadPool()
        server.executor=executor
        val seen=CopyOnWriteArrayList<Map<String,String?>>()
        var status=200
        var body="""{"nicknames":{"12345678-1234-4234-8234-123456789abc":"작가"}}"""
        server.createContext("/internal/v1/members/nicknames") { exchange ->
            try {
                seen+=mapOf("method" to exchange.requestMethod,"token" to exchange.requestHeaders.getFirst("X-Content-Service-Token"),
                    "authorization" to exchange.requestHeaders.getFirst("Authorization"),"type" to exchange.requestHeaders.getFirst("Content-Type"),
                    "body" to String(exchange.requestBody.readAllBytes()))
                exchange.responseHeaders.add("Content-Type","application/json")
                if(status==302) exchange.responseHeaders.add("Location","/redirect-target")
                val bytes=body.toByteArray()
                exchange.sendResponseHeaders(status,bytes.size.toLong())
                exchange.responseBody.use {it.write(bytes)}
            } finally {exchange.close()}
        }
        server.start()
        try {
            val properties=CoreAuthClientProperties(URI.create("http://127.0.0.1:${server.address.port}"),Duration.ofSeconds(1),Duration.ofSeconds(3))
            val service=MemberNicknameService(CoreAuthClientConfig().coreMemberClient(RestClient.builder(),properties,"service-credential-0123456789abcdef"))
            val id="12345678-1234-4234-8234-123456789abc"
            assertEquals(mapOf(id to "작가"),service.nicknames(listOf(id,"author")))
            val request=seen.single()
            assertEquals("POST",request["method"])
            assertEquals("service-credential-0123456789abcdef",request["token"])
            assertNull(request["authorization"],"사용자 Bearer는 보내지 않는다")
            assertTrue(request["type"].orEmpty().startsWith("application/json"))
            assertEquals("""{"ids":["$id"]}""",request["body"])
            for(code in listOf(401,403,404,500,503,302)) {
                status=code;body="{}"
                assertEquals(503,assertThrows(ContentFailure::class.java) {service.nicknames(listOf(id))}.status,"HTTP $code")
            }
            status=200;body="{}"
            assertEquals(503,assertThrows(ContentFailure::class.java) {service.nicknames(listOf(id))}.status,"본문에 nicknames가 없는 응답")
            assertEquals(8,seen.size,"재시도 없음")
        } finally {
            server.stop(0);executor.shutdownNow();executor.awaitTermination(2,TimeUnit.SECONDS)
        }
    }
}
