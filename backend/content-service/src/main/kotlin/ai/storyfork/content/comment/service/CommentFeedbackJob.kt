package ai.storyfork.content.comment.service

import ai.storyfork.content.comment.client.CommentFeedbackClient
import ai.storyfork.content.comment.repository.CommentFeedbackStore
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import org.springframework.stereotype.Service
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.client.RestClientResponseException

@Configuration(proxyBeanMethods = false)
class CommentFeedbackScheduler {
    @Bean(defaultCandidate = false)
    fun feedbackScheduler() = ThreadPoolTaskScheduler().apply { setThreadNamePrefix("comment-feedback-") }
}

@Service
class CommentFeedbackJob(private val store: CommentFeedbackStore, private val ai: CommentFeedbackClient) {
    @Scheduled(fixedDelayString = "\${COMMENT_FEEDBACK_INTERVAL_MS:1000}", initialDelayString = "\${COMMENT_FEEDBACK_INTERVAL_MS:1000}",
        scheduler = "feedbackScheduler")
    fun processOne() {
        val jobs = store.claimBatch(ai.leaseSeconds, 8)
        if (jobs.isEmpty()) return
        val prediction = try {
            ai.classifyBatch(jobs.associate { it.id to it.body })
        } catch (error: RestClientResponseException) {
            jobs.forEach { store.fail(it,"AI_HTTP_${error.statusCode.value()}",error.statusCode.is5xxServerError) }
            return
        } catch (error: ResourceAccessException) {
            jobs.forEach { store.fail(it,"AI_CONNECTION_OR_TIMEOUT",true) }
            return
        } catch (error: RuntimeException) {
            jobs.forEach { store.fail(it,"AI_INVALID_RESPONSE",false) }
            return
        }
        jobs.forEach { store.complete(it,prediction.getValue(it.id)) }
    }
}
