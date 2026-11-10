package ai.storyfork.operations._common.client

import java.net.http.HttpClient
import java.time.Duration
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpStatus
import org.springframework.http.HttpStatusCode
import org.springframework.http.client.JdkClientHttpRequestFactory
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestClientException
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.server.ResponseStatusException
import tools.jackson.core.JacksonException
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
class OperationsClientConfig {
    @Bean
    fun coreClient(@Value("\${app.operations.core-base-url}") baseUrl: String,
        @Value("\${app.operations.service-token:}") token: String, mapper: JsonMapper) =
        CoreClient(operationsRestClient(baseUrl, token, mapper).build())

    @Bean
    fun contentClient(@Value("\${app.operations.content-base-url}") baseUrl: String,
        @Value("\${app.operations.service-token:}") token: String, mapper: JsonMapper) =
        ContentClient(operationsRestClient(baseUrl, token, mapper).build())
}

/** ponytail: fixed short timeouts and no retry; expose properties only if a deployment needs tuning. */
fun operationsRestClient(baseUrl: String, token: String, mapper: JsonMapper): RestClient.Builder {
    val http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(2)).build()
    return RestClient.builder().baseUrl(baseUrl)
        .requestFactory(JdkClientHttpRequestFactory(http).apply { setReadTimeout(Duration.ofSeconds(5)) })
        .defaultHeader("X-Operations-Service-Token", token)
        .configureMessageConverters { it.withJsonConverter(JacksonJsonHttpMessageConverter(mapper)) }
}

/**
 * A preserved Content 4xx whose own message is shown to the admin as is, so the admin can read why a record cannot be handled.
 * Only a call that opts in with `keepMessage` raises it: Content failure texts never embed raw or database content.
 */
class UpstreamRejection(status: HttpStatusCode, val userMessage: String, cause: Throwable) : ResponseStatusException(status, null, cause)

private val detailReader = JsonMapper.builder().build()

/** The text of Content's `{ "detail": … }` error body; null for an empty, non-JSON or text-less body. UTF-8 is read from the bytes, not a header charset. */
private fun RestClientResponseException.upstreamDetail(): String? = try {
    detailReader.readTree(responseBodyAsByteArray).path("detail").takeIf { it.isString }?.stringValue()?.takeIf { it.isNotBlank() }
} catch (_: JacksonException) {
    null
}

/**
 * Upstream 4xx listed in [preserved] keep their status; any other failure or empty body is 502, never success.
 * With [keepMessage] a preserved failure also carries Content's own detail text ([UpstreamRejection]); every other call keeps only the status.
 */
internal fun <T : Any> upstream(preserved: Set<Int> = setOf(400, 404, 409), keepMessage: Boolean = false, call: () -> T?): T {
    val result = try {
        call()
    } catch (error: RestClientResponseException) {
        val kept = error.statusCode.value() in preserved
        val message = if (kept && keepMessage) error.upstreamDetail() else null
        throw if (message != null) UpstreamRejection(error.statusCode, message, error)
        else ResponseStatusException(if (kept) error.statusCode else HttpStatus.BAD_GATEWAY, null, error)
    } catch (error: RestClientException) {
        // Keep the cause for server logs; the response body stays the generic UPSTREAM_FAILED DTO.
        throw ResponseStatusException(HttpStatus.BAD_GATEWAY, null, error)
    }
    return result ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY)
}
