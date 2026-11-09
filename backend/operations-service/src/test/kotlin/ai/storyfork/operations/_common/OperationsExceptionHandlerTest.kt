package ai.storyfork.operations._common

import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import ai.storyfork.operations.notice.repository.NoticeRepository
import ai.storyfork.operations.notice.service.NoticeService
import ai.storyfork.operations.notice.service.dto.NoticeRequest
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import ch.qos.logback.classic.spi.ThrowableProxyUtil
import ch.qos.logback.core.read.ListAppender
import jakarta.persistence.OptimisticLockException
import jakarta.validation.ConstraintViolationException
import java.io.IOException
import java.net.ConnectException
import java.nio.charset.StandardCharsets
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.slf4j.LoggerFactory
import org.springframework.context.support.StaticApplicationContext
import org.springframework.core.MethodParameter
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.validation.BeanPropertyBindingResult
import org.springframework.validation.method.MethodValidationResult
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.client.HttpServerErrorException
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver
import org.springframework.web.servlet.resource.NoResourceFoundException
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.http.converter.json.JacksonJsonHttpMessageConverter
import org.springframework.web.server.ResponseStatusException
import tools.jackson.databind.json.JsonMapper

/** Calls the advice directly or through a bare exception resolver; no Spring Boot context or HTTP dispatcher. */
class OperationsExceptionHandlerTest {
    private val handler = OperationsExceptionHandler()
    private val mapper = JsonMapper.builder().build()
    private val logger = LoggerFactory.getLogger(OperationsExceptionHandler::class.java) as Logger
    private val logs = ListAppender<ILoggingEvent>()
    // The inbound query (a member search term) must never reach the log; only the path may.
    private val request = MockHttpServletRequest("GET", "/api/v1/operations/members").apply { queryString = "q=secret-search" }

    @BeforeEach
    fun captureLogs() {
        logs.start()
        logger.addAppender(logs)
    }

    @AfterEach
    fun releaseLogs() {
        logger.detachAppender(logs)
    }

    /** The logged exception followed by its causes. */
    private fun loggedChain(): List<Throwable> =
        generateSequence((logs.list.single().throwableProxy as? ThrowableProxy)?.throwable) { it.cause }.toList()

    /** What reaches the log file: every formatted message plus the messages and frames of any logged throwable. */
    private fun rendered(): String = logs.list.joinToString("\n") { event ->
        event.formattedMessage + (event.throwableProxy?.let { ThrowableProxyUtil.asString(it) } ?: "")
    }

    private fun assertError(response: ResponseEntity<OperationsErrorResponse>, status: Int, code: String, message: String) {
        assertEquals(status, response.statusCode.value())
        assertEquals(OperationsErrorResponse(code, message), response.body)
    }

    @Test
    fun `not found validation and conflict use safe explicit error DTOs`() {
        assertError(handler.notFound(), 404, "NOT_FOUND", "Resource not found.")
        assertError(handler.invalidRequest(), 400, "INVALID_REQUEST", "Invalid request.")
        assertError(handler.conflict(), 409, "CONFLICT", "Resource conflicts with its current state.")
    }

    @Test
    fun `mapping covers malformed input and both persistence conflict families`() {
        val mapping = OperationsExceptionHandler::class.java.declaredMethods
            .filter { it.isAnnotationPresent(ExceptionHandler::class.java) }
            .flatMap { method -> method.getAnnotation(ExceptionHandler::class.java).value.map { it.java to method.name } }
            .toMap()
        for (type in listOf(IllegalArgumentException::class.java, ConstraintViolationException::class.java,
            MethodArgumentTypeMismatchException::class.java, HttpMessageNotReadableException::class.java)) {
            assertEquals("invalidRequest", mapping[type], type.name)
        }
        assertEquals("notFound", mapping[NoSuchElementException::class.java])
        for (type in listOf(OptimisticLockingFailureException::class.java, OptimisticLockException::class.java,
            DataIntegrityViolationException::class.java)) {
            assertEquals("conflict", mapping[type], type.name)
        }
    }

