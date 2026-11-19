package ai.storyfork.operations._common

import java.net.URI
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatusCode
import org.springframework.http.MediaType
import org.springframework.http.client.ClientHttpRequest
import org.springframework.http.client.ClientHttpRequestFactory
import org.springframework.http.client.ClientHttpResponse
import org.springframework.mock.http.client.MockClientHttpRequest
import org.springframework.mock.http.client.MockClientHttpResponse
import org.springframework.web.util.UriComponentsBuilder
import org.springframework.web.util.UriUtils

/** One request as the server would have seen it. */
data class RecordedCall(val method: HttpMethod, val uri: URI, val headers: HttpHeaders, val body: String) {
    /** Decoded query parameters in order; a repeated name keeps every value. */
    val query: Map<String, List<String>> = UriComponentsBuilder.fromUri(uri).build().queryParams
        .mapValues { (_, values) -> values.map { UriUtils.decode(it, Charsets.UTF_8) } }
}

data class Reply(val status: Int, val body: String = "")

/** Answers every request from memory and records it: a real RestClient pipeline with no socket, server or Spring context. */
class RecordingRequestFactory(private val answer: (RecordedCall) -> Reply) : ClientHttpRequestFactory {
    val calls = mutableListOf<RecordedCall>()

    override fun createRequest(uri: URI, httpMethod: HttpMethod): ClientHttpRequest = object : MockClientHttpRequest(httpMethod, uri) {
        override fun executeInternal(): ClientHttpResponse {
            val call = RecordedCall(method, getURI(), headers, bodyAsString)
            calls += call
            val reply = answer(call)
            return MockClientHttpResponse(reply.body.toByteArray(), HttpStatusCode.valueOf(reply.status)).also { it.headers.contentType = MediaType.APPLICATION_JSON }
        }
    }
}
