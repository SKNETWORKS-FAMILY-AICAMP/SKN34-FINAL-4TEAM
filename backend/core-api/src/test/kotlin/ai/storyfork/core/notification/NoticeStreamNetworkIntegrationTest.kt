package ai.storyfork.core.notification

import ai.storyfork.core.notification.service.NoticeStream
import jakarta.servlet.Filter
import jakarta.servlet.ServletOutputStream
import jakarta.servlet.WriteListener
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.servlet.http.HttpServletResponseWrapper
import java.io.BufferedReader
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.apache.catalina.startup.Tomcat
import org.apache.tomcat.util.descriptor.web.FilterDef
import org.apache.tomcat.util.descriptor.web.FilterMap
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext
import org.springframework.web.servlet.DispatcherServlet
import org.springframework.web.servlet.config.annotation.EnableWebMvc
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

/** Real MVC/Tomcat TCP boundary; no application scan, authentication, database or external services. */
class NoticeStreamNetworkIntegrationTest {
    @Test
    fun `blocked TCP write cannot delay notify or healthy SSE and deadline removes stalled subscriber`() {
        val completed = CountDownLatch(2)
        val stream = NoticeStream({
            SseEmitter(NoticeStream.MAX_LIFETIME_MILLIS).apply { onCompletion { completed.countDown() } }
        }, NoticeStream.SEND_TIMEOUT_MILLIS)
        val member = UUID.randomUUID()
        val armed = AtomicBoolean()
        val entered = CountDownLatch(1)
        val exited = CountDownLatch(1)
        val writer = AtomicReference<Thread>()
        val base = Files.createTempDirectory(Path.of(System.getenv("TMPDIR") ?: System.getProperty("java.io.tmpdir")), "notice-tomcat-")
        val tomcat = Tomcat()
        val sockets = mutableListOf<Socket>()
        val mvc = AnnotationConfigWebApplicationContext()
        try {
            tomcat.setBaseDir(base.toString())
            tomcat.setPort(0)
            tomcat.connector.setProperty("address", "127.0.0.1")
            tomcat.connector.setProperty("socket.soTimeout", "15000")
            tomcat.connector.setProperty("socket.txBufSize", "4096")
            val context = tomcat.addContext("", base.toString())
            mvc.register(NetworkConfig::class.java)
            mvc.addBeanFactoryPostProcessor { it.registerSingleton("noticeStream", stream) }
            Tomcat.addServlet(context, "mvc", DispatcherServlet(mvc)).apply {
                isAsyncSupported = true
                loadOnStartup = 1
            }
            context.addServletMappingDecoded("/", "mvc")
            // Transport amplification only: production NoticeStream still builds/sends the real SSE.
            // A single 32 MiB comment saturates kernel buffers deterministically, unlike tiny signals.
            val filter = Filter { request, response, chain ->
                val http = request as HttpServletRequest
                if (!http.requestURI.endsWith("/slow")) {
                    chain.doFilter(request, response)
                } else {
                    chain.doFilter(request, object : HttpServletResponseWrapper(response as HttpServletResponse) {
                        override fun getOutputStream(): ServletOutputStream {
                            val output = super.getOutputStream()
                            return object : ServletOutputStream() {
                                override fun isReady() = output.isReady
                                override fun setWriteListener(listener: WriteListener) = output.setWriteListener(listener)
                                override fun write(value: Int) = write(byteArrayOf(value.toByte()), 0, 1)
                                override fun write(bytes: ByteArray, offset: Int, length: Int) {
                                    if (armed.compareAndSet(true, false)) {
                                        writer.set(Thread.currentThread())
                                        entered.countDown()
                                        try {
                                            val padding = ByteArray(64 * 1024) { 'x'.code.toByte() }
                                            output.write(':'.code)
                                            repeat(512) { output.write(padding); output.flush() }
                                            output.write('\n'.code)
                                        } finally {
                                            exited.countDown()
                                        }
                                    }
                                    output.write(bytes, offset, length)
                                }
                            }
                        }
                    })
                }
            }
            context.addFilterDef(FilterDef().apply {
                filterName = "transport-amplification"
                setFilter(filter)
                asyncSupported = "true"
            })
            context.addFilterMap(FilterMap().apply {
                filterName = "transport-amplification"
                addURLPattern("/*")
            })
            tomcat.start()
            val port = tomcat.connector.localPort
            fun connect(kind: String): BufferedReader {
                val socket = Socket().apply {
                    receiveBufferSize = 1024
                    soTimeout = 2500
                    connect(InetSocketAddress("127.0.0.1", port))
                }
                sockets.add(socket)
                socket.getOutputStream().write("GET /network-test/$member/$kind HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n".toByteArray())
                val reader = socket.getInputStream().bufferedReader()
                assertTrue(reader.readLine().contains("200"))
                readUntil(reader, "event:ready")
                readUntil(reader, "data:ok")
                return reader
            }
            connect("slow") // Stop consuming this actual TCP connection after ready.
            val healthy = connect("healthy")
            armed.set(true)
            val start = System.nanoTime()
            stream.notifyChanged(member)
            assertTrue(entered.await(2, TimeUnit.SECONDS), "amplified servlet write did not start")
            await(2_000) {
                writer.get()?.stackTrace?.any {
                    it.className.startsWith("org.apache.tomcat.util.net.") &&
                        (it.methodName.contains("Write") || it.methodName.contains("write"))
                } == true
            }
            val blockedStack = writer.get().stackTrace.joinToString("\n")
            assertEquals(1L, exited.count, "write must still be physically blocked")
            assertTrue(writer.get().isVirtual, "real send should run on a JDK 21 virtual thread")
            val notifyStart = System.nanoTime()
            assertTimeoutPreemptively(Duration.ofSeconds(1)) { repeat(5_000) { stream.notifyChanged(member) } }
            val notifyMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - notifyStart)
            readUntil(healthy, "event:changed")
            val healthyMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
            assertTrue(healthyMillis < NoticeStream.SEND_TIMEOUT_MILLIS, "healthy delivery must precede slow deadline")
            assertEquals(2, subscriberCount(stream, member))
            await(NoticeStream.SEND_TIMEOUT_MILLIS + 2_000) { subscriberCount(stream, member) == 1 }
            val cleanupMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
            assertEquals(1L, exited.count, "logical deadline must not be confused with physical socket release")
            // Drain flood responses so the next assertion proves delivery after logical cleanup.
            sockets.last().soTimeout = 100
            try { while (healthy.readLine() != null) { /* drain */ } } catch (_: java.net.SocketTimeoutException) { }
            sockets.last().soTimeout = 2500
            stream.notifyChanged(member)
            readUntil(healthy, "event:changed")
            println("NOTICE_TCP_EVIDENCE port=$port healthyMs=$healthyMillis notify5000Ms=$notifyMillis logicalCleanupMs=$cleanupMillis physicallyBlocked=true virtualWriter=true transportAmplificationBytes=${32 * 1024 * 1024}")
            println("NOTICE_TCP_BLOCKED_STACK\n$blockedStack")
            sockets.first().close()
            assertTrue(exited.await(3, TimeUnit.SECONDS), "closing owned peer must release physical write")
            stream.destroy()
            assertTrue(completed.await(3, TimeUnit.SECONDS), "owned servlet async requests must complete before shutdown")
        } finally {
            sockets.forEach { runCatching { it.close() } }
            stream.destroy()
            completed.await(3, TimeUnit.SECONDS)
            tomcat.stop()
            tomcat.destroy()
            mvc.close()
            Files.walk(base).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
        }
    }

    private fun readUntil(reader: BufferedReader, expected: String) {
        while (true) {
            val line = reader.readLine() ?: fail("EOF before $expected")
            if (line == expected) return
        }
    }

    private fun subscriberCount(stream: NoticeStream, member: UUID): Int {
        val field = NoticeStream::class.java.getDeclaredField("subscribers").apply { isAccessible = true }
        val subscribers = field.get(stream) as Map<*, *>
        return (subscribers[member] as? Collection<*>)?.size ?: 0
    }

    private fun await(timeoutMillis: Long, condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
        while (!condition() && System.nanoTime() < deadline) Thread.sleep(10)
        assertTrue(condition(), "network condition not reached within ${timeoutMillis}ms")
    }

    @Configuration(proxyBeanMethods = false)
    @EnableWebMvc
    class NetworkConfig {
        @Bean
        fun networkController(stream: NoticeStream) = NetworkController(stream)
    }

    /** 격리 테스트 서버에서만 실제 NoticeStream의 SSE 응답을 연결한다. */
    @RestController
    class NetworkController(private val stream: NoticeStream) {
        /** 테스트 회원의 SSE 연결을 열며 인증·DB·업무 API를 기동하지 않는다. */
        @GetMapping("/network-test/{member}/{kind}", produces = ["text/event-stream"])
        fun subscribe(@PathVariable member: UUID, @PathVariable kind: String): SseEmitter = stream.subscribe(member)
    }
}
