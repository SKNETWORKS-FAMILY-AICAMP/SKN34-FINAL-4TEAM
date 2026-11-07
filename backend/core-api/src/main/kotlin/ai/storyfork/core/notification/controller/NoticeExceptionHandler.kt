package ai.storyfork.core.notification.controller

import ai.storyfork.core.notification.service.NoticeException
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

/** 알림 업무 실패를 기존과 같은 HTTP 상태로 변환한다. 응답 본문은 기존 오류 처리와 동일하게 상태만 보낸다. */
@RestControllerAdvice(basePackages = ["ai.storyfork.core.notification.controller"])
class NoticeExceptionHandler {
    @ExceptionHandler(NoticeException::class)
    fun handle(exception: NoticeException, response: HttpServletResponse) {
        response.sendError(status(exception.reason).value())
    }

    private fun status(reason: NoticeException.Reason): HttpStatus = when (reason) {
        NoticeException.Reason.INVALID -> HttpStatus.BAD_REQUEST
        NoticeException.Reason.UNAUTHENTICATED -> HttpStatus.UNAUTHORIZED
        NoticeException.Reason.NOT_FOUND -> HttpStatus.NOT_FOUND
    }
}
