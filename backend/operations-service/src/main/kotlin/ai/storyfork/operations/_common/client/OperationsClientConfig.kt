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

    @Bean
    fun langfuseClient(@Value("\${app.operations.langfuse-base-url}") baseUrl: String,
        @Value("\${app.operations.langfuse-public-key:}") publicKey: String, @Value("\${app.operations.langfuse-secret-key:}") secretKey: String,
        mapper: JsonMapper) = LangfuseClient(langfuseRestClient(baseUrl, publicKey, secretKey, mapper).build(), mapper)

    @Bean
    fun aiClient(@Value("\${app.operations.ai-base-url}") baseUrl: String,
        @Value("\${app.operations.internal-token:}") token: String, mapper: JsonMapper) =
        AiClient(aiRestClient(baseUrl, token, mapper).build())
}

/** Core and Content: the operations service token only. */
fun operationsRestClient(baseUrl: String, token: String, mapper: JsonMapper): RestClient.Builder =
    jsonRestClient(baseUrl, mapper).defaultHeader("X-Operations-Service-Token", token)

/** Langfuse: the project keys as Basic auth; the service token must never reach it. */
fun langfuseRestClient(baseUrl: String, publicKey: String, secretKey: String, mapper: JsonMapper): RestClient.Builder =
    jsonRestClient(baseUrl, mapper).defaultHeaders { it.setBasicAuth(publicKey, secretKey) }

/** AI service: the internal token only. The leak judge is an LLM call, so the read timeout is longer than the 5 seconds of the others. */
fun aiRestClient(baseUrl: String, token: String, mapper: JsonMapper): RestClient.Builder =
    jsonRestClient(baseUrl, mapper, Duration.ofSeconds(30)).defaultHeader("X-Internal-Token", token)

/** ponytail: fixed short timeouts and no retry; expose properties only if a deployment needs tuning. */
private fun jsonRestClient(baseUrl: String, mapper: JsonMapper, readTimeout: Duration = Duration.ofSeconds(5)): RestClient.Builder {
    val http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(2)).build()
    return RestClient.builder().baseUrl(baseUrl)
        .requestFactory(JdkClientHttpRequestFactory(http).apply { setReadTimeout(readTimeout) })
        .configureMessageConverters { it.withJsonConverter(JacksonJsonHttpMessageConverter(mapper)) }
}

/**
 * A preserved Content 4xx whose own message is shown to the admin as is, so the admin can read why a record cannot be handled.
 * Only a call that opts in with `keepMessage` raises it: Content failure texts never embed raw or database content.
 * [code] is Content's own error code (for example GENRE_NAME_TAKEN) when its body had one, so the screen can tell two 409 apart.
 */
class UpstreamRejection(status: HttpStatusCode, val userMessage: String, cause: Throwable, val code: String? = null) : ResponseStatusException(status, null, cause)

private val detailReader = JsonMapper.builder().build()

/** The text of one field (`detail` or `code`) of Content's `{ "detail": …, "code": … }` error body; null for an empty, non-JSON or text-less body. UTF-8 is read from the bytes, not a header charset. */
private fun RestClientResponseException.upstreamText(field: String): String? = try {
    detailReader.readTree(responseBodyAsByteArray).path(field).takeIf { it.isString }?.stringValue()?.takeIf { it.isNotBlank() }
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
        val message = if (kept && keepMessage) error.upstreamText("detail") else null
        throw if (message != null) UpstreamRejection(error.statusCode, message, error, error.upstreamText("code"))
        else ResponseStatusException(if (kept) error.statusCode else HttpStatus.BAD_GATEWAY, null, error)
    } catch (error: RestClientException) {
        // Keep the cause for server logs; the response body stays the generic UPSTREAM_FAILED DTO.
        throw ResponseStatusException(HttpStatus.BAD_GATEWAY, null, error)
    }
    return result ?: throw ResponseStatusException(HttpStatus.BAD_GATEWAY)
}
