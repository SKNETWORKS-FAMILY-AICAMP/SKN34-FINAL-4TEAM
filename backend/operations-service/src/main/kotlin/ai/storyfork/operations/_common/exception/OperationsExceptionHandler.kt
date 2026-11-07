package ai.storyfork.operations._common.exception

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.persistence.OptimisticLockException
import jakarta.validation.ConstraintViolationException
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.ErrorResponse
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.MissingServletRequestParameterException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.web.server.ResponseStatusException

@RestControllerAdvice(basePackages = ["ai.storyfork.operations"])
class OperationsExceptionHandler {
    @ExceptionHandler(NoSuchElementException::class)
    fun notFound(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.status(404).body(OperationsErrorResponse("NOT_FOUND", "Resource not found."))

    @ExceptionHandler(IllegalArgumentException::class, ConstraintViolationException::class,
        MethodArgumentNotValidException::class, HandlerMethodValidationException::class,
        MethodArgumentTypeMismatchException::class, HttpMessageNotReadableException::class,
        MissingServletRequestParameterException::class)
    fun invalidRequest(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.badRequest().body(OperationsErrorResponse("INVALID_REQUEST", "Invalid request."))

    @ExceptionHandler(OptimisticLockingFailureException::class, OptimisticLockException::class, DataIntegrityViolationException::class)
    fun conflict(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.status(409).body(OperationsErrorResponse("CONFLICT", "Resource conflicts with its current state."))

    @ExceptionHandler(ResponseStatusException::class)
    fun responseStatus(error: ErrorResponse): ResponseEntity<OperationsErrorResponse> = when (error.statusCode.value()) {
        400 -> invalidRequest()
        404 -> notFound()
        409 -> conflict()
        else -> ResponseEntity.status(error.statusCode).body(OperationsErrorResponse("REQUEST_FAILED", "Request could not be completed."))
    }

    @ExceptionHandler(Exception::class)
    fun unexpected(error: Exception): ResponseEntity<OperationsErrorResponse> =
        if (error is ErrorResponse) responseStatus(error)
        else ResponseEntity.internalServerError().body(OperationsErrorResponse("INTERNAL_ERROR", "Request could not be completed."))
}
