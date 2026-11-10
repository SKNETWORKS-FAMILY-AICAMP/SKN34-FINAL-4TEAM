package ai.storyfork.content.proposal.service

import ai.storyfork.content._common.exception.ContentFailure
import jakarta.annotation.PreDestroy
import org.springframework.stereotype.Service
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.io.IOException
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean

/** 영속 cursor를 재조회하므로 연결 종료·서버 재시작은 새 실행을 만들지 않는다. */
@Service
class AiRunStreamService(private val runs: AiRunService) {
    // shortcut: 프로세스당 동시 구독 8개, 시연 이후 연결 수요가 커지면 비차단 전송으로 바꾼다.
    private val workers=ThreadPoolExecutor(0,8,30,TimeUnit.SECONDS,SynchronousQueue(),ThreadFactory { task ->
        Thread(task,"ai-run-sse").apply {isDaemon=true}
    })

    fun open(workId: String,subject: String,runId: String,lastId: String?,cursor: String?): SseEmitter {
        val initial=runs.events(workId,subject,runId,lastId,cursor) // 410/인가 실패는 응답 시작 전에 반환한다.
        val emitter=SseEmitter(60_000L)
        val closed=AtomicBoolean(false)
        emitter.onCompletion {closed.set(true)}
        emitter.onTimeout {closed.set(true);emitter.complete()}
        emitter.onError {closed.set(true)}
        try {
            workers.execute {
                var page=initial
                var after=lastId ?: cursor ?: "0"
                var heartbeat=System.nanoTime()
                val deadline=heartbeat+TimeUnit.SECONDS.toNanos(55)
                try {
                    while(!closed.get() && System.nanoTime()<deadline) {
                        for(event in page.events) {
                            if(closed.get()) break
                            emitter.send(SseEmitter.event().id(event.seq.toString()).name("progress").data(event))
                            after=event.seq.toString()
                        }
                        if(after.toLong()==page.lastEventId && page.status !in setOf("pending","running","awaiting_approval")) break
                        if(System.nanoTime()-heartbeat>=TimeUnit.SECONDS.toNanos(15)) {
                            emitter.send(SseEmitter.event().comment("heartbeat"))
                            heartbeat=System.nanoTime()
                        }
                        if(after.toLong()<page.lastEventId) {
                            page=runs.events(workId,subject,runId,after,null)
                            continue
                        }
                        Thread.sleep(1_000)
                        if(closed.get()) break
                        runs.read(workId,subject,runId)
                        page=runs.events(workId,subject,runId,after,null)
                    }
                    emitter.complete()
                } catch(_: IOException) {
                    closed.set(true) // 연결 단절은 취소 신호가 아니다.
                } catch(_: InterruptedException) {
                    Thread.currentThread().interrupt();emitter.complete()
                } catch(_: RuntimeException) {
                    // 응답 시작 후 오류 원문을 보내지 않는다. 같은 run 상태 GET으로 확인한다.
                    emitter.complete()
                }
            }
        } catch(_: RejectedExecutionException) {
            throw ContentFailure(503,"진행 연결이 많아요. 같은 작업의 상태를 조회해 주세요.")
        }
        return emitter
    }

    @PreDestroy fun close() {workers.shutdownNow()}
}
