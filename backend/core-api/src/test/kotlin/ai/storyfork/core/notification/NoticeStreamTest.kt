package ai.storyfork.core.notification

import ai.storyfork.core.notification.service.NoticeStream
import java.io.IOException
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.function.Consumer
import kotlin.concurrent.withLock
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

class NoticeStreamTest {
    @Test
    fun `ready and changed are delivered only to the intended member and reconnect gets ready`() {
        val first = ControlledEmitter()
        val second = ControlledEmitter()
        val reconnect = ControlledEmitter()
        withStream(first, second, reconnect) { stream ->
            val member = UUID.randomUUID()
            assertSame(first, stream.subscribe(member))
            stream.subscribe(UUID.randomUUID())
            await { first.events.size == 1 && second.events.size == 1 }
            stream.notifyChanged(member)
            await { first.events.size == 2 }
            assertEquals(listOf("ready", "changed"), first.events.toList())
            assertEquals(listOf("ready"), second.events.toList())
            stream.subscribe(member)
            await { reconnect.events.size == 1 }
            assertEquals(listOf("ready"), reconnect.events.toList())
        }
    }

    @Test
    fun `repeated signals for one slow connection do not occupy every sender and are coalesced`() {
        val slow = ControlledEmitter(blockOn = "ready")
        val healthy = ControlledEmitter()
        withStream(slow, healthy) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            assertTrue(slow.entered.await(1, TimeUnit.SECONDS))
            assertTimeoutPreemptively(Duration.ofSeconds(1)) {
                repeat(5_000) { stream.notifyChanged(member); ping(stream) }
            }
            val healthyMember = UUID.randomUUID()
            stream.subscribe(healthyMember)
            await { healthy.events.size == 1 }
            stream.notifyChanged(healthyMember)
            await { healthy.events.size == 2 }
            assertEquals(1, slow.maximumConcurrentSends.get())
            slow.release.countDown()
            await { slow.events.size == 3 }
            // One pending signal of each kind, rather than an event per notification/heartbeat.
            assertEquals(listOf("ready", "changed", "ping"), slow.events.toList())
        }
    }

    @Test
    fun `four blocked connections cannot starve a healthy member`() {
        val slow = List(4) { ControlledEmitter(blockOn = "ready") }
        val healthy = ControlledEmitter()
        withStream(*(slow + healthy).toTypedArray()) { stream ->
            slow.forEach { stream.subscribe(UUID.randomUUID()) }
            slow.forEach { assertTrue(it.entered.await(1, TimeUnit.SECONDS)) }
            stream.subscribe(UUID.randomUUID())
            await { healthy.events == listOf("ready") }
        }
    }

    @Test
    fun `member cap evicts oldest without waiting for its send or completion`() {
        val slow = ControlledEmitter(blockOn = "ready")
        val others = List(NoticeStream.MAX_CONNECTIONS_PER_MEMBER) { ControlledEmitter() }
        withStream(*(listOf(slow) + others).toTypedArray()) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            assertTrue(slow.entered.await(1, TimeUnit.SECONDS))
            assertTimeoutPreemptively(Duration.ofSeconds(1)) { others.forEach { stream.subscribe(member) } }
            assertTrue(slow.completionRequested.await(1, TimeUnit.SECONDS))
            assertEquals(1L, slow.completed.count, "physical completion is still blocked by the write lock")
            stream.notifyChanged(member)
            others.forEach { emitter -> await { "changed" in emitter.events } }
            slow.release.countDown()
            assertTrue(slow.completed.await(1, TimeUnit.SECONDS))
            assertEquals(listOf("ready"), slow.events.toList())
        }
    }

    @Test
    fun `send deadline logically removes connection even when interruption cannot release write`() {
        val slow = ControlledEmitter(blockOn = "ready")
        val healthy = ControlledEmitter()
        withStream(slow, healthy, timeoutMillis = 100) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            assertTrue(slow.entered.await(1, TimeUnit.SECONDS))
            stream.notifyChanged(member)
            assertTrue(slow.completionRequested.await(1, TimeUnit.SECONDS), "deadline must request completion")
            assertEquals(1L, slow.completed.count)
            assertTimeoutPreemptively(Duration.ofSeconds(1)) { repeat(2_000) { stream.notifyChanged(member) } }
            stream.subscribe(UUID.randomUUID())
            await { healthy.events.size == 1 }
            slow.release.countDown()
            assertTrue(slow.completed.await(1, TimeUnit.SECONDS))
            assertEquals(listOf("ready"), slow.events.toList(), "expired pending changed must not be sent")
        }
    }

    @Test
    fun `failed sends remove the connection and request completion`() {
        val failed = ControlledEmitter(failOn = "changed")
        withStream(failed) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            await { failed.events.size == 1 }
            stream.notifyChanged(member)
            assertTrue(failed.completed.await(1, TimeUnit.SECONDS))
            stream.notifyChanged(member)
            ping(stream)
            assertEquals(listOf("ready", "changed"), failed.events.toList())
        }
    }

    @Test
    fun `servlet timeout removes connection without blocking its callback`() {
        val slow = ControlledEmitter(blockOn = "ready")
        withStream(slow) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            assertTrue(slow.entered.await(1, TimeUnit.SECONDS))
            stream.notifyChanged(member)
            assertTimeoutPreemptively(Duration.ofSeconds(1)) { slow.timeoutCallback.run() }
            assertTrue(slow.completionRequested.await(1, TimeUnit.SECONDS))
            slow.release.countDown()
            assertTrue(slow.completed.await(1, TimeUnit.SECONDS))
            assertEquals(listOf("ready"), slow.events.toList())
        }
    }

    @Test
    fun `completion and error callbacks remove connections`() {
        val completed = ControlledEmitter()
        val errored = ControlledEmitter()
        withStream(completed, errored) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            stream.subscribe(member)
            await { completed.events.size == 1 && errored.events.size == 1 }
            completed.completionCallback.run()
            errored.errorCallback.accept(IOException("disconnected"))
            stream.notifyChanged(member)
            ping(stream)
            assertEquals(listOf("ready"), completed.events.toList())
            assertEquals(listOf("ready"), errored.events.toList())
        }
    }

    @Test
    fun `destroy does not wait for blocked socket cleanup and prevents new subscriptions`() {
        val slow = ControlledEmitter(blockOn = "ready")
        withStream(slow) { stream ->
            val member = UUID.randomUUID()
            stream.subscribe(member)
            assertTrue(slow.entered.await(1, TimeUnit.SECONDS))
            stream.notifyChanged(member)
            assertTimeoutPreemptively(Duration.ofSeconds(1)) { stream.destroy() }
            assertTrue(slow.completionRequested.await(1, TimeUnit.SECONDS))
            assertThrows(IllegalStateException::class.java) { stream.subscribe(member) }
            slow.release.countDown()
            assertTrue(slow.completed.await(1, TimeUnit.SECONDS))
            assertEquals(listOf("ready"), slow.events.toList())
        }
    }

    @Test
    fun `default constructor preserves servlet authentication lifetime`() {
        val stream = NoticeStream()
        try {
            assertEquals(NoticeStream.MAX_LIFETIME_MILLIS, stream.subscribe(UUID.randomUUID()).timeout)
        } finally {
            stream.destroy()
        }
    }

    private fun withStream(vararg emitters: ControlledEmitter, timeoutMillis: Long = 5_000, test: (NoticeStream) -> Unit) {
        val pending = ConcurrentLinkedQueue(emitters.toList())
        val stream = NoticeStream({ pending.remove() }, timeoutMillis)
        try {
            test(stream)
        } finally {
            emitters.forEach { it.release.countDown() }
            stream.destroy()
        }
    }

    private fun ping(stream: NoticeStream) {
        NoticeStream::class.java.getDeclaredMethod("ping").apply { isAccessible = true }.invoke(stream)
    }

    private fun await(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (!condition() && System.nanoTime() < deadline) Thread.sleep(5)
        assertTrue(condition(), "asynchronous condition was not reached")
    }

    /** Models SseEmitter's shared send/complete write lock and a socket ignoring interruption. */
    private class ControlledEmitter(private val blockOn: String? = null, private val failOn: String? = null) : SseEmitter() {
        val events = CopyOnWriteArrayList<String>()
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val completionRequested = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val maximumConcurrentSends = AtomicInteger()
        private val concurrentSends = AtomicInteger()
        lateinit var completionCallback: Runnable
        lateinit var timeoutCallback: Runnable
        lateinit var errorCallback: Consumer<Throwable>

        override fun onCompletion(callback: Runnable) { completionCallback = callback }
        override fun onTimeout(callback: Runnable) { timeoutCallback = callback }
        override fun onError(callback: Consumer<Throwable>) { errorCallback = callback }

        override fun send(builder: SseEventBuilder) {
            val concurrent = concurrentSends.incrementAndGet()
            maximumConcurrentSends.accumulateAndGet(concurrent, ::maxOf)
            try {
                writeLock.withLock {
                    val data = builder.build().joinToString("") { it.data.toString() }
                    val event = when {
                        "event:ready" in data -> "ready"
                        "event:changed" in data -> "changed"
                        else -> "ping"
                    }
                    events.add(event)
                    if (event == failOn) throw IOException("broken socket")
                    if (event == blockOn) {
                        entered.countDown()
                        while (release.count > 0) {
                            try { release.await() } catch (_: InterruptedException) { /* socket may ignore cancellation */ }
                        }
                    }
                }
            } finally {
                concurrentSends.decrementAndGet()
            }
        }

        override fun complete() {
            completionRequested.countDown()
            writeLock.withLock { completed.countDown() }
        }
    }
}