    @Test
    fun `status exceptions do not expose reason or database details`() {
        for ((status, code, message) in listOf(
            Triple(HttpStatus.CONFLICT, "CONFLICT", "Resource conflicts with its current state."),
            Triple(HttpStatus.NOT_FOUND, "NOT_FOUND", "Resource not found."),
            Triple(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Invalid request."),
            Triple(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Authentication required."),
            Triple(HttpStatus.FORBIDDEN, "FORBIDDEN", "Access denied."),
            Triple(HttpStatus.BAD_GATEWAY, "UPSTREAM_FAILED", "Upstream service request failed."))) {
            assertError(handler.responseStatus(ResponseStatusException(status, "private SQL, token or inquiry body"), request),
                status.value(), code, message)
        }
    }

    @Test
    fun `unexpected failures return a generic server error`() {
        assertError(handler.unexpected(IllegalStateException("private token"), request), 500, "INTERNAL_ERROR", "Request could not be completed.")
    }

    @Test
    fun `framework not found and method errors retain their HTTP status rather than becoming 500`() {
        assertError(handler.unexpected(NoResourceFoundException(HttpMethod.GET, "/api/v1/operations/private", "private path"), request),
            404, "NOT_FOUND", "Resource not found.")
        assertError(handler.unexpected(HttpRequestMethodNotSupportedException("PATCH"), request),
            405, "REQUEST_FAILED", "Request could not be completed.")
    }

    @Test
    fun `unexpected failures log their cause at ERROR`() {
        val failure = IllegalStateException("private token", IOException("socket closed"))

        handler.unexpected(failure, request)

        assertEquals(Level.ERROR, logs.list.single().level)
        assertTrue(failure in loggedChain())
    }

    @Test
    fun `upstream failures log only class names upstream status and request path at WARN and keep the generic response`() {
        val unavailable = HttpServerErrorException.create(HttpStatus.SERVICE_UNAVAILABLE, "Service Unavailable", HttpHeaders(),
            ByteArray(0), StandardCharsets.UTF_8)
        val unreachable = ResourceAccessException("I/O error on GET request", ConnectException("Connection refused"))
        val prefix = "Upstream request failed: path=/api/v1/operations/members"

        for ((cause, expected) in listOf(
            unavailable to "$prefix upstreamStatus=503 causes=${unavailable.javaClass.name}",
            unreachable to "$prefix upstreamStatus=- causes=${ResourceAccessException::class.java.name} > ${ConnectException::class.java.name}",
            null to "$prefix upstreamStatus=- causes=-")) {
            logs.list.clear()

            assertError(handler.responseStatus(ResponseStatusException(HttpStatus.BAD_GATEWAY, null, cause), request),
                502, "UPSTREAM_FAILED", "Upstream service request failed.")

            val event = logs.list.single()
            assertEquals(Level.WARN, event.level)
            assertEquals(expected, event.formattedMessage)
            assertNull(event.throwableProxy)
        }
    }

    @Test
    fun `upstream failure logs leave out request queries and upstream response bodies`() {
        val body = """{"detail":"secret-body"}"""
        val causes = listOf(
            ResourceAccessException("I/O error on GET request for \"http://core.test/internal/v1/members?q=secret-search\": connect failed",
                ConnectException("connect failed for http://core.test/internal/v1/members?q=secret-search")),
            HttpServerErrorException.create("503 Service Unavailable: \"$body\"", HttpStatus.SERVICE_UNAVAILABLE,
                "Service Unavailable", HttpHeaders(), body.toByteArray(), StandardCharsets.UTF_8))

        for (cause in causes) handler.responseStatus(ResponseStatusException(HttpStatus.BAD_GATEWAY, null, cause), request)

        assertEquals(2, logs.list.size)
        val logged = rendered()
        val leaked = listOf("secret-search", "secret-body", "connect failed").filter { it in logged }
        assertTrue(leaked.isEmpty(), "leaked into the log: $leaked")
    }

    @Test
    fun `client errors are not logged so request details never reach the log`() {
        for (status in listOf(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)) {
            handler.responseStatus(ResponseStatusException(status, "private SQL, token or inquiry body"), request)
        }
        handler.unexpected(HttpRequestMethodNotSupportedException("PATCH"), request)

        assertTrue(logs.list.isEmpty())
    }

    /** The real advice behind a bare exception resolver, so handler selection is the framework's own. */
    private fun adviceResolver(): ExceptionHandlerExceptionResolver {
        val context = StaticApplicationContext().apply {
            registerSingleton("operationsExceptionHandler", OperationsExceptionHandler::class.java)
            refresh()
        }
        return ExceptionHandlerExceptionResolver().apply {
            setMessageConverters(listOf(JacksonJsonHttpMessageConverter(mapper)))
            setApplicationContext(context)
            afterPropertiesSet()
        }
    }

    @Test
    fun `validation and missing parameter errors answer 400 with the shared error DTO through the real resolver`() {
        val resolver = adviceResolver()
        val parameter = MethodParameter(String::class.java.getMethod("compareTo", String::class.java), 0)

        for (failure in listOf<Exception>(
            MethodArgumentNotValidException(parameter, BeanPropertyBindingResult(Any(), "request")),
            HandlerMethodValidationException(mock(MethodValidationResult::class.java)),
            MissingServletRequestParameterException("q", "String"),
            ResponseStatusException(HttpStatus.BAD_REQUEST, "private body"))) {
            val response = MockHttpServletResponse()

            assertNotNull(resolver.resolveException(MockHttpServletRequest("GET", "/api/v1/operations/members"), response, null, failure))

            assertEquals(400, response.status, failure.javaClass.simpleName)
            assertEquals("""{"code":"INVALID_REQUEST","message":"Invalid request."}""", response.contentAsString, failure.javaClass.simpleName)
        }
    }

    @Test
    fun `non-breaking-space-only input is answered 400 INVALID_REQUEST end to end`() {
        // @NotBlank accepts U+00A0, so the 400 depends on the service's isNotBlank rejection reaching the shared advice.
        // The repository stores whatever it gets, so a missing rejection shows up as a saved notice rather than an accidental NPE.
        val repository = mock(NoticeRepository::class.java)
        doAnswer { it.getArgument<Any>(0) }.`when`(repository).saveAndFlush(any())
        val failure = assertThrows(IllegalArgumentException::class.java) {
            NoticeService(repository).create(NoticeRequest(" ", "본문"))
        }
        val response = MockHttpServletResponse()

        assertNotNull(adviceResolver().resolveException(MockHttpServletRequest("POST", "/api/v1/operations/notices"), response, null, failure))

        assertEquals(400, response.status)
        assertEquals("""{"code":"INVALID_REQUEST","message":"Invalid request."}""", response.contentAsString)
    }

    @Test
    fun `advice also answers errors raised before a controller was chosen`() {
        val resolver = adviceResolver()
        // The handler is null when mapping fails and the static resource handler for unmatched paths.
        fun assertAnswered(handlerOrNull: Any?, failure: Exception, status: Int, code: String) {
            val response = MockHttpServletResponse()
            val resolved = resolver.resolveException(MockHttpServletRequest("GET", "/api/v1/operations/missing"), response, handlerOrNull, failure)
            assertNotNull(resolved, failure.javaClass.simpleName)
            assertEquals(status, response.status)
            assertEquals(code, mapper.readTree(response.contentAsString)["code"].asString())
        }

        assertAnswered(null, NoHandlerFoundException("GET", "/api/v1/operations/missing", HttpHeaders()), 404, "NOT_FOUND")
        assertAnswered(null, HttpRequestMethodNotSupportedException("PATCH"), 405, "REQUEST_FAILED")
        assertAnswered(ResourceHttpRequestHandler(), NoResourceFoundException(HttpMethod.GET, "/api/v1/operations/missing", "missing"), 404, "NOT_FOUND")
        // The 502 handler method takes the servlet request itself, so resolve it through the real argument resolvers too.
        assertAnswered(null, ResponseStatusException(HttpStatus.BAD_GATEWAY, null, ResourceAccessException("I/O error", IOException("down"))),
            502, "UPSTREAM_FAILED")
    }
}
