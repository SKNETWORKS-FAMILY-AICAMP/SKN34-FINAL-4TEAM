package ai.storyfork.operations._common

import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import ch.qos.logback.core.read.ListAppender
import jakarta.persistence.OptimisticLockException
import jakarta.validation.ConstraintViolationException
import java.io.IOException
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.context.support.StaticApplicationContext
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.client.ResourceAccessException
import org.springframework.web.servlet.NoHandlerFoundException
import org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver
import org.springframework.web.servlet.resource.NoResourceFoundException
import org.springframework.web.servlet.resource.ResourceHttpRequestHandler
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
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
    private val logger = LoggerFactory.getLogger(OperationsExceptionHandler::class.java) as Logger
    private val logs = ListAppender<ILoggingEvent>()

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
            MethodArgumentNotValidException::class.java, HandlerMethodValidationException::class.java,
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
            assertError(handler.responseStatus(ResponseStatusException(status, "private SQL, token or inquiry body")),
                status.value(), code, message)
        }
    }

    @Test
    fun `unexpected failures return a generic server error`() {
        assertError(handler.unexpected(IllegalStateException("private token")), 500, "INTERNAL_ERROR", "Request could not be completed.")
    }

    @Test
    fun `framework not found and method errors retain their HTTP status rather than becoming 500`() {
        assertError(handler.unexpected(NoResourceFoundException(HttpMethod.GET, "/api/v1/operations/private", "private path")),
            404, "NOT_FOUND", "Resource not found.")
        assertError(handler.unexpected(HttpRequestMethodNotSupportedException("PATCH")),
            405, "REQUEST_FAILED", "Request could not be completed.")
    }

    @Test
    fun `unexpected failures log their cause at ERROR`() {
        val failure = IllegalStateException("private token", IOException("socket closed"))

        handler.unexpected(failure)

        assertEquals(Level.ERROR, logs.list.single().level)
        assertTrue(failure in loggedChain())
    }

    @Test
    fun `upstream failures log the Core or Content cause at WARN and keep the generic response`() {
        val cause = ResourceAccessException("I/O error on GET request", IOException("Connection refused"))

        assertError(handler.responseStatus(ResponseStatusException(HttpStatus.BAD_GATEWAY, null, cause)),
            502, "UPSTREAM_FAILED", "Upstream service request failed.")

        assertEquals(Level.WARN, logs.list.single().level)
        assertTrue(cause in loggedChain())
    }

    @Test
    fun `client errors are not logged so request details never reach the log`() {
        for (status in listOf(HttpStatus.BAD_REQUEST, HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT)) {
            handler.responseStatus(ResponseStatusException(status, "private SQL, token or inquiry body"))
        }
        handler.unexpected(HttpRequestMethodNotSupportedException("PATCH"))

        assertTrue(logs.list.isEmpty())
    }

    @Test
    fun `advice also answers errors raised before a controller was chosen`() {
        val mapper = JsonMapper.builder().build()
        val context = StaticApplicationContext().apply {
            registerSingleton("operationsExceptionHandler", OperationsExceptionHandler::class.java)
            refresh()
        }
        val resolver = ExceptionHandlerExceptionResolver().apply {
            setMessageConverters(listOf(JacksonJsonHttpMessageConverter(mapper)))
            setApplicationContext(context)
            afterPropertiesSet()
        }
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
    }
}
