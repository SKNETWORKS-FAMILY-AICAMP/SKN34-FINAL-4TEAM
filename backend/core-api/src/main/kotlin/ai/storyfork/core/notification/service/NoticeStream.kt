package ai.storyfork.core.notification.service

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import org.springframework.beans.factory.DisposableBean
import org.springframework.stereotype.Component
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/**
 * 알림 변경 신호(SSE)를 로그인한 본인의 열린 연결로만 보낸다.
 *
 * 신호는 "알림 목록·미읽음 수를 다시 조회하라"는 뜻일 뿐 알림 내용·읽음 상태를 담지 않는다.
 * 알림 정본은 DB이므로 신호가 유실되거나 연결이 끊겨도 재연결 뒤 재조회로 복구되며, 신호 유실 때문에 알림을 다시 만들지 않는다.
 * 연결별 가상 스레드가 전송을 직렬화하며, 대기 신호는 종류별 한 개로 합친다. 느린 연결은 전송 기한 뒤 등록 해제한다.
 * 연결 목록은 이 Core 인스턴스의 메모리에만 있다(단일 Core 전제). 여러 Core 인스턴스로 늘리면 다른 인스턴스에 연결된
 * 회원에게는 신호가 가지 않으므로, 그때는 인스턴스 간 전달(예: 브로커 fan-out)을 추가해야 한다.
 */
@Component
class NoticeStream internal constructor(
    private val emitterFactory: () -> SseEmitter,
    private val sendTimeoutMillis: Long,
) : DisposableBean {
    constructor() : this({ SseEmitter(MAX_LIFETIME_MILLIS) }, SEND_TIMEOUT_MILLIS)

    private val subscribers = ConcurrentHashMap<UUID, CopyOnWriteArrayList<Connection>>()
    private val heartbeat = ScheduledThreadPoolExecutor(1) {
        Thread(it, "notice-stream-heartbeat").apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }
    private val sender = Executors.newVirtualThreadPerTaskExecutor()
    private var destroyed = false

    init {
        heartbeat.scheduleWithFixedDelay({ ping() }, HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS)
    }

    /** 회원 본인의 새 연결을 등록한다. 한 회원의 연결이 너무 많으면 가장 오래된 연결부터 닫는다. */
    fun subscribe(memberId: UUID): SseEmitter {
        val evicted = ArrayList<Connection>()
        val connection = synchronized(this) {
            check(!destroyed) { "Notice stream is closed" }
            val connection = Connection(memberId, emitterFactory())
            connection.emitter.onCompletion { close(connection, complete = false) }
            connection.emitter.onError { close(connection, complete = false) }
            connection.emitter.onTimeout { close(connection) }
            synchronized(connection) {
                subscribers.compute(memberId) { _, current ->
                    val list = current ?: CopyOnWriteArrayList()
                    list.add(connection)
                    while (list.size > MAX_CONNECTIONS_PER_MEMBER) evicted.add(list.removeAt(0))
                    list
                }
                // 동시 변경보다 먼저 ready를 등록하여 재연결 때도 재조회하게 한다.
                dispatch(connection, Signal.READY)
            }
            connection
        }
        evicted.forEach { close(it) }
        return connection.emitter
    }

    /** 본인의 열린 연결로 "변경됨" 신호를 보낸다. 연결이 없으면 아무 일도 하지 않는다. */
    fun notifyChanged(memberId: UUID) {
        subscribers[memberId]?.forEach { dispatch(it, Signal.CHANGED) }
    }

    /** 프록시·브라우저가 유휴 연결을 끊지 않도록 주기적으로 주석 줄을 보낸다. */
    private fun ping() {
        subscribers.values.forEach { list -> list.forEach { dispatch(it, Signal.PING) } }
    }

    private fun dispatch(connection: Connection, signal: Signal) {
        synchronized(connection) {
            if (connection.closed) return
            connection.pending.add(signal)
            if (connection.sending) return
            connection.sending = true
            try {
                sender.execute { deliver(connection) }
            } catch (_: RejectedExecutionException) {
                close(connection)
            }
        }
    }

    private fun deliver(connection: Connection) {
        while (true) {
            val signal = synchronized(connection) {
                if (connection.closed || connection.pending.isEmpty()) {
                    connection.sending = false
                    return
                }
                connection.pending.first().also { connection.pending.remove(it) }
            }
            try {
                val deadline = heartbeat.schedule({ close(connection) }, sendTimeoutMillis, TimeUnit.MILLISECONDS)
                try {
                    val event = when (signal) {
                        Signal.READY -> SseEmitter.event().name(READY_EVENT).data("ok")
                        Signal.CHANGED -> SseEmitter.event().name(CHANGED_EVENT).data("1")
                        Signal.PING -> SseEmitter.event().comment("ping")
                    }
                    connection.emitter.send(event)
                } finally {
                    deadline.cancel(false)
                }
            } catch (_: Exception) {
                close(connection)
                return
            }
        }
    }

    private fun close(connection: Connection, complete: Boolean = true) {
        synchronized(connection) {
            if (connection.closed) return
            connection.closed = true
            connection.pending.clear()
        }
        subscribers.computeIfPresent(connection.memberId) { _, list ->
            list.remove(connection)
            if (list.isEmpty()) null else list
        }
        // ponytail: 기한은 논리적 등록 해제다. complete도 Spring writeLock에서 막힐 수 있어 호출자와 분리한다.
        // 인터럽트로 servlet socket 정리를 보장하지 않는다. 물리적 해제 보장은 컨테이너의 write timeout이 필요하다.
        if (complete) Thread.ofVirtual().name("notice-stream-close").start { runCatching { connection.emitter.complete() } }
    }

    override fun destroy() {
        val connections = synchronized(this) {
            destroyed = true
            subscribers.values.flatten().also { subscribers.clear() }
        }
        connections.forEach { close(it) }
        heartbeat.shutdownNow()
        sender.shutdownNow()
    }

    private enum class Signal { READY, CHANGED, PING }

    private class Connection(val memberId: UUID, val emitter: SseEmitter) {
        val pending = linkedSetOf<Signal>()
        var sending = false
        var closed = false
    }

    companion object {
        const val READY_EVENT = "ready"
        const val CHANGED_EVENT = "changed"
        /** 접속 시 한 번 검증한 인증이 오래 이어지지 않도록 연결 수명을 제한한다. 끝나면 클라이언트가 새 토큰으로 다시 연결한다. */
        const val MAX_LIFETIME_MILLIS = 10 * 60 * 1000L
        const val HEARTBEAT_SECONDS = 20L
        const val MAX_CONNECTIONS_PER_MEMBER = 5
        const val SEND_TIMEOUT_MILLIS = 5_000L
    }
}
