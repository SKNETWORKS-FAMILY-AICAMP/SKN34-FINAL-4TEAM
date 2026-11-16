package ai.storyfork.operations._common.exception

import ai.storyfork.operations._common.client.UpstreamRejection
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import jakarta.persistence.OptimisticLockException
import jakarta.servlet.http.HttpServletRequest
import jakarta.validation.ConstraintViolationException
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.OptimisticLockingFailureException
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.ErrorResponse
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.client.RestClientResponseException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException

// No basePackages: a selector never matches errors raised before a controller is chosen (unknown path, wrong method).
@RestControllerAdvice
class OperationsExceptionHandler {
    private val log = LoggerFactory.getLogger(OperationsExceptionHandler::class.java)

    @ExceptionHandler(NoSuchElementException::class)
    fun notFound(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.status(404).body(OperationsErrorResponse("NOT_FOUND", "Resource not found."))

    @ExceptionHandler(IllegalArgumentException::class, ConstraintViolationException::class,
        MethodArgumentTypeMismatchException::class, HttpMessageNotReadableException::class)
    fun invalidRequest(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.badRequest().body(OperationsErrorResponse("INVALID_REQUEST", "Invalid request."))

    @ExceptionHandler(OptimisticLockingFailureException::class, OptimisticLockException::class, DataIntegrityViolationException::class)
    fun conflict(): ResponseEntity<OperationsErrorResponse> =
        ResponseEntity.status(409).body(OperationsErrorResponse("CONFLICT", "Resource conflicts with its current state."))

    // Every Spring ErrorResponse (ResponseStatusException, validation and missing-parameter errors, framework 404/405) reaches
    // unexpected() and is answered here by its status, so none of them needs a handler of its own.
    fun responseStatus(error: ErrorResponse, request: HttpServletRequest): ResponseEntity<OperationsErrorResponse> = when (error.statusCode.value()) {
        400 -> invalidRequest()
        404 -> notFound()
        409 -> conflict()
        401 -> ResponseEntity.status(401).body(OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
        403 -> ResponseEntity.status(403).body(OperationsErrorResponse("FORBIDDEN", "Access denied."))
        502 -> {
            // A RestClient 5xx message embeds the upstream response body and an I/O cause message may embed the URL,
            // so neither message nor stack is logged: only class names, the upstream status and the request path without its query.
            val cause = (error as? Throwable)?.cause
            log.warn("Upstream request failed: path={} upstreamStatus={} causes={}", request.requestURI,
                (cause as? RestClientResponseException)?.statusCode?.value() ?: "-",
                generateSequence(cause) { it.cause }.joinToString(" > ") { it.javaClass.name }.ifEmpty { "-" })
            ResponseEntity.status(502).body(OperationsErrorResponse("UPSTREAM_FAILED", "Upstream service request failed."))
        }
        else -> ResponseEntity.status(error.statusCode).body(OperationsErrorResponse("REQUEST_FAILED", "Request could not be completed."))
    }

    /** Keeps the status and code a plain status exception would get, but shows the upstream's own message instead of the generic one. */
    @ExceptionHandler(UpstreamRejection::class)
    fun upstreamRejected(error: UpstreamRejection, request: HttpServletRequest): ResponseEntity<OperationsErrorResponse> {
        val generic = responseStatus(error, request)
        return ResponseEntity.status(generic.statusCode).body(OperationsErrorResponse(requireNotNull(generic.body).code, error.userMessage))
    }

    @ExceptionHandler(Exception::class)
    fun unexpected(error: Exception, request: HttpServletRequest): ResponseEntity<OperationsErrorResponse> =
        if (error is ErrorResponse) responseStatus(error, request)
        else {
            log.error("Request failed unexpectedly", error)
            ResponseEntity.internalServerError().body(OperationsErrorResponse("INTERNAL_ERROR", "Request could not be completed."))
        }
}
