package ai.storyfork.content._common.helper

import java.net.URI
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.mock.http.client.MockClientHttpRequest
import org.springframework.mock.http.client.MockClientHttpResponse
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.web.client.RestClient
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

/**
 * AI 호출에 요청한 회원을 싣는 규칙(DEC-55 추적의 user_id)을 확인한다: 처리 중인 요청의 Authorization을 [USER_AUTHORIZATION_HEADER]로 넘기고,
 * 요청이 없는 스레드(스케줄러 같은 백그라운드)나 Authorization이 없는 요청이면 싣지 않는다. 실제 HTTP 전송은 CI의 AiUserBearerIntegrationTest가 확인한다.
 */
class UserBearerInterceptorTest {
    @AfterEach fun clear() = RequestContextHolder.resetRequestAttributes()

    private fun inbound(authorization: String?) = RequestContextHolder.setRequestAttributes(
        ServletRequestAttributes(MockHttpServletRequest().apply { authorization?.let { addHeader("Authorization", it) } }))

    /** 인터셉터를 한 번 통과한 요청이 AI로 나갈 때의 [USER_AUTHORIZATION_HEADER] 값이다(헤더가 없으면 null). */
    private fun outgoing(): String? {
        var sent: String? = null
        val execution = ClientHttpRequestExecution { request, _ ->
            sent = request.headers.getFirst(USER_AUTHORIZATION_HEADER)
            MockClientHttpResponse(ByteArray(0), HttpStatus.OK)
        }
        UserBearerInterceptor.intercept(MockClientHttpRequest(HttpMethod.POST, URI("http://ai.test/internal/v1/x")), ByteArray(0), execution)
        return sent
    }

    private fun interceptors(client: RestClient): List<ClientHttpRequestInterceptor> {
        var seen = emptyList<ClientHttpRequestInterceptor>()
        client.mutate().requestInterceptors { seen = it.toList() }
        return seen
    }

    @Test fun `the bearer of the request being handled is forwarded as it came`() {
        inbound("Bearer member-token")

        assertEquals("X-User-Authorization", USER_AUTHORIZATION_HEADER) // AI와 집필 AI 오케스트레이션이 읽는 이름이다
        assertEquals("Bearer member-token", outgoing())
    }

    @Test fun `nothing is forwarded without a request or without an authorization`() {
        assertNull(outgoing())
        inbound(null)
        assertNull(outgoing())
        inbound("  ")
        assertNull(outgoing())
    }

    @Test fun `a background thread has no request even while another thread handles one`() {
        inbound("Bearer member-token")
        var background: String? = "unset"

        Thread { background = outgoing() }.also { it.start() }.join()

        assertNull(background)
        assertEquals("Bearer member-token", outgoing())
    }

    @Test fun `only a client built with forwardUser carries the interceptor`() {
        val base = URI("http://127.0.0.1:9")
        val plain = buildRestClient(RestClient.builder(), base, java.time.Duration.ofSeconds(1), java.time.Duration.ofSeconds(1))
        val forwarding = buildRestClient(RestClient.builder(), base, java.time.Duration.ofSeconds(1), java.time.Duration.ofSeconds(1), forwardUser = true)

        assertFalse(UserBearerInterceptor in interceptors(plain))
        assertTrue(UserBearerInterceptor in interceptors(forwarding))
    }
}
