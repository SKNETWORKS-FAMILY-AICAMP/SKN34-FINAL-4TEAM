package ai.storyfork.core.auth.scheduler

import ai.storyfork.core.auth.service.WithdrawalCompletionService
import java.time.Instant
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * 유예 기한이 지난 탈퇴 요청을 주기적으로 완료 처리한다. 기본은 꺼져 있고(`app.withdrawal.completion.enabled=false`),
 * 콘텐츠 처리와 크레딧 정책이 정해져 팀이 켤 때까지 아무 일도 하지 않는다. 회원 식별 정보는 로그에 남기지 않는다.
 */
@Component
class WithdrawalCompletionJob(
    private val completion: WithdrawalCompletionService,
    @Value("\${app.withdrawal.completion.enabled:false}") private val enabled: Boolean,
    @Value("\${app.withdrawal.completion.batch-size:50}") private val batchSize: Int,
) {
    private val log = LoggerFactory.getLogger(WithdrawalCompletionJob::class.java)

    @Scheduled(fixedDelayString = "\${app.withdrawal.completion.poll-interval:PT1H}")
    fun poll() {
        if (!enabled) return
        try { runOnce(Instant.now()) } catch (e: RuntimeException) { log.warn("withdrawal completion failed: {}", e.javaClass.simpleName) }
    }

    /** 기한이 지난 요청을 최대 batchSize개 처리하고 처리한 건수를 반환한다. 한 건이 실패해도 나머지는 계속한다. */
    fun runOnce(now: Instant): Int {
        var done = 0
        for (id in completion.dueIds(now, batchSize)) {
            try {
                if (completion.complete(id, now)) done += 1
            } catch (e: RuntimeException) {
                log.warn("withdrawal completion failed: id={} error={}", id, e.javaClass.simpleName)
            }
        }
        return done
    }
}
