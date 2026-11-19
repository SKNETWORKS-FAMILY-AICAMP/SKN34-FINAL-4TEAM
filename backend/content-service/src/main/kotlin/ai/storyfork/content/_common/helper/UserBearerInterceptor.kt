package ai.storyfork.content._common.helper

import org.springframework.http.HttpHeaders
import org.springframework.http.HttpRequest
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.http.client.ClientHttpResponse
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes

/** AI 호출에 요청한 회원을 싣는 헤더다. 오케스트레이션([ai.storyfork.content.writingai.client.WritingAiClient])이 쓰는 이름과 같다. */
internal const val USER_AUTHORIZATION_HEADER = "X-User-Authorization"

/**
 * 지금 처리 중인 HTTP 요청의 `Authorization`(Core가 확인한 회원 Bearer)을 AI 호출의 [USER_AUTHORIZATION_HEADER]로 그대로 넘겨 AI가 추적에 회원을 남기게 한다(DEC-55).
 * 요청이 없는 스레드(스케줄러 같은 백그라운드)이거나 Authorization이 없으면 싣지 않는다. [buildRestClient]의 `forwardUser`로 AI 클라이언트에만 단다.
 */
internal object UserBearerInterceptor : ClientHttpRequestInterceptor {
    override fun intercept(request: HttpRequest, body: ByteArray, execution: ClientHttpRequestExecution): ClientHttpResponse {
        val bearer = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request?.getHeader(HttpHeaders.AUTHORIZATION)
        if (!bearer.isNullOrBlank()) request.headers.set(USER_AUTHORIZATION_HEADER, bearer)
        return execution.execute(request, body)
    }
}
