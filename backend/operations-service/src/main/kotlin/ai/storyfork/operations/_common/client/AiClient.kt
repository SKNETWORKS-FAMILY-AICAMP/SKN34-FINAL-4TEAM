package ai.storyfork.operations._common.client

import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

data class EvaluationStarted(val runName: String)

data class LeakVerdict(val suspected: Boolean, val reason: String? = null)

/** AI service internal API (X-Internal-Token, see [aiRestClient]): it runs the evaluations and the leak judge but never changes a record. */
class AiClient(private val http: RestClient) {
    /** The AI service answers 202 and keeps running; the Langfuse Dataset Run it names carries the result. */
    fun startEvaluation(dataset: String, prompt: String, version: Int): EvaluationStarted = upstream {
        http.post().uri("/internal/v1/evaluations").contentType(MediaType.APPLICATION_JSON)
            .body(mapOf("dataset" to dataset, "prompt" to prompt, "version" to version)).retrieve().body<EvaluationStarted>()
    }

    /** [references] are the private titles that appeared in [response]; the judge decides whether the response really gave them away. */
    fun leakCheck(response: String, references: List<String>): LeakVerdict = upstream {
        http.post().uri("/internal/v1/evaluations/leak-check").contentType(MediaType.APPLICATION_JSON)
            .body(mapOf("response" to response, "references" to references)).retrieve().body<LeakVerdict>()
    }
}
