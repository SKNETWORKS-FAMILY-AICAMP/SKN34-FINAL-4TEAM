package ai.storyfork.operations._common

import ai.storyfork.operations._common.exception.OperationsExceptionHandler
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.persistence.OptimisticLockException
import jakarta.validation.ConstraintViolationException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.HttpMethod
import org.springframework.http.HttpStatus
import org.springframework.web.HttpRequestMethodNotSupportedException
import org.springframework.web.servlet.resource.NoResourceFoundException
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.server.ResponseStatusException

/** Calls the advice directly; no Spring context or HTTP dispatcher. */
class OperationsExceptionHandlerTest {
    private val handler = OperationsExceptionHandler()

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
            Triple(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "Invalid request."))) {
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
}
