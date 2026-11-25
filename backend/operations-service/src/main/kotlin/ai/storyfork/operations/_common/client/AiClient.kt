package ai.storyfork.operations._common.client

import java.util.UUID
import org.springframework.http.MediaType
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

data class EvaluationStarted(val runName: String)

data class LeakVerdict(val suspected: Boolean, val reason: String? = null)

/** What the AI service runs each prompt on when the prompt version chose no model, by prompt name; null where it has none to name. */
data class PromptDefaultModels(val models: Map<String, String?>)

/** AI service internal API (X-Internal-Token, see [aiRestClient]): it runs the evaluations and the leak judge but never changes a record. */
class AiClient(private val http: RestClient) {
    /** The AI service answers 202 and keeps running; the Langfuse Dataset Run it names carries the result. */
    fun startEvaluation(dataset: String, prompt: String, version: Int): EvaluationStarted = upstream {
        http.post().uri("/internal/v1/evaluations").contentType(MediaType.APPLICATION_JSON)
            .body(mapOf("dataset" to dataset, "prompt" to prompt, "version" to version)).retrieve().body<EvaluationStarted>()
    }

    /** The model each prompt really runs on when its version names none: only the AI service knows (its environment), so it is asked, never guessed. */
    fun promptDefaultModels(): Map<String, String?> = upstream {
        http.get().uri("/internal/v1/prompts/default-models").retrieve().body<PromptDefaultModels>()
    }.models

    /** Hands a queued operations job run to the AI service (202): a worker there runs it by calling the operations execute API, so the run is only accepted here. */
    fun startJob(runId: UUID, kind: String) {
        upstream {
            http.post().uri("/internal/v1/jobs").contentType(MediaType.APPLICATION_JSON).body(mapOf("runId" to runId, "kind" to kind)).retrieve().toBodilessEntity()
        }
    }

    /**
     * Asks the AI service to improve a prompt version automatically (202, #823): its worker runs GEPA, saves a new unlabelled version and evaluates it on the gate set.
     * Only its 409 (an improvement of that prompt is already running) keeps its status; every other failure is a 502.
     */
    fun startOptimization(prompt: String, version: Int, maxMetricCalls: Int) {
        upstream(preserved = setOf(409)) {
            http.post().uri("/internal/v1/optimizations").contentType(MediaType.APPLICATION_JSON)
                .body(mapOf("prompt" to prompt, "version" to version, "maxMetricCalls" to maxMetricCalls)).retrieve().toBodilessEntity()
        }
    }

    /**
     * [references] are the private titles that appeared in [response]; the judge decides whether the response really gave them away. [question] is what
     * the user asked (null when the trace has none), always sent, so the judge can tell a title the answer gave away from a word it only repeated.
     */
    fun leakCheck(response: String, references: List<String>, question: String? = null): LeakVerdict = upstream {
        http.post().uri("/internal/v1/evaluations/leak-check").contentType(MediaType.APPLICATION_JSON)
            .body(mapOf("response" to response, "references" to references, "question" to question)).retrieve().body<LeakVerdict>()
    }
}
