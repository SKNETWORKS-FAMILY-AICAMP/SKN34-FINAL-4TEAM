package ai.storyfork.core.notification.service

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * 알림 변경 신호(SSE)를 로그인한 본인의 열린 연결로만 보낸다.
 *
 * 신호는 "알림 목록·미읽음 수를 다시 조회하라"는 뜻일 뿐 알림 내용·읽음 상태를 담지 않는다.
 * 알림 정본은 DB이므로 신호가 유실되거나 연결이 끊겨도 재연결 뒤 재조회로 복구되며, 신호 유실 때문에 알림을 다시 만들지 않는다.
 * 연결 목록은 이 Core 인스턴스의 메모리에만 있다(단일 Core 전제). 여러 Core 인스턴스로 늘리면 다른 인스턴스에 연결된
 * 회원에게는 신호가 가지 않으므로, 그때는 인스턴스 간 전달(예: 브로커 fan-out)을 추가해야 한다.
 */
@Component
class NoticeStream : DisposableBean {
    private val subscribers = ConcurrentHashMap<UUID, CopyOnWriteArrayList<SseEmitter>>()
    private val heartbeat = Executors.newSingleThreadScheduledExecutor { Thread(it, "notice-stream-heartbeat").apply { isDaemon = true } }

    init {
        heartbeat.scheduleWithFixedDelay({ ping() }, HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS)
    }

    /** 회원 본인의 새 연결을 등록한다. 한 회원의 연결이 너무 많으면 가장 오래된 연결부터 닫는다. */
    fun subscribe(memberId: UUID): SseEmitter {
        val emitter = SseEmitter(MAX_LIFETIME_MILLIS)
        emitter.onCompletion { remove(memberId, emitter) }
        emitter.onError { remove(memberId, emitter) }
        emitter.onTimeout { emitter.complete() }
        val evicted = ArrayList<SseEmitter>()
        subscribers.compute(memberId) { _, current ->
            val list = current ?: CopyOnWriteArrayList()
            list.add(emitter)
            while (list.size > MAX_CONNECTIONS_PER_MEMBER) evicted.add(list.removeAt(0))
            list
        }
        evicted.forEach { runCatching { it.complete() } }
        // 연결 직후와 재연결 직후에 한 번 보내, 끊겨 있던 동안 놓친 변경을 클라이언트가 다시 조회하게 한다.
        send(memberId, emitter, SseEmitter.event().name(READY_EVENT).data("ok"))
        return emitter
    }

    /** 본인의 열린 연결로 "변경됨" 신호를 보낸다. 연결이 없으면 아무 일도 하지 않는다. */
    fun notifyChanged(memberId: UUID) {
        subscribers[memberId]?.forEach { send(memberId, it, SseEmitter.event().name(CHANGED_EVENT).data("1")) }
    }

    /** 프록시·브라우저가 유휴 연결을 끊지 않도록 주기적으로 주석 줄을 보낸다. 끊긴 연결은 이때 정리된다. */
    private fun ping() {
        subscribers.forEach { (memberId, list) -> list.forEach { send(memberId, it, SseEmitter.event().comment("ping")) } }
    }

    private fun send(memberId: UUID, emitter: SseEmitter, event: SseEmitter.SseEventBuilder) {
        try {
            emitter.send(event)
        } catch (_: Exception) {
            remove(memberId, emitter)
            runCatching { emitter.complete() }
        }
    }

    private fun remove(memberId: UUID, emitter: SseEmitter) {
        subscribers.computeIfPresent(memberId) { _, list ->
            list.remove(emitter)
            if (list.isEmpty()) null else list
        }
    }

    override fun destroy() {
        heartbeat.shutdownNow()
        subscribers.values.flatten().forEach { runCatching { it.complete() } }
        subscribers.clear()
    }

    companion object {
        const val READY_EVENT = "ready"
        const val CHANGED_EVENT = "changed"
        /** 접속 시 한 번 검증한 인증이 오래 이어지지 않도록 연결 수명을 제한한다. 끝나면 클라이언트가 새 토큰으로 다시 연결한다. */
        const val MAX_LIFETIME_MILLIS = 10 * 60 * 1000L
        const val HEARTBEAT_SECONDS = 20L
        const val MAX_CONNECTIONS_PER_MEMBER = 5
    }
}
