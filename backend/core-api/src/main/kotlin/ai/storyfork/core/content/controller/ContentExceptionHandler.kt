package ai.storyfork.core.content.controller

import ai.storyfork.core._common.exception.ContentFailure
import ai.storyfork.core.content.service.dto.ContentErrorResponse
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.*
import org.springframework.web.method.annotation.HandlerMethodValidationException
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException
import org.springframework.http.converter.HttpMessageNotReadableException

/** 콘텐츠 API의 기존 상태 코드와 안전한 detail JSON을 보존한다. */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(basePackages=["ai.storyfork.core.work.controller","ai.storyfork.core.episode.controller","ai.storyfork.core.episode_version.controller","ai.storyfork.core.publication.controller","ai.storyfork.core.world.controller","ai.storyfork.core.fork.controller","ai.storyfork.core.context.controller","ai.storyfork.core.proposal.controller"])
class ContentExceptionHandler {
    @ExceptionHandler(ContentFailure::class)
    fun failure(error: ContentFailure): ResponseEntity<ContentErrorResponse> = ResponseEntity.status(error.status).body(ContentErrorResponse(error.message))

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalid(error: MethodArgumentNotValidException): ResponseEntity<ContentErrorResponse> {
        val status=if(error.bindingResult.fieldErrors.any {it.isBindingFailure}) 400 else 422
        return ResponseEntity.status(status).body(ContentErrorResponse("입력 길이·회차·필수 항목을 확인해 주세요."))
    }

    @ExceptionHandler(HandlerMethodValidationException::class)
    fun invalidParameter(): ResponseEntity<ContentErrorResponse> = ResponseEntity.unprocessableContent().body(ContentErrorResponse("입력 길이·회차·필수 항목을 확인해 주세요."))
    @ExceptionHandler(MethodArgumentTypeMismatchException::class,HttpMessageNotReadableException::class,org.springframework.web.bind.MissingServletRequestParameterException::class)
    fun binding(): ResponseEntity<ContentErrorResponse> = ResponseEntity.badRequest().body(ContentErrorResponse("요청 형식과 필수 항목을 확인해 주세요."))
}
