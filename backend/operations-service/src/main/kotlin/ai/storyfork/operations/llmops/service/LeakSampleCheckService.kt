package ai.storyfork.operations.llmops.service

import ai.storyfork.operations._common.client.AiClient
import ai.storyfork.operations._common.client.ContentClient
import ai.storyfork.operations._common.client.LangfuseClient
import ai.storyfork.operations._common.client.LeakReferences
import ai.storyfork.operations._common.client.LeakVerdict
import ai.storyfork.operations.alert.repository.AlertRuleRepository
import ai.storyfork.operations.alert.service.AlertRaiser
import ai.storyfork.operations.llmops.entity.LeakCheckResultEntity
import ai.storyfork.operations.llmops.repository.LeakCheckResultRepository
import java.time.Instant
import kotlin.random.Random
import org.springframework.stereotype.Service
import org.springframework.web.server.ResponseStatusException

private const val LEAK_RULE = "leak_suspected"

/** Scheduled by the jobs piece (leak_sample_check); this is only the work of one run. */
@Service
class LeakSampleCheckService(
    private val langfuse: LangfuseClient,
    private val content: ContentClient,
    private val ai: AiClient,
    private val settings: LlmopsSettingService,
    private val results: LeakCheckResultRepository,
    private val rules: AlertRuleRepository,
    private val raiser: AlertRaiser,
) {
    /**
     * Samples the Fork-work traces of the window at the configured rate (one draw per eligible trace, in list order; a trace is eligible once a
     * request of it has finished, and a resumed turn is one trace), looks for the origin's private card titles and unpublished episode titles in
     * the answer text (read from the trace's observations when it is drawn), and sends only the matches to the AI judge. Every sampled trace
     * leaves one result (nothing matched is a clean result); a suspicious one raises the leak alert when that rule is switched on.
     * Returns how many answers the judge found suspicious. A failing AI or Content call reaches the caller and keeps the results saved before it.
     * ponytail: titles are matched as plain substrings, so a title that JSON would escape inside an object answer is missed.
     */
    fun run(from: Instant, to: Instant, random: Random = Random.Default): Int {
        val rate = settings.leakSampleRate()
        val sampled = langfuse.allTraces(from, to).map { it.toTraceFact() }.filter { it.status != null && it.fork && it.workId != null }.distinctBy { it.id }
            .filter { random.nextDouble() < rate }
        // Content is asked once per work in a run, an unknown work (null) included.
        val references = HashMap<String, LeakReferences?>()
        var suspicious = 0
        for (trace in sampled) {
            if (results.existsByTraceId(trace.id)) continue
            val workId = checkNotNull(trace.workId)
            val origin = if (workId in references) references[workId] else referencesOf(workId).also { references[workId] = it }
            if (origin == null) continue
            val answer = langfuse.traceObservations(trace.id).traceOutput()?.let { if (it.isString) it.stringValue() else it.toString() }.orEmpty()
            val matched = (origin.privateCardTitles + origin.unpublishedEpisodeTitles).filter { it.isNotBlank() && answer.contains(it) }.distinct()
            val verdict = if (matched.isEmpty()) LeakVerdict(false) else ai.leakCheck(answer, matched)
            results.saveAndFlush(LeakCheckResultEntity(traceId = trace.id, workId = workId, matched = matched, suspected = verdict.suspected, reason = verdict.reason))
            if (verdict.suspected) {
                suspicious++
                // The message never repeats the private titles; the leak check list shows what matched.
                if (rules.findById(LEAK_RULE).map { it.enabled }.orElse(false)) {
                    raiser.raise(LEAK_RULE, "Fork 작품($workId)의 답변에서 원작의 비공개 설정이 드러난 것으로 의심돼요. 누설 검사 결과에서 일치한 ${matched.size}건을 확인하세요", null, trace.id)
                }
            }
        }
        return suspicious
    }

    private fun referencesOf(workId: String): LeakReferences? = try {
        content.leakReferences(workId)
    } catch (error: ResponseStatusException) {
        if (error.statusCode.value() == 404) null else throw error
    }
}
