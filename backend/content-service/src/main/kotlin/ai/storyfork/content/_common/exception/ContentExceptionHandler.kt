package ai.storyfork.content._common.exception

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.service.dto.ContentErrorResponse
import ai.storyfork.content.auth.client.exception.CoreAuthException
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
@RestControllerAdvice(basePackages=["ai.storyfork.content.work.controller","ai.storyfork.content.episode.controller","ai.storyfork.content.episode_version.controller","ai.storyfork.content.publication.controller","ai.storyfork.content.world.controller","ai.storyfork.content.fork.controller","ai.storyfork.content.context.controller","ai.storyfork.content.proposal.controller","ai.storyfork.content.plan.controller","ai.storyfork.content.comment.controller","ai.storyfork.content.manuscript.controller"])
class ContentExceptionHandler {
    @ExceptionHandler(ContentFailure::class)
    fun failure(error: ContentFailure): ResponseEntity<ContentErrorResponse> = ResponseEntity.status(error.status).body(ContentErrorResponse(error.message))

    /** 표시명 조회에 쓰는 Core 호출의 실패(503·504·502)를 500으로 흐리거나 성공으로 숨기지 않고 상태 그대로 전한다. */
    @ExceptionHandler(CoreAuthException::class)
    fun core(error: CoreAuthException): ResponseEntity<ContentErrorResponse> = ResponseEntity.status(error.status).body(ContentErrorResponse(error.message.orEmpty()))

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
