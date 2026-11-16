package ai.storyfork.core.auth.scheduler

import ai.storyfork.core.auth.service.WithdrawalCompletionService
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

/**
 * 유예 기한이 지난 탈퇴 요청을 주기적으로 완료 처리한다. 기본은 꺼져 있고(`app.withdrawal.completion.enabled=false`),
 * 콘텐츠 처리와 크레딧 정책이 정해져 팀이 켤 때까지 아무 일도 하지 않는다. 완료된 요청은 되돌릴 수 없고 이 작업은 Content의 작품을
 * 정리하지 않으므로, Content 연동이 생기기 전에는 켜지 않는다. 회원 식별 정보는 로그에 남기지 않는다.
 * 처리하지 못한(실패하거나 건너뛴) 요청은 [retryDelay] 동안 다시 시도하지 않아서, 계속 실패하는 요청이 batchSize개 이상 쌓여도 뒤의 요청이 밀리지 않는다.
 * shortcut: 건너뛴 요청 목록은 메모리에만 있어 재시작하면 비워지고(그냥 다시 시도한다), 실패 원인을 DB에 남기지 않는다.
 */
@Component
class WithdrawalCompletionJob(
    private val completion: WithdrawalCompletionService,
    @Value("\${app.withdrawal.completion.enabled:false}") private val enabled: Boolean,
    @Value("\${app.withdrawal.completion.batch-size:50}") private val batchSize: Int,
    @Value("\${app.withdrawal.completion.retry-delay:PT6H}") private val retryDelay: Duration,
) {
    private val log = LoggerFactory.getLogger(WithdrawalCompletionJob::class.java)

    /** 다시 시도해도 되는 시각 전까지 건너뛸 요청. */
    private val skipUntil = ConcurrentHashMap<UUID, Instant>()

    @Scheduled(fixedDelayString = "\${app.withdrawal.completion.poll-interval:PT1H}")
    fun poll() {
        if (!enabled) return
        try { runOnce(Instant.now()) } catch (e: RuntimeException) { log.warn("withdrawal completion failed: {}", e.javaClass.simpleName) }
    }

    /**
     * 기한이 지난 요청을 최대 batchSize개 처리하고 처리한 건수를 반환한다. 한 건이 실패해도 나머지는 계속한다.
     * 실패했거나 처리되지 않은 요청은 [retryDelay] 동안 건너뛴다.
     */
    fun runOnce(now: Instant): Int {
        skipUntil.values.removeIf { !it.isAfter(now) }
        var done = 0
        for (id in completion.dueIds(now, batchSize, skipUntil.keys.toList())) {
            try {
                if (completion.complete(id, now)) {
                    done += 1
                } else {
                    // 복구됐거나 회원 행이 없는 등의 이유로 완료하지 못했다. 같은 요청이 계속 대기로 남으면 이 로그가 반복해서 보인다.
                    skipUntil[id] = now.plus(retryDelay)
                    log.warn("withdrawal completion skipped: id={}", id)
                }
            } catch (e: RuntimeException) {
                skipUntil[id] = now.plus(retryDelay)
                log.warn("withdrawal completion failed: id={} error={}", id, e.javaClass.simpleName)
            }
        }
        return done
    }
}
